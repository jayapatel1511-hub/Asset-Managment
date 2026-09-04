/**
 * The offline runtime's public surface and its boot sequence - WS-W6.
 *
 * BOOT ORDER MATTERS MORE THAN ANYTHING ELSE IN THIS FILE.
 *
 *   0. (synchronous, in main.tsx, before React renders)
 *      `guardQueueSnapshotForIdentity` - if the recorded owner of the queue snapshot is not the
 *      user signed in now, move the snapshot out of the engine's reach. See identity.ts for why
 *      this half has to be synchronous.
 *
 *   1. open the partition's database, ask for persistent storage;
 *   2. file anything the gate quarantined into ITS OWN owner's partition as held rows, so another
 *      technician's submissions never land in this user's cache and are waiting for them when
 *      they sign back in;
 *   3. reconcile the remaining durable command rows against the snapshot under the signed-in
 *      identity, and write back the snapshot the engine should hydrate from;
 *   4. install the write-through mirror so later submissions become durable as they are made;
 *   5. build the replay coordinator, which installs the guarded transport on the queue;
 *   6. register the service worker, and only then consider an update;
 *   7. confirm the identity against the server in the background, and correct the partition if the
 *      cached one was wrong.
 *
 * Steps 1-5 are all local, so this completes in a few milliseconds and works with no network -
 * which is the point, since the airplane-mode cold start is one of WS-W6's required device tests.
 * Step 7 is the only step that needs a server, and nothing waits on it.
 *
 * NOTHING HERE FAILS THE APP. Every step is wrapped: a browser with IndexedDB disabled, a Safari
 * private window, a quota-exhausted origin all end with `startOfflineRuntime` returning a runtime
 * whose `db` is null and a `degraded` reason. The app then behaves exactly as it does today -
 * online-only, localStorage queue - and says so, rather than white-screening.
 */
import { getSubmissionQueue } from "../api/queue";
import type { AmsBackend } from "../api/AmsBackend";
import type { SubmissionTransport } from "../api/queue/types";
import type { CurrentUser } from "../api/types";
import { cacheAgeMs, cacheAssets, clearProjections, getCachedAsset, listCachedAssets, searchCachedAssets } from "./cache";
import { countOpenConflicts, listConflicts, recordConflict } from "./conflicts";
import { openOfflineDb, requestPersistentStorage, writeMeta, type OfflineDb } from "./db";
import {
  claimQueueOwnership,
  clearQuarantine,
  guardQueueSnapshotForIdentity,
  readCachedIdentity,
  readQuarantine,
  writeCachedIdentity,
} from "./identity";
import { DEFAULT_TENANT, resolvePartition, type CachePartition } from "./partition";
import { installQueueMirror, type QueueMirrorHandle } from "./queueMirror";
import { DurableCommandStore, QUEUE_STORAGE_KEY } from "./queueStore";
import { registerBackgroundSync, ReplayCoordinator } from "./replay";
import { registerServiceWorker, type ServiceWorkerHandle } from "./swRegistration";

export * from "./partition";
export * from "./projections";
export * from "./cache";
export * from "./drafts";
export * from "./conflicts";
export * from "./cachePolicy";
export * from "./identity";
export { openOfflineDb, deleteOfflineDb, requestPersistentStorage, OFFLINE_DB_VERSION, MIGRATIONS, STORE, OfflineStorageUnavailableError } from "./db";
export type { OfflineDb } from "./db";
export { DurableCommandStore, QUEUE_STORAGE_KEY, canonicalise, requestHash } from "./queueStore";
export type { CommandRow, QueueSnapshotStorage } from "./queueStore";
export { installQueueMirror } from "./queueMirror";
export { ReplayCoordinator, createGuardedTransport, classifyTransportFailure, registerBackgroundSync } from "./replay";
export type { ReplaySummary, ReplayableQueue } from "./replay";
export { registerServiceWorker, decideServiceWorkerUpdate } from "./swRegistration";
export type { ServiceWorkerHandle, UpdateDecision } from "./swRegistration";

/**
 * The app's single backend seam, imported lazily.
 *
 * Static-importing `../api` here would pull the whole backend (and, in mock mode, its dataset
 * hydration) into the module graph of anything that touches the offline layer - including the
 * synchronous `guardOfflineQueueBoot` that main.tsx calls before React renders. The boot gate must
 * cost nothing, so the backend is fetched only at the point replay actually needs it.
 */
async function defaultBackend(): Promise<AmsBackend> {
  return (await import("../api")).backend;
}

export type DegradedReason = "storage-unavailable" | "no-identity" | null;

export interface OfflineRuntime {
  readonly partition: CachePartition | null;
  readonly db: OfflineDb | null;
  readonly store: DurableCommandStore | null;
  readonly coordinator: ReplayCoordinator | null;
  readonly mirror: QueueMirrorHandle | null;
  readonly serviceWorker: ServiceWorkerHandle | null;
  readonly degraded: DegradedReason;
  /** Commands held because a different identity queued them, found during this boot. */
  readonly heldCommands: number;
  stop(): void;
}

const inertRuntime = (degraded: DegradedReason): OfflineRuntime => ({
  partition: null,
  db: null,
  store: null,
  coordinator: null,
  mirror: null,
  serviceWorker: null,
  degraded,
  heldCommands: 0,
  stop() {},
});

export interface StartOfflineRuntimeOptions {
  readonly tenant?: string;
  readonly environment?: string;
  /** Injected in tests. Defaults to the app's single backend seam (api/index.ts). */
  readonly getCurrentUser?: () => Promise<CurrentUser>;
  /** The thing replay actually sends through. Defaults to the same backend seam. */
  readonly transport?: SubmissionTransport;
  /** Skip service-worker registration - tests, and the `dev` server where a worker only gets in
   * the way of hot module replacement. */
  readonly registerWorker?: boolean;
  readonly onUpdateWaiting?: (handle: ServiceWorkerHandle) => void;
}

/**
 * Synchronous half of the boot. Call this from main.tsx BEFORE rendering: it is the only part
 * whose ordering the async half cannot guarantee. See identity.ts.
 */
export function guardOfflineQueueBoot(): void {
  const cached = readCachedIdentity();
  guardQueueSnapshotForIdentity(cached?.objectId ?? null, { queueKey: QUEUE_STORAGE_KEY });
}

let currentRuntime: OfflineRuntime | null = null;

/** The runtime last started on this page. Screens that cannot be handed a handle (the shell) read here. */
export function getOfflineRuntime(): OfflineRuntime | null {
  return currentRuntime;
}

function remember(runtime: OfflineRuntime): OfflineRuntime {
  const previousStop = runtime.stop.bind(runtime);
  const wrapped: OfflineRuntime = {
    ...runtime,
    stop() {
      previousStop();
      if (currentRuntime === wrapped) currentRuntime = null;
    },
  };
  currentRuntime = wrapped;
  return wrapped;
}

/** Asynchronous half. Never throws; returns a degraded runtime instead. */
export async function startOfflineRuntime(options: StartOfflineRuntimeOptions = {}): Promise<OfflineRuntime> {
  const cached = readCachedIdentity();
  if (!cached) {
    // First ever run, or Storage is unusable. There is no queue to protect and no partition to
    // open yet; step 7 below (running for its side effect) will seed the identity for next time.
    void confirmIdentity(options).catch(() => undefined);
    return remember(inertRuntime("no-identity"));
  }

  const partition = resolvePartition(cached, { tenant: options.tenant ?? cached.tenant ?? DEFAULT_TENANT, environment: options.environment });

  let db: OfflineDb;
  try {
    db = await openOfflineDb(partition);
  } catch (error) {
    console.warn("offline: storage unavailable, running online-only", error);
    void confirmIdentity(options).catch(() => undefined);
    return remember(inertRuntime("storage-unavailable"));
  }

  await requestPersistentStorage();
  await writeMeta(db, "partition", partition);

  const store = new DurableCommandStore(db, partition);

  // Anything the synchronous gate parked belongs to somebody else (identity.ts). File it into
  // THAT user's own partition, as held rows, so it is waiting for them when they sign in again -
  // and so the current user's cache never contains another technician's submissions at all. The
  // current user gets a conflict row saying something is held, with no detail that is not theirs.
  const quarantined = readQuarantine();
  let filed = 0;
  let heldFromQuarantine = 0;
  for (const parked of quarantined) {
    try {
      const ownerPartition: CachePartition = { ...partition, objectId: parked.owner };
      const ownerDb = await openOfflineDb(ownerPartition);
      try {
        const ownerStore = new DurableCommandStore(ownerDb, ownerPartition);
        const rows = await ownerStore.importHeldSnapshot(
          parked.snapshot,
          parked.owner,
          `Held on ${parked.quarantinedAt}: a different user signed in on this device.`,
        );
        heldFromQuarantine += rows.length;
        if (rows.length > 0) {
          await recordConflict(ownerDb, ownerPartition, {
            kind: "identity-mismatch",
            subject: "session",
            detail: "Submissions you queued were held because someone else signed in on this device. They have not been sent.",
            affectedAssetIds: rows.flatMap((row) => row.affectedAssetIds),
          });
        }
      } finally {
        ownerDb.close();
      }
      filed += 1;
    } catch (error) {
      // Could not open the other user's partition. Leave the quarantine in place and try again on
      // the next boot - dropping it would destroy the only copy of their work.
      console.warn("offline: could not file a quarantined queue yet", error);
    }
    await recordConflict(db, partition, {
      kind: "identity-mismatch",
      subject: parked.owner,
      detail: "Submissions queued by a previous user of this device are held. They will be sent when that user signs in again.",
    });
  }
  if (quarantined.length > 0 && filed === quarantined.length) clearQuarantine();

  const restored = await store.restoreForIdentity(partition.objectId);
  store.writeSnapshotToStorage(restored.snapshot);
  claimQueueOwnership(partition.objectId);

  if (restored.rebuiltSnapshot || restored.reseededRows) {
    await recordConflict(db, partition, {
      kind: "storage-degraded",
      subject: "queue",
      detail: restored.reseededRows
        ? "Offline storage was cleared on this device; queued submissions were recovered from the browser's copy."
        : "The browser cleared its copy of the queue; queued submissions were recovered from offline storage.",
    });
  }

  // Everything above happens before the engine is constructed, so the array it hydrates is
  // already correct for this identity.
  const queue = getSubmissionQueue();
  const mirror = installQueueMirror(store);

  // iOS can freeze or discard a backgrounded tab without another `setItem` ever happening, so the
  // last thing the technician did would only exist in localStorage. `pagehide` is the event that
  // actually fires on iOS (`beforeunload` frequently does not), and `visibilitychange` covers the
  // ordinary switch to another app.
  const flushMirror = () => void mirror.syncNow();
  const mirrorEvents: Array<() => void> = [];
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushMirror);
    mirrorEvents.push(() => window.removeEventListener("pagehide", flushMirror));
  }
  if (typeof document !== "undefined") {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushMirror();
    };
    document.addEventListener("visibilitychange", onHidden);
    mirrorEvents.push(() => document.removeEventListener("visibilitychange", onHidden));
  }

  const coordinator = new ReplayCoordinator({
    queue,
    transport: options.transport ?? (await defaultBackend()),
    store,
    db,
    partition,
    currentObjectId: () => readCachedIdentity()?.objectId ?? partition.objectId,
  });
  coordinator.start();

  let serviceWorker: ServiceWorkerHandle | null = null;
  if (options.registerWorker !== false) {
    serviceWorker = await registerServiceWorker({
      onUpdateWaiting: (handle) => {
        // Never applied here. The decision needs the queue depth, and the caller may want to ask
        // the user - see swRegistration.ts's header.
        options.onUpdateWaiting?.(handle);
      },
      onReplayRequest: () => void coordinator.replayNow(),
    });
    if (serviceWorker.registration) void registerBackgroundSync(serviceWorker.registration);
  }

  void confirmIdentity(options)
    .then(async (user) => {
      if (!user) return;
      const currentObjectId = user.objectId ?? cached.objectId;
      if (currentObjectId !== partition.objectId) {
        // The device changed hands, or the cached identity was stale. The engine's in-memory array
        // belongs to the previous user; stop replaying and let the next load boot cleanly.
        coordinator.notifyIdentityChanged(currentObjectId);
        await recordConflict(db, partition, {
          kind: "identity-mismatch",
          subject: "session",
          detail: "The signed-in user changed. Queued submissions from the previous session are held until that user signs in again.",
        });
      }
    })
    .catch(() => undefined);

  return remember({
    partition,
    db,
    store,
    coordinator,
    mirror,
    serviceWorker,
    degraded: null,
    heldCommands: restored.held.length + heldFromQuarantine,
    stop() {
      coordinator.stop();
      for (const off of mirrorEvents) off();
      mirror.uninstall();
      db.close();
    },
  });
}

/**
 * Ask the server who is signed in and cache it for the next cold start.
 *
 * Deliberately fire-and-forget everywhere it is called: offline this rejects, and an offline cold
 * start must not be blocked on a call that cannot succeed.
 */
async function confirmIdentity(options: StartOfflineRuntimeOptions): Promise<CurrentUser | null> {
  const get = options.getCurrentUser ?? (async () => (await defaultBackend()).getCurrentUser());
  try {
    const user = await get();
    const objectId = user.objectId ?? `upn:${user.upn.trim().toLowerCase()}`;
    writeCachedIdentity({ objectId, upn: user.upn, tenant: options.tenant ?? DEFAULT_TENANT });
    return user;
  } catch {
    return null;
  }
}

/** Convenience read-side surface for screens, so a caller does not have to hold the runtime.
 * Returns empty rather than throwing when offline storage is unavailable. */
export function offlineReads(runtime: OfflineRuntime) {
  const db = runtime.db;
  if (!db) {
    return {
      searchAssets: async () => [],
      getAsset: async () => undefined,
      listAssets: async () => [],
      conflicts: async () => [],
      openConflictCount: async () => 0,
      cacheAgeMs: async () => null,
    } as const;
  }
  return {
    searchAssets: (query: string) => searchCachedAssets(db, query),
    getAsset: (assetId: string) => getCachedAsset(db, assetId),
    listAssets: () => listCachedAssets(db),
    conflicts: () => listConflicts(db),
    openConflictCount: () => countOpenConflicts(db),
    cacheAgeMs: () => cacheAgeMs(db),
  };
}

/** Refresh the cached projections from the server. Call after a successful online list/search so
 * the next cold start has something to show. */
export async function refreshProjections(runtime: OfflineRuntime): Promise<number> {
  if (!runtime.db || !runtime.partition) return 0;
  const assets = await (await defaultBackend()).listAssets();
  return cacheAssets(runtime.db, runtime.partition, assets);
}

/** Drop cached data on sign-out. Queued commands and drafts survive on purpose - they belong to
 * the person who made them, not to the session. */
export async function clearOfflineData(runtime: OfflineRuntime): Promise<void> {
  if (!runtime.db) return;
  await clearProjections(runtime.db);
}
