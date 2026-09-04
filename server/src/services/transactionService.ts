/**
 * The write path — this server's copy of flow F1 (docs/03-automation.md), and the only code in
 * the process that writes an asset's derived fields (status, currentlocation, custodian,
 * currentproject, parentasset). Constitution Principle I: those are OUTPUTS of a transaction
 * line, never a direct edit, and the function that computes them is
 * app/src/domain/deriveState.ts — imported, never copied. See server/README.md.
 *
 * Structure mirrors api/mock/store.ts's applyTransaction deliberately, so the two produce the
 * same outcome (and the same refusal text) for the same input:
 *
 *   pass 1  validate every line through deriveState, writing nothing; return on the first
 *           refusal, naming the offending asset (FR-003, FR-023)
 *   pass 2  header, one line per asset, the derived asset update, the kit relationship
 *           open/close operations, and the permanent-Component mirror (F1 step 5)
 *
 * Two things the mock cannot do, which the database gives for free:
 *   - A composite command (Return then ReportFault; a recovery's Undeploy then MarkMissing) is
 *     all-or-nothing, because `runCommand` holds one PostgreSQL transaction across every
 *     applyTransaction call and a refusal after a write ROLLS BACK rather than returning (that
 *     is what the Refusal error class is for — returning `{ ok: false }` out of a
 *     `db.transaction()` callback would commit the earlier writes).
 *   - `SELECT ... FOR UPDATE` on the affected assets, in assetid order, so a checkout of the
 *     same asset from two devices serialises rather than interleaving. PGlite is
 *     single-connection so this is documentation of intent today and load-bearing the moment
 *     the same SQL runs against networked PostgreSQL (see db/pglite.ts's header).
 *
 * Idempotency (FR-007) is handled once per COMMAND in `runCommand`, against the
 * command_idempotency table, not per applyTransaction call: a replay returns the stored
 * response and writes nothing. Only accepted commands are recorded — a refused one is
 * re-evaluated on retry, exactly as the mock does (it adds to processedClientSubmissionIds only
 * on success), because a refusal is an answer about the state at that moment, not a result to
 * replay forever.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db/database";
import type { SubmissionError, SubmissionOutcome } from "../../../app/src/api/AmsBackend";
import type { Condition, CurrentUser, KitRole, TransactionHeader } from "../../../app/src/api/types";
import { deriveState, type AssetSnapshot, type RelationshipOp, type TransactionLineInput } from "../../../app/src/domain/deriveState";
import type { TransactionType } from "../../../app/src/domain/stateMachine";
import type { Queryable } from "../db/pglite";
import { HEADER_COLUMNS, LINE_COLUMNS, assetFromRow, headerToValues, insertRows, type AssetRow } from "../db/rows";
import { enqueue, transactionAcceptedEvent } from "../outbox";

// ---------------------------------------------------------------- refusal / command wrapper

/** Thrown to roll back a PostgreSQL transaction while carrying the refusal back to the route,
 * where it becomes an HTTP 200 `{ ok: false, reason }` — see server/README.md § Refusals. */
export class Refusal extends Error {
  constructor(readonly outcome: SubmissionError) {
    super(outcome.reason);
    this.name = "Refusal";
  }
}

export function refuse(reason: string, offendingAssetId?: string): SubmissionError {
  return offendingAssetId ? { ok: false, reason, offendingAssetId } : { ok: false, reason };
}

/** Key order-independent hash of the request body, stored for traceability and to notice a
 * client reusing one submission id for two different requests. */
function hashRequest(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export interface CommandMeta {
  clientSubmissionId: string;
  command: string;
  user: CurrentUser;
  /** The parsed request body, hashed into the idempotency record. */
  request: unknown;
  /** Optional logger for the "same key, different body" case. */
  warn?: (payload: Record<string, unknown>, message: string) => void;
}

/**
 * Runs one command as a single PostgreSQL transaction, idempotently.
 *
 * `body` receives the transaction and returns the outcome. A refusal is turned into a rollback
 * and handed back unchanged; a real fault propagates and becomes a 5xx (a genuine transport
 * failure the offline queue SHOULD retry, unlike a refusal).
 */
export async function runCommand(
  db: Database,
  meta: CommandMeta,
  body: (tx: Queryable) => Promise<SubmissionOutcome>
): Promise<SubmissionOutcome> {
  const requestHash = hashRequest(meta.request);

  // Two attempts, never more. The only reason to go round again is losing the claim race, and
  // the winner's row is committed by the time we lose it — so the second pass reads it and
  // returns. A third pass could not learn anything the second did not.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prior = await lookupIdempotency(db, meta.clientSubmissionId);
    if (prior) return answerFromStore(prior, requestHash, meta);

    try {
      return await db.transaction(async (tx) => {
        // THE CLAIM, and it is the first thing in the transaction on purpose.
        //
        // A second copy of the same submission inserting this primary key BLOCKS here until we
        // commit or roll back — PostgreSQL's own duplicate-key wait, not a lock we invented. So
        // two simultaneous copies can never both run the command, which is what read-then-insert
        // allowed (finding WS-W4-F2). Claiming before `lockAssets` also means duplicates never
        // contend for asset rows at all.
        //
        // `response` is NULL between here and the UPDATE below. No other session can ever observe
        // that: the row is uncommitted until the outcome is written, and a crash in between rolls
        // the claim away rather than stranding it.
        await tx.query(
          `INSERT INTO command_idempotency (client_submission_id, request_hash, user_upn, command, response, created_at)
           VALUES ($1, $2, $3, $4, NULL, $5)`,
          [meta.clientSubmissionId, requestHash, meta.user.upn, meta.command, new Date().toISOString()]
        );

        const outcome = await body(tx);
        // A refusal rolls the claim back with everything else, so the command is re-evaluated on
        // retry. That is deliberate and unchanged: a refusal is an answer about the state at that
        // moment, not a result to replay forever.
        if (!outcome.ok) throw new Refusal(outcome);

        // CLAUDE.md rule 2: "One business event is one atomic database commit... commits all
        // transaction lines, state changes, relationship changes AND OUTBOX EVENTS, or commits
        // none." This is the line that makes the last clause true. It runs on `tx`, so the outbox
        // row lands in the same commit as the lines it describes — there is no window in which a
        // business event exists without its event, or an event exists without its business fact.
        //
        // Deliberately reads the committed lines back rather than re-deriving the asset list from
        // `meta.request`: every command shape spells its assets differently (`lines[]`,
        // `assetIds[]`, a bare `assetId`, and deployment's primary-plus-components), and a second
        // derivation is a second thing to keep in step. The lines are the truth that was just
        // written.
        await emitAcceptedEvent(tx, meta);

        await tx.query("UPDATE command_idempotency SET response = $1::jsonb WHERE client_submission_id = $2", [
          JSON.stringify(outcome),
          meta.clientSubmissionId,
        ]);
        return outcome;
      });
    } catch (err) {
      if (err instanceof Refusal) return err.outcome;
      // We lost the claim race: the other copy committed while we waited on its key. Go round
      // once and answer from its result rather than surfacing a 500 (finding WS-W4-F3).
      if (isDuplicateKey(err) && attempt === 0) continue;
      throw err;
    }
  }

  const settled = await lookupIdempotency(db, meta.clientSubmissionId);
  if (!settled) throw new Error(`Command ${meta.command} lost the idempotency claim but found no committed result.`);
  return answerFromStore(settled, requestHash, meta);
}

interface IdempotencyRow {
  response: SubmissionOutcome | null;
  request_hash: string;
}

async function lookupIdempotency(db: Queryable, clientSubmissionId: string): Promise<IdempotencyRow | null> {
  const res = await db.query<IdempotencyRow>(
    "SELECT response, request_hash FROM command_idempotency WHERE client_submission_id = $1",
    [clientSubmissionId]
  );
  return res.rows[0] ?? null;
}

/**
 * What a stored claim means for the caller in front of us.
 *
 * Same id + same request -> the original result (CLAUDE.md rule 3, first clause).
 * Same id + DIFFERENT request -> refused (rule 3, second clause).
 *
 * The refusal is the correction of finding WS-W4-F1. This function used to return the stored
 * outcome in both cases, and `server/README.md` § Idempotency argued for it: "refusing would make
 * a replay fail after a success the caller may already have seen." That argument answers the
 * wrong question. A client that reuses one submission id for two different requests has a bug,
 * and handing it someone else's success hides the bug and silently drops the second request —
 * which is worse than an error a developer can see. CLAUDE.md rule 3 and the frozen R2 contract
 * both say refuse; rule 13 says the specification wins.
 */
function answerFromStore(row: IdempotencyRow, requestHash: string, meta: CommandMeta): SubmissionOutcome {
  if (row.request_hash !== requestHash) {
    meta.warn?.(
      { clientSubmissionId: meta.clientSubmissionId, command: meta.command },
      "submission id reused with a different body — refusing (CLAUDE.md rule 3)"
    );
    return refuse(
      "This submission was already used for a different request, so it was refused rather than " +
        "applied twice. [command.error.idempotencyPayloadMismatch]"
    );
  }
  if (!row.response) {
    // Unreachable through the claim protocol above: a committed row always carries its outcome.
    throw new Error(`Idempotency row ${meta.clientSubmissionId} is committed with no response.`);
  }
  return row.response;
}

/** SQLSTATE 23505. `pg` puts it on `code`; the message is a fallback for any driver that does not. */
function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate key value/i.test(e?.message ?? "");
}

// ---------------------------------------------------------------- applyTransaction

export interface TransactionLineSpec {
  assetId: string;
  condition?: Condition | null;
  kitRole?: KitRole | null;
  retirementReason?: string | null;
  /** Deploy lines only — feature 005. */
  orientation?: string | null;
  powersource?: string | null;
}

export interface ApplyTransactionParams {
  /** Written to asset_transaction.client_submission_id for traceability. Idempotency itself is
   * `runCommand`'s job, one record per command, not per header. */
  clientSubmissionId: string;
  transactiontype: TransactionType;
  performedby: string;
  date: string;
  fromlocation?: string | null;
  tolocation?: string | null;
  fromuser?: string | null;
  touser?: string | null;
  fromproject?: string | null;
  toproject?: string | null;
  toLocationKind?: "Office" | "Site" | "CalibrationLab" | "Other" | null;
  calibrationResult?: "Pass" | "Fail" | "Adjusted" | null;
  primaryAssetId?: string | null;
  expectedreturn?: string | null;
  notes?: string | null;
  lines: TransactionLineSpec[];
}

function snapshotOf(row: AssetRow): AssetSnapshot {
  const asset = assetFromRow(row);
  return {
    assetId: asset.assetid,
    status: asset.status,
    lifecycle: asset.lifecycle,
    disposition: row.disposition,
    serviceability: row.serviceability,
    homeoffice: asset.homeoffice,
    currentlocation: asset.currentlocation,
    custodian: asset.custodian,
    currentproject: asset.currentproject,
    parentasset: asset.parentasset,
  };
}

/** Locks the named assets in a deterministic order (current assetid) — see this file's header. */
async function lockAssets(tx: Queryable, assetIds: string[]): Promise<Map<string, AssetRow>> {
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return new Map();
  const lowered = unique.map((id) => id.trim().toLowerCase());
  const res = await tx.query<AssetRow>(
    `SELECT a.*
       FROM asset a
      WHERE a.assetid = ANY($1::text[])
         OR a.id IN (
              SELECT i.asset_uuid FROM asset_identifier i
               WHERE i.is_current
                 AND (i.identifier_value = ANY($1::text[]) OR i.normalized_value = ANY($2::text[]))
            )
      ORDER BY a.assetid
      FOR UPDATE`,
    [unique, lowered]
  );
  const byCurrent = new Map(res.rows.map((r) => [r.assetid, r]));
  const byUuid = new Map(res.rows.map((r) => [r.id, r]));
  const aliases = await tx.query<{ identifier_value: string; normalized_value: string; asset_uuid: string }>(
    `SELECT identifier_value, normalized_value, asset_uuid FROM asset_identifier
      WHERE is_current AND (identifier_value = ANY($1::text[]) OR normalized_value = ANY($2::text[]))`,
    [unique, lowered]
  );
  const out = new Map<string, AssetRow>();
  for (const requested of unique) {
    const direct = byCurrent.get(requested);
    if (direct) {
      out.set(requested, direct);
      continue;
    }
    const alias = aliases.rows.find(
      (a) => a.identifier_value === requested || a.normalized_value === requested.trim().toLowerCase()
    );
    const row = alias ? byUuid.get(alias.asset_uuid) : undefined;
    if (row) out.set(requested, row);
  }
  return out;
}

async function nextTransactionName(tx: Queryable): Promise<string> {
  const res = await tx.query<{ nextval: string | number }>("SELECT nextval('transaction_name_seq') AS nextval");
  return `TXN-${String(Number(res.rows[0].nextval)).padStart(6, "0")}`;
}

/**
 * Applies one transaction across a set of asset lines. Validates every line before writing
 * anything; on refusal nothing in this call has been written (and `runCommand` rolls back
 * anything an earlier call in the same command wrote).
 */
export async function applyTransaction(tx: Queryable, params: ApplyTransactionParams): Promise<SubmissionOutcome> {
  if (params.lines.length === 0) {
    return refuse("Add at least one asset before submitting.");
  }

  const rows = await lockAssets(
    tx,
    params.lines.map((l) => l.assetId)
  );

  // ---- pass 1: validate, writing nothing ----
  const plans: Array<{ row: AssetRow; line: TransactionLineSpec; fields: ReturnType<typeof deriveState> }> = [];
  for (const line of params.lines) {
    const row = rows.get(line.assetId);
    if (!row) {
      return refuse(`Unknown asset ${line.assetId}.`, line.assetId);
    }
    // FR-026: a permanent Component child never carries a line of its own — it follows its
    // parent (see mirrorComponentChildren below). Refused here as well as in the UI.
    if (params.transactiontype === "Checkout" || params.transactiontype === "Deploy") {
      if (await hasOpenComponentParent(tx, row.assetid)) {
        return refuse(
          `${line.assetId} is a permanent component of another asset and cannot be transacted on its own.`,
          line.assetId
        );
      }
    }
    const foundDefaultsToHome =
      params.transactiontype === "Found" && !params.tolocation && !params.touser && !params.toproject;
    const lineInput: TransactionLineInput = {
      type: params.transactiontype,
      date: params.date,
      tolocation: foundDefaultsToHome ? row.homeoffice : params.tolocation,
      toLocationKind: foundDefaultsToHome ? "Office" : params.toLocationKind,
      touser: params.touser,
      toproject: params.toproject,
      calibrationResult: params.calibrationResult,
      primaryAssetId: params.primaryAssetId,
      retirementReason: line.retirementReason,
      isPrimary: params.primaryAssetId === line.assetId,
    };
    const derived = deriveState(snapshotOf(row), lineInput);
    if (!derived.ok) {
      return refuse(derived.reason, line.assetId);
    }
    plans.push({ row, line, fields: derived });
  }

  // ---- pass 2: write ----
  const transactionId = randomUUID();
  const transactionName = await nextTransactionName(tx);
  const header: TransactionHeader = {
    id: transactionId,
    name: transactionName,
    transactiontype: params.transactiontype,
    transactiondate: params.date,
    performedby: params.performedby,
    fromlocation: params.fromlocation ?? null,
    tolocation: params.tolocation ?? null,
    fromuser: params.fromuser ?? null,
    touser: params.touser ?? null,
    fromproject: params.fromproject ?? null,
    toproject: params.toproject ?? null,
    primaryasset: params.primaryAssetId ?? null,
    // The mock appends "[clientSubmissionId:…]" to the note because it has nowhere else to put
    // it; here the id has its own column, so the user's note stays the user's note.
    notes: params.notes ?? null,
    expectedreturn: params.expectedreturn ?? null,
  };
  await insertRows(tx, "asset_transaction", HEADER_COLUMNS, [
    headerToValues(header, params.clientSubmissionId, new Date().toISOString()),
  ]);

  let lineNumber = 0;
  for (const plan of plans) {
    if (!plan.fields.ok) continue; // unreachable after pass 1; satisfies narrowing
    const { fields, relationshipOps } = plan.fields;
    lineNumber += 1;

    await insertRows(tx, "asset_transaction_line", LINE_COLUMNS, [
      [
        randomUUID(),
        transactionId,
        plan.row.assetid,
        plan.row.lifecycle,
        fields.lifecycle,
        plan.row.disposition,
        fields.disposition,
        plan.row.serviceability,
        fields.serviceability,
        plan.line.kitRole ?? null,
        plan.line.orientation ?? null,
        plan.line.powersource ?? null,
        plan.line.condition ?? null,
        true,
        null,
        lineNumber,
      ],
    ]);

    // The ONE place asset current state is written (Principle I) — axes are stored; status is generated.
    await tx.query(
      `UPDATE asset
          SET lifecycle = $1, disposition = $2, serviceability = $3,
              custodian = $4, currentlocation = $5, currentproject = $6,
              retirementreason = $7, row_version = row_version + 1
        WHERE assetid = $8`,
      [
        fields.lifecycle,
        fields.disposition,
        fields.serviceability,
        fields.custodian,
        fields.currentlocation,
        fields.currentproject,
        fields.retirementReason ?? plan.row.retirementreason,
        plan.row.assetid,
      ]
    );

    await applyRelationshipOps(tx, relationshipOps, transactionId);
    await mirrorComponentChildren(tx, plan.row.assetid);
  }

  return { ok: true, transactionId, transactionName };
}

async function hasOpenComponentParent(tx: Queryable, assetId: string): Promise<boolean> {
  const res = await tx.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM asset_relationship
      WHERE childasset = $1 AND end_at IS NULL AND relationshiptype = 'Component'`,
    [assetId]
  );
  return (res.rows[0]?.c ?? 0) > 0;
}

/**
 * asset.parentasset is a derived mirror of whichever relationship row is currently open, so it
 * is recomputed from the rows rather than assigned. This matters for an asset that is both a
 * permanent Component of one asset and (never) a kit child of another: recomputing keeps the
 * Component parent, where the mock's unconditional `parentasset = null` on a kit close would
 * drop it.
 */
async function refreshParentAsset(tx: Queryable, childAssetId: string): Promise<void> {
  await tx.query(
    `UPDATE asset
        SET parentasset = (SELECT parentasset FROM asset_relationship
                            WHERE childasset = $1 AND end_at IS NULL
                            ORDER BY relationshiptype LIMIT 1)
      WHERE assetid = $1`,
    [childAssetId]
  );
}

async function applyRelationshipOps(tx: Queryable, ops: RelationshipOp[], transactionId: string): Promise<void> {
  for (const op of ops) {
    if (op.op === "open") {
      // The schema's rel_one_open_parent partial unique index allows a child exactly one open
      // parent. An asset moving straight from one kit to another (checked out under logger A,
      // then deployed under logger B without an intervening Return) therefore has its previous
      // Kit membership closed on the same date rather than colliding with the index — the mock,
      // having no index, would have left two open rows and reported the wrong parent.
      const open = await tx.query<{ id: string; parentasset: string; relationshiptype: string }>(
        "SELECT id, parentasset, relationshiptype FROM asset_relationship WHERE childasset = $1 AND end_at IS NULL",
        [op.childAssetId]
      );
      if (open.rows.some((r) => r.parentasset === op.parentAssetId)) continue; // already in this kit
      for (const stale of open.rows.filter((r) => r.relationshiptype === "Kit")) {
        await tx.query("UPDATE asset_relationship SET end_at = $1, closedbyline = $2 WHERE id = $3", [
          op.start,
          transactionId,
          stale.id,
        ]);
      }
      await tx.query(
        `INSERT INTO asset_relationship (id, parentasset, childasset, relationshiptype, start_at, end_at, createdbyline, closedbyline)
         VALUES ($1, $2, $3, 'Kit', $4, NULL, $5, NULL)`,
        [randomUUID(), op.parentAssetId, op.childAssetId, op.start, transactionId]
      );
      await refreshParentAsset(tx, op.childAssetId);
    } else if (op.op === "closeAsChild") {
      await tx.query(
        `UPDATE asset_relationship SET end_at = $1, closedbyline = $2
          WHERE childasset = $3 AND end_at IS NULL AND relationshiptype = 'Kit'`,
        [op.end, transactionId, op.childAssetId]
      );
      await refreshParentAsset(tx, op.childAssetId);
    } else {
      const kids = await tx.query<{ childasset: string }>(
        `SELECT childasset FROM asset_relationship
          WHERE parentasset = $1 AND end_at IS NULL AND relationshiptype = 'Kit'`,
        [op.parentAssetId]
      );
      await tx.query(
        `UPDATE asset_relationship SET end_at = $1, closedbyline = $2
          WHERE parentasset = $3 AND end_at IS NULL AND relationshiptype = 'Kit'`,
        [op.end, transactionId, op.parentAssetId]
      );
      for (const kid of kids.rows) await refreshParentAsset(tx, kid.childasset);
    }
  }
}

/** F1 step 5: a permanent Component child mirrors its parent's status, location, custodian and
 * project. It gets no line of its own — the parent's line IS its history. */
async function mirrorComponentChildren(tx: Queryable, parentAssetId: string): Promise<void> {
  await tx.query(
    `UPDATE asset AS child
        SET lifecycle = parent.lifecycle, disposition = parent.disposition, serviceability = parent.serviceability,
            currentlocation = parent.currentlocation,
            custodian = parent.custodian, currentproject = parent.currentproject,
            row_version = child.row_version + 1
       FROM asset AS parent, asset_relationship AS rel
      WHERE parent.assetid = $1
        AND rel.parentasset = parent.assetid
        AND rel.relationshiptype = 'Component'
        AND rel.end_at IS NULL
        AND child.assetid = rel.childasset`,
    [parentAssetId]
  );
}


// ---------------------------------------------------------------- outbox

/**
 * Writes the `transaction.accepted` outbox row for an accepted command, inside the command's own
 * transaction.
 *
 * Skipped — not failed — when the outcome names no transaction header. Not every accepted command
 * is a business *event*: `SetOfficeAdmins` changes an administrative assignment and creates no
 * transaction, and a composite command such as deployment returns one id while writing several.
 * The header lookup is what distinguishes them, and it is a lookup rather than a list of command
 * names so that a new command type is classified by what it actually wrote.
 */
async function emitAcceptedEvent(tx: Queryable, meta: CommandMeta): Promise<void> {
  // Every header this command wrote, not just the one it returned.
  //
  // A single command can be several business events. Returning a damaged asset is a Return AND a
  // ReportFault; recovering a partially-missing installation is a Recover AND a MarkMissing.
  // Those are committed together and the command returns ONE transaction id, so looking up that
  // id alone emitted one event and silently dropped the others — a fault reported on return
  // reached no consumer at all. Measured and pinned by `tests/outbox.test.ts` A1e, which the
  // documents/outbox lane wrote against this function before it existed.
  //
  // The composites mark their extra headers by suffixing the client submission id — `-fault`,
  // `-return-from-cal` (commandService.ts), `-missing`, `-deploy` (deploymentService.ts). Matching
  // the prefix rather than listing those four suffixes means a composite added later is picked up
  // without anyone remembering to update a list here.
  //
  // `starts_with` rather than LIKE on purpose: the submission id comes from the client, and a
  // value containing `%` or `_` would be a wildcard in a LIKE pattern. This compares literally.
  const headers = await tx.query<{ id: string; name: string; transactiontype: string; transactiondate: string }>(
    `SELECT id, name, transactiontype, transactiondate
       FROM asset_transaction
      WHERE client_submission_id = $1 OR starts_with(client_submission_id, $1 || '-')
      ORDER BY transactiondate, name`,
    [meta.clientSubmissionId]
  );
  if (headers.rows.length === 0) return;

  for (const row of headers.rows) {
    const lines = await tx.query<{ asset: string }>(
      "SELECT DISTINCT asset FROM asset_transaction_line WHERE transaction_id = $1 ORDER BY asset",
      [row.id]
    );

    await enqueue(
      tx,
      transactionAcceptedEvent({
        transactionId: row.id,
        transactionName: row.name,
        transactionType: row.transactiontype,
        assetIds: lines.rows.map((l) => l.asset),
        performedByUserId: meta.user.upn,
        recordedAt: row.transactiondate,
        clientSubmissionId: meta.clientSubmissionId,
      })
    );
  }
}
