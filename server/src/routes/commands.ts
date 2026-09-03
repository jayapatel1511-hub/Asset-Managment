/**
 * Write endpoints. Phase 1 registers them as explicit "not implemented" refusals so the app's
 * screens get a SubmissionError (`{ ok: false, reason }`) they already know how to display,
 * rather than a 404 the http adapter would surface as a network failure and the offline queue
 * would keep retrying. Phase 2 replaces the bodies with the atomic transaction service.
 */
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app";

const NOT_YET = { ok: false as const, reason: "This write is not implemented on the local API yet (POC phase 1: reads only)." };

export function registerCommandRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const stub = async () => NOT_YET;
  app.post("/api/commands/:type", stub);
  app.post("/api/calibrations", stub);
  app.post("/api/assets", stub);
  app.get("/api/assets/next-id", async () => {
    // Registration lands in phase 3; until then the admin screen gets an explicit placeholder.
    return { assetId: "—" };
  });
  app.post("/api/deployments", stub);
  app.post("/api/recoveries", stub);
  app.post("/api/component-swaps", stub);
  app.post("/api/configuration-changes", stub);
  app.put("/api/office-admins/:office", stub);
}
