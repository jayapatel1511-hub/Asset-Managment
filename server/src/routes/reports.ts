/**
 * Reporting endpoints (WS-W9). Read-only, over the approved SQL views in `src/db/views.sql`.
 *
 * Eight reports, answering `docs/00-brief.md`'s seven acceptance questions:
 *
 *   GET /api/reports/catalog                      what a caller may read, and from which views
 *   GET /api/reports/fleet                        Q1  what do we own
 *   GET /api/reports/where-who                    Q2  where is asset X · Q3 who has it
 *   GET /api/reports/availability                 Q4  what is available at office Y
 *   GET /api/reports/calibration                  Q5  what needs calibration in the next N days
 *   GET /api/reports/by-project                   Q6  what is assigned to project Z
 *   GET /api/reports/asset-timeline/:assetId      Q7  where was asset X on date D, attached to what
 *   GET /api/reports/site-timeline                Q7  the same question asked of a site
 *   GET /api/reports/utilisation                  what the fleet is actually doing (FR-023…FR-028)
 *
 *   GET  /api/reports/exports/templates           the approved templates for this role
 *   POST /api/reports/exports                     request a governed artifact
 *   GET  /api/reports/exports/:id                 artifact metadata / audit record
 *   GET  /api/reports/exports/:id/download        the private, short-lived artifact
 *
 * `/api/reports/fleet-counts` and `/api/reports/calibration-counts` are deliberately NOT here.
 * They live in `routes/read.ts`, they are what `app/src/api/http/index.ts` already calls, and
 * they are left exactly as they are — a reporting lane that silently changed the numbers two
 * screens already display would be the opposite of the reconciliation this workstream exists to
 * prove. The routes above are additive, and `server/tests/reports.test.ts` asserts the old two
 * still agree with the new ones figure for figure.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Authorization
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every guard here is the shared one from `../auth/authorize` — `requireRole`, and the office
 * predicates in `../auth/roles`. Nothing in this file re-implements a role test, and nothing in
 * it reads a role, an office or a user id out of a query string, body or header (CLAUDE.md
 * rule 1); a body that tries to supply one is refused outright rather than ignored, which is what
 * `refuseClientAuthority` is for.
 *
 * `FieldUser` is not a reporting role. A technician reads the fleet through `/api/assets`, which
 * is unchanged; these aggregates are a different audience (feature 006 US1: "people who do not
 * touch equipment") and a different authorization. `ReportReader` is the audience, and
 * `auth/roles.ts#WRITE_ROLES` excludes it, so "answers the seven questions without operational
 * write access" is enforced by the command routes' own guard rather than asserted here.
 *
 * ── Row scope, and one deliberate difference from routes/read.ts ──
 *
 * `auth/roles.ts#rowsAreScoped` is the authority on WHO is row-scoped: the office-scoped
 * read-only principal, and nobody else. This file uses it unchanged.
 *
 * What it does with the answer differs. `routes/read.ts#refuseUnscopedAggregate` refuses a scoped
 * caller's unfiltered aggregate, on the sound ground that narrowing a total after the fact
 * reports a subtotal as a total. These routes instead filter the rows **in SQL** and then state
 * the population on the face of every response — `scope.offices` is a required field of the
 * envelope, never omitted, never empty-by-implication. That answers the same objection at the
 * point where it actually bites: a scoped total cannot be misread as a fleet total when the
 * document says which offices it covers. It also avoids requiring a Report Reader to know and
 * type their own office name before they may see any figure at all, which is a poor answer for
 * the one role that exists solely to read. Both behaviours are defensible; they are recorded
 * together so the integrator picks one rather than discovering two.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { requireRole } from "../auth/authorize";
import { authOf, rowsAreScoped, scopeCovers, type AppRole, type AuthUser } from "../auth/roles";
import {
  APPROVED_VIEWS,
  EXPORT_TEMPLATES,
  ReportRefusal,
  ReportService,
  RESTRICTED_COLUMNS,
  type ReportFilter,
} from "../services/reportService";

/** The reporting audience. Disjoint from `auth/roles.ts#WRITE_ROLES` on exactly one role —
 * `ReportReader` — which is WS-W9's "without operational write access" as a property of two
 * constants rather than a claim in a document. */
export const REPORT_ROLES: AppRole[] = ["ReportReader", "OfficeAdmin", "SystemOwner"];

/**
 * The offices a report's rows are cut to. `null` means every office.
 *
 * Delegates the policy to `rowsAreScoped` so this lane cannot drift from `routes/read.ts`: if
 * A-R5 is later reversed and administrators become row-scoped too, both surfaces change together
 * because both ask the same question of the same function.
 */
function reportScope(user: AuthUser): string[] | null {
  return rowsAreScoped(user) ? (user.scopedOffices ?? []) : null;
}

// ============================================================================================
// Request shapes
// ============================================================================================

const filterSchema = z.object({
  office: z.string().optional(),
  status: z.string().optional(), // comma-separated, same convention as routes/read.ts
  equipmenttype: z.string().optional(),
  assetgroup: z.string().optional(),
  custodian: z.string().optional(),
  project: z.string().optional(),
  includeRetired: z.string().optional(),
  assetId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

function parseFilter(q: z.infer<typeof filterSchema>): ReportFilter & { assetId?: string } {
  return {
    office: q.office || undefined,
    status: q.status ? q.status.split(",").filter(Boolean) : undefined,
    equipmenttype: q.equipmenttype || undefined,
    assetgroup: q.assetgroup || undefined,
    custodian: q.custodian || undefined,
    project: q.project || undefined,
    includeRetired: q.includeRetired === "1" || q.includeRetired === "true",
    assetId: q.assetId || undefined,
  };
}

const horizonSchema = z.object({ horizonDays: z.coerce.number().int().min(0).max(3650).default(30) });

const utilisationSchema = z.object({
  periodDays: z.coerce.number().int().min(1).max(3650).default(90),
  from: z.string().min(4).optional(),
  to: z.string().min(4).optional(),
});

const timelineSchema = z.object({ from: z.string().min(4).optional(), to: z.string().min(4).optional() });
const siteSchema = z.object({ site: z.string().optional(), asOf: z.string().min(4).optional() });
const projectSchema = z.object({ project: z.string().optional() });

const exportRequestSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  purpose: z.string().min(3).max(500),
  filters: z.record(z.string(), z.string()).default({}),
  clientSubmissionId: z.string().min(1),
});

/**
 * CLAUDE.md rule 1 and `auth-caller-context.md` § "Forbidden client claims", plus
 * `governed-export.md`'s "never trust client-hidden columns".
 *
 * These keys are refused, not ignored. Ignoring a client-supplied column list means a client that
 * believes it chose its own columns receives a plausible file it will then treat as what it asked
 * for; and a request naming a role or an office scope is either a bug or an attempt, and both
 * deserve an answer rather than silence.
 */
const FIELD_AUTHORITY_KEYS = ["columns", "fields", "fieldList", "select", "sql", "query"];
const IDENTITY_AUTHORITY_KEYS = [
  "roles",
  "role",
  "isAdmin",
  "officeIds",
  "scopedOffices",
  "userId",
  "upn",
  "performedByUserId",
  "rowScope",
  "allRows",
];

function refuseClientAuthority(body: unknown): void {
  if (typeof body !== "object" || body === null) return;
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (FIELD_AUTHORITY_KEYS.includes(key)) {
      throw new ReportRefusal("export.fieldForbidden", 400, `"${key}" is server-owned: an export's columns come from its approved template.`);
    }
    if (IDENTITY_AUTHORITY_KEYS.includes(key)) {
      throw new ReportRefusal("auth.error.clientAuthorityForbidden", 400, `"${key}" is resolved from the session, never from the request.`);
    }
  }
}

// ============================================================================================
// Routes
// ============================================================================================

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const reports = new ReportService(ctx.db, ctx.dataset, (assetId) => ctx.readModel.getAssetRelationships(assetId));
  const reader = requireRole(...REPORT_ROLES);

  // No view bootstrap here any more. The eleven approved views are applied by
  // `db/migrations/0012_reporting_views.sql` along with the rest of the schema; this hook used to
  // apply them from `src/db/views.sql` because the migration runner did not exist yet.
  // `ReportService.ready()` now verifies rather than creates.

  /** Structured refusal, in `auth/authorize.ts`'s house shape: a machine code in `error`, a
   * developer-readable message, and nothing that discloses what the caller was not allowed to
   * know. Codes come from `specs/010…/contracts/error-codes.md` and `governed-export.md`. */
  function sendRefusal(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof ReportRefusal) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    throw err;
  }

  /** A client-supplied office filter outside the caller's scope is refused, never silently
   * narrowed — a narrowed answer is one the caller did not ask for and would then misread. */
  function officeFilterRefusal(user: AuthUser, office: string | undefined): ReportRefusal | null {
    if (!office || !rowsAreScoped(user)) return null;
    return scopeCovers(user, office)
      ? null
      : new ReportRefusal("auth.error.officeScope", 403, "That office is outside your report scope.");
  }

  // ---------------------------------------------------------------- catalog

  app.get("/api/reports/catalog", reader, async (req: FastifyRequest) => {
    const user = authOf(req);
    return {
      scope: { offices: reportScope(user), readOnly: true },
      approvedViews: APPROVED_VIEWS,
      // Stated in the payload so a Power BI author or an auditor sees the exclusion without
      // reading the SQL — and so a regression shows up in a response body, not only in a test.
      restrictedColumnsExcluded: RESTRICTED_COLUMNS,
      reports: [
        { id: "fleet", questions: [1], path: "/api/reports/fleet" },
        { id: "where-who", questions: [2, 3], path: "/api/reports/where-who" },
        { id: "availability", questions: [4], path: "/api/reports/availability" },
        { id: "calibration", questions: [5], path: "/api/reports/calibration" },
        { id: "by-project", questions: [6], path: "/api/reports/by-project" },
        { id: "asset-timeline", questions: [7], path: "/api/reports/asset-timeline/:assetId" },
        { id: "site-timeline", questions: [7], path: "/api/reports/site-timeline" },
        { id: "utilisation", questions: [1], path: "/api/reports/utilisation" },
      ],
      exportTemplates: reports.templatesFor(user).map((t) => ({
        id: t.id,
        version: t.version,
        name: t.name,
        classification: t.classification,
        columns: t.fields.map((f) => f.label),
        requiredFilters: t.requiredFilters,
        optionalFilters: t.optionalFilters,
        maxRows: t.maxRows,
      })),
      currency: await reports.currency(),
    };
  });

  // ---------------------------------------------------------------- the eight reports

  app.get("/api/reports/fleet", reader, async (req, reply) => {
    const user = authOf(req);
    const filter = parseFilter(filterSchema.parse(req.query));
    const refusal = officeFilterRefusal(user, filter.office);
    if (refusal) return sendRefusal(reply, refusal);
    return reports.fleet(reportScope(user), filter);
  });

  app.get("/api/reports/where-who", reader, async (req, reply) => {
    const user = authOf(req);
    const q = filterSchema.parse(req.query);
    const filter = parseFilter(q);
    const refusal = officeFilterRefusal(user, filter.office);
    if (refusal) return sendRefusal(reply, refusal);
    return reports.whereWho(reportScope(user), filter, q.limit ?? 500);
  });

  app.get("/api/reports/availability", reader, async (req, reply) => {
    const user = authOf(req);
    const filter = parseFilter(filterSchema.parse(req.query));
    const refusal = officeFilterRefusal(user, filter.office);
    if (refusal) return sendRefusal(reply, refusal);
    return reports.availability(reportScope(user), filter);
  });

  app.get("/api/reports/calibration", reader, async (req: FastifyRequest) => {
    const { horizonDays } = horizonSchema.parse(req.query);
    return reports.calibration(reportScope(authOf(req)), horizonDays);
  });

  app.get("/api/reports/by-project", reader, async (req: FastifyRequest) => {
    const { project } = projectSchema.parse(req.query);
    return reports.byProject(reportScope(authOf(req)), project || null);
  });

  app.get("/api/reports/asset-timeline/:assetId", reader, async (req, reply) => {
    const user = authOf(req);
    const { assetId } = req.params as { assetId: string };
    const range = timelineSchema.parse(req.query);

    // Scope is checked against the asset's own home office BEFORE any history is read: an
    // out-of-scope timeline is refused, not fetched and then filtered. 404 rather than 403,
    // matching `routes/read.ts`'s own choice — a 403 here would confirm the asset exists.
    const homeoffice = await reports.assetHomeOffice(assetId);
    if (homeoffice === undefined) return reply.code(404).send({ error: "not_found", assetId });
    if (rowsAreScoped(user) && !scopeCovers(user, homeoffice)) {
      return reply.code(404).send({ error: "not_found", assetId });
    }
    return reports.assetTimeline(reportScope(user), assetId, range);
  });

  app.get("/api/reports/site-timeline", reader, async (req: FastifyRequest) => {
    const { site, asOf } = siteSchema.parse(req.query);
    return reports.siteTimeline(reportScope(authOf(req)), site || null, asOf ?? new Date().toISOString());
  });

  app.get("/api/reports/utilisation", reader, async (req: FastifyRequest) => {
    const { periodDays, from, to } = utilisationSchema.parse(req.query);
    return reports.utilisation(reportScope(authOf(req)), { periodDays, from, to });
  });

  // ---------------------------------------------------------------- governed exports

  app.get("/api/reports/exports/templates", reader, async (req: FastifyRequest) => {
    const user = authOf(req);
    return {
      templates: reports.templatesFor(user).map((t) => ({
        id: t.id,
        version: t.version,
        name: t.name,
        view: t.view,
        classification: t.classification,
        columns: t.fields.map((f) => f.label),
        requiredFilters: t.requiredFilters,
        optionalFilters: t.optionalFilters,
        maxRows: t.maxRows,
        excludesRestrictedIdentifiers: t.excludesRestrictedIdentifiers,
      })),
      // The whole approved set, so a caller can see that a template they were not offered exists
      // and is simply not theirs — the difference between "no such thing" and "not for you".
      approvedTemplateIds: EXPORT_TEMPLATES.map((t) => `${t.id}@${t.version}`),
    };
  });

  app.post("/api/reports/exports", reader, async (req, reply) => {
    const user = authOf(req);
    try {
      refuseClientAuthority(req.body);
      const body = exportRequestSchema.parse(req.body);
      refuseClientAuthority(body.filters);
      const refusal = officeFilterRefusal(user, body.filters.office);
      if (refusal) throw refusal;
      const artifact = await reports.runExport(user, reportScope(user), body);
      // The local audit sink. In Azure this is the same record into an append-only store; it is
      // already a complete standalone value rather than a set of joins, precisely so the
      // destination can change without the content changing (governed-export.md § 3).
      req.log.info({ governedExport: artifact }, "governed export produced");
      return reply.code(201).send(artifact);
    } catch (err) {
      return sendRefusal(reply, err);
    }
  });

  app.get("/api/reports/exports/:exportId", reader, async (req, reply) => {
    const { exportId } = req.params as { exportId: string };
    try {
      return reports.auditFor(authOf(req), exportId);
    } catch (err) {
      return sendRefusal(reply, err);
    }
  });

  app.get("/api/reports/exports/:exportId/download", reader, async (req, reply) => {
    const user = authOf(req);
    const { exportId } = req.params as { exportId: string };
    try {
      const { csv, artifact } = reports.download(user, exportId);
      req.log.info({ governedExportDownload: { exportId, by: user.upn } }, "governed export downloaded");
      return reply
        .code(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${artifact.templateId}-${exportId.slice(0, 8)}.csv"`)
        // Private by policy, and said out loud: no intermediary may retain a governed artifact.
        .header("cache-control", "no-store, private")
        .header("x-ams-export-id", artifact.exportId)
        .header("x-ams-export-classification", artifact.classification)
        .header("x-ams-export-expires", artifact.expiresAt)
        .send(csv);
    } catch (err) {
      return sendRefusal(reply, err);
    }
  });
}
