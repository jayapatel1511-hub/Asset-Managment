/**
 * Features 001, 003 and 004 write commands — the server's port of api/mock/index.ts's submit*
 * methods, method by method. Every business rule and every refusal message is the mock's, so a
 * screen behaves identically whether VITE_AMS_BACKEND is `mock` or `http`; where this file
 * differs from the mock it says so in a comment.
 *
 * Each function takes the open PostgreSQL transaction, so the whole command — including the
 * composite ones (a Return that also reports a fault, a calibration that also brings the asset
 * back from the lab) — commits or rolls back as one unit. None of them writes an asset's
 * status, location, custodian, project or parent: that is transactionService.applyTransaction's
 * exclusive job, from deriveState's result (Principle I).
 */
import { randomUUID } from "node:crypto";
import type {
  CheckoutInput,
  FaultReportInput,
  RecordCalibrationInput,
  RegisterAssetInput,
  ReturnInput,
  SubmissionOutcome,
  TransferInput,
} from "../../../app/src/api/AmsBackend";
import type { Asset, CurrentUser, RetirementReason } from "../../../app/src/api/types";
import { isAdmin } from "../../../app/src/api/types";
import { mintAssetId } from "../../../app/src/domain/assetId";
import type { Queryable } from "../db/pglite";
import { ASSET_COLUMNS, assetToValues, insertRows, type AssetRow, type ModelRow, type ProjectRow } from "../db/rows";
import { applyTransaction, refuse } from "./transactionService";

const RETIREMENT_REASONS: readonly RetirementReason[] = ["Sold", "Lost", "Damaged", "Obsolete"];

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadAsset(tx: Queryable, assetId: string): Promise<AssetRow | undefined> {
  const res = await tx.query<AssetRow>("SELECT * FROM asset WHERE assetid = $1", [assetId]);
  return res.rows[0];
}

async function findProject(tx: Queryable, projectnumber: string): Promise<ProjectRow | undefined> {
  const res = await tx.query<ProjectRow>("SELECT * FROM project WHERE projectnumber = $1", [projectnumber]);
  return res.rows[0];
}

export async function findModel(
  tx: Queryable,
  manufacturer: string,
  model: string,
  equipmenttype: string
): Promise<ModelRow | undefined> {
  const res = await tx.query<ModelRow>(
    "SELECT * FROM equipment_model WHERE manufacturer = $1 AND model = $2 AND equipmenttype = $3",
    [manufacturer, model, equipmenttype]
  );
  return res.rows[0];
}

// ---------------------------------------------------------------- feature 003 — transactions

export async function checkout(tx: Queryable, user: CurrentUser, input: CheckoutInput): Promise<SubmissionOutcome> {
  if (!input.project) return refuse("A project is required to check equipment out."); // FR-008
  if (input.lines.length === 0) return refuse("Add at least one asset before submitting.");

  // ASSUMPTION: the inactive-project rule (feature 003 FR-027) is open between "refuse outright"
  // and "warn and permit for legitimate late charges" — refuse outright is assumed
  // (docs/08-decisions.md), the same call api/mock/index.ts made.
  const project = await findProject(tx, input.project);
  if (project && project.status !== "Active") {
    return refuse(`Project ${input.project} is ${project.status}, not Active — checkout refused.`);
  }

  // Checkout of a non-Available asset is refused by deriveState's own matrix lookup inside
  // applyTransaction — "Checkout is not a valid transition from CheckedOut for DL-UM-16984" —
  // which is why this rule needs no code here and cannot drift from the state machine.
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Checkout",
    performedby: user.upn,
    date: nowIso(),
    touser: input.touser ?? user.upn,
    toproject: input.project,
    primaryAssetId: input.primaryAssetId,
    expectedreturn: input.expectedReturn ?? null,
    notes: input.notes ?? null,
    lines: input.lines.map((l) => ({ assetId: l.assetId, kitRole: l.kitRole as never })),
  });
}

export async function returnAssets(tx: Queryable, user: CurrentUser, input: ReturnInput): Promise<SubmissionOutcome> {
  if (input.lines.length === 0) return refuse("Add at least one asset before submitting.");

  // FR-025: only the custodian or an administrator may return an asset.
  if (!isAdmin(user)) {
    for (const line of input.lines) {
      const row = await loadAsset(tx, line.assetId);
      if (row && row.custodian !== user.upn) {
        return refuse(
          `${line.assetId} is held by someone else — only its custodian or an administrator can return it.`,
          line.assetId
        );
      }
    }
  }

  const tolocation = input.tolocation ?? user.homeoffice ?? undefined; // FR-010
  const badLines = input.lines.filter((l) => (l.condition ?? "Good") !== "Good");
  const date = nowIso();

  const returnResult = await applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Return",
    performedby: user.upn,
    date,
    tolocation,
    notes: input.notes ?? null,
    lines: input.lines.map((l) => ({ assetId: l.assetId, condition: l.condition })),
  });
  if (!returnResult.ok) return returnResult;

  if (badLines.length > 0) {
    // FR-017: a damaged / needs-service item goes on to NeedsRepair in the same submission, as a
    // second line sharing the transaction date, so the history reads as one event.
    const faultResult = await applyTransaction(tx, {
      clientSubmissionId: `${input.clientSubmissionId}-fault`,
      transactiontype: "ReportFault",
      performedby: user.upn,
      date,
      notes: "Reported damaged/needs-service on return.",
      lines: badLines.map((l) => ({ assetId: l.assetId, condition: l.condition })),
    });
    if (!faultResult.ok) return faultResult;
  }

  return returnResult;
}

export async function transfer(tx: Queryable, user: CurrentUser, input: TransferInput): Promise<SubmissionOutcome> {
  if (!input.reason?.trim()) return refuse("A reason is required to transfer equipment."); // FR-009
  if (input.assetIds.length === 0) return refuse("Add at least one asset before submitting.");

  // ASSUMPTION: inactive-project rule — see checkout's identical note.
  if (input.toproject) {
    const project = await findProject(tx, input.toproject);
    if (project && project.status !== "Active") {
      return refuse(`Project ${input.toproject} is ${project.status}, not Active — transfer refused.`);
    }
  }

  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Transfer",
    performedby: user.upn,
    date: nowIso(),
    // `?? undefined` rather than `?? null`, deliberately: deriveState's Transfer case treats
    // undefined as "this transaction says nothing about that field, keep it" and null as "clear
    // it". The mock makes the same conversion for the same reason.
    touser: input.touser ?? undefined,
    tolocation: input.tolocation ?? undefined,
    toproject: input.toproject ?? undefined,
    notes: input.reason,
    lines: input.assetIds.map((assetId) => ({ assetId })),
  });
}

export async function reportFault(tx: Queryable, user: CurrentUser, input: FaultReportInput): Promise<SubmissionOutcome> {
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "ReportFault",
    performedby: user.upn,
    date: nowIso(),
    notes: input.notes,
    lines: [{ assetId: input.assetId }],
  });
}

export async function markMissing(
  tx: Queryable,
  user: CurrentUser,
  input: { assetId: string; notes: string; clientSubmissionId: string }
): Promise<SubmissionOutcome> {
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "MarkMissing",
    performedby: user.upn,
    date: nowIso(),
    notes: input.notes,
    lines: [{ assetId: input.assetId }],
  });
}

export async function markFound(
  tx: Queryable,
  user: CurrentUser,
  input: { assetId: string; clientSubmissionId: string }
): Promise<SubmissionOutcome> {
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Found",
    performedby: user.upn,
    date: nowIso(),
    lines: [{ assetId: input.assetId }],
  });
}

export async function completeRepair(
  tx: Queryable,
  user: CurrentUser,
  input: { assetId: string; clientSubmissionId: string }
): Promise<SubmissionOutcome> {
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "RepairComplete",
    performedby: user.upn,
    date: nowIso(),
    lines: [{ assetId: input.assetId }],
  });
}

export async function retireAsset(
  tx: Queryable,
  user: CurrentUser,
  input: { assetId: string; reason: string; clientSubmissionId: string }
): Promise<SubmissionOutcome> {
  if (!input.reason) return refuse("A retirement reason is required."); // FR-024
  if (!RETIREMENT_REASONS.includes(input.reason as RetirementReason)) {
    // Principle IV: retirement reason is a choice column, not free text. The screen offers only
    // these four (RetireDialog.tsx's REASONS); refusing anything else keeps a stray value from a
    // scripted client out of the column.
    return refuse(`"${input.reason}" is not a retirement reason — pick one of ${RETIREMENT_REASONS.join(", ")}.`);
  }
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Retire",
    performedby: user.upn,
    date: nowIso(),
    lines: [{ assetId: input.assetId, retirementReason: input.reason }],
  });
}

// ---------------------------------------------------------------- feature 004 — calibration

export async function sendToCalibration(
  tx: Queryable,
  user: CurrentUser,
  input: { assetIds: string[]; lab: string; clientSubmissionId: string }
): Promise<SubmissionOutcome> {
  if (input.assetIds.length === 0) return refuse("Add at least one asset before submitting.");
  return applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "SendToCalibration",
    performedby: user.upn,
    date: nowIso(),
    tolocation: input.lab,
    lines: input.assetIds.map((assetId) => ({ assetId })),
  });
}

export async function recordCalibration(
  tx: Queryable,
  user: CurrentUser,
  input: RecordCalibrationInput
): Promise<SubmissionOutcome> {
  if (input.calibrationdate > todayIso()) {
    return refuse("Calibration date cannot be in the future."); // FR-011 (004)
  }
  const row = await loadAsset(tx, input.assetId);
  if (!row) return refuse(`Unknown asset ${input.assetId}.`);

  const model = await findModel(tx, row.manufacturer, row.model, row.equipmenttype);
  let nextduedate = input.nextduedate ?? null;
  if (!nextduedate && model?.defaultcalintervalmonths) {
    const d = new Date(input.calibrationdate);
    d.setMonth(d.getMonth() + model.defaultcalintervalmonths);
    nextduedate = d.toISOString().slice(0, 10);
  }
  if (!nextduedate) {
    return refuse("This model has no default calibration interval — a next-due date is required."); // FR-010 (004)
  }

  const dup = await tx.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM calibration_record WHERE asset = $1 AND calibrationdate = $2",
    [input.assetId, input.calibrationdate]
  );
  const duplicate = (dup.rows[0]?.c ?? 0) > 0;

  await tx.query(
    `INSERT INTO calibration_record (id, asset, calibrationdate, nextduedate, lab, certificatenumber, certificateurl, cost, result)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
    [
      randomUUID(),
      input.assetId,
      input.calibrationdate,
      nextduedate,
      input.lab ?? null,
      input.certificatenumber ?? null,
      input.cost ?? null,
      input.result ?? null,
    ]
  );

  // FR-012/FR-013 (004): the asset's last-cal / next-due reflect the most recent record BY
  // CALIBRATION DATE, not the most recently entered — recomputed from the full set every time.
  // These two columns are derived from calibration records rather than from a transaction line,
  // so they are written here; the five transaction-derived fields never are.
  await tx.query(
    `UPDATE asset AS a
        SET lastcaldate = c.calibrationdate, nextcaldue = c.nextduedate
       FROM (SELECT calibrationdate, nextduedate FROM calibration_record
              WHERE asset = $1
              ORDER BY calibrationdate DESC NULLS LAST, nextduedate DESC, id
              LIMIT 1) AS c
      WHERE a.assetid = $1`,
    [input.assetId]
  );

  // F2: recording a calibration for an asset that is AT the lab brings it back to Available at
  // its home office — through a transaction, never by setting status.
  if (row.status === "InCalibration") {
    const result = await applyTransaction(tx, {
      clientSubmissionId: `${input.clientSubmissionId}-return-from-cal`,
      transactiontype: "ReturnFromCalibration",
      performedby: user.upn,
      date: nowIso(),
      lines: [{ assetId: input.assetId }],
    });
    if (!result.ok) return result;
  }

  return duplicate
    ? { ok: true, transactionId: "calibration-duplicate-date-flagged", transactionName: "recorded (duplicate date flagged for review)" }
    : { ok: true, transactionId: "calibration-recorded", transactionName: "recorded" };
}

// ---------------------------------------------------------------- feature 001 — registration

/** Peek at the next sequence value without consuming it — the New Asset screen's live preview. */
export async function previewNextAssetId(
  tx: Queryable,
  manufacturer: string,
  model: string,
  equipmenttype: string,
  serial?: string | null
): Promise<{ ok: true; assetId: string } | { ok: false; reason: string }> {
  const found = await findModel(tx, manufacturer, model, equipmenttype);
  if (!found) {
    return { ok: false, reason: `Unknown model ${manufacturer} ${model} (${equipmenttype}) — pick one from the catalogue.` };
  }
  if (found.isserialised) {
    if (!serial?.trim()) return { ok: false, reason: "This model requires a serial number." };
    return { ok: true, assetId: mintAssetId(found, serial, 0) };
  }
  const res = await tx.query<{ nextvalue: number }>("SELECT nextvalue FROM id_sequence WHERE prefix = $1", [found.idprefix]);
  return { ok: true, assetId: mintAssetId(found, null, res.rows[0]?.nextvalue ?? 1) };
}

/**
 * FR-007: issue the next sequence value for a prefix, atomically. One statement, so two
 * concurrent registrations of the same non-serialised model can never be handed the same number
 * — the local equivalent of the `If-Match` etag retry against eng_idsequence that
 * api/dataverse/ has to do (its header docstring, decision 4).
 */
async function consumeSequence(tx: Queryable, prefix: string): Promise<number> {
  const res = await tx.query<{ nextvalue: number }>(
    `INSERT INTO id_sequence (prefix, nextvalue) VALUES ($1, 2)
     ON CONFLICT (prefix) DO UPDATE SET nextvalue = id_sequence.nextvalue + 1
     RETURNING nextvalue`,
    [prefix]
  );
  return res.rows[0].nextvalue - 1;
}

export async function registerAsset(
  tx: Queryable,
  user: CurrentUser,
  input: RegisterAssetInput
): Promise<SubmissionOutcome> {
  const model = await findModel(tx, input.manufacturer, input.model, input.equipmenttype);
  if (!model) {
    return refuse("Pick a model from the catalogue — free-text models are not permitted (Principle IV).");
  }

  let assetid: string;
  if (model.isserialised) {
    if (!input.serial?.trim()) return refuse("This model requires a serial number.");
    assetid = mintAssetId(model, input.serial, 0);
  } else {
    assetid = mintAssetId(model, null, await consumeSequence(tx, model.idprefix));
  }

  const clash = await loadAsset(tx, assetid);
  if (clash) {
    return refuse(`${assetid} already exists — this looks like a re-registration, not a new asset.`, assetid);
  }

  const newAsset: Asset = {
    id: randomUUID(),
    assetid,
    migrationsource: null,
    equipmentmodel: { manufacturer: model.manufacturer, model: model.model, equipmenttype: model.equipmenttype },
    serialnumber: input.serial ?? null,
    homeoffice: input.homeoffice,
    lifecycle: "Active",
    status: "Available",
    currentlocation: input.homeoffice,
    custodian: null,
    currentproject: null,
    parentasset: null,
    lastcaldate: null,
    nextcaldue: null,
    retirementreason: null,
    notes: input.notes ?? null,
    carrier: null,
    identifiervalue: null,
    phonenumber: null,
    staticip: null,
  };
  await insertRows(tx, "asset", ASSET_COLUMNS, [assetToValues(newAsset)]);

  const result = await applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "AddToInventory",
    performedby: user.upn,
    date: nowIso(),
    tolocation: input.homeoffice,
    lines: [{ assetId: assetid }],
  });
  // No manual roll-back of the asset row the mock has to do here: a refusal throws out of
  // runCommand's db.transaction() and the INSERT above is undone with it.
  if (!result.ok) return result;

  // The screen shows transactionName; the mock returns the new tag there rather than TXN-nnnnnn
  // because that is what the person who just registered an asset needs to see. Kept.
  return { ok: true, transactionId: result.transactionId, transactionName: assetid };
}
