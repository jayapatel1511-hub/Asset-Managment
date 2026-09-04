/**
 * What the service worker may cache — CLAUDE.md rules 10 and 11 enforced at the network layer, and
 * WS-W6's "cache only approved projections".
 *
 * The three assertions that matter most, and why they are worth a test each:
 *   - a command response is never cached: a cached `POST /api/commands/Checkout` is a stored claim
 *     that a business event happened, which the browser has no authority to make (rule 1);
 *   - an API *read* is never cached either: `GET /api/assets` carries `identifiervalue`,
 *     `phonenumber` and `staticip` for an Office Admin, and Cache Storage re-runs no role check
 *     when a different user opens the same device tomorrow;
 *   - `/data/*` is never cached or precached: that is the 1,026-asset staged copy.
 */
import { describe, expect, it } from "vitest";
import { SHELL_CACHE_PREFIX, isStaleCacheName, shellCacheName, shellUrlFor, shouldPrecache, strategyFor, type PolicyContext } from "../../src/offline/cachePolicy";

const context: PolicyContext = {
  origin: "https://ams.englobe.test",
  base: "/",
  precache: ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png"],
};

const get = (url: string, mode?: string) => strategyFor({ url, method: "GET", mode }, context);
const post = (url: string) => strategyFor({ url, method: "POST" }, context);

describe("no command response is ever cached", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s is network-only", (method) => {
    const decision = strategyFor({ url: "https://ams.englobe.test/api/commands/Checkout", method }, context);
    expect(decision.strategy).toBe("network-only");
    expect(decision.reason).toMatch(/non-GET/);
  });

  it("holds for every command endpoint the app actually posts to", () => {
    for (const path of ["/api/commands/Checkout", "/api/commands/Return", "/api/commands/Transfer", "/api/assets", "/api/calibrations", "/api/deployments"]) {
      expect(post(`https://ams.englobe.test${path}`).strategy).toBe("network-only");
    }
  });
});

describe("no API response is cached at all, read or write", () => {
  it.each(["/api/assets", "/api/assets/SEIS-INS-MIC-0001", "/api/me", "/api/reports/fleet-counts", "/api/locations"])(
    "GET %s is network-only",
    (path) => {
      const decision = get(`https://ams.englobe.test${path}`);
      expect(decision.strategy).toBe("network-only");
      expect(decision.reason).toContain("api/");
    },
  );

  it("is not fooled by a query string or a trailing path", () => {
    expect(get("https://ams.englobe.test/api/assets?query=SEIS").strategy).toBe("network-only");
    expect(get("https://ams.englobe.test/api/assets/X/history").strategy).toBe("network-only");
  });
});

describe("staged fleet data never enters a cache", () => {
  it("is network-only at fetch time", () => {
    const decision = get("https://ams.englobe.test/data/assets.json");
    expect(decision.strategy).toBe("network-only");
    expect(decision.reason).toContain("data/");
  });

  it("is excluded from the precache manifest", () => {
    expect(shouldPrecache("data/assets.json")).toBe(false);
    expect(shouldPrecache("data/assets_clean.json")).toBe(false);
  });
});

describe("the app shell is cached, and only the app shell", () => {
  it("serves a navigation network-first with an offline shell fallback", () => {
    const decision = get("https://ams.englobe.test/asset/SEIS-INS-MIC-0001", "navigate");
    expect(decision.strategy).toBe("network-first");
  });

  it("serves content-hashed build output cache-first", () => {
    expect(get("https://ams.englobe.test/assets/index-7bDZmb1q.js").strategy).toBe("cache-first");
  });

  it("serves an explicitly precached file cache-first", () => {
    expect(get("https://ams.englobe.test/manifest.webmanifest").strategy).toBe("cache-first");
    expect(get("https://ams.englobe.test/icons/icon-192.png").strategy).toBe("cache-first");
  });

  it("denies anything not on the allowlist rather than caching it speculatively", () => {
    const decision = get("https://ams.englobe.test/something-new.json");
    expect(decision.strategy).toBe("network-only");
    expect(decision.reason).toMatch(/allowlist/);
  });

  it("never caches a third party", () => {
    expect(get("https://cdn.example.com/analytics.js").strategy).toBe("network-only");
  });

  it("ignores extension and devtools schemes", () => {
    expect(get("chrome-extension://abcdef/inject.js").strategy).toBe("network-only");
  });
});

describe("hosting under a path prefix", () => {
  const prefixed: PolicyContext = { origin: "https://ams.englobe.test", base: "/ams/", precache: ["/ams/", "/ams/index.html"] };

  it("still refuses the API and the staged data", () => {
    expect(strategyFor({ url: "https://ams.englobe.test/ams/api/assets", method: "GET" }, prefixed).strategy).toBe("network-only");
    expect(strategyFor({ url: "https://ams.englobe.test/ams/data/assets.json", method: "GET" }, prefixed).strategy).toBe("network-only");
  });

  it("resolves the shell under the prefix", () => {
    expect(shellUrlFor({ base: "/ams/" })).toBe("/ams/index.html");
    expect(shellUrlFor({ base: "/ams" })).toBe("/ams/index.html");
  });
});

describe("cache generations", () => {
  it("names a cache after the build version so a deploy invalidates cleanly", () => {
    expect(shellCacheName("abc123")).toBe(`${SHELL_CACHE_PREFIX}abc123`);
  });

  it("marks earlier generations stale and leaves everything else alone", () => {
    expect(isStaleCacheName("ams-shell-old", "new")).toBe(true);
    expect(isStaleCacheName("ams-shell-new", "new")).toBe(false);
    // Not ours: another app on the same origin, or a browser-managed cache.
    expect(isStaleCacheName("workbox-precache-v2", "new")).toBe(false);
    expect(isStaleCacheName("some-other-cache", "new")).toBe(false);
  });
});

describe("precache selection", () => {
  it("takes the shell files", () => {
    for (const file of ["index.html", "assets/index-abc.js", "assets/style-abc.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"]) {
      expect(shouldPrecache(file)).toBe(true);
    }
  });

  it("leaves out source maps and the worker itself", () => {
    expect(shouldPrecache("assets/index-abc.js.map")).toBe(false);
    // A worker that precached itself could never be replaced by a newer one.
    expect(shouldPrecache("sw.js")).toBe(false);
  });
});
