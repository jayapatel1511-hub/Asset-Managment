/**
 * Contract drift check: does the client still ask for routes the server still answers?
 *
 * WS-W1 asks for a "generated OpenAPI or equivalent contract artifact". A hand-written OpenAPI
 * document would be the obvious answer and the wrong one — it is a third copy of the truth, it
 * drifts silently, and nothing fails when it does. What the requirement is actually protecting
 * against is one specific accident: someone renames a route in `server/src/routes/`, the server
 * suite stays green because it was updated in the same edit, the app suite stays green because it
 * runs against `api/mock/`, and the break only appears when a human opens the running app.
 *
 * So this file uses the two implementations as the artifact. It reads every `/api/...` path
 * literal out of `app/src/api/http/index.ts` — the client's entire view of the contract, since
 * that adapter is the only thing in the browser that names a URL — and asks the real Fastify
 * router whether each one resolves. A route that exists but refuses the body is a pass: a 400
 * from zod proves the router matched. Only "no such route" is a failure.
 *
 * The check is deliberately one-directional. A server route with no client caller is not a
 * defect (reports and health checks are reached by other things); a client call with no server
 * route is always a defect.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, type TestApp } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = path.resolve(here, "../../app/src/api/http/index.ts");

/**
 * Every path the adapter names, with interpolations replaced by a value that is safe in a URL
 * segment. `${enc(assetId)}` becomes "x" — the router only cares that a segment is present.
 */
export function extractClientPaths(rawSource: string): Array<{ method: string; path: string }> {
  // Comments first. The adapter's own header says it "talks only to same-origin `/api/*`", and a
  // scanner that cannot tell prose from code would dutifully ask the router for `/api/*`.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: Array<{ method: string; path: string }> = [];

  // `fetch(path, { method: "POST" ... })` is wrapped by getJson/getJsonOrNull (GET) and
  // send("POST"|"PUT", ...) — so the method travels with the call site, not the literal.
  // Matching the literal and its enclosing helper is more fragile than matching the two shapes
  // the adapter actually uses, which are the only two it has ever had.
  const literal = /(["`])(\/api\/[^"`]*)\1/g;
  const sendCall = /send\(\s*"(POST|PUT)"\s*,\s*(["`])(\/api\/[^"`]*)\2/g;

  const sendPaths = new Map<string, string>();
  for (const m of source.matchAll(sendCall)) sendPaths.set(normalise(m[3]), m[1]);

  for (const m of source.matchAll(literal)) {
    const p = normalise(m[2]);
    found.push({ method: sendPaths.get(p) ?? "GET", path: p });
  }

  // De-duplicate on method+path; several methods share `/api/assets`.
  const seen = new Set<string>();
  return found.filter((r) => {
    if (r.path.includes("*")) return false;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * `/api/assets/${enc(id)}/history` → `/api/assets/x/history`
 * `/api/reports/fleet-counts${qs({ ... })}` → `/api/reports/fleet-counts`
 *
 * Brace-matched rather than regex-replaced, because the adapter interpolates an object literal
 * (`${qs({ horizonDays })}`) and `\$\{[^}]*\}` stops at the *first* closing brace, which is the
 * object's — leaving a stray `)}` glued onto the path. A query-string interpolation also has to
 * be dropped entirely rather than substituted, since it contributes no path segment.
 */
function normalise(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < raw.length && depth > 0) {
        if (raw[j] === "{") depth += 1;
        else if (raw[j] === "}") depth -= 1;
        j += 1;
      }
      const expr = raw.slice(i + 2, j - 1);
      // A query-string helper produces "?a=b" or "", never a segment.
      if (/\bqs\(|Qs\(/.test(expr)) break;
      out += "x";
      i = j;
      continue;
    }
    if (raw[i] === "?") break;
    out += raw[i];
    i += 1;
  }
  return out.replace(/\/+$/, "");
}

let harness: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await createTestApp();
  app = harness.app;
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

describe("app ↔ API contract", () => {
  const paths = extractClientPaths(readFileSync(ADAPTER, "utf8"));

  it("finds the adapter's routes at all (guards against this test silently matching nothing)", () => {
    // If a refactor moves the URLs somewhere this regex cannot see, the loop below would pass
    // vacuously. 25 is comfortably under the count today and far above zero.
    expect(paths.length).toBeGreaterThan(25);
    // Three landmarks, one per shape the scanner has to handle: a plain literal, an interpolated
    // path segment, and a POST whose method comes from the `send("POST", ...)` call rather than
    // from the literal itself.
    expect(paths).toContainEqual({ method: "GET", path: "/api/locations" });
    expect(paths).toContainEqual({ method: "GET", path: "/api/assets/x/history" });
    expect(paths).toContainEqual({ method: "POST", path: "/api/commands/Checkout" });
  });

  it.each(paths)("server answers $method $path", async ({ method, path: p }) => {
    const res = await app.inject({
      method: method as "GET" | "POST" | "PUT",
      url: p,
      headers: { "x-ams-dev-user": "owner" },
      ...(method === "GET" ? {} : { payload: {} }),
    });

    // 404 is ambiguous: read.ts returns it for "no asset with that id", which is a *matched*
    // route answering honestly. Fastify's unmatched-route 404 is the one that matters, and it
    // carries `Route ... not found` in the body.
    const unmatched = res.statusCode === 404 && /not found/i.test(res.body) && /Route/i.test(res.body);
    expect(unmatched, `${method} ${p} → ${res.statusCode} ${res.body.slice(0, 160)}`).toBe(false);

    // A 500 means the route matched but the handler broke on an empty body, which is a real
    // defect: routes/commands.ts's contract is that a bad shape is a 400 with the offending
    // paths, never a fault.
    //
    // 501 is the one exception and it is not a fault. `GET /api/auth/sign-in` answers 501 under
    // the dev identity provider, which implements no sign-in flow — the route exists and is
    // saying so, which is precisely what this test set out to establish. Treating it as a defect
    // would mean the honest answer scores worse than a silent redirect to nowhere.
    const notImplemented = res.statusCode === 501;
    expect(notImplemented || res.statusCode < 500, `${method} ${p} returned a server error (${res.statusCode})`).toBe(true);
  });
});
