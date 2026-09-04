/**
 * Draft persistence — WS-W6's "draft persistence for in-progress workflows".
 *
 * WHAT A DRAFT IS, AND WHAT IT IS NOT:
 *   A draft is the half-filled cart on the CheckoutPage: three assets scanned, project not chosen
 *   yet, the technician's phone locks and the OS reclaims the tab. It is a *local editing state*.
 *   It carries no clientSubmissionId, it is never replayed, and it never becomes a transaction on
 *   its own — the technician has to press submit, at which point api/queue takes over and the
 *   thing becomes a queued command with all the identity and idempotency machinery that implies.
 *
 *   This distinction is the reason drafts and commands are separate stores rather than one table
 *   with a status column: WS-W6's "pending is not accepted" would be much easier to violate if a
 *   draft could drift into the replay path by flipping a field. It cannot, because the replay
 *   coordinator never reads this store.
 *
 * IDENTITY: a draft is stamped with the objectId that wrote it and lives in that identity's
 * partition already, so `listDrafts` is scoped twice. A shared site phone that changes hands does
 * not show the previous technician's half-finished cart.
 *
 * EXPIRY: drafts older than DRAFT_TTL_MS are dropped on load. A three-week-old cart is not a
 * resumable workflow, it is a fleet state that has moved on — and offering to resume it invites a
 * check-out built on assets that were returned a fortnight ago.
 */
import { STORE, type OfflineDb } from "./db";
import { assertCacheSafe } from "./projections";
import { partitionKey, type CachePartition } from "./partition";

/** Fourteen days. Long enough to cover a rotation, short enough that a resumed draft is plausible. */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type DraftWorkflow = "Checkout" | "Return" | "Transfer" | "Deploy" | "Recover" | "FaultReport" | "Register";

export interface DraftRow<T = unknown> {
  /** Caller-chosen and stable — one draft per workflow per screen instance, e.g. "Checkout". */
  id: string;
  workflow: DraftWorkflow;
  partition: string;
  /** Entra objectId of the author. Never a UPN — see partition.ts. */
  authorObjectId: string;
  createdAt: string;
  updatedAt: string;
  payload: T;
}

export interface DraftOptions {
  readonly now?: () => string;
  readonly ttlMs?: number;
}

export async function saveDraft<T>(
  db: OfflineDb,
  partition: CachePartition,
  workflow: DraftWorkflow,
  payload: T,
  options: DraftOptions & { id?: string } = {},
): Promise<DraftRow<T>> {
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.id ?? workflow;
  // A draft is user-entered workflow state; it has no business carrying a restricted attribute or
  // a certificate, and if it somehow does we refuse rather than persist it (rules 10 and 11).
  assertCacheSafe(payload, `draft[${id}]`);

  const existing = await db.get<DraftRow<T>>(STORE.DRAFTS, id);
  const timestamp = now();
  const row: DraftRow<T> = {
    id,
    workflow,
    partition: partitionKey(partition),
    authorObjectId: partition.objectId,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    payload,
  };
  await db.put(STORE.DRAFTS, row);
  return row;
}

/** The draft for a workflow, or undefined when there is none or it has expired (expired drafts are
 * deleted as they are found, so a stale one cannot linger and be resumed later). */
export async function loadDraft<T>(
  db: OfflineDb,
  partition: CachePartition,
  workflow: DraftWorkflow,
  options: DraftOptions & { id?: string } = {},
): Promise<DraftRow<T> | undefined> {
  const id = options.id ?? workflow;
  const row = await db.get<DraftRow<T>>(STORE.DRAFTS, id);
  if (!row) return undefined;
  if (row.authorObjectId !== partition.objectId) return undefined;
  if (isExpired(row, options)) {
    await db.delete(STORE.DRAFTS, id);
    return undefined;
  }
  return row;
}

export async function listDrafts<T>(db: OfflineDb, partition: CachePartition, options: DraftOptions = {}): Promise<Array<DraftRow<T>>> {
  const rows = await db.getAll<DraftRow<T>>(STORE.DRAFTS);
  const expired = rows.filter((row) => isExpired(row, options));
  if (expired.length > 0) await db.deleteAll(STORE.DRAFTS, expired.map((row) => row.id));
  return rows
    .filter((row) => row.authorObjectId === partition.objectId && !expired.includes(row))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Delete a draft — on successful submit, or when the technician clears the cart. */
export async function deleteDraft(db: OfflineDb, workflow: DraftWorkflow, id?: string): Promise<void> {
  await db.delete(STORE.DRAFTS, id ?? workflow);
}

function isExpired(row: DraftRow, options: DraftOptions): boolean {
  const ttl = options.ttlMs ?? DRAFT_TTL_MS;
  const nowMs = Date.parse((options.now ?? (() => new Date().toISOString()))());
  const updated = Date.parse(row.updatedAt);
  if (Number.isNaN(updated) || Number.isNaN(nowMs)) return false;
  return nowMs - updated > ttl;
}
