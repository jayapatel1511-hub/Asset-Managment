/**
 * Read endpoints — one per AmsBackend read method. Query strings are validated with zod at the
 * boundary; the resolved caller is attached by app.ts's onRequest hook.
 *
 * Route shapes are the contract app/src/api/http/index.ts implements. Static segments
 * (`/api/assets/next-id`) are registered before the `:assetId` parameter route and take priority
 * in Fastify's router.
 *
 * ## The authorization matrix, in the file rather than in the folklore
 *
 * Every route below names its guard between the path and the handler, so the matrix can be read
 * top to bottom:
 *
 *   `/health`, `/api/health`          open — see observability/health.ts (liveness / readiness)
 *   `/api/auth/*`                     see routes/session.ts
 *   every other read                  any authenticated, enabled role
 *   `/api/office-admins`              OfficeAdmin or SystemOwner — it is an administrative surface
 *
 * ## Two filters, not one
 *
 * `services/readModel.ts` already applies FR-030: a non-administrator's asset simply does not
 * contain ICCID, phone number or static IP. That is the floor. This file adds the office
 * dimension the read model structurally cannot, because it is handed a user and an asset
 * separately and never asks whether *this* administrator administers *that* asset's office:
 *
 *   `scopeRestrictedFields`  an administrator reads restricted fields for their own offices only.
 *                            An Ottawa administrator who guesses a Toronto SIM's asset id gets the
 *                            row and no credentials — the direct-object-reference attack returns
 *                            nothing worth having.
 *   `scopeAssetRows`         an office-scoped read-only caller (ReportReader) sees only their own
 *                            offices' rows at all, and a 404 — not a 403 — for anything else,
 *                            because 403 would confirm the row exists.
 *
 * Both are applied on the way out, to every asset-bearing response, rather than being pushed into
 * the query. Same reason the read model gives for its own predicates: one filter that everything
 * passes through cannot drift out of agreement with a second one that some things pass through.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AssetFilter } from "../../../app/src/api/AmsBackend";
import type { Asset, CalibrationCounts } from "../../../app/src/api/types";
import type { AppContext } from "../app";
import { requireAdminRole, requireAnyRole } from "../auth/authorize";
import { authOf, canReadRestrictedFields, owningOffice, publicUser, rowsAreScoped, scopeCovers, type AuthUser } from "../auth/roles";

const filterSchema = z.object({
  office: z.string().optional(),
  status: z.string().optional(), // comma-separated
  equipmenttype: z.string().optional(),
  assetgroup: z.string().optional(),
  custodian: z.string().optional(),
  project: z.string().optional(),
  includeRetired: z.string().optional(),
  query: z.string().optional(),
});

export function parseFilter(q: z.infer<typeof filterSchema>): AssetFilter {
  return {
    office: q.office || undefined,
    status: q.status ? q.status.split(",").filter(Boolean) : undefined,
    equipmenttype: q.equipmenttype || undefined,
    assetgroup: q.assetgroup || undefined,
    custodian: q.custodian || undefined,
    project: q.project || undefined,
    includeRetired: q.includeRetired === "1" || q.includeRetired === "true",
  };
}

const horizonSchema = z.object({ horizonDays: z.coerce.number().int().min(0).max(3650).default(30) });

// ---------------------------------------------------------------- office scope, applied on the way out

/**
 * Withholds restricted SIM/network fields for assets outside the caller's office scope.
 *
 * Runs *after* the read model's FR-030 pass, and only ever nulls more — so composing the two is
 * safe in either order and the existing guarantee cannot be widened by accident.
 */
export function scopeRestrictedFields(asset: Asset, user: AuthUser): Asset {
  if (canReadRestrictedFields(user, owningOffice(asset))) return asset;
  if (asset.identifiervalue === null && asset.phonenumber === null && asset.staticip === null) return asset;
  return { ...asset, identifiervalue: null, phonenumber: null, staticip: null };
}

/** Drops rows outside an office-scoped read-only caller's scope. A no-op for every other role —
 * see auth/roles.ts § "Fleet visibility" for why that is a deliberate line and not an omission. */
export function scopeAssetRows(assets: Asset[], user: AuthUser): Asset[] {
  if (!rowsAreScoped(user)) return assets;
  return assets.filter((a) => scopeCovers(user, owningOffice(a)));
}

/** The whole outbound pass for a list of assets. One function, so no route can apply half of it. */
function scopeAssets(assets: Asset[], user: AuthUser): Asset[] {
  return scopeAssetRows(assets, user).map((a) => scopeRestrictedFields(a, user));
}

/**
 * An office-scoped read-only caller must name one of their own offices on an aggregate report,
 * because an aggregate cannot be filtered after the fact without silently reporting a subtotal as
 * a total. Refusing is the honest answer; quietly substituting their office would not be.
 */
function refuseUnscopedAggregate(user: AuthUser, filter: AssetFilter): { error: string; message: string } | null {
  if (!rowsAreScoped(user)) return null;
  if (filter.office && scopeCovers(user, filter.office)) return null;
  return {
    error: "office_scope_required",
    message: `This account reads one office at a time. Name an office it is scoped to: ${(user.scopedOffices ?? []).join(", ") || "(none)"}.`,
  };
}

export function registerReadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = ctx.readModel;

  /**
   * Asset-keyed sub-resources must 404 the same way GET /api/assets/:id does for an office-scoped
   * reader. History, relationships, calibrations and installations used to answer for any id the
   * caller guessed, which is the insecure-direct-object-reference the detail route already closes.
   */
  async function requireVisibleAsset(req: FastifyRequest, reply: FastifyReply, assetId: string) {
    const user = authOf(req);
    const asset = await read.getAsset(assetId, user);
    if (!asset || scopeAssetRows([asset], user).length === 0) {
      reply.code(404).send({ error: "not_found", assetId, correlationId: req.id });
      return null;
    }
    return asset;
  }

  // Deliberately the resolved principal and nothing else: `publicUser` in auth/roles.ts drops
  // tenant, session and `via`, which are server-side facts.
  app.get("/api/me", requireAnyRole(), async (req: FastifyRequest) => publicUser(authOf(req)));

  app.get("/api/dataset", requireAnyRole(), async () => ctx.dataset);

  app.get("/api/assets", requireAnyRole(), async (req) => {
    const user = authOf(req);
    const q = filterSchema.parse(req.query);
    const assets = q.query !== undefined ? await read.searchAssets(q.query, user) : await read.listAssets(parseFilter(q), user);
    return scopeAssets(assets, user);
  });

  app.get("/api/assets/:assetId", requireAnyRole(), async (req, reply) => {
    const user = authOf(req);
    const { assetId } = req.params as { assetId: string };
    const asset = await read.getAsset(assetId, user);
    // 404 rather than 403 for a row outside an office-scoped reader's scope: a 403 would confirm
    // the asset exists, which is the one bit the insecure-direct-object-reference attack wants.
    if (!asset || scopeAssetRows([asset], user).length === 0) {
      return reply.code(404).send({ error: "not_found", assetId, correlationId: req.id });
    }
    return scopeRestrictedFields(asset, user);
  });

  app.get("/api/assets/:assetId/history", requireAnyRole(), async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    if (!(await requireVisibleAsset(req, reply, assetId))) return;
    return read.getAssetHistory(assetId);
  });

  app.get("/api/assets/:assetId/relationships", requireAnyRole(), async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    if (!(await requireVisibleAsset(req, reply, assetId))) return;
    return read.getAssetRelationships(assetId);
  });

  app.get("/api/assets/:assetId/calibrations", requireAnyRole(), async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    if (!(await requireVisibleAsset(req, reply, assetId))) return;
    return read.getCalibrationHistory(assetId);
  });

  app.get("/api/assets/:assetId/installations", requireAnyRole(), async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    if (!(await requireVisibleAsset(req, reply, assetId))) return;
    return read.getAssetInstallations(assetId);
  });

  app.get("/api/locations", requireAnyRole(), async () => read.listLocations());
  app.get("/api/equipment-models", requireAnyRole(), async () => read.listEquipmentModels());
  app.get("/api/projects", requireAnyRole(), async () => read.listProjects());

  app.get("/api/calibration/due", requireAnyRole(), async (req) => {
    const user = authOf(req);
    const { horizonDays } = horizonSchema.parse(req.query);
    return scopeAssets(await read.listCalibrationDue(horizonDays, user), user);
  });

  app.get("/api/sites", requireAnyRole(), async (req) => {
    const q = z.object({ onlyCurrent: z.string().optional() }).parse(req.query);
    return read.listSites(q.onlyCurrent === "1" || q.onlyCurrent === "true");
  });

  app.get("/api/sites/:site/installations", requireAnyRole(), async (req) => {
    const { site } = req.params as { site: string };
    return read.getSiteInstallations(site);
  });

  app.get("/api/installations/:installationId/snapshot", requireAnyRole(), async (req, reply) => {
    const { installationId } = req.params as { installationId: string };
    const { asOf } = z.object({ asOf: z.string().min(4) }).parse(req.query);
    const snapshot = await read.getInstallationSnapshot(installationId, asOf);
    if (!snapshot) return reply.code(404).send({ error: "not_found", installationId });
    return snapshot;
  });

  app.get("/api/reports/fleet-counts", requireAnyRole(), async (req, reply) => {
    const user = authOf(req);
    const filter = parseFilter(filterSchema.parse(req.query));
    const refusal = refuseUnscopedAggregate(user, filter);
    if (refusal) return reply.code(403).send(refusal);
    return read.getFleetCounts(filter);
  });

  app.get("/api/reports/calibration-counts", requireAnyRole(), async (req) => {
    const user = authOf(req);
    const { horizonDays } = horizonSchema.parse(req.query);
    const counts = await read.getCalibrationCounts(horizonDays);
    if (!rowsAreScoped(user)) return counts;
    // Per-office already, so narrowing it is exact rather than an approximation — no aggregate is
    // recomputed and no subtotal is presented as a total.
    const byOffice: CalibrationCounts["byOffice"] = {};
    for (const [office, bucket] of Object.entries(counts.byOffice)) if (scopeCovers(user, office)) byOffice[office] = bucket;
    return { ...counts, byOffice };
  });

  // An administrative surface: who administers which office. Restricted to administrators, and
  // *not* office-scoped for reading — an Ottawa administrator being able to see that Toronto has
  // no administrator assigned is FR-027a's gap signal working, not a leak.
  app.get("/api/office-admins", requireAdminRole(), async () => read.listOfficeAdminAssignments());
}
