/**
 * Builds the Fastify instance. Kept separate from main.ts so tests can build an app over
 * an isolated database and call routes with `app.inject()` — no port, no network.
 */
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Database } from "./db/database";
import type { CurrentUser, DatasetInfo } from "../../app/src/api/types";
import { resolveUser } from "./auth/identity";
import { registerCommandRoutes } from "./routes/commands";
import { registerDocumentRoutes } from "./routes/documents";
import { registerReadRoutes } from "./routes/read";
import { registerReportRoutes } from "./routes/reports";
import { registerSessionRoutes } from "./routes/session";
import { ReadModel } from "./services/readModel";

declare module "fastify" {
  interface FastifyRequest {
    user: CurrentUser;
  }
}

export interface AppContext {
  db: Database;
  dataset: DatasetInfo;
  readModel: ReadModel;
}

export function createContext(db: Database, dataset: DatasetInfo): AppContext {
  return { db, dataset, readModel: new ReadModel(db) };
}

export async function buildApp(ctx: AppContext, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // Declared up front so every request object has the same shape (Fastify's decorateRequest
  // contract); the real value is set per request by the hook below.
  app.decorateRequest("user", null as unknown as CurrentUser);
  app.addHook("onRequest", async (req) => {
    req.user = await resolveUser(req);
  });

  // Validation failures (zod) become 400s with the message; everything else stays a 500 with the
  // error surfaced — this is a local development server, hiding the cause helps nobody.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const isValidation = err.name === "ZodError";
    reply.code(isValidation ? 400 : (err.statusCode ?? 500)).send({ error: err.name, message: err.message });
  });

  // Registration order is the routing contract: session first (it must answer before anything
  // authorises), then reads, then writes, then the read-only extras. Every module here exports
  // the same `register*Routes(app, ctx)` shape, so a lane fills in its own file and never edits
  // this one — see specs/_planning/BUILD-FREEZE.md.
  registerSessionRoutes(app, ctx);
  registerReadRoutes(app, ctx);
  registerCommandRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  return app;
}
