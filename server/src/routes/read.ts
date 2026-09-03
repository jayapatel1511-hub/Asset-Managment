/**
 * Read endpoints — one per AmsBackend read method. Query strings are validated with zod at the
 * boundary; the resolved CurrentUser (dev auth) is attached by app.ts's onRequest hook.
 *
 * Route shapes are the contract app/src/api/http/index.ts implements. Static segments
 * (`/api/assets/next-id`) are registered before the `:assetId` parameter route and take priority
 * in Fastify's router.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AssetFilter } from "../../../app/src/api/AmsBackend";
import type { AppContext } from "../app";

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

export function registerReadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = ctx.readModel;

  app.get("/api/health", async () => ({ ok: true, dataset: ctx.dataset, now: new Date().toISOString() }));

  app.get("/api/me", async (req) => req.user);

  app.get("/api/dataset", async () => ctx.dataset);

  app.get("/api/assets", async (req) => {
    const q = filterSchema.parse(req.query);
    if (q.query !== undefined) return read.searchAssets(q.query, req.user);
    return read.listAssets(parseFilter(q), req.user);
  });

  app.get("/api/assets/:assetId", async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const asset = await read.getAsset(assetId, req.user);
    if (!asset) return reply.code(404).send({ error: "not_found", assetId });
    return asset;
  });

  app.get("/api/assets/:assetId/history", async (req) => {
    const { assetId } = req.params as { assetId: string };
    return read.getAssetHistory(assetId);
  });

  app.get("/api/assets/:assetId/relationships", async (req) => {
    const { assetId } = req.params as { assetId: string };
    return read.getAssetRelationships(assetId);
  });

  app.get("/api/assets/:assetId/calibrations", async (req) => {
    const { assetId } = req.params as { assetId: string };
    return read.getCalibrationHistory(assetId);
  });

  app.get("/api/assets/:assetId/installations", async (req) => {
    const { assetId } = req.params as { assetId: string };
    return read.getAssetInstallations(assetId);
  });

  app.get("/api/locations", async () => read.listLocations());
  app.get("/api/equipment-models", async () => read.listEquipmentModels());
  app.get("/api/projects", async () => read.listProjects());

  app.get("/api/calibration/due", async (req) => {
    const { horizonDays } = horizonSchema.parse(req.query);
    return read.listCalibrationDue(horizonDays, req.user);
  });

  app.get("/api/sites", async (req) => {
    const q = z.object({ onlyCurrent: z.string().optional() }).parse(req.query);
    return read.listSites(q.onlyCurrent === "1" || q.onlyCurrent === "true");
  });

  app.get("/api/sites/:site/installations", async (req) => {
    const { site } = req.params as { site: string };
    return read.getSiteInstallations(site);
  });

  app.get("/api/installations/:installationId/snapshot", async (req, reply) => {
    const { installationId } = req.params as { installationId: string };
    const { asOf } = z.object({ asOf: z.string().min(4) }).parse(req.query);
    const snapshot = await read.getInstallationSnapshot(installationId, asOf);
    if (!snapshot) return reply.code(404).send({ error: "not_found", installationId });
    return snapshot;
  });

  app.get("/api/reports/fleet-counts", async (req) => read.getFleetCounts(parseFilter(filterSchema.parse(req.query))));

  app.get("/api/reports/calibration-counts", async (req) => {
    const { horizonDays } = horizonSchema.parse(req.query);
    return read.getCalibrationCounts(horizonDays);
  });

  app.get("/api/office-admins", async () => read.listOfficeAdminAssignments());
}
