/**
 * FR-046 / T010: health contract, readiness, request-scoped correlation IDs, in-process metrics.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "../../packages/contracts/src/platform";
import { createTestApp, type TestApp } from "./helpers";
import { processMetrics } from "../src/observability/metrics";

let harness: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await createTestApp();
  app = harness.app;
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

function assertHealthShape(body: HealthResponse & { ok?: boolean; correlationId?: string }) {
  expect(["ok", "degraded", "unavailable"]).toContain(body.status);
  expect(typeof body.version).toBe("string");
  expect(body.version.length).toBeGreaterThan(0);
  expect(["ok", "fail"]).toContain(body.checks.database);
  expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(typeof body.correlationId).toBe("string");
}

describe("health contract (FR-046 / T010)", () => {
  it("answers liveness on both /health and /api/health with the contracted shape", async () => {
    for (const url of ["/health", "/api/health"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      const body = res.json() as HealthResponse & { ok: boolean; dataset: unknown; correlationId: string };
      assertHealthShape(body);
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.ok).toBe(true);
      expect(body.dataset).toBeTruthy();
      expect(body.schemaVersion).toMatch(/^\d{4}$/);
      expect(res.headers["x-correlation-id"]).toBe(body.correlationId);
    }
  });

  it("answers readiness 200 while the database is reachable", async () => {
    for (const url of ["/health/ready", "/api/health/ready"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      const body = res.json() as HealthResponse;
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
    }
  });

  it("honours an incoming x-correlation-id and echoes it on the response", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-correlation-id": "probe-ottawa-7f3a2c1b" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-correlation-id"]).toBe("probe-ottawa-7f3a2c1b");
    expect(res.json()).toMatchObject({ correlationId: "probe-ottawa-7f3a2c1b" });
  });

  it("takes the trace-id from a W3C traceparent when no correlation header is set", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    });
    expect(res.headers["x-correlation-id"]).toBe(traceId);
  });

  it("exposes in-process metrics with no row data", async () => {
    const before = processMetrics.snapshot();
    await app.inject({ method: "GET", url: "/api/metrics" });
    const res = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { requests: number; errors: number; byStatus: Record<string, number>; correlationId: string };
    expect(body.requests).toBeGreaterThan(before.requests);
    expect(typeof body.errors).toBe("number");
    expect(body.byStatus["2xx"]).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/ICCID|identifiervalue|password/i);
  });

  it("puts a correlation id on a validation refusal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/commands/Checkout",
      headers: { "x-ams-dev-user": "field", "x-correlation-id": "checkout-bad-shape-01" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { correlationId: string; code: string; error: string };
    expect(body.error).toBe("invalid_request");
    expect(body.code).toBe("command.error.validation");
    expect(body.correlationId).toBe("checkout-bad-shape-01");
    expect(res.headers["x-correlation-id"]).toBe("checkout-bad-shape-01");
  });
});
