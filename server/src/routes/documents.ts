/**
 * Calibration certificate / document endpoints (WS-W7), and this lane's bootstrap.
 *
 * ROUTE SHAPES follow `specs/010-web-application-platform/contracts/document-blob.md`, with one
 * deliberate simplification the contract itself offers: **proxy only, no SAS**. § Upload
 * initiation lists `userDelegationSas` and `proxyPut` as alternatives and says the proxy exists
 * "to keep keys off the client entirely" — which is CLAUDE.md rule 11's requirement, not a
 * preference, and which the local store could not satisfy any other way. The reasoning is in
 * `documents/blobStore.ts` § THE SAS QUESTION.
 *
 * AUTHORIZATION IS ON EVERY REQUEST, not on the URL. `/api/documents/:id/content` re-runs the
 * same check `download-authorization` ran; the authorization response is a statement about this
 * instant, never a bearer token. A document id in a log, a browser history or a copied link
 * grants nothing (WS-W7 § upload/download authorization).
 *
 * EVERY URL LIVES UNDER `/api/documents/`, including the calibration summary, so this lane can
 * never collide with a route another lane registers — Fastify refuses a duplicate route at build
 * time, which would break every other lane's tests, and BUILD-FREEZE § File ownership makes
 * `app.ts` off limits to fix it. `reconciliation`, `calibration-summary` and `upload-sessions`
 * are static segments and win over `:documentId` in Fastify's router, the same trick
 * `routes/commands.ts` uses for `/api/assets/next-id`.
 *
 * THE BINARY BODY. Certificates arrive as raw bytes, and Fastify only parses JSON out of the
 * box. `app.addContentTypeParser` is instance-wide, so registering one here would change how
 * every other lane's routes parse bodies. Instead the routes are registered inside
 * `app.register(...)`, which gives Fastify an ENCAPSULATED child context: the parser applies to
 * these routes and nothing else. That is why this file has a plugin wrapper it would otherwise
 * not need.
 *
 * THE SCHEMA. Folded into `db/migrations/0010_outbox.sql` and `0011_documents.sql` on 2026-09-03
 * and no longer bootstrapped here. It had to live in this module during the parallel build —
 * `server/src/db/**` belonged to the database lane while it built the migration runner — but an
 * `onReady` hook became the wrong home the moment `transactionService.ts` started writing an
 * outbox row inside every accepted command: the atomic command would then have depended on a
 * table created by a *route module's* start-up, and any path that opened the database without
 * building the Fastify app would have failed. `outbox/schema.ts` and `documents/schema.ts` still
 * export the SQL, which is what the migrations were cut from.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import {
  createDocumentStore,
  DocumentService,
  reconcileDocuments,
  reconciliationCounts,
  type DocumentRefusal,
} from "../documents";
import { publishReconciliationResult } from "../outbox";

// ---------------------------------------------------------------- request shapes

const LINKED_ENTITY_TYPES = ["Calibration", "Asset", "Transaction", "Other"] as const;
const DOCUMENT_TYPES = ["CalibrationCertificate", "Photo", "Other"] as const;

const uploadSessionSchema = z.object({
  clientSubmissionId: z.string().min(1),
  linkedEntityType: z.enum(LINKED_ENTITY_TYPES),
  linkedEntityId: z.string().min(1),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  // Not `.refine(isAllowedMediaType)` on purpose: an unaccepted type must reach the service so
  // the caller gets `document.error.typeOrSize` with the accepted list, not a generic 400.
  mediaType: z.string().min(1),
  byteSize: z.number(),
  originalFileName: z.string().min(1),
  sha256: z.string().nullable().optional(),
  retentionClass: z.string().optional(),
  replacesDocumentId: z.string().nullable().optional(),
  supersededReason: z.string().nullable().optional(),
});

const attachSchema = z.object({ calibrationRecordId: z.string().min(1) });
const voidSchema = z.object({ reason: z.string().min(1) });
const replaceSchema = z.object({ reason: z.string().min(1) });
const listQuerySchema = z.object({
  linkedEntityType: z.enum(LINKED_ENTITY_TYPES),
  linkedEntityId: z.string().min(1),
});

/**
 * HTTP status for a document refusal.
 *
 * `routes/commands.ts` answers a business refusal with 200 + `{ ok: false }` because the offline
 * queue distinguishes "answered" from "retry" on that boundary. Documents are different in one
 * respect that `contracts/error-codes.md` § Transport vs business already codifies: an
 * AUTHORIZATION refusal is 403, and a dependency fault is 5xx and SHOULD be retried. Business
 * refusals about the document itself stay 200 + `{ ok: false }`, matching the command path.
 */
function statusFor(refusal: DocumentRefusal): number {
  if (refusal.code === "document.error.forbidden") return 403;
  if (refusal.code === "platform.error.dependency") return 503;
  return 200;
}

function answer(reply: FastifyReply, result: { ok: true } | DocumentRefusal): unknown {
  if (result.ok) return result;
  return reply.code(statusFor(result)).send(result);
}

function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({
    ok: false,
    code: "command.error.validation",
    reason: error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
  });
}

// ---------------------------------------------------------------- registration

export function registerDocumentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const service = new DocumentService(ctx.db, createDocumentStore(), {
    log: (payload, message) => app.log.info(payload, message),
  });

  // Encapsulated child context — see § THE BINARY BODY.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/heic", "application/octet-stream"],
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body)
    );

    // ---- 1. open an upload session ----
    scope.post("/api/documents/upload-sessions", async (req, reply) => {
      const parsed = uploadSessionSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return answer(reply, await service.createUploadSession(req.user, parsed.data));
    });

    // ---- 2. send the bytes (proxy PUT — no storage credential ever reaches the browser) ----
    scope.post("/api/documents/:documentId/content", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        return reply.code(400).send({
          ok: false,
          code: "command.error.validation",
          reason: "Send the document as a raw body with an accepted Content-Type.",
        });
      }
      return answer(reply, await service.putContent(req.user, documentId, body));
    });

    // ---- 3. authorize, then download ----
    scope.post("/api/documents/:documentId/download-authorization", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      return answer(reply, await service.authorizeDownload(req.user, documentId));
    });

    scope.get("/api/documents/:documentId/content", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      const result = await service.getContent(req.user, documentId);
      if (!result.ok) return reply.code(statusFor(result)).send(result);
      return reply
        .header("content-type", result.metadata.mediaType)
        // `attachment` and the ORIGINAL name: the stored name is a UUID nobody wants to see, and
        // an inline PDF would render in a tab whose URL then sits in browser history.
        .header("content-disposition", `attachment; filename="${sanitizeFileName(result.metadata.originalFileName)}"`)
        .header("x-content-type-options", "nosniff")
        // Private, and never cached by a shared proxy (CLAUDE.md rule 11).
        .header("cache-control", "no-store, private")
        .send(result.bytes);
    });

    // ---- 4. metadata, history, summary ----
    scope.get("/api/documents/reconciliation", async (req, reply) => {
      if (!service.assertMayReconcile(req.user)) {
        return reply.code(403).send({
          ok: false,
          code: "document.error.forbidden",
          reason: "Document reconciliation is a System Owner report.",
        });
      }
      const q = z.object({ verifyHashes: z.string().optional() }).safeParse(req.query);
      if (!q.success) return badRequest(reply, q.error);
      const verifyHashes = q.data.verifyHashes === "1" || q.data.verifyHashes === "true";
      const report = await reconcileDocuments(ctx.db, service.store, { verifyHashes });
      // Publishing the result through the outbox keeps every operational notification on one
      // path, with one cadence gate and one alert owner (outbox/jobs.ts § publish…).
      await publishReconciliationResult(ctx.db, reconciliationCounts(report));
      return { ok: true, report };
    });

    scope.get("/api/documents/calibration-summary", async (req, reply) => {
      const q = z.object({ assetId: z.string().min(1) }).safeParse(req.query);
      if (!q.success) return badRequest(reply, q.error);
      return { ok: true, summary: await service.getCalibrationSummary(req.user, q.data.assetId) };
    });

    scope.get("/api/documents", async (req, reply) => {
      const q = listQuerySchema.safeParse(req.query);
      if (!q.success) return badRequest(reply, q.error);
      return { ok: true, documents: await service.listForEntity(req.user, q.data.linkedEntityType, q.data.linkedEntityId) };
    });

    scope.get("/api/documents/:documentId", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      return answer(reply, await service.getMetadata(req.user, documentId));
    });

    scope.get("/api/documents/:documentId/history", async (req) => {
      const { documentId } = req.params as { documentId: string };
      return { ok: true, chain: await service.replacementChain(req.user, documentId) };
    });

    // ---- 5. attach later, replace, void ----
    scope.post("/api/documents/:documentId/attach", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      const parsed = attachSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return answer(reply, await service.attachToCalibration(req.user, documentId, parsed.data.calibrationRecordId));
    });

    scope.post("/api/documents/:documentId/complete-replacement", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      const parsed = replaceSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return answer(reply, await service.completeReplacement(req.user, documentId, parsed.data.reason));
    });

    scope.post("/api/documents/:documentId/void", async (req, reply) => {
      const { documentId } = req.params as { documentId: string };
      const parsed = voidSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      return answer(reply, await service.voidDocument(req.user, documentId, parsed.data.reason));
    });
  });
}

/** Quotes, control characters and path separators out of a Content-Disposition value. The name
 * is user input that has been carried since upload purely as display metadata. */
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[ -"\\/]+/g, "_").slice(0, 200) || "document";
}
