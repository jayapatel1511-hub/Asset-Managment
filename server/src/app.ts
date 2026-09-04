/**
 * Builds the Fastify instance. Kept separate from main.ts so tests can build an app over
 * an isolated database and call routes with `app.inject()` — no port, no network.
 */
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Database } from "./db/database";
import type { CurrentUser, DatasetInfo } from "../../app/src/api/types";
import { resolveUser } from "./auth/identity";
import { CORRELATION_HEADER, correlationIdFromHeaders } from "./observability/correlation";
import { registerHealthRoutes } from "./observability/health";
import { processMetrics } from "./observability/metrics";
import { registerCommandRoutes } from "./routes/commands";
import { registerDocumentRoutes } from "./routes/documents";
import { registerReadRoutes } from "./routes/read";
import { registerReferenceRoutes } from "./routes/reference";
import { registerReportRoutes } from "./routes/reports";
import { registerSessionRoutes } from "./routes/session";
import { registerDataManagementRoutes } from "./modules/data-management/routes";
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
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: (req) => correlationIdFromHeaders(req.headers),
    requestIdHeader: false,
  });

  // Declared up front so every request object has the same shape (Fastify's decorateRequest
  // contract); the real value is set per request by the hook below.
  app.decorateRequest("user", null as unknown as CurrentUser);
  app.addHook("onRequest", async (req) => {
    req.user = await resolveUser(req);
  });
  app.addHook("onResponse", async (_req, reply) => {
    processMetrics.note(reply.statusCode);
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header(CORRELATION_HEADER, req.id);
    return payload;
  });

  // Validation failures (zod) become 400s with the message; everything else stays a 500 with the
  // error surfaced — this is a local development server, hiding the cause helps nobody.
  // correlationId is the FR-046 join key; `error` is kept so existing tests that read it still pass.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const isValidation = err.name === "ZodError";
    const status = isValidation ? 400 : (err.statusCode ?? 500);
    const code = isValidation ? "command.error.validation" : "platform.error.internal";
    reply.code(status).send({
      ok: false,
      error: err.name,
      code,
      messageKey: code,
      message: err.message,
      correlationId: req.id,
    });
  });

  // Registration order is the routing contract: health first (a probe has no session), then
  // session (it must answer before anything authorises), then reads, then writes, then the
  // read-only extras. Every module here exports the same `register*Routes(app, ctx)` shape.
  registerHealthRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerReadRoutes(app, ctx);
  registerCommandRoutes(app, ctx);
  registerReferenceRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  await registerDataManagementRoutes(app, ctx);
  return app;
}
