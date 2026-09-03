/**
 * Builds the Fastify instance. Kept separate from main.ts so tests can build an app over an
 * in-memory PGlite and call routes with `app.inject()` — no port, no network.
 */
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { PGlite } from "@electric-sql/pglite";
import type { CurrentUser, DatasetInfo } from "../../app/src/api/types";
import { DEV_USER_HEADER, resolveDevUser } from "./auth/devAuth";
import { registerCommandRoutes } from "./routes/commands";
import { registerReadRoutes } from "./routes/read";
import { ReadModel } from "./services/readModel";

declare module "fastify" {
  interface FastifyRequest {
    user: CurrentUser;
  }
}

export interface AppContext {
  db: PGlite;
  dataset: DatasetInfo;
  readModel: ReadModel;
}

export function createContext(db: PGlite, dataset: DatasetInfo): AppContext {
  return { db, dataset, readModel: new ReadModel(db) };
}

export async function buildApp(ctx: AppContext, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // Declared up front so every request object has the same shape (Fastify's decorateRequest
  // contract); the real value is set per request by the hook below.
  app.decorateRequest("user", null as unknown as CurrentUser);
  app.addHook("onRequest", async (req) => {
    req.user = resolveDevUser(req.headers[DEV_USER_HEADER]);
  });

  // Validation failures (zod) become 400s with the message; everything else stays a 500 with the
  // error surfaced — this is a local development server, hiding the cause helps nobody.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const isValidation = err.name === "ZodError";
    reply.code(isValidation ? 400 : (err.statusCode ?? 500)).send({ error: err.name, message: err.message });
  });

  registerReadRoutes(app, ctx);
  registerCommandRoutes(app, ctx);
  return app;
}
