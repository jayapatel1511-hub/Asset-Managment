/**
 * The service worker - WS-W6's "service worker" and "service-worker update behavior".
 *
 * It is deliberately small. Every decision it makes is a call into offline/cachePolicy.ts, which
 * is a pure function with its own tests; what is left here is event wiring, which cannot be
 * meaningfully unit-tested without a real worker global and is therefore kept to the point where
 * reading it is enough.
 *
 * THE THREE THINGS THIS FILE MUST NOT GET WRONG:
 *
 *   1. It must never cache an API response or the staged fleet data. That is cachePolicy.ts's
 *      allowlist; see its header for why reads are as dangerous as writes here.
 *
 *   2. It must never take control mid-flight. `install` does NOT call `skipWaiting()`. A new
 *      worker sits in `waiting` until the page explicitly sends SKIP_WAITING, and
 *      offline/swRegistration.ts only sends it when no command is queued (CLAUDE.md: "Preserve
 *      queued commands across service-worker updates"). A worker that activates itself would swap
 *      the controller in the middle of a replay pass.
 *
 *   3. `activate` must delete only the caches it owns. It matches the `ams-shell-` prefix and
 *      nothing else, and it never touches IndexedDB - which is where the queued commands live.
 *      A cleanup that reached into storage would be the exact failure mode rule "commands persist
 *      through app/device restarts" exists to prevent.
 *
 * WHY THE WORKER DOES NOT REPLAY:
 *   It cannot. The commands are replayed through an AmsBackend that lives in the page and carries
 *   the page's session. On a `sync` event all this worker does is wake any open client and ask it
 *   to run a pass; if there is no client, the pass happens the next time the app is opened. See
 *   offline/replay.ts's header for why Background Sync is an enhancement and never the mechanism.
 *
 * TYPES: `ServiceWorkerGlobalScope`, `ExtendableEvent` and `FetchEvent` live in TypeScript's
 * `WebWorker` lib, and this project's tsconfig.json compiles `src` with `DOM` (adding `WebWorker`
 * would leak worker globals into every React file, and tsconfig.json is not in this lane). The
 * minimal declarations below are therefore local, and cover exactly what is used.
 */
import { isStaleCacheName, shellCacheName, shellUrlFor, strategyFor } from "./offline/cachePolicy";

// Injected by the service-worker build in vite.config.ts.
declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string[];
declare const __SW_BASE__: string;

interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface SwSyncEvent extends SwExtendableEvent {
  readonly tag: string;
}
interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
}
interface SwGlobalScope {
  addEventListener(type: "install" | "activate", listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: SwMessageEvent) => void): void;
  addEventListener(type: "sync", listener: (event: SwSyncEvent) => void): void;
  skipWaiting(): Promise<void>;
  readonly registration: { scope: string };
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<Array<{ postMessage(message: unknown): void }>>;
  };
  readonly caches: CacheStorage;
  readonly location: Location;
}

const sw = self as unknown as SwGlobalScope;

const VERSION = __SW_VERSION__;
const PRECACHE = __SW_PRECACHE__;
const BASE = __SW_BASE__;
const CACHE = shellCacheName(VERSION);
const SHELL = shellUrlFor({ base: BASE });

const context = { origin: sw.location.origin, base: BASE, precache: PRECACHE };

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await sw.caches.open(CACHE);
      // `reload` so an install never seeds the new generation from the HTTP cache's copy of the
      // old one - the whole point of a versioned precache is that it is fetched fresh.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      // No skipWaiting(). See this file's header, point 2.
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await sw.caches.keys();
      await Promise.all(names.filter((name) => isStaleCacheName(name, VERSION)).map((name) => sw.caches.delete(name)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const decision = strategyFor({ url: event.request.url, method: event.request.method, mode: event.request.mode }, context);
  if (decision.strategy === "network-only") return; // let the browser do it; nothing is stored

  if (decision.strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(networkFirst(event.request));
});

sw.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "SKIP_WAITING") {
    // Only ever sent by swRegistration.ts, and only when it has checked the queue is empty or the
    // user asked for the update explicitly.
    event.waitUntil(sw.skipWaiting());
  }
});

sw.addEventListener("sync", (event) => {
  if (event.tag !== "ams-replay") return;
  event.waitUntil(
    (async () => {
      const clients = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: "REPLAY_REQUEST", version: VERSION });
      // No client open means no replay this time, and that is correct: this worker has no session
      // and no transport. The queue is durable, so the pass happens on next open.
    })(),
  );
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await sw.caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Network first, precached shell second. The cache is only written for requests the policy already
 * approved, and only for a successful, non-opaque response - an opaque or error response cached
 * here would serve a broken shell offline, which is worse than serving nothing.
 */
async function networkFirst(request: Request): Promise<Response> {
  const cache = await sw.caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(request)) ?? (await cache.match(SHELL));
    if (hit) return hit;
    throw error;
  }
}
