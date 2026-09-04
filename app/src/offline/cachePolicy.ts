/**
 * What the service worker is allowed to put in the HTTP cache - WS-W6's "service worker", and the
 * place CLAUDE.md rules 10 and 11 are enforced at the network layer rather than the data layer.
 *
 * This is a pure function on purpose. A service worker is one of the hardest things in a web app
 * to test - it needs a real worker global, a real Cache Storage and a real registration - so the
 * *decision* is separated from the plumbing. `sw.ts` is then a thin shell that applies whatever
 * this returns, and tests/offline/cachePolicy.test.ts proves the rules directly.
 *
 * THE POLICY IS AN ALLOWLIST. Anything not explicitly matched is `network-only`. That is the
 * opposite of the usual service-worker recipe, and it is deliberate:
 *
 *   /api/*   NOTHING is cached. Not reads, not writes.
 *            Writes are obvious - a cached command response is a lie about whether a business
 *            event happened, and "pending is not accepted" (WS-W6) forbids it.
 *            Reads are the subtle half: `GET /api/assets` returns unrestricted API rows including
 *            `identifiervalue`, `phonenumber` and `staticip` for an Office Admin, and Cache
 *            Storage has no role check to re-run when that entry is read back tomorrow by a
 *            different signed-in user on the same device. CLAUDE.md's offline rule is "Cache only
 *            approved projections, never unrestricted API rows" - so offline reads come from the
 *            IndexedDB projections (cache.ts), which are narrowed and asserted, and the HTTP cache
 *            simply never holds an API response at all.
 *
 *   /data/*  NEVER cached, and never precached. This is `app/public/data/` - the local copy of
 *            migration/staged/, 1,026 real assets with 127 ICCIDs, 129 phone numbers and 226
 *            static IPs. `scripts/scan-bundle.mjs` and `vite.config.ts`'s `publicDir: false`
 *            already keep it out of a release *bundle*; this keeps a development or demo build
 *            from parking it in a long-lived device cache on the way past.
 *
 *   the shell  Precached and served cache-first: the HTML entry, the content-hashed JS/CSS, the
 *            manifest and the icons. Content-hashed filenames make cache-first safe - a new build
 *            has new names, so a stale asset is unreachable rather than merely unlikely.
 */

export type CacheStrategy =
  /** Serve from the precache; go to the network only on a miss. Safe for content-hashed files. */
  | "cache-first"
  /** Try the network, fall back to the precached shell. For navigations. */
  | "network-first"
  /** Never touched by the cache, in either direction. */
  | "network-only";

export interface RoutedRequest {
  readonly url: string;
  readonly method: string;
  /** `Request.mode` - "navigate" identifies a document load. */
  readonly mode?: string;
}

export interface PolicyContext {
  /** The worker's own origin. Anything else is third-party and never cached. */
  readonly origin: string;
  /** Vite's `base` - "/" today, a path prefix if the app is ever hosted under one. */
  readonly base: string;
  /** Files precached at install, as absolute paths (base included). */
  readonly precache: readonly string[];
}

export interface PolicyDecision {
  readonly strategy: CacheStrategy;
  /** Short machine-readable reason. Logged, and asserted in tests, so a policy change is visible
   * as a changed reason rather than only as a changed boolean. */
  readonly reason: string;
}

const decide = (strategy: CacheStrategy, reason: string): PolicyDecision => ({ strategy, reason });

/** Paths under `base` that are never cached under any circumstances. */
const NEVER_CACHE_PREFIXES = [
  "api/", // every API response - see the header
  "data/", // staged fleet data with restricted SIM/network fields
];

/** Content-hashed build output. Vite writes these into `assets/` with a hash in the filename. */
const HASHED_ASSET_PREFIX = "assets/";

export function strategyFor(request: RoutedRequest, context: PolicyContext): PolicyDecision {
  // 1. Anything that is not a GET is a command or a probe. Cache Storage only stores GETs anyway;
  //    saying so explicitly means the rule is asserted rather than inherited from a browser quirk.
  if (request.method.toUpperCase() !== "GET") {
    return decide("network-only", "non-GET: commands and their responses are never cached");
  }

  let url: URL;
  try {
    url = new URL(request.url, context.origin);
  } catch {
    return decide("network-only", "unparseable URL");
  }

  // 2. Third-party. Nothing in this app needs a cross-origin cache, and an opaque response would
  //    consume quota with something we cannot inspect.
  if (url.origin !== context.origin) {
    return decide("network-only", "cross-origin");
  }

  // 3. Chrome DevTools and extension probes; not ours to cache.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return decide("network-only", "non-http scheme");
  }

  const base = context.base.endsWith("/") ? context.base : `${context.base}/`;
  const relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.replace(/^\//, "");

  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (relative === prefix.replace(/\/$/, "") || relative.startsWith(prefix)) {
      return decide("network-only", `never-cache prefix: ${prefix}`);
    }
  }

  // 4. A document load. Network-first so a deployed change is picked up as soon as there is a
  //    link, with the precached shell as the offline answer - this is the airplane-mode cold
  //    start (WS-W6 required device test).
  if (request.mode === "navigate") {
    return decide("network-first", "navigation: shell fallback when offline");
  }

  // 5. Content-hashed build output, or anything explicitly precached.
  if (relative.startsWith(HASHED_ASSET_PREFIX)) {
    return decide("cache-first", "content-hashed build asset");
  }
  if (context.precache.includes(url.pathname)) {
    return decide("cache-first", "precached shell file");
  }

  // 6. Deny by default.
  return decide("network-only", "not on the precache allowlist");
}

/** The shell entry a navigation falls back to when the network is gone. */
export function shellUrlFor(context: Pick<PolicyContext, "base">): string {
  const base = context.base.endsWith("/") ? context.base : `${context.base}/`;
  return `${base}index.html`;
}

/**
 * Which emitted build files belong in the precache.
 *
 * The exclusions are the point: `data/` for the reason in the header, source maps because they are
 * large and only useful with devtools open, and anything already carrying a hash is included
 * (it is the shell) while `.map`/`.txt` sidecars are not.
 */
export function shouldPrecache(fileName: string): boolean {
  if (fileName.startsWith("data/")) return false;
  if (fileName.endsWith(".map")) return false;
  if (fileName === "sw.js") return false; // a worker that precaches itself cannot be updated
  return /\.(html|js|css|webmanifest|svg|png|woff2?)$/i.test(fileName);
}

/** Cache names are versioned so activate() can delete every earlier generation in one sweep. */
export function shellCacheName(version: string): string {
  return `ams-shell-${version}`;
}

export const SHELL_CACHE_PREFIX = "ams-shell-";

/** True for a cache this worker owns but no longer wants. Never returns true for a name we do not
 * recognise - deleting another origin-mate's cache is not ours to do. */
export function isStaleCacheName(name: string, currentVersion: string): boolean {
  return name.startsWith(SHELL_CACHE_PREFIX) && name !== shellCacheName(currentVersion);
}
