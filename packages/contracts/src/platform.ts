/**
 * Platform envelope types from specs/010 health-and-read.md and error-codes.md.
 *
 * Kept out of `types.ts` so operational screens and entity shapes do not grow a second home for
 * probe and error contracts. Both sides import from the package root.
 */
export type HealthStatus = "ok" | "degraded" | "unavailable";
export type HealthCheckResult = "ok" | "fail";

/** `GET /health` and `GET /api/health` (liveness); `GET /health/ready` (readiness). */
export interface HealthResponse {
  status: HealthStatus;
  /** App/API revision or git SHA injected at build. */
  version: string;
  /** Latest applied migration id when the database is reachable. */
  schemaVersion?: string;
  checks: {
    database: HealthCheckResult;
  };
  /** ISO UTC. */
  time: string;
}

/**
 * Structured refusal / fault body. `correlationId` is request-scoped and is also returned as
 * `x-correlation-id`; it is not a security claim.
 */
export interface ApiErrorBody {
  ok: false;
  code: string;
  messageKey: string;
  message?: string;
  offendingAssetId?: string;
  details?: Record<string, unknown>;
  correlationId: string;
}
