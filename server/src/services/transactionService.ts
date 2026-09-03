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
import type { PGlite } from "@electric-sql/pglite";
import type { SubmissionError, SubmissionOutcome } from "../../../app/src/api/AmsBackend";
import type { Condition, CurrentUser, KitRole, TransactionHeader } from "../../../app/src/api/types";
import { deriveState, type AssetSnapshot, type RelationshipOp, type TransactionLineInput } from "../../../app/src/domain/deriveState";
import type { TransactionType } from "../../../app/src/domain/stateMachine";
import type { Queryable } from "../db/pglite";
import { HEADER_COLUMNS, LINE_COLUMNS, assetFromRow, headerToValues, insertRows, type AssetRow } from "../db/rows";

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
  db: PGlite,
  meta: CommandMeta,
  body: (tx: Queryable) => Promise<SubmissionOutcome>
): Promise<SubmissionOutcome> {
  const requestHash = hashRequest(meta.request);
  // A closure-assigned box: TypeScript cannot see a write made inside the callback, so the
  // outcome is carried out explicitly rather than through the transaction's return value.
  const box: { value: SubmissionOutcome | null } = { value: null };

  try {
    await db.transaction(async (tx) => {
      const prior = await tx.query<{ response: SubmissionOutcome; request_hash: string }>(
        "SELECT response, request_hash FROM command_idempotency WHERE client_submission_id = $1",
        [meta.clientSubmissionId]
      );
      const seen = prior.rows[0];
      if (seen) {
        if (seen.request_hash !== requestHash) {
          meta.warn?.(
            { clientSubmissionId: meta.clientSubmissionId, command: meta.command },
            "submission id replayed with a different body — returning the original outcome (FR-007)"
          );
        }
        box.value = seen.response;
        return;
      }

      const outcome = await body(tx);
      if (!outcome.ok) throw new Refusal(outcome);

      await tx.query(
        `INSERT INTO command_idempotency (client_submission_id, request_hash, user_upn, command, response, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [meta.clientSubmissionId, requestHash, meta.user.upn, meta.command, JSON.stringify(outcome), new Date().toISOString()]
      );
      box.value = outcome;
    });
  } catch (err) {
    if (err instanceof Refusal) return err.outcome;
    throw err;
  }

  if (!box.value) throw new Error(`Command ${meta.command} produced no outcome.`);
  return box.value;
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
    homeoffice: asset.homeoffice,
    currentlocation: asset.currentlocation,
    custodian: asset.custodian,
    currentproject: asset.currentproject,
    parentasset: asset.parentasset,
  };
}

/** Locks the named assets in a deterministic order (assetid) — see this file's header. */
async function lockAssets(tx: Queryable, assetIds: string[]): Promise<Map<string, AssetRow>> {
  const unique = [...new Set(assetIds)].sort();
  if (unique.length === 0) return new Map();
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(",");
  const res = await tx.query<AssetRow>(
    `SELECT * FROM asset WHERE assetid IN (${placeholders}) ORDER BY assetid FOR UPDATE`,
    unique
  );
  return new Map(res.rows.map((r) => [r.assetid, r]));
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
      if (await hasOpenComponentParent(tx, line.assetId)) {
        return refuse(
          `${line.assetId} is a permanent component of another asset and cannot be transacted on its own.`,
          line.assetId
        );
      }
    }
    const lineInput: TransactionLineInput = {
      type: params.transactiontype,
      date: params.date,
      tolocation: params.tolocation,
      touser: params.touser,
      toproject: params.toproject,
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
        plan.row.status,
        fields.statusAfter,
        plan.line.kitRole ?? null,
        plan.line.orientation ?? null,
        plan.line.powersource ?? null,
        plan.line.condition ?? null,
        true,
        null,
        lineNumber,
      ],
    ]);

    // The ONE place asset current state is written (Principle I) — every value comes from
    // deriveState's result, none from the request.
    await tx.query(
      `UPDATE asset
          SET status = $1, lifecycle = $2, custodian = $3, currentlocation = $4, currentproject = $5,
              retirementreason = $6, row_version = row_version + 1
        WHERE assetid = $7`,
      [
        fields.statusAfter,
        fields.lifecycle,
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
        SET status = parent.status, currentlocation = parent.currentlocation,
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
