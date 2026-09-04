/**
 * Reference-data commands — the shape `PUT /api/office-admins/:office` established, applied to
 * Rule 7's second clause. Named commands, field-specific zod at the boundary, deactivate never
 * delete. Paths follow specs/011-data-management/contracts/reference-command.md.
 *
 * Who may write: OfficeAdmin or SystemOwner (`requireAdminRole`). Office scope is decided
 * inside the command when the row is an Office (or a project that names one).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SubmissionOutcome } from "../../../packages/contracts/src/backend";
import type { CurrentUser } from "../../../app/src/api/types";
import type { AppContext } from "../app";
import { requireAdminRole } from "../auth/authorize";
import type { Queryable } from "../db/pglite";
import { runCommand } from "../services/transactionService";
import {
  createReference,
  deactivateReference,
  deleteForbidden,
  editReference,
  getReference,
  isReferenceDomain,
  listReference,
  previewImpact,
  reactivateReference,
  reparentLocation,
} from "../services/referenceService";

const submissionId = z.string().min(1);
const domainSchema = z.enum(["Manufacturer", "EquipmentCategory", "EquipmentModel", "Location", "Project"]);

const createSchema = z.object({
  domain: domainSchema,
  clientSubmissionId: submissionId,
  reason: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
});

const editSchema = z.object({
  domain: domainSchema,
  id: z.string().min(1),
  clientSubmissionId: submissionId,
  reason: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
});

const deactivateSchema = z.object({
  domain: domainSchema,
  id: z.string().min(1),
  clientSubmissionId: submissionId,
  reason: z.string().min(1),
});

const reparentSchema = z.object({
  domain: z.literal("Location"),
  id: z.string().min(1),
  newParentId: z.string().nullable(),
  clientSubmissionId: submissionId,
  reason: z.string().min(1),
});

function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({
    error: "invalid_request",
    message: error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
  });
}

function asReply(reply: FastifyReply, outcome: SubmissionOutcome): SubmissionOutcome | FastifyReply {
  if (!outcome.ok && outcome.reason.startsWith("reference.forbidden")) {
    return reply.code(403).send({ error: "forbidden_office", message: outcome.reason });
  }
  return outcome;
}

export function registerReferenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function submit<S extends z.ZodType>(
    reply: FastifyReply,
    user: CurrentUser,
    command: string,
    schema: S,
    body: unknown,
    run: (tx: Queryable, input: z.output<S>) => Promise<SubmissionOutcome>
  ): Promise<SubmissionOutcome | FastifyReply> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const input = parsed.data as z.output<S> & { clientSubmissionId: string };
    const outcome = await runCommand(
      ctx.db,
      {
        clientSubmissionId: input.clientSubmissionId,
        command,
        user,
        request: parsed.data,
        warn: (payload, message) => app.log.warn(payload, message),
      },
      (tx) => run(tx, parsed.data)
    );
    return asReply(reply, outcome);
  }

  app.get("/api/data-management/reference/:domain", requireAdminRole(), async (req, reply) => {
    const { domain } = req.params as { domain: string };
    if (!isReferenceDomain(domain)) {
      return reply.code(404).send({ error: "unknown_domain", message: `No reference domain "${domain}".` });
    }
    return listReference(ctx.db, domain);
  });

  app.get("/api/data-management/reference/:domain/:id", requireAdminRole(), async (req, reply) => {
    const { domain, id } = req.params as { domain: string; id: string };
    if (!isReferenceDomain(domain)) {
      return reply.code(404).send({ error: "unknown_domain", message: `No reference domain "${domain}".` });
    }
    const row = await getReference(ctx.db, domain, decodeURIComponent(id));
    if (!row) return reply.code(404).send({ error: "not_found", domain, id });
    return row;
  });

  app.get("/api/data-management/reference/:domain/:id/impact", requireAdminRole(), async (req, reply) => {
    const { domain, id } = req.params as { domain: string; id: string };
    if (!isReferenceDomain(domain)) {
      return reply.code(404).send({ error: "unknown_domain", message: `No reference domain "${domain}".` });
    }
    return previewImpact(ctx.db, domain, decodeURIComponent(id));
  });

  app.post("/api/data-management/reference/commands/create", requireAdminRole(), async (req, reply) =>
    submit(reply, req.user, "CreateReference", createSchema, req.body, (tx, input) =>
      createReference(tx, req.user, input)
    )
  );

  app.post("/api/data-management/reference/commands/edit", requireAdminRole(), async (req, reply) =>
    submit(reply, req.user, "EditReference", editSchema, req.body, (tx, input) => editReference(tx, req.user, input))
  );

  app.post("/api/data-management/reference/commands/deactivate", requireAdminRole(), async (req, reply) =>
    submit(reply, req.user, "DeactivateReference", deactivateSchema, req.body, (tx, input) =>
      deactivateReference(tx, req.user, input)
    )
  );

  app.post("/api/data-management/reference/commands/reactivate", requireAdminRole(), async (req, reply) =>
    submit(reply, req.user, "ReactivateReference", deactivateSchema, req.body, (tx, input) =>
      reactivateReference(tx, req.user, input)
    )
  );

  app.post("/api/data-management/reference/commands/reparent-location", requireAdminRole(), async (req, reply) =>
    submit(reply, req.user, "ReparentLocation", reparentSchema, req.body, (tx, input) =>
      reparentLocation(tx, req.user, input)
    )
  );

  // Named refusal — there is no DELETE verb (concurrency suite forbids one). A client that
  // posts a delete command is told to deactivate instead.
  app.post("/api/data-management/reference/commands/delete", requireAdminRole(), async (req, reply) => {
    const parsed = deactivateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return deleteForbidden();
  });
}
