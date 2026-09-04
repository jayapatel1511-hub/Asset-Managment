/**
 * The durable pending-command queue - WS-W6's "pending-command queue" and "commands persist
 * through app/device restarts", plus CLAUDE.md's offline rule "Persist command ID, request hash,
 * originating identity, asset row versions and timestamps."
 *
 * WHY THIS FILE EXISTS AT ALL (the honest version):
 *
 *   `api/queue/SubmissionQueue.ts` is a good engine with the right semantics - insertion-order
 *   replay, pending is not accepted, rejection kept for a human, a "Sending" row downgraded to
 *   "Queued" on load because idempotency makes a redundant resend free. What it does *not* have
 *   is a durable place to put any of that: it writes one JSON blob to `localStorage`, which is
 *   synchronous, ~5 MB, evictable without warning, and cleared by browser settings a technician
 *   can reach by accident. It also records nothing about *who* queued a command, so "never replay
 *   under a different identity" cannot be enforced from what is stored.
 *
 *   This file supplies both: one durable row per command, in IndexedDB, in the identity's own
 *   partition, carrying originating objectId, a canonical request hash and timestamps.
 *
 *   `SubmissionQueue.ts` is not in this lane, so it is not edited here. Two things follow:
 *     - `QueueSnapshotStorage` below is the injectable seam it *should* take - one optional
 *       constructor option (see this file's `SUBMISSION_QUEUE_SEAM` note), at which point
 *       queueMirror.ts can be deleted outright.
 *     - Until then, queueMirror.ts write-throughs the localStorage key into this store, and
 *       `restoreForIdentity` rebuilds that key from these rows at boot. The two copies heal each
 *       other: localStorage evicted, rebuilt from IndexedDB; IndexedDB evicted, reseeded from
 *       localStorage. That is the "storage eviction handled without data loss" test.
 *
 * WHY THE ROWS ARE THE TRUTH AND THE SNAPSHOT IS THE WORKING COPY:
 *   Identity partitioning has to happen *before* the queue hydrates, because once it has
 *   hydrated, an array in memory is all there is and nothing can un-queue a foreign command
 *   without editing the engine. Boot order is therefore: read rows, hold anything whose
 *   originObjectId is not the signed-in user, write only the survivors to localStorage, then let
 *   the queue hydrate. A held command is never in the array the engine replays, so it cannot be
 *   sent by accident; it is surfaced instead (conflicts store, see replay.ts).
 */
import { STORE, type OfflineDb } from "./db";
import { partitionKey, type CachePartition } from "./partition";
import { assertCacheSafe } from "./projections";
import type { QueuedSubmission, QueueableInput } from "../api/queue/types";
import type { PendingSubmissionKind, PendingSubmissionStatus } from "../api/types";

/** The localStorage key SubmissionQueue.ts writes. Duplicated deliberately: importing its private
 * DEFAULT_STORAGE_KEY is not possible (it is not exported) and hard-coupling to it here keeps the
 * coupling in one visible place. tests/offline/queueStore.test.ts asserts the two agree. */
export const QUEUE_STORAGE_KEY = "ams-offline-queue-v1";

/**
 * SUBMISSION_QUEUE_SEAM - the change this lane needs and did not make.
 *
 * `SubmissionQueueOptions` gains one optional field:
 *
 *     storage?: QueueSnapshotStorage;
 *
 * `persist()` becomes `void this.storage.writeSnapshot(json)` and `hydrate()` becomes an awaited
 * `readSnapshot()` in a `static async create()`. The 17 tests in tests/api/queue.test.ts keep
 * their current behaviour by defaulting to a localStorage-backed implementation of the same
 * interface. Until that lands, queueMirror.ts provides the same effect from outside.
 */
export interface QueueSnapshotStorage {
  readSnapshot(): Promise<string | null>;
  writeSnapshot(json: string): Promise<void>;
  clearSnapshot(): Promise<void>;
}

/** A command's durable status. Adds one value to the engine's three. */
export type DurableCommandStatus = PendingSubmissionStatus | "HeldForIdentity";

export interface CommandRow {
  /** SubmissionQueue's own entry id - the primary key on both sides. */
  id: string;
  /** Monotonic insertion order. Replay order is insertion order (FR-038) and a millisecond
   * timestamp ties on a fast double-tap, so order is stored explicitly. */
  sequence: number;
  clientSubmissionId: string;
  kind: PendingSubmissionKind;
  /**
   * Canonical hash of the request payload. NOT the server's authoritative idempotency hash - the
   * server canonicalises and hashes for itself (CLAUDE.md API rules), and the browser owns no
   * authority over whether two requests are the same one. This is the device-local change
   * detector that makes "same submission ID, different payload" visible here rather than only as
   * a refusal after the round trip.
   */
  requestHash: string;
  /** Entra objectId of whoever queued it. The identity guard's entire basis. */
  originObjectId: string;
  partition: string;
  affectedAssetIds: string[];
  queuedAt: string;
  updatedAt: string;
  status: DurableCommandStatus;
  attempts: number;
  rejectionReason: string | null;
  /** Why a command is held or was refused, in a form Needs attention can render. */
  holdReason: string | null;
  payload: QueueableInput;
}

/**
 * Canonical JSON: object keys sorted at every depth, so `{a:1,b:2}` and `{b:2,a:1}` hash the same.
 * Arrays keep their order - a two-line cart is not the same request with the lines swapped, since
 * `primaryAssetId` and line order both carry meaning.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

/**
 * FNV-1a, 64-bit, hex. Chosen over `crypto.subtle.digest` because that is async and unavailable in
 * some of the environments this runs in, and over a dependency because the requirement here is
 * determinism, not collision resistance against an adversary: the value never leaves the device
 * and the server does its own canonical hashing.
 */
export function requestHash(kind: PendingSubmissionKind, payload: unknown): string {
  const input = `${kind} ${canonicalise(payload)}`;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ BigInt(input.charCodeAt(i))) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface DurableCommandStoreOptions {
  readonly now?: () => string;
  readonly storageKey?: string;
  /** The Storage the snapshot half lives in. Injected so tests are not at the mercy of a shared
   * global, and so the mirror can hand in the *real* Storage after it has proxied the global. */
  readonly snapshotStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface RestoreResult {
  /** Commands returned to the live queue because they belong to the signed-in identity. */
  readonly restored: CommandRow[];
  /** Commands withheld because a different identity queued them (WS-W6: never replay under
   * another identity). Surfaced, never sent, never deleted. */
  readonly held: CommandRow[];
  /** True when the snapshot had to be rebuilt from IndexedDB - i.e. localStorage had been
   * evicted or cleared. Worth telling the user about; it is the near-miss. */
  readonly rebuiltSnapshot: boolean;
  /** True when IndexedDB was empty and rows had to be reseeded from the snapshot - the other
   * direction of the same eviction. */
  readonly reseededRows: boolean;
}

export class DurableCommandStore implements QueueSnapshotStorage {
  private readonly now: () => string;
  private readonly storageKey: string;
  private readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  /**
   * Serialises every *mutating* operation.
   *
   * Without it, `reconcileSnapshot` (driven by the mirror, asynchronously) and `markHeld` /
   * `markAccepted` (driven by the guarded transport, also asynchronously) interleave as a
   * read-modify-write race: reconcile reads the rows, the guard marks one held, reconcile writes
   * its stale copy back, and a held command is labelled Queued again. The *hold itself* would
   * still be enforced, because the guard re-checks `originObjectId` on every attempt and that
   * field is never rewritten - but a status the UI reads must not flicker, and a durable store
   * that loses a write under ordinary concurrency is not durable. Reads are deliberately left
   * outside the chain: they are consistent by IndexedDB's own transaction semantics and blocking
   * them would serialise the read path for no benefit.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: OfflineDb,
    private readonly partition: CachePartition,
    options: DurableCommandStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.storageKey = options.storageKey ?? QUEUE_STORAGE_KEY;
    this.storage = options.snapshotStorage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work, work);
    // The chain must survive a rejected step, or one failed write would wedge every later one.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // ---- QueueSnapshotStorage: the seam SubmissionQueue should take ----

  async readSnapshot(): Promise<string | null> {
    const rows = await this.listActive();
    return rows.length === 0 ? null : JSON.stringify(rows.map(toQueuedSubmission));
  }

  async writeSnapshot(json: string): Promise<void> {
    await this.reconcileSnapshot(json);
  }

  clearSnapshot(): Promise<void> {
    return this.serialize(async () => {
      const rows = await this.listAll();
      await this.db.deleteAll(
        STORE.COMMANDS,
        rows.filter((r) => r.status !== "HeldForIdentity").map((r) => r.id),
      );
    });
  }

  // ---- durable rows ----

  async listAll(): Promise<CommandRow[]> {
    const rows = await this.db.getAll<CommandRow>(STORE.COMMANDS);
    return rows.sort((a, b) => a.sequence - b.sequence);
  }

  /** Rows belonging to the signed-in identity that the engine should be replaying. */
  async listActive(): Promise<CommandRow[]> {
    return (await this.listAll()).filter((row) => row.status !== "HeldForIdentity" && row.originObjectId === this.partition.objectId);
  }

  async listHeld(): Promise<CommandRow[]> {
    return (await this.listAll()).filter((row) => row.status === "HeldForIdentity");
  }

  async findBySubmissionId(clientSubmissionId: string): Promise<CommandRow | undefined> {
    const rows = await this.db.getAllFromIndex<CommandRow>(STORE.COMMANDS, "by-submission", clientSubmissionId);
    return rows[0];
  }

  /**
   * Bring the durable rows in line with one snapshot of the engine's array.
   *
   * Rows that disappear from the snapshot were accepted by the server and removed by the engine
   * (attemptOne's `entries.filter` on `ok:true`), so they are deleted here too. A held row is
   * never in the snapshot by construction, and is therefore explicitly exempt from that deletion:
   * without the exemption, holding a foreign command would immediately destroy it.
   */
  reconcileSnapshot(json: string | null): Promise<CommandRow[]> {
    return this.serialize(() => this.reconcileSnapshotInner(json));
  }

  private async reconcileSnapshotInner(json: string | null): Promise<CommandRow[]> {
    const entries = parseSnapshot(json);
    const existing = new Map((await this.listAll()).map((row) => [row.id, row]));
    let sequence = Math.max(0, ...[...existing.values()].map((row) => row.sequence));

    const rows: CommandRow[] = [];
    for (const entry of entries) {
      const previous = existing.get(entry.id);
      const row: CommandRow = {
        id: entry.id,
        sequence: previous?.sequence ?? ++sequence,
        clientSubmissionId: entry.clientSubmissionId,
        kind: entry.kind,
        requestHash: requestHash(entry.kind, entry.input),
        // First sighting stamps the identity; it is never restamped, or a device that changed
        // hands would relabel the previous technician's command as the new one's.
        originObjectId: previous?.originObjectId ?? this.partition.objectId,
        partition: partitionKey(this.partition),
        affectedAssetIds: entry.affectedAssetIds,
        queuedAt: entry.queuedAt,
        updatedAt: this.now(),
        status: previous?.status === "HeldForIdentity" ? "HeldForIdentity" : entry.status,
        attempts: entry.attempts,
        rejectionReason: entry.rejectionReason,
        holdReason: previous?.holdReason ?? null,
        payload: entry.input,
      };
      assertCacheSafe(row.payload, `command[${row.clientSubmissionId}]`);
      rows.push(row);
    }

    const keep = new Set(rows.map((row) => row.id));
    const removed = [...existing.values()].filter((row) => !keep.has(row.id) && row.status !== "HeldForIdentity");

    await this.db.putAll(STORE.COMMANDS, rows);
    await this.db.deleteAll(
      STORE.COMMANDS,
      removed.map((row) => row.id),
    );
    return rows;
  }

  /**
   * File a snapshot that belongs to somebody else, into THEIR partition, as held rows.
   *
   * Used for the quarantine identity.ts creates when a device changes hands (see this file's
   * header and offline/index.ts's boot sequence). The owner is passed in explicitly rather than
   * taken from `this.partition`, because the whole point is that these rows are not the current
   * user's - `reconcileSnapshot` would stamp them with whoever is signed in now, which is exactly
   * the mislabelling the identity guard exists to prevent.
   *
   * Existing rows are never overwritten: a command already filed under this owner keeps the
   * status and history it has.
   */
  importHeldSnapshot(json: string | null, owner: string, reason: string): Promise<CommandRow[]> {
    return this.serialize(async () => {
      const entries = parseSnapshot(json);
      if (entries.length === 0) return [];
      const existing = new Map((await this.listAll()).map((row) => [row.id, row]));
      let sequence = Math.max(0, ...[...existing.values()].map((row) => row.sequence));

      const rows = entries
        .filter((entry) => !existing.has(entry.id))
        .map((entry) => {
          const row: CommandRow = {
            id: entry.id,
            sequence: ++sequence,
            clientSubmissionId: entry.clientSubmissionId,
            kind: entry.kind,
            requestHash: requestHash(entry.kind, entry.input),
            originObjectId: owner,
            partition: partitionKey({ ...this.partition, objectId: owner }),
            affectedAssetIds: entry.affectedAssetIds,
            queuedAt: entry.queuedAt,
            updatedAt: this.now(),
            status: "HeldForIdentity",
            attempts: entry.attempts,
            rejectionReason: entry.rejectionReason,
            holdReason: reason,
            payload: entry.input,
          };
          assertCacheSafe(row.payload, `command[${row.clientSubmissionId}]`);
          return row;
        });

      await this.db.putAll(STORE.COMMANDS, rows);
      return rows;
    });
  }

  /**
   * Boot-time reconciliation between the durable rows and the localStorage snapshot, for one
   * identity. Returns the snapshot the engine should hydrate from - the caller writes it before
   * constructing the queue.
   */
  restoreForIdentity(objectId: string, rawSnapshot?: string | null): Promise<RestoreResult & { snapshot: string | null }> {
    return this.serialize(() => this.restoreForIdentityInner(objectId, rawSnapshot));
  }

  private async restoreForIdentityInner(objectId: string, rawSnapshot?: string | null): Promise<RestoreResult & { snapshot: string | null }> {
    const snapshotJson = rawSnapshot !== undefined ? rawSnapshot : this.storage?.getItem(this.storageKey) ?? null;
    const snapshotEntries = parseSnapshot(snapshotJson);
    let rows = await this.listAll();

    // IndexedDB lost (evicted, new profile, Safari clearing a 7-day-idle origin) but the snapshot
    // survived: reseed the durable rows from it rather than dropping the commands.
    const reseededRows = rows.length === 0 && snapshotEntries.length > 0;
    if (reseededRows) {
      rows = await this.reconcileSnapshotInner(snapshotJson);
    }

    // Identity partitioning, before the engine ever sees the array.
    const foreign = rows.filter((row) => row.originObjectId !== objectId && row.status !== "HeldForIdentity");
    if (foreign.length > 0) {
      await this.db.putAll(
        STORE.COMMANDS,
        foreign.map((row) => ({
          ...row,
          status: "HeldForIdentity" as const,
          updatedAt: this.now(),
          holdReason: `Queued by a different signed-in user (${row.originObjectId}); held rather than replayed.`,
        })),
      );
      rows = await this.listAll();
    }

    const mine = rows.filter((row) => row.status !== "HeldForIdentity" && row.originObjectId === objectId);
    const held = rows.filter((row) => row.status === "HeldForIdentity");

    // localStorage lost but the durable rows survived - the common eviction direction.
    const rebuiltSnapshot = snapshotEntries.length < mine.length || foreign.length > 0;
    const snapshot = mine.length === 0 ? null : JSON.stringify(mine.map(toQueuedSubmission));
    return { restored: mine, held, rebuiltSnapshot, reseededRows, snapshot };
  }

  /** Persist the snapshot the engine will hydrate from. Separated from `restoreForIdentity` so a
   * caller can inspect the result before committing to it. */
  writeSnapshotToStorage(snapshot: string | null): void {
    if (!this.storage) return;
    try {
      if (snapshot === null) this.storage.removeItem(this.storageKey);
      else this.storage.setItem(this.storageKey, snapshot);
    } catch {
      // Quota or a disabled Storage: the durable rows are still correct, and the engine will run
      // in memory for this session. Losing the snapshot is survivable; losing the rows is not.
    }
  }

  markHeld(id: string, reason: string): Promise<void> {
    return this.serialize(async () => {
      const row = await this.db.get<CommandRow>(STORE.COMMANDS, id);
      if (!row) return;
      await this.db.put(STORE.COMMANDS, { ...row, status: "HeldForIdentity", holdReason: reason, updatedAt: this.now() });
    });
  }

  markRejected(clientSubmissionId: string, reason: string | null): Promise<void> {
    return this.serialize(async () => {
      const row = await this.findBySubmissionId(clientSubmissionId);
      if (!row) return;
      await this.db.put(STORE.COMMANDS, { ...row, status: "Rejected", rejectionReason: reason, updatedAt: this.now() });
    });
  }

  /** The server accepted it. The durable row goes; the history now lives server-side, where it is
   * append-only (rule 5). */
  markAccepted(clientSubmissionId: string): Promise<void> {
    return this.serialize(async () => {
      const row = await this.findBySubmissionId(clientSubmissionId);
      if (!row) return;
      await this.db.delete(STORE.COMMANDS, row.id);
    });
  }

  async count(): Promise<number> {
    return this.db.count(STORE.COMMANDS);
  }
}

function parseSnapshot(json: string | null): QueuedSubmission[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as QueuedSubmission[]) : [];
  } catch {
    // A corrupted snapshot is not a reason to lose the durable rows - treat it as empty and let
    // restoreForIdentity rebuild it from IndexedDB.
    return [];
  }
}

/** Durable row to the shape SubmissionQueue.hydrate() expects. A row is handed back as "Queued"
 * whatever it was mid-flight, for the same reason the engine downgrades "Sending" on load: every
 * replay is idempotent on clientSubmissionId, so a redundant resend is free and a lost one is not. */
function toQueuedSubmission(row: CommandRow): QueuedSubmission {
  return {
    id: row.id,
    kind: row.kind,
    clientSubmissionId: row.clientSubmissionId,
    input: row.payload,
    affectedAssetIds: row.affectedAssetIds,
    queuedAt: row.queuedAt,
    status: row.status === "Rejected" ? "Rejected" : "Queued",
    rejectionReason: row.rejectionReason,
    attempts: row.attempts,
  };
}
