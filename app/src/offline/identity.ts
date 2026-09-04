/**
 * Which identity this device's offline state belongs to - WS-W6's "no replay under another
 * identity" and "same-device user change", made enforceable at the one moment it is hard: boot.
 *
 * THE ORDERING PROBLEM THIS FILE SOLVES:
 *
 *   `api/queue/index.ts`'s `getSubmissionQueue()` constructs the engine lazily, and the engine
 *   hydrates from localStorage inside its constructor - synchronously. Whichever screen touches
 *   the queue first triggers that. Everything this lane can offer (IndexedDB, `/api/me`) is
 *   asynchronous, so there is no way to be *certain* the async boot finishes before some component
 *   renders and pulls a foreign user's commands into memory.
 *
 *   So the identity gate is synchronous and localStorage-only. `guardQueueSnapshotForIdentity`
 *   runs before `ReactDOM.render` in main.tsx, compares the queue's recorded owner with whoever is
 *   signed in now, and if they differ it *moves* the snapshot to a quarantine key instead of
 *   leaving it where the engine will find it. Nothing is deleted; the async boot then turns the
 *   quarantine into durable held rows plus a Needs-attention conflict (queueStore.ts,
 *   conflicts.ts). The engine can hydrate whenever it likes and there is nothing foreign to find.
 *
 * A CACHED IDENTITY IS NOT AN AUTHORIZATION (CLAUDE.md rule 1):
 *
 *   `readCachedIdentity` exists because an airplane-mode cold start cannot call `/api/me`, and the
 *   cache partition needs an object ID before any network is available. It selects *which local
 *   partition to open*. It never decides a role, never unlocks a screen, and never authorises a
 *   request: every command still goes to the server, which resolves the caller from the
 *   authenticated session and can refuse. If the cached identity turns out to be wrong, the worst
 *   case is that the app opened the wrong (empty) local cache for a moment and then corrected it.
 */

/** Where the queue's owner is recorded. Sits next to SubmissionQueue's own key. */
export const QUEUE_OWNER_KEY = "ams-offline-queue-owner-v1";
/** Where a foreign snapshot is parked until the async boot can file it properly. */
export const QUEUE_QUARANTINE_KEY = "ams-offline-queue-quarantine-v1";
/** Last known signed-in identity, for the offline cold start. */
export const CACHED_IDENTITY_KEY = "ams-offline-identity-v1";

export interface CachedIdentity {
  readonly objectId: string;
  readonly upn: string;
  readonly tenant: string;
  readonly cachedAt: string;
}

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOr(storage?: MinimalStorage): MinimalStorage | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Safari private mode throws on access, not on use
  }
}

export function readCachedIdentity(storage?: MinimalStorage): CachedIdentity | null {
  const store = storageOr(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(CACHED_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedIdentity>;
    if (!parsed.objectId || !parsed.upn) return null;
    return { objectId: parsed.objectId, upn: parsed.upn, tenant: parsed.tenant ?? "", cachedAt: parsed.cachedAt ?? "" };
  } catch {
    return null;
  }
}

export function writeCachedIdentity(identity: Omit<CachedIdentity, "cachedAt">, storage?: MinimalStorage, now = () => new Date().toISOString()): void {
  const store = storageOr(storage);
  if (!store) return;
  try {
    store.setItem(CACHED_IDENTITY_KEY, JSON.stringify({ ...identity, cachedAt: now() } satisfies CachedIdentity));
  } catch {
    // Full or disabled Storage. The partition falls back to whatever `/api/me` returns next time
    // there is a network; only the offline cold start degrades.
  }
}

export interface SnapshotGuardResult {
  /** True when a snapshot belonging to someone else was moved out of the engine's way. */
  readonly quarantined: boolean;
  /** The objectId that owned the quarantined snapshot, for the conflict message. */
  readonly previousOwner: string | null;
  /** The quarantined JSON, so the async boot does not have to re-read it. */
  readonly quarantinedSnapshot: string | null;
}

export interface SnapshotGuardOptions {
  readonly storage?: MinimalStorage;
  readonly queueKey?: string;
}

/**
 * Synchronous identity gate. Call before anything can construct the submission queue.
 *
 * Quarantine is append-only within a session: if a device changes hands twice before the async
 * boot runs, both snapshots are kept, as a JSON array of snapshots. Losing a technician's queued
 * work because a colleague borrowed the phone is not an acceptable outcome at any point.
 */
export function guardQueueSnapshotForIdentity(objectId: string | null, options: SnapshotGuardOptions = {}): SnapshotGuardResult {
  const store = storageOr(options.storage);
  const queueKey = options.queueKey ?? "ams-offline-queue-v1";
  const none: SnapshotGuardResult = { quarantined: false, previousOwner: null, quarantinedSnapshot: null };
  if (!store || !objectId) return none;

  try {
    const owner = store.getItem(QUEUE_OWNER_KEY);
    if (owner === objectId) return none;

    const snapshot = store.getItem(queueKey);
    // No owner recorded and no snapshot: a first run. Claim ownership and carry on.
    if (!snapshot) {
      store.setItem(QUEUE_OWNER_KEY, objectId);
      return none;
    }
    // No owner recorded but a snapshot exists: this is the upgrade from a build that predates the
    // owner key. It cannot have belonged to anyone else - there was only ever one queue - so it is
    // adopted rather than quarantined.
    if (owner === null) {
      store.setItem(QUEUE_OWNER_KEY, objectId);
      return none;
    }

    const existing = readQuarantine(store);
    existing.push({ owner, snapshot, quarantinedAt: new Date().toISOString() });
    store.setItem(QUEUE_QUARANTINE_KEY, JSON.stringify(existing));
    store.removeItem(queueKey);
    store.setItem(QUEUE_OWNER_KEY, objectId);
    return { quarantined: true, previousOwner: owner, quarantinedSnapshot: snapshot };
  } catch {
    return none;
  }
}

export interface QuarantinedSnapshot {
  owner: string;
  snapshot: string;
  quarantinedAt: string;
}

export function readQuarantine(storage?: MinimalStorage): QuarantinedSnapshot[] {
  const store = storageOr(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(QUEUE_QUARANTINE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QuarantinedSnapshot[]) : [];
  } catch {
    return [];
  }
}

/** Clear the quarantine once its contents are durable in IndexedDB - and not one moment sooner. */
export function clearQuarantine(storage?: MinimalStorage): void {
  const store = storageOr(storage);
  if (!store) return;
  try {
    store.removeItem(QUEUE_QUARANTINE_KEY);
  } catch {
    /* nothing to do; the rows are already durable, this is only tidying */
  }
}

/** Record who owns the live snapshot. Called after a successful identity resolution. */
export function claimQueueOwnership(objectId: string, storage?: MinimalStorage): void {
  const store = storageOr(storage);
  if (!store) return;
  try {
    store.setItem(QUEUE_OWNER_KEY, objectId);
  } catch {
    /* see writeCachedIdentity */
  }
}
