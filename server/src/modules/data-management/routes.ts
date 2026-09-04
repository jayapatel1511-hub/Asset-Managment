/**
 * Data-management routes — dictionary (read) and quality (read + named commands).
 *
 * Field User is denied the dictionary. Quality issue reads are open to every
 * authenticated role so Field home can route overdue / unknown-due counts here.
 * Writes are OfficeAdmin (office-scoped) or SystemOwner. No PATCH.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app";
import { requireAnyRole, requireRole } from "../../auth/authorize";
import { authOf, type AppRole } from "../../auth/roles";
import { MIGRATIONS_DIR } from "../../db/migrate";
import {
  commandAssignIssue,
  commandMarkFalsePositive,
  commandRunRules,
  commandSetIssueStatus,
  commandVerifyResolution,
  commandWaiveIssue,
  loadIssue,
  issueFromRow,
  canSeeIssue,
  canWriteIssue,
} from "./commands";
import { dictionaryCoverage, ensureDictionary, getDictionaryEntry, listDictionary } from "./dictionary";
import { ensureRules, runQualityRules } from "./engine";
import { listQualityIssues, qualityOverview } from "./queries";

const DICTIONARY_ROLES: AppRole[] = ["OfficeAdmin", "SystemOwner", "ReportReader"];
const WRITE_ROLES: AppRole[] = ["OfficeAdmin", "SystemOwner"];

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function registerDataManagementRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await ensureDictionary(ctx.db);
  await ensureRules(ctx.db);

  app.get("/api/data-management/dictionary", requireRole(...DICTIONARY_ROLES), async (req) => {
    const q = pageQuery.extend({
      entityName: z.string().optional(),
      authorityMode: z.string().optional(),
      classification: z.string().optional(),
    }).parse(req.query);
    return listDictionary(ctx.db, q);
  });

  app.get("/api/data-management/dictionary/coverage", requireRole(...DICTIONARY_ROLES), async () => {
    return dictionaryCoverage(ctx.db, MIGRATIONS_DIR);
  });

  app.get("/api/data-management/dictionary/:entityName/:fieldName", requireRole(...DICTIONARY_ROLES), async (req, reply) => {
    const { entityName, fieldName } = req.params as { entityName: string; fieldName: string };
    const entry = await getDictionaryEntry(ctx.db, entityName, fieldName);
    if (!entry) return reply.code(404).send({ error: "dictionary.notFound" });
    return entry;
  });

  app.get("/api/data-management/quality/overview", requireAnyRole(), async (req) => {
    await maybeEvaluate(ctx);
    return qualityOverview(ctx.db, authOf(req));
  });

  app.get("/api/data-management/quality/rules", requireAnyRole(), async () => {
    await ensureRules(ctx.db);
    const rows = await ctx.db.query(
      "SELECT id, rule_key AS \"ruleKey\", version, domain, severity, owner_user_id AS \"ownerUserId\", schedule, is_active AS \"isActive\", implementation_ref AS \"implementationRef\", title, description FROM data_quality_rule ORDER BY is_active DESC, rule_key"
    );
    return { items: rows.rows };
  });

  app.get("/api/data-management/quality/issues", requireAnyRole(), async (req) => {
    await maybeEvaluate(ctx);
    const q = pageQuery.extend({
      officeId: z.string().optional(),
      domain: z.string().optional(),
      severity: z.string().optional(),
      status: z.string().optional(),
      ownerUserId: z.string().optional(),
      ruleKey: z.string().optional(),
    }).parse(req.query);
    return listQualityIssues(ctx.db, authOf(req), q);
  });

  app.get("/api/data-management/quality/issues/:id", requireAnyRole(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await loadIssue(ctx.db, id);
    if (!row) return reply.code(404).send({ error: "quality.issueNotFound" });
    const user = authOf(req);
    if (!canSeeIssue(user, row.office_location_id)) return reply.code(404).send({ error: "quality.issueNotFound" });
    return issueFromRow(row);
  });

  app.post("/api/data-management/quality/commands/run-rules", requireRole(...WRITE_ROLES), async (req) => {
    const body = z.object({ clientSubmissionId: z.string().min(1) }).parse(req.body);
    return commandRunRules(ctx.db, authOf(req), body.clientSubmissionId);
  });

  app.post("/api/data-management/quality/commands/assign-issue", requireRole(...WRITE_ROLES), async (req, reply) => {
    const user = authOf(req);
    const body = z.object({
      issueId: z.string().min(1),
      ownerUserId: z.string().min(1),
      dueAt: z.string().nullable().optional(),
      clientSubmissionId: z.string().min(1),
      expectedRowVersion: z.number().int(),
    }).parse(req.body);
    const issue = await loadIssue(ctx.db, body.issueId);
    if (issue && !canWriteIssue(user, issue.office_location_id)) {
      return reply.code(403).send({ error: "quality.forbidden", message: "This account is not scoped to administer that issue." });
    }
    return commandAssignIssue(ctx.db, user, body);
  });

  app.post("/api/data-management/quality/commands/set-issue-status", requireRole(...WRITE_ROLES), async (req) => {
    const body = z.object({
      issueId: z.string().min(1),
      status: z.string().min(1),
      clientSubmissionId: z.string().min(1),
      expectedRowVersion: z.number().int(),
    }).parse(req.body);
    return commandSetIssueStatus(ctx.db, authOf(req), body);
  });

  app.post("/api/data-management/quality/commands/waive-issue", requireRole(...WRITE_ROLES), async (req) => {
    const body = z.object({
      issueId: z.string().min(1),
      reason: z.string(),
      approverUserId: z.string(),
      waiverExpiresAt: z.string(),
      clientSubmissionId: z.string().min(1),
      expectedRowVersion: z.number().int(),
    }).parse(req.body);
    return commandWaiveIssue(ctx.db, authOf(req), body);
  });

  app.post("/api/data-management/quality/commands/mark-false-positive", requireRole(...WRITE_ROLES), async (req) => {
    const body = z.object({
      issueId: z.string().min(1),
      note: z.string().default(""),
      clientSubmissionId: z.string().min(1),
      expectedRowVersion: z.number().int(),
    }).parse(req.body);
    return commandMarkFalsePositive(ctx.db, authOf(req), body);
  });

  app.post("/api/data-management/quality/commands/verify-resolution", requireRole(...WRITE_ROLES), async (req) => {
    const body = z.object({
      issueId: z.string().min(1),
      verificationType: z.enum(["RuleReevaluation", "ManualApproved"]),
      note: z.string().optional(),
      approverUserId: z.string().optional(),
      clientSubmissionId: z.string().min(1),
      expectedRowVersion: z.number().int(),
    }).parse(req.body);
    return commandVerifyResolution(ctx.db, authOf(req), body);
  });
}

async function maybeEvaluate(ctx: AppContext): Promise<void> {
  const n = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM data_quality_issue");
  if ((n.rows[0]?.n ?? 0) > 0) return;
  await runQualityRules(ctx.db, {
    requestedBy: "system:quality-engine",
    clientSubmissionId: `quality-initial-${ctx.dataset.asOf ?? "dev"}`,
    requestHash: "initial",
  });
}
