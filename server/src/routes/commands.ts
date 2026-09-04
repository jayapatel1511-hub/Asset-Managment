/**
 * Write endpoints. Route shapes are the contract app/src/api/http/index.ts implements.
 *
 * The refusal contract, which the offline queue depends on (api/queue/types.ts
 * SubmissionTransport, and http/index.ts's `send`):
 *
 *   HTTP 200 `{ ok: true, … }`               accepted
 *   HTTP 200 `{ ok: false, reason, … }`      REFUSED — a business answer, not a failure. The
 *                                            queue marks it answered and shows the reason
 *                                            instead of retrying it forever.
 *   HTTP 4xx / 5xx                           a real failure: a malformed body, or a fault. The
 *                                            queue keeps the submission and retries.
 *
 * Every body is validated with zod here, at the boundary, so no service function has to defend
 * against a missing field; a body that does not parse is a 400 with the offending paths, because
 * a client sending the wrong shape has a bug and retrying it would not help.
 *
 * ## Who may write (WS-W3)
 *
 * Every route below names its guard between the path and the handler:
 *
 *   every command                 FieldUser, OfficeAdmin or SystemOwner. ReportReader is refused
 *                                 with 403 `forbidden_role` — read-only is enforced, not documented.
 *   `PUT /api/office-admins/:office`  OfficeAdmin or SystemOwner, **and** office scope: an Ottawa
 *                                 administrator administering Toronto is refused (A-R5).
 *   `GET /api/assets/next-id`     any authenticated role — it is a preview, and it allocates
 *                                 nothing (the server mints the real id inside the command).
 *
 * Note what the guards do *not* consult: the body. zod strips unknown keys, so a body carrying
 * `role`, `upn`, `office` or `performedby` loses them before any service sees it, and every
 * server-owned field is taken from the resolved caller — `performedby: user.upn` in
 * services/commandService.ts, never `body.performedby`. That is CLAUDE.md rule 1 holding at the
 * only layer where it can be checked.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SubmissionOutcome } from "../../../app/src/api/AmsBackend";
import type { AppContext } from "../app";
import { guards, requireAdminRole, requireAnyRole, requireOfficeScope, requireWriteAccess } from "../auth/authorize";
import type { Queryable } from "../db/pglite";
import type { CurrentUser } from "../../../app/src/api/types";
import {
  checkout,
  completeRepair,
  markFound,
  markMissing,
  previewNextAssetId,
  recordCalibration,
  registerAsset,
  reportFault,
  retireAsset,
  returnAssets,
  sendToCalibration,
  transfer,
} from "../services/commandService";
import {
  setOfficeAdmins,
  submitComponentSwap,
  submitConfigurationChange,
  submitDeployment,
  submitRecovery,
} from "../services/deploymentService";
import { runCommand } from "../services/transactionService";

// ---------------------------------------------------------------- shared shapes

const KIT_ROLES = ["Primary", "Sensor1", "Sensor2", "Sensor3", "Sensor4", "Microphone", "Modem", "Cellular", "Router", "Accessory"] as const;
const ORIENTATIONS = ["H", "V", "BH", "N", "E", "S", "W"] as const;
const POWER_SOURCES = ["Battery", "Solar", "AC", "External"] as const;
const LOCATION_TYPES = ["Region", "Office", "Site", "Vehicle", "CalLab", "Client", "Storage"] as const;
const CONDITIONS = ["Good", "Damaged", "NeedsService"] as const;

const submissionId = z.string().min(1);
const assetId = z.string().min(1);

const cartLine = z.object({
  assetId,
  kitRole: z.string().optional(),
  orientation: z.string().optional(),
  powerSource: z.string().optional(),
  condition: z.enum(CONDITIONS).optional(),
});

// `project: z.string()` (not .min(1)) on purpose: an empty project must reach the service so the
// caller gets FR-008's own message rather than a generic 400.
const checkoutSchema = z.object({
  lines: z.array(cartLine),
  primaryAssetId: z.string().optional(),
  project: z.string(),
  touser: z.string().optional(),
  expectedReturn: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const returnSchema = z.object({
  lines: z.array(cartLine),
  tolocation: z.string().optional(),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const transferSchema = z.object({
  assetIds: z.array(assetId),
  touser: z.string().nullable().optional(),
  tolocation: z.string().nullable().optional(),
  toproject: z.string().nullable().optional(),
  reason: z.string(),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const faultSchema = z.object({ assetId, notes: z.string(), clientSubmissionId: submissionId });
const missingSchema = z.object({ assetId, notes: z.string(), clientSubmissionId: submissionId });
const singleAssetSchema = z.object({ assetId, clientSubmissionId: submissionId });
const retireSchema = z.object({ assetId, reason: z.string(), clientSubmissionId: submissionId });
const sendToCalSchema = z.object({ assetIds: z.array(assetId), lab: z.string(), clientSubmissionId: submissionId });

const calibrationSchema = z.object({
  assetId,
  calibrationdate: z.string().min(4),
  nextduedate: z.string().nullable().optional(),
  lab: z.string().nullable().optional(),
  certificatenumber: z.string().nullable().optional(),
  cost: z.string().nullable().optional(),
  result: z.enum(["Pass", "Fail", "Adjusted"]).nullable().optional(),
  clientSubmissionId: submissionId,
});

const registerSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  equipmenttype: z.string().min(1),
  serial: z.string().nullable().optional(),
  homeoffice: z.string().min(1),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const deploymentSchema = z.object({
  project: z.string(),
  primaryAssetId: z.string(),
  components: z.array(z.object({ assetId, kitRole: z.enum(KIT_ROLES), orientation: z.enum(ORIENTATIONS).nullable().optional() })),
  site: z.string(),
  locationtype: z.enum(LOCATION_TYPES),
  sitename: z.string(),
  position: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  coordinatesource: z.enum(["Manual", "Device"]).nullable().optional(),
  powersource: z.enum(POWER_SOURCES),
  deploymentDate: z.string(),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const recoverySchema = z.object({
  installationId: z.string().min(1),
  components: z.array(
    z.object({
      assetId,
      disposition: z.enum(["Recovered", "Missing"]),
      condition: z.enum(CONDITIONS).optional(),
      notes: z.string().nullable().optional(),
    })
  ),
  leaveBehind: z.array(z.object({ assetId, reason: z.string() })).optional(),
  recoveryDate: z.string(),
  notes: z.string().nullable().optional(),
  clientSubmissionId: submissionId,
});

const swapSchema = z.object({
  installationId: z.string().min(1),
  outgoingAssetId: assetId,
  incomingAssetId: assetId,
  kitRole: z.enum(KIT_ROLES),
  orientation: z.enum(ORIENTATIONS).nullable().optional(),
  effectiveDate: z.string(),
  reason: z.string(),
  clientSubmissionId: submissionId,
});

const configChangeSchema = z.object({
  installationId: z.string().min(1),
  orientationChanges: z.array(z.object({ assetId, orientation: z.enum(ORIENTATIONS) })).optional(),
  powersource: z.enum(POWER_SOURCES).optional(),
  position: z.string().nullable().optional(),
  toproject: z.string().optional(),
  effectiveDate: z.string(),
  reason: z.string(),
  clientSubmissionId: submissionId,
});

const officeAdminsSchema = z.object({ adminUpns: z.array(z.string()), clientSubmissionId: submissionId });

// ---------------------------------------------------------------- dispatch

/** One entry per POST /api/commands/:type. Each parses its own body and returns the outcome. */
type CommandHandler = (tx: Queryable, user: CurrentUser, body: unknown) => Promise<SubmissionOutcome>;

function handler<S extends z.ZodType>(
  schema: S,
  run: (tx: Queryable, user: CurrentUser, input: z.output<S>) => Promise<SubmissionOutcome>
): { schema: S; run: CommandHandler } {
  return { schema, run: (tx, user, body) => run(tx, user, schema.parse(body)) };
}

const COMMANDS: Record<string, { schema: z.ZodType; run: CommandHandler }> = {
  Checkout: handler(checkoutSchema, (tx, user, input) => checkout(tx, user, input)),
  Return: handler(returnSchema, (tx, user, input) => returnAssets(tx, user, input)),
  Transfer: handler(transferSchema, (tx, user, input) => transfer(tx, user, input)),
  ReportFault: handler(faultSchema, (tx, user, input) => reportFault(tx, user, input)),
  MarkMissing: handler(missingSchema, (tx, user, input) => markMissing(tx, user, input)),
  Found: handler(singleAssetSchema, (tx, user, input) => markFound(tx, user, input)),
  RepairComplete: handler(singleAssetSchema, (tx, user, input) => completeRepair(tx, user, input)),
  SendToCalibration: handler(sendToCalSchema, (tx, user, input) => sendToCalibration(tx, user, input)),
  Retire: handler(retireSchema, (tx, user, input) => retireAsset(tx, user, input)),
};

/** 400 with the offending paths — a shape error is a client bug, not a refusal to display. */
function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({
    error: "invalid_request",
    message: error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
  });
}

export function registerCommandRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Parses, then runs the body inside one transaction with command-level idempotency. */
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
    return runCommand(
      ctx.db,
      {
        clientSubmissionId: input.clientSubmissionId,
        command,
        user,
        request: parsed.data,
        warn: (payload, message) => app.log.warn(payload, message),
      },
      (tx) => run(tx, input)
    );
  }

  // ---- features 001/003/004 transaction commands ----
  app.post("/api/commands/:type", requireWriteAccess(), async (req, reply) => {
    const { type } = req.params as { type: string };
    const entry = COMMANDS[type];
    if (!entry) {
      return reply.code(400).send({ error: "unknown_command", message: `No such command "${type}".` });
    }
    return submit(reply, req.user, type, entry.schema, req.body, (tx, input) => entry.run(tx, req.user, input));
  });

  // ---- feature 004: record a calibration ----
  app.post("/api/calibrations", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "RecordCalibration", calibrationSchema, req.body, (tx, input) =>
      recordCalibration(tx, req.user, input)
    )
  );

  // ---- feature 001: register an asset, and preview the tag it would be given ----
  app.post("/api/assets", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "RegisterAsset", registerSchema, req.body, (tx, input) => registerAsset(tx, req.user, input))
  );

  // Registered as a static segment, which Fastify's router prefers over read.ts's
  // /api/assets/:assetId regardless of registration order.
  app.get("/api/assets/next-id", requireAnyRole(), async (req, reply) => {
    const q = z
      .object({ manufacturer: z.string(), model: z.string(), equipmenttype: z.string(), serial: z.string().optional() })
      .safeParse(req.query);
    if (!q.success) return badRequest(reply, q.error);
    const result = await previewNextAssetId(ctx.db, q.data.manufacturer, q.data.model, q.data.equipmenttype, q.data.serial);
    // The New Asset screen treats a rejected preview as "no preview yet" (it catches and clears),
    // so an unknown model or a missing serial is a 400 rather than a fake tag on screen.
    if (!result.ok) return reply.code(400).send({ error: "no_preview", message: result.reason });
    return { assetId: result.assetId };
  });

  // ---- feature 005: deployment, recovery, swap, configuration change ----
  app.post("/api/deployments", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "Deploy", deploymentSchema, req.body, (tx, input) => submitDeployment(tx, req.user, input))
  );

  app.post("/api/recoveries", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "Recover", recoverySchema, req.body, (tx, input) => submitRecovery(tx, req.user, input))
  );

  app.post("/api/component-swaps", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "ComponentSwap", swapSchema, req.body, (tx, input) => submitComponentSwap(tx, req.user, input))
  );

  app.post("/api/configuration-changes", requireWriteAccess(), async (req, reply) =>
    submit(reply, req.user, "ConfigurationChange", configChangeSchema, req.body, (tx, input) =>
      submitConfigurationChange(tx, req.user, input)
    )
  );

  // ---- feature 004 US4: office → administrator assignment ----
  //
  // The one office-scoped write in the system today, and the shape every later administrative
  // command follows. `knownOffice` returns null for a name that is not an office at all, which
  // `requireOfficeScope` passes through on purpose: "Vancouver is not one of our offices" is a
  // validation answer the command already gives, and dressing it up as 403 would hide a typo
  // behind a permissions error while disclosing nothing an attacker could not read off
  // GET /api/locations.
  app.put(
    "/api/office-admins/:office",
    guards(requireAdminRole(), requireOfficeScope((req) => knownOffice(ctx, (req.params as { office: string }).office))),
    async (req, reply) => {
      const { office } = req.params as { office: string };
      return submit(reply, req.user, "SetOfficeAdmins", officeAdminsSchema, req.body, (tx, input) =>
        setOfficeAdmins(tx, office, input.adminUpns)
      );
    }
  );
}

/**
 * The office an administrative request names, or null when it names no office this system has.
 *
 * Case-insensitive, because the caller typed it into a URL. Reads the location table rather than
 * a constant so that an office added by an administrator is immediately administrable — rule 7:
 * reference data is maintained in the application, not hard-coded.
 */
async function knownOffice(ctx: AppContext, name: string): Promise<string | null> {
  const res = await ctx.db.query<{ name: string }>(
    "SELECT name FROM location WHERE locationtype = 'Office' AND lower(name) = lower($1) LIMIT 1",
    [name]
  );
  return res.rows[0]?.name ?? null;
}
