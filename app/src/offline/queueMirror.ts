/**
 * Write-through mirror from the submission queue's localStorage key into the durable IndexedDB
 * command rows - WS-W6's "commands persist through app/device restarts" made true today, without
 * editing `api/queue/SubmissionQueue.ts`.
 *
 * READ THIS BEFORE JUDGING THE PROXY:
 *
 *   `SubmissionQueue.persist()` calls `window.localStorage.setItem(key, json)` directly. There is
 *   no injectable storage seam on it, and that file belongs to another lane
 *   (specs/_planning/BUILD-FREEZE.md's ownership table), so this lane cannot add one. The choices
 *   were:
 *
 *     (a) poll `queue.list()` on a timer and copy what changed - which is what
 *         hooks/usePendingSync.ts already does for the pending badge, and is honest for a badge.
 *         For durability it is not: a command queued 400 ms before the phone dies is lost, and
 *         "the queue survives a restart" would be true only on average.
 *
 *     (b) intercept the one localStorage key the queue owns, so the durable write happens on the
 *         same call as the volatile one.
 *
 *   (b) is what this does. The interception is narrow on purpose: a Proxy around the *real*
 *   Storage that forwards every property untouched except `setItem`/`removeItem`/`clear`, and
 *   even then only reacts when the key is the queue's own. Every other localStorage user in the
 *   app - the role switcher, the mock store's delta blob - goes through unchanged and cannot tell
 *   the proxy is there.
 *
 *   THIS IS A SEAM, NOT AN ARCHITECTURE. The moment `SubmissionQueueOptions` accepts the
 *   `storage?: QueueSnapshotStorage` option described in queueStore.ts's `SUBMISSION_QUEUE_SEAM`
 *   note, delete this file and pass a `DurableCommandStore` in instead. It is written to be
 *   deleted.
 *
 * WHY THE WRITE IS FIRE-AND-FORGET:
 *   `setItem` is synchronous and IndexedDB is not, so the mirror cannot make the durable write
 *   part of the caller's call. It serialises writes onto one promise chain (so two rapid
 *   submissions cannot reconcile out of order) and exposes `settled()` for tests and for the
 *   pagehide handler. The volatile write has already succeeded by the time the async one starts,
 *   so the window in which only one copy exists is the same window that exists today - it just
 *   closes shortly afterwards instead of never.
 */
import { QUEUE_STORAGE_KEY, type DurableCommandStore } from "./queueStore";

export interface QueueMirrorOptions {
  readonly storageKey?: string;
  /** Defaults to `globalThis.window`. Injected in tests. */
  readonly target?: Window & typeof globalThis;
  readonly onError?: (error: unknown) => void;
}

export interface QueueMirrorHandle {
  /** Restore the original `localStorage` binding. Always call this in a test teardown. */
  uninstall(): void;
  /** Resolves once every mirrored write scheduled so far has reached IndexedDB. */
  settled(): Promise<void>;
  /** Mirror the current snapshot now, without waiting for a write. Used on pagehide/visibility
   * change, where the page may be frozen before the next `setItem` ever happens. */
  syncNow(): Promise<void>;
}

/**
 * Install the mirror. Idempotent per target: installing twice returns a handle to the first
 * installation rather than stacking proxies, because a stacked proxy would double every write and
 * an `uninstall()` would restore the wrong object.
 */
export function installQueueMirror(store: DurableCommandStore, options: QueueMirrorOptions = {}): QueueMirrorHandle {
  const storageKey = options.storageKey ?? QUEUE_STORAGE_KEY;
  const target = options.target ?? (typeof window !== "undefined" ? window : undefined);
  const onError = options.onError ?? ((error: unknown) => console.warn("offline: durable queue mirror write failed", error));

  if (!target) return inertHandle();

  const alreadyInstalled = (target as MirrorHost)[MIRROR_FLAG];
  if (alreadyInstalled) return alreadyInstalled;

  let real: Storage;
  try {
    real = target.localStorage;
    // Touch it: Safari in private mode and a locked-down profile both throw only on use.
    real.getItem(storageKey);
  } catch (error) {
    onError(error);
    return inertHandle();
  }

  // One chain, so N rapid writes reconcile in the order they were made rather than racing.
  let chain: Promise<void> = Promise.resolve();
  const schedule = (json: string | null): Promise<void> => {
    chain = chain.then(() => store.reconcileSnapshot(json)).then(
      () => undefined,
      (error) => onError(error),
    );
    return chain;
  };

  const proxy = new Proxy(real, {
    get(storage, property) {
      if (property === "setItem") {
        return (key: string, value: string): void => {
          storage.setItem(key, value);
          if (key === storageKey) void schedule(value);
        };
      }
      if (property === "removeItem") {
        return (key: string): void => {
          storage.removeItem(key);
          if (key === storageKey) void schedule(null);
        };
      }
      if (property === "clear") {
        return (): void => {
          storage.clear();
          void schedule(null);
        };
      }
      // `Reflect.get` with the storage itself as receiver, not the proxy: Storage is an exotic
      // object and its own methods throw "Illegal invocation" if `this` is anything else.
      const value = Reflect.get(storage, property, storage);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(storage) : value;
    },
    set(storage, property, value) {
      return Reflect.set(storage, property, value, storage);
    },
  });

  const descriptor = Object.getOwnPropertyDescriptor(target, "localStorage");
  Object.defineProperty(target, "localStorage", { configurable: true, enumerable: true, get: () => proxy });

  const handle: QueueMirrorHandle = {
    uninstall() {
      delete (target as MirrorHost)[MIRROR_FLAG];
      if (descriptor) Object.defineProperty(target, "localStorage", descriptor);
      else Object.defineProperty(target, "localStorage", { configurable: true, enumerable: true, get: () => real });
    },
    settled: () => chain,
    syncNow: () => schedule(real.getItem(storageKey)),
  };

  (target as MirrorHost)[MIRROR_FLAG] = handle;
  return handle;
}

const MIRROR_FLAG = "__amsQueueMirror" as const;
type MirrorHost = { [MIRROR_FLAG]?: QueueMirrorHandle };

/** Used when there is no window, or Storage is unusable. Every method is a no-op so callers never
 * need a null check - and the durable rows are still written at boot and on explicit sync. */
function inertHandle(): QueueMirrorHandle {
  return {
    uninstall() {},
    settled: () => Promise.resolve(),
    syncNow: () => Promise.resolve(),
  };
}
