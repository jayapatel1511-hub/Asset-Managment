/**
 * Liveness and readiness per specs/010-web-application-platform/contracts/health-and-read.md.
 *
 * Pair chosen (and documented in server/README.md):
 *   GET /health and GET /api/health     liveness — process up, 200 even if the database blips
 *   GET /health/ready and GET /api/health/ready
 *                                       readiness — database must be ok for traffic promotion
 *
 * `dataset` and `ok` are extra fields kept so existing probes that read the previous `{ ok, dataset }`
 * shape still work. They disclose no rows.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HealthCheckResult, HealthResponse, HealthStatus } from "../../../packages/contracts/src/platform";
import type { AppContext } from "../app";
import { CORRELATION_HEADER } from "./correlation";
import { processMetrics } from "./metrics";

const API_VERSION = process.env.AMS_VERSION ?? process.env.AMS_GIT_SHA ?? "0.1.0";

interface HealthBody extends HealthResponse {
  ok: boolean;
  dataset: AppContext["dataset"];
  correlationId: string;
}

async function probeDatabase(ctx: AppContext): Promise<{ database: HealthCheckResult; schemaVersion?: string }> {
  try {
    await ctx.db.query("SELECT 1 AS ok");
    const ledger = await ctx.db.query<{ version: number | null }>("SELECT MAX(version)::int AS version FROM schema_migration");
    const version = ledger.rows[0]?.version;
    return {
      database: "ok",
      schemaVersion: version != null ? String(version).padStart(4, "0") : undefined,
    };
  } catch {
    return { database: "fail" };
  }
}

function body(
  req: FastifyRequest,
  ctx: AppContext,
  checks: { database: HealthCheckResult; schemaVersion?: string },
  status: HealthStatus,
): HealthBody {
  return {
    status,
    version: API_VERSION,
    schemaVersion: checks.schemaVersion,
    checks: { database: checks.database },
    time: new Date().toISOString(),
    ok: status !== "unavailable",
    dataset: ctx.dataset,
    correlationId: req.id,
  };
}

async function liveness(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): Promise<HealthBody> {
  const checks = await probeDatabase(ctx);
  const status: HealthStatus = checks.database === "ok" ? "ok" : "degraded";
  reply.header(CORRELATION_HEADER, req.id);
  return body(req, ctx, checks, status);
}

async function readiness(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): Promise<HealthBody> {
  const checks = await probeDatabase(ctx);
  const status: HealthStatus = checks.database === "ok" ? "ok" : "unavailable";
  reply.header(CORRELATION_HEADER, req.id);
  if (status === "unavailable") reply.code(503);
  return body(req, ctx, checks, status);
}

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const live = (req: FastifyRequest, reply: FastifyReply) => liveness(req, reply, ctx);
  const ready = (req: FastifyRequest, reply: FastifyReply) => readiness(req, reply, ctx);

  app.get("/health", live);
  app.get("/api/health", live);
  app.get("/health/ready", ready);
  app.get("/api/health/ready", ready);

  app.get("/api/metrics", async (req, reply) => {
    reply.header(CORRELATION_HEADER, req.id);
    return { ...processMetrics.snapshot(), correlationId: req.id, time: new Date().toISOString() };
  });
}
