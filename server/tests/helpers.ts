/**
 * Test harness: one Fastify app over an in-memory PGlite (no directory, so nothing touches
 * server/data/), seeded from the real migrated dataset in migration/staged/ — 1,026 assets, not
 * fixtures. Routes are exercised with `app.inject()`, so there is no port and no network, but
 * every request goes through the same hooks, zod validation and error handler production traffic
 * does.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp, createContext } from "../src/app";
import { DATASET_DIR } from "../src/config";
import { openDatabase } from "../src/db/pglite";
import { seedIfNeeded } from "../src/db/seed";
import type { SubmissionOutcome } from "../../app/src/api/AmsBackend";

export interface TestApp {
  app: FastifyInstance;
  db: PGlite;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const db = await openDatabase(); // in-memory
  const seed = await seedIfNeeded(db, DATASET_DIR);
  const app = await buildApp(createContext(db, seed.dataset), { logger: false });
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Demo identities resolved by server/src/auth/devAuth.ts from the x-ams-dev-user header. */
export type DevUser = "field" | "admin" | "owner";

export async function post(app: FastifyInstance, url: string, body: unknown, as: DevUser = "field") {
  return app.inject({ method: "POST", url, payload: body as object, headers: { "x-ams-dev-user": as } });
}

export async function put(app: FastifyInstance, url: string, body: unknown, as: DevUser = "admin") {
  return app.inject({ method: "PUT", url, payload: body as object, headers: { "x-ams-dev-user": as } });
}

export async function get(app: FastifyInstance, url: string, as: DevUser = "field") {
  return app.inject({ method: "GET", url, headers: { "x-ams-dev-user": as } });
}

/** A write's parsed outcome, with the HTTP status asserted to be 200 — a refusal is an answer,
 * not a failure, so `{ ok: false }` still arrives as 200 (see routes/commands.ts's header). */
export async function submit(
  app: FastifyInstance,
  url: string,
  body: unknown,
  as: DevUser = "field"
): Promise<SubmissionOutcome & { status: number }> {
  const res = await post(app, url, body, as);
  return { ...(res.json() as SubmissionOutcome), status: res.statusCode };
}

export async function getJson<T>(app: FastifyInstance, url: string, as: DevUser = "field"): Promise<T> {
  const res = await get(app, url, as);
  if (res.statusCode !== 200) throw new Error(`GET ${url} → ${res.statusCode}: ${res.body}`);
  return res.json() as T;
}

let counter = 0;
/** A fresh idempotency key per call, so one test's key never collides with another's. */
export function newSubmissionId(label = "test"): string {
  counter += 1;
  return `${label}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
