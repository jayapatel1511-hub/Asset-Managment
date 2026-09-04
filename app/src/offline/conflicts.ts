/**
 * The durable conflict register - WS-W6's "Needs-attention conflict surface" and its rule
 * "conflicts are visible and never silently dropped", plus CLAUDE.md's "Surface every conflict in
 * Needs attention."
 *
 * WHY A SEPARATE STORE RATHER THAN A FLAG ON THE COMMAND:
 *
 *   The queue engine already keeps a refused command in the queue as "Rejected" and offers Retry
 *   (features/offline/NeedsAttentionPage.tsx), which covers exactly one of the five ways a replay
 *   can go wrong. The other four leave the command *still queued and still valid*, so there is
 *   nowhere on the command to record what happened:
 *
 *     identity-mismatch   a different user is signed in on this device; the command is held.
 *     auth-expired        the session died while replaying; nothing is wrong with the command.
 *     version-conflict    a second device moved the asset first; the server refused on state.
 *     rejected            the server understood and refused (the case the engine already keeps).
 *     storage-degraded    a copy of the queue was lost and rebuilt from the other copy.
 *
 *   A conflict row also *outlives the command*: after a technician retries successfully, the
 *   record that "this check-out was refused because Bravo had already returned the logger" is the
 *   thing that explains the fleet's history to whoever asks tomorrow. Deleting it with the command
 *   would erase the only device-side account of what happened.
 *
 * NOTHING HERE DECIDES ANYTHING. A conflict row is a notification, never an authority: it does not
 * change asset state, does not un-queue a command, and does not mark anything accepted (CLAUDE.md
 * rule 1). Resolution is a human pressing Retry, or signing in again.
 */
import { STORE, type OfflineDb } from "./db";
import { partitionKey, type CachePartition } from "./partition";

export type ConflictKind = "identity-mismatch" | "auth-expired" | "version-conflict" | "rejected" | "storage-degraded";

export interface ConflictRow {
  /** Stable per (kind, subject) so a replay that fails on every pass produces one row, not one a
   * minute. `occurrences` carries the repetition instead. */
  id: string;
  kind: ConflictKind;
  /** The command's clientSubmissionId where there is one; otherwise a subsystem name. */
  subject: string;
  partition: string;
  /** Human-readable, already safe to display. Never contains a restricted field value. */
  detail: string;
  affectedAssetIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  /** Set when a human has dealt with it. Resolved rows are kept, not deleted - see the header. */
  resolvedAt: string | null;
}

export interface RecordConflictInput {
  readonly kind: ConflictKind;
  readonly subject: string;
  readonly detail: string;
  readonly affectedAssetIds?: string[];
}

export interface ConflictOptions {
  readonly now?: () => string;
}

function conflictId(kind: ConflictKind, subject: string): string {
  return `${kind}:${subject}`;
}

/** Record a conflict, or bump the one that is already there. Idempotent by (kind, subject). */
export async function recordConflict(
  db: OfflineDb,
  partition: CachePartition,
  input: RecordConflictInput,
  options: ConflictOptions = {},
): Promise<ConflictRow> {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const id = conflictId(input.kind, input.subject);
  const existing = await db.get<ConflictRow>(STORE.CONFLICTS, id);

  const row: ConflictRow = {
    id,
    kind: input.kind,
    subject: input.subject,
    partition: partitionKey(partition),
    detail: input.detail,
    affectedAssetIds: input.affectedAssetIds ?? existing?.affectedAssetIds ?? [],
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    occurrences: (existing?.occurrences ?? 0) + 1,
    // A conflict that recurs after being resolved is open again - the resolution did not hold.
    resolvedAt: null,
  };
  await db.put(STORE.CONFLICTS, row);
  return row;
}

/** Everything Needs attention should show, newest first. Unresolved only, unless asked otherwise. */
export async function listConflicts(db: OfflineDb, options: { includeResolved?: boolean } = {}): Promise<ConflictRow[]> {
  const rows = await db.getAll<ConflictRow>(STORE.CONFLICTS);
  return rows
    .filter((row) => options.includeResolved === true || row.resolvedAt === null)
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

export async function countOpenConflicts(db: OfflineDb): Promise<number> {
  return (await listConflicts(db)).length;
}

/** Mark a conflict handled. The row stays; only `resolvedAt` changes. */
export async function resolveConflict(db: OfflineDb, id: string, options: ConflictOptions = {}): Promise<void> {
  const row = await db.get<ConflictRow>(STORE.CONFLICTS, id);
  if (!row) return;
  await db.put(STORE.CONFLICTS, { ...row, resolvedAt: (options.now ?? (() => new Date().toISOString()))() });
}

/** Resolve every open conflict for one command - what a successful retry means. */
export async function resolveConflictsFor(db: OfflineDb, subject: string, options: ConflictOptions = {}): Promise<number> {
  const rows = (await listConflicts(db)).filter((row) => row.subject === subject);
  const now = (options.now ?? (() => new Date().toISOString()))();
  await db.putAll(
    STORE.CONFLICTS,
    rows.map((row) => ({ ...row, resolvedAt: now })),
  );
  return rows.length;
}
