/**
 * WS-W3's definition of done, asserted directly against the API.
 *
 * "Authorized test users receive only permitted API data/actions; unauthorized direct requests are
 * refused." The word that does the work is *directly*. A UI that hides a button is not evidence of
 * anything — the attacker does not use the UI. Every assertion below is a request made straight at
 * the route with `app.inject()`, exactly as `curl` would, with a role, an office, a cookie or a
 * header chosen to be the wrong one.
 *
 * Two apps are built over one seeded database, because there are two things to prove and they need
 * different identity providers:
 *
 *   `devApp`   the development identity header. This is the cross-role/cross-office matrix: four
 *              roles across every protected read and write, cross-office administration, insecure
 *              direct object access, restricted SIM/network fields, and escalation attempts.
 *   `entraApp` a **fabricated Entra tenant**. A-R6 says no real tenant exists, so this file builds
 *              one: a locally generated RSA key pair published as a JWKS, a discovery document, and
 *              a token endpoint that mints correctly signed id_tokens — and verifies the PKCE
 *              `code_verifier` before it does. The provider under test is the production one,
 *              unmodified, with only `fetch` injected. The session, cookie, CSRF, open-redirect,
 *              disabled-user and same-device-user-change behaviour is proved there because that is
 *              where it will run.
 *
 * The negative OIDC cases matter as much as the positive one, and each maps to a real attack: a
 * token from another tenant (a valid token, from the wrong directory), a token with a forged
 * signature, a replayed `state` (a stolen authorization code), and a `x-ams-dev-user` header sent
 * at a deployment that uses Entra (the escalation this lane's whole provider split exists to make
 * impossible).
 */
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, createContext, type AppContext } from "../src/app";
import { configureDirectory, invalidateDirectory } from "../src/auth/directory";
import { installIdentityProvider, resetIdentityProvider } from "../src/auth/identity";
import { createOidcProvider } from "../src/auth/providers/oidcProvider";
import type { Fetcher } from "../src/auth/providers/jwt";
import { safeReturnTo } from "../src/auth/redirect";
import { AuthConfigurationError, readOidcSettings, type OidcSettings } from "../src/auth/settings";
import { DATASET_DIR } from "../src/config";
import type { Database } from "../src/db/database";
import { openTestDatabase } from "../src/db/open";
import { seedIfNeeded } from "../src/db/seed";
import type { Asset, CurrentUser } from "../../app/src/api/types";

// ---------------------------------------------------------------- fabricated Entra tenant

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const CLOUD = "https://login.microsoftonline.test";
const AUTHORITY = `${CLOUD}/${TENANT_ID}/v2.0`;
const REDIRECT_URI = "https://ams.englobecorp.test/api/auth/callback";
const JWKS_URI = `${CLOUD}/${TENANT_ID}/discovery/v2.0/keys`;
const TOKEN_URI = `${CLOUD}/${TENANT_ID}/oauth2/v2.0/token`;
const AUTHORIZE_URI = `${CLOUD}/${TENANT_ID}/oauth2/v2.0/authorize`;
const SIGNING_KID = "fabricated-key-1";

const realKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
/** A second key with the *same* kid: the JWKS will not have it, so anything it signs is a forgery. */
const forgedKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

const OIDC_SETTINGS: OidcSettings = {
  tenantId: TENANT_ID,
  clientId: CLIENT_ID,
  clientSecret: null, // public client + PKCE — no secret anywhere, per rule 10
  redirectUri: REDIRECT_URI,
  authority: AUTHORITY,
  issuer: AUTHORITY,
  scopes: "openid profile email offline_access",
  postLogoutRedirectUri: null,
};

interface EntraUser {
  objectId: string;
  upn: string;
  name: string;
}

const ENTRA_ADMIN: EntraUser = { objectId: "oid-ottawa-admin", upn: "entra-ottawa-admin@englobecorp.com", name: "Entra Ottawa Admin" };
const ENTRA_DISABLED: EntraUser = { objectId: "oid-disabled", upn: "entra-disabled@englobecorp.com", name: "Entra Disabled" };
const ENTRA_STRANGER: EntraUser = { objectId: "oid-stranger", upn: "entra-stranger@englobecorp.com", name: "Entra Stranger" };

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** A real RS256 JWS. The verifier under test is `auth/providers/jwt.ts`, so the token has to be
 * genuinely signed — a hand-written string would prove nothing. */
function signJwt(claims: Record<string, unknown>, options: { key?: ReturnType<typeof generateKeyPairSync>["privateKey"]; kid?: string; alg?: string } = {}): string {
  const alg = options.alg ?? "RS256";
  const input = `${b64url({ alg, kid: options.kid ?? SIGNING_KID, typ: "JWT" })}.${b64url(claims)}`;
  const signature = cryptoSign("sha256", Buffer.from(input, "utf8"), options.key ?? realKeys.privateKey).toString("base64url");
  return `${input}.${signature}`;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

/**
 * The identity provider on the other end of the wire. It implements just enough of Entra to be
 * indistinguishable from it for this flow — and it *checks* the parts a real IdP checks, so a
 * regression in PKCE or nonce handling fails here rather than in Azure.
 */
class FakeEntra {
  /** Codes minted, keyed by the authorization code, so PKCE can be verified at the token endpoint. */
  private readonly issued = new Map<string, { nonce: string; challenge: string; user: EntraUser }>();
  /** Who the next sign-in is for. */
  nextUser: EntraUser = ENTRA_ADMIN;
  /** Claims to override on the next id_token — how a wrong-tenant or wrong-issuer token is made. */
  claimOverrides: Record<string, unknown> = {};
  /** Sign with the key that is not in the JWKS. */
  forgeSignature = false;
  /** Every authorization request this saw, for asserting on PKCE and scope. */
  readonly authorizeRequests: URL[] = [];
  jwksRequests = 0;

  /** What the browser does at the IdP: consents, and comes back with a code. */
  authorize(authorizationUrl: string): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    this.authorizeRequests.push(url);
    const state = url.searchParams.get("state") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const code = `code-${state}`;
    this.issued.set(code, { nonce, challenge, user: this.nextUser });
    return { code, state };
  }

  readonly fetch: Fetcher = async (url, init) => {
    if (url === `${AUTHORITY}/.well-known/openid-configuration`) {
      return jsonResponse(200, {
        issuer: AUTHORITY,
        authorization_endpoint: AUTHORIZE_URI,
        token_endpoint: TOKEN_URI,
        jwks_uri: JWKS_URI,
        end_session_endpoint: `${CLOUD}/${TENANT_ID}/oauth2/v2.0/logout`,
      });
    }

    if (url === JWKS_URI) {
      this.jwksRequests += 1;
      const jwk = realKeys.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
      return jsonResponse(200, { keys: [{ ...jwk, kid: SIGNING_KID, use: "sig", alg: "RS256" }] });
    }

    if (url === TOKEN_URI && init?.method === "POST") {
      const params = new URLSearchParams(init.body ?? "");
      const code = params.get("code") ?? "";
      const record = this.issued.get(code);
      if (!record) return jsonResponse(400, { error: "invalid_grant", error_description: "unknown or already-redeemed code" });
      // Single use, like the real thing.
      this.issued.delete(code);

      // PKCE, verified rather than assumed: this is the check that makes a stolen code useless.
      const verifier = params.get("code_verifier") ?? "";
      const computed = createHash("sha256").update(verifier).digest("base64url");
      if (!verifier || computed !== record.challenge) {
        return jsonResponse(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
      }
      if (params.get("client_id") !== CLIENT_ID) return jsonResponse(400, { error: "invalid_client" });
      if (params.get("redirect_uri") !== REDIRECT_URI) return jsonResponse(400, { error: "invalid_grant" });

      const nowSec = Math.floor(Date.now() / 1000);
      const claims = {
        iss: AUTHORITY,
        aud: CLIENT_ID,
        sub: `sub-${record.user.objectId}`,
        tid: TENANT_ID,
        oid: record.user.objectId,
        preferred_username: record.user.upn,
        name: record.user.name,
        nonce: record.nonce,
        iat: nowSec,
        nbf: nowSec,
        exp: nowSec + 3600,
        ...this.claimOverrides,
      };
      return jsonResponse(200, {
        token_type: "Bearer",
        // Both are minted and both are discarded by the provider — see the `no token reaches the
        // browser` assertion below.
        access_token: "an-access-token-that-must-never-leave-the-server",
        refresh_token: "a-refresh-token-that-must-never-leave-the-server",
        id_token: signJwt(claims, this.forgeSignature ? { key: forgedKeys.privateKey } : {}),
      });
    }

    return jsonResponse(404, { error: "not_found", url });
  };
}

// ---------------------------------------------------------------- request helpers

type DevUser = "field" | "admin" | "owner" | "reader" | "toronto" | "anonymous";

function asDev(app: FastifyInstance, options: InjectOptions, who: DevUser) {
  return app.inject({ ...options, headers: { ...(options.headers ?? {}), "x-ams-dev-user": who } });
}

const get = (app: FastifyInstance, url: string, who: DevUser) => asDev(app, { method: "GET", url }, who);
const post = (app: FastifyInstance, url: string, body: unknown, who: DevUser) =>
  asDev(app, { method: "POST", url, payload: body as object }, who);
const put = (app: FastifyInstance, url: string, body: unknown, who: DevUser) =>
  asDev(app, { method: "PUT", url, payload: body as object }, who);

let n = 0;
const sid = (label: string) => `authz-${label}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

/** Collects `Set-Cookie` into a jar the way a browser would, honouring Max-Age=0 as a delete. */
type CookieJar = Map<string, string>;
function absorb(jar: CookieJar, res: { headers: Record<string, unknown> }): CookieJar {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const line of all) {
    const [pair, ...attrs] = String(line).split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1).trim());
    if (attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a))) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}
const cookieHeader = (jar: CookieJar) => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");

/** Attributes of one Set-Cookie line, for asserting HttpOnly / SameSite / Secure. */
function cookieAttributes(res: { headers: Record<string, unknown> }, name: string): string {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return all.find((line) => String(line).startsWith(`${name}=`)) ?? "";
}

// ---------------------------------------------------------------- fixtures

let db: Database;
let ctx: AppContext;
let devApp: FastifyInstance;
let entraApp: FastifyInstance;
let entra: FakeEntra;

/** Real assets chosen from the seeded fleet, so the office-scope assertions are about the data
 * Englobe actually has rather than about a fixture built to agree with the test. */
let ottawaSim: string;
let torontoSim: string;
let torontoAsset: string;
let ottawaAsset: string;

async function pick(sql: string): Promise<string> {
  const res = await db.query<{ assetid: string }>(sql);
  const id = res.rows[0]?.assetid;
  if (!id) throw new Error(`No asset matched: ${sql}`);
  return id;
}

beforeAll(async () => {
  db = await openTestDatabase();
  const seed = await seedIfNeeded(db, DATASET_DIR);
  ctx = createContext(db, seed.dataset);

  // Directory answers must be read fresh, so that deactivating a user takes effect on the next
  // request rather than after the cache window. Production keeps the cache; a test that asserts on
  // revocation must not.
  configureDirectory({ ttlMs: 0 });

  resetIdentityProvider();
  devApp = await buildApp(ctx, { logger: false });
  await devApp.ready();

  entra = new FakeEntra();
  installIdentityProvider(createOidcProvider(OIDC_SETTINGS, { fetch: entra.fetch }));
  entraApp = await buildApp(ctx, { logger: false });
  await entraApp.ready();
  resetIdentityProvider();

  // Entra principals for the session tests. `ENTRA_STRANGER` is deliberately absent: a person the
  // tenant vouches for who has no row here must get no roles.
  for (const [user, office, active] of [
    [ENTRA_ADMIN, "Ottawa", true],
    [ENTRA_DISABLED, "Ottawa", false],
  ] as Array<[EntraUser, string, boolean]>) {
    await db.query(
      `INSERT INTO app_user (upn, object_id, tenant_id, display_name, homeoffice, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (upn) DO UPDATE SET object_id = EXCLUDED.object_id, is_active = EXCLUDED.is_active`,
      [user.upn, user.objectId, TENANT_ID, user.name, office, active]
    );
    await db.query("DELETE FROM app_user_role WHERE upn = $1", [user.upn]);
    for (const role of ["FieldUser", "OfficeAdmin"]) {
      await db.query("INSERT INTO app_user_role (upn, role, office) VALUES ($1, $2, $3)", [user.upn, role, office]);
    }
  }
  invalidateDirectory();

  ottawaSim = await pick("SELECT assetid FROM asset WHERE homeoffice = 'Ottawa' AND identifiervalue IS NOT NULL ORDER BY assetid LIMIT 1");
  torontoSim = await pick("SELECT assetid FROM asset WHERE homeoffice = 'Toronto' AND identifiervalue IS NOT NULL ORDER BY assetid LIMIT 1");
  torontoAsset = await pick("SELECT assetid FROM asset WHERE homeoffice = 'Toronto' ORDER BY assetid LIMIT 1");
  ottawaAsset = await pick("SELECT assetid FROM asset WHERE homeoffice = 'Ottawa' ORDER BY assetid LIMIT 1");
}, 60_000);

afterAll(async () => {
  configureDirectory({ ttlMs: 10_000 });
  resetIdentityProvider();
  await devApp?.close();
  await entraApp?.close();
  await db?.close();
});

// ================================================================ the matrix

/** Every protected read, as (path, the roles that may call it). */
const READ_ENDPOINTS: Array<{ url: string; allowed: DevUser[] }> = [
  { url: "/api/me", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/dataset", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/assets", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/locations", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/equipment-models", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/projects", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/calibration/due", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/sites", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  { url: "/api/reports/calibration-counts", allowed: ["field", "admin", "owner", "reader", "toronto"] },
  // Administrative surface: who administers which office.
  { url: "/api/office-admins", allowed: ["admin", "owner", "toronto"] },
  // Reference stewardship — admin console, not a field read.
  { url: "/api/data-management/reference/Manufacturer", allowed: ["admin", "owner", "toronto"] },
  { url: "/api/data-management/reference/Location", allowed: ["admin", "owner", "toronto"] },
];

/** Every write, as (path, body, the roles that may call it). A refusal here is 401/403 — never a
 * business `{ ok: false }`, which is a different thing entirely. */
const WRITE_ENDPOINTS: Array<{ url: string; body: () => unknown; allowed: DevUser[]; method?: "POST" | "PUT" }> = [
  { url: "/api/commands/ReportFault", body: () => ({ assetId: "X", notes: "n", clientSubmissionId: sid("m") }), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/commands/Checkout", body: () => ({ lines: [], project: "P", clientSubmissionId: sid("m") }), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/calibrations", body: () => ({ assetId: "X", calibrationdate: "2026-01-01", clientSubmissionId: sid("m") }), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/assets", body: () => ({ manufacturer: "M", model: "M", equipmenttype: "E", homeoffice: "Ottawa", clientSubmissionId: sid("m") }), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/deployments", body: () => ({}), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/recoveries", body: () => ({}), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/component-swaps", body: () => ({}), allowed: ["field", "admin", "owner", "toronto"] },
  { url: "/api/configuration-changes", body: () => ({}), allowed: ["field", "admin", "owner", "toronto"] },
];

const EVERY_ROLE: DevUser[] = ["field", "admin", "owner", "reader", "toronto"];

describe("WS-W3 — role × endpoint matrix, called directly", () => {
  it("admits every role the endpoint permits, on every protected read", async () => {
    for (const endpoint of READ_ENDPOINTS) {
      for (const who of endpoint.allowed) {
        const res = await get(devApp, endpoint.url, who);
        expect(`${endpoint.url} as ${who} → ${res.statusCode}`).toBe(`${endpoint.url} as ${who} → 200`);
      }
    }
  });

  it("refuses every role the endpoint does not permit, with 403 forbidden_role", async () => {
    for (const endpoint of READ_ENDPOINTS) {
      for (const who of EVERY_ROLE.filter((r) => !endpoint.allowed.includes(r))) {
        const res = await get(devApp, endpoint.url, who);
        expect(`${endpoint.url} as ${who} → ${res.statusCode}`).toBe(`${endpoint.url} as ${who} → 403`);
        expect(res.json().error).toBe("forbidden_role");
      }
    }
  });

  it("lets FieldUser, OfficeAdmin and SystemOwner reach every command endpoint", async () => {
    for (const endpoint of WRITE_ENDPOINTS) {
      for (const who of endpoint.allowed) {
        const res = await post(devApp, endpoint.url, endpoint.body(), who);
        // Past the guard is the assertion. What the command then answers — 200 accepted, 200
        // refused, 400 malformed — is feature behaviour proved in the other suites.
        expect(`${endpoint.url} as ${who} → ${res.statusCode}`).not.toBe(`${endpoint.url} as ${who} → 403`);
        expect(`${endpoint.url} as ${who} → ${res.statusCode}`).not.toBe(`${endpoint.url} as ${who} → 401`);
      }
    }
  });

  it("refuses ReportReader on every command endpoint — read-only is enforced, not documented", async () => {
    for (const endpoint of WRITE_ENDPOINTS) {
      const res = await post(devApp, endpoint.url, endpoint.body(), "reader");
      expect(`${endpoint.url} as reader → ${res.statusCode}`).toBe(`${endpoint.url} as reader → 403`);
      expect(res.json().error).toBe("forbidden_role");
      expect(res.json().requiredRoles).toEqual(["FieldUser", "OfficeAdmin", "SystemOwner"]);
    }
  });

  it("refuses a FieldUser the administrative write, and admits an administrator", async () => {
    const asField = await put(devApp, "/api/office-admins/Ottawa", { adminUpns: [], clientSubmissionId: sid("oa") }, "field");
    expect(asField.statusCode).toBe(403);
    expect(asField.json().error).toBe("forbidden_role");

    const asAdmin = await put(devApp, "/api/office-admins/Ottawa", { adminUpns: [], clientSubmissionId: sid("oa") }, "admin");
    expect(asAdmin.statusCode).toBe(200);

    const refField = await post(
      devApp,
      "/api/data-management/reference/commands/create",
      { domain: "Manufacturer", clientSubmissionId: sid("rf"), reason: "no", attributes: { name: "Nope" } },
      "field"
    );
    expect(refField.statusCode).toBe(403);
    expect(refField.json().error).toBe("forbidden_role");

    const refAdmin = await post(
      devApp,
      "/api/data-management/reference/commands/create",
      { domain: "Manufacturer", clientSubmissionId: sid("ra"), reason: "yes", attributes: { name: `AuthMfr-${sid("am")}` } },
      "admin"
    );
    expect(refAdmin.statusCode).toBe(200);
  });
});

// ================================================================ office scope

describe("WS-W3 — office scope (A-R5)", () => {
  it("refuses an Ottawa administrator administering Toronto", async () => {
    const res = await put(devApp, "/api/office-admins/Toronto", { adminUpns: ["x@englobecorp.com"], clientSubmissionId: sid("oa") }, "admin");
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden_office");
  });

  it("refuses a Toronto administrator administering Ottawa — it is symmetric, not a special case", async () => {
    const res = await put(devApp, "/api/office-admins/Ottawa", { adminUpns: ["x@englobecorp.com"], clientSubmissionId: sid("oa") }, "toronto");
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden_office");
  });

  it("lets each administrator administer their own office", async () => {
    expect((await put(devApp, "/api/office-admins/Toronto", { adminUpns: [], clientSubmissionId: sid("oa") }, "toronto")).statusCode).toBe(200);
    expect((await put(devApp, "/api/office-admins/Ottawa", { adminUpns: [], clientSubmissionId: sid("oa") }, "admin")).statusCode).toBe(200);
  });

  it("lets the SystemOwner administer any office — global scope means global", async () => {
    for (const office of ["Ottawa", "Toronto", "Sudbury"]) {
      const res = await put(devApp, `/api/office-admins/${office}`, { adminUpns: [], clientSubmissionId: sid("oa") }, "owner");
      expect(`${office} → ${res.statusCode}`).toBe(`${office} → 200`);
    }
  });

  it("keeps 'not a known office' a validation answer rather than a permissions one", async () => {
    // The pre-existing contract in fieldSecurity.test.ts: HTTP 200 with `{ ok: false }`. A 403 here
    // would hide a typo behind an authorization error — see auth/authorize.ts § requireOfficeScope.
    const res = await put(devApp, "/api/office-admins/Vancouver", { adminUpns: ["x@englobecorp.com"], clientSubmissionId: sid("oa") }, "admin");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().reason).toContain("not a known office");
  });

  it("scopes the read-only role to its own office's rows, and reports the scope on /api/me", async () => {
    const me = (await get(devApp, "/api/me", "reader")).json() as CurrentUser;
    expect(me.roles).toEqual(["ReportReader"]);
    expect(me.scopedOffices).toEqual(["Ottawa"]);

    const listed = (await get(devApp, "/api/assets", "reader")).json() as Asset[];
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((a) => a.homeoffice === "Ottawa")).toBe(true);

    // The same request as an operational role is not scoped: an Ottawa technician must still be
    // able to see the logger that arrived from Toronto (auth/roles.ts § "Fleet visibility").
    const asField = (await get(devApp, "/api/assets", "field")).json() as Asset[];
    expect(asField.some((a) => a.homeoffice === "Toronto")).toBe(true);
  });

  it("refuses an office-scoped reader an aggregate it cannot be given honestly", async () => {
    const unscoped = await get(devApp, "/api/reports/fleet-counts", "reader");
    expect(unscoped.statusCode).toBe(403);
    expect(unscoped.json().error).toBe("office_scope_required");

    const otherOffice = await get(devApp, "/api/reports/fleet-counts?office=Toronto", "reader");
    expect(otherOffice.statusCode).toBe(403);

    const ownOffice = await get(devApp, "/api/reports/fleet-counts?office=Ottawa", "reader");
    expect(ownOffice.statusCode).toBe(200);
  });

  it("narrows per-office calibration counts to the reader's scope, exactly rather than approximately", async () => {
    const counts = (await get(devApp, "/api/reports/calibration-counts", "reader")).json() as { byOffice: Record<string, unknown> };
    expect(Object.keys(counts.byOffice)).toEqual(["Ottawa"]);

    const all = (await get(devApp, "/api/reports/calibration-counts", "owner")).json() as { byOffice: Record<string, unknown> };
    expect(Object.keys(all.byOffice).length).toBeGreaterThan(1);
  });
});

// ================================================================ insecure direct object access

describe("WS-W3 — insecure direct object access", () => {
  it("gives an office-scoped reader 404, not 403, for another office's asset id", async () => {
    const own = await get(devApp, `/api/assets/${ottawaAsset}`, "reader");
    expect(own.statusCode).toBe(200);

    const guessed = await get(devApp, `/api/assets/${torontoAsset}`, "reader");
    // 404 on purpose: a 403 would confirm the asset exists, which is the one fact the guess was
    // fishing for. It is indistinguishable from an id that does not exist at all.
    expect(guessed.statusCode).toBe(404);
    const nonsense = await get(devApp, "/api/assets/NOT-AN-ASSET-9999", "reader");
    expect(nonsense.statusCode).toBe(404);
    expect(guessed.json()).toMatchObject({ error: "not_found", assetId: torontoAsset });
    expect(typeof (guessed.json() as { correlationId?: string }).correlationId).toBe("string");
  });

  it("gives the same 404, not history, for another office's asset-keyed sub-resources", async () => {
    for (const suffix of ["history", "relationships", "calibrations", "installations"]) {
      const guessed = await get(devApp, `/api/assets/${torontoAsset}/${suffix}`, "reader");
      expect(guessed.statusCode, suffix).toBe(404);
      expect(guessed.json()).toMatchObject({ error: "not_found", assetId: torontoAsset });
      const own = await get(devApp, `/api/assets/${ottawaAsset}/${suffix}`, "reader");
      expect(own.statusCode, `${suffix} own office`).toBe(200);
    }
  });

  it("returns another office's asset to an administrator but strips its credentials", async () => {
    const own = (await get(devApp, `/api/assets/${ottawaSim}`, "admin")).json() as Asset;
    expect(own.identifiervalue).not.toBeNull();

    const guessed = (await get(devApp, `/api/assets/${torontoSim}`, "admin")).json() as Asset;
    expect(guessed.assetid).toBe(torontoSim);
    expect(guessed.identifiervalue).toBeNull();
    expect(guessed.phonenumber).toBeNull();
    expect(guessed.staticip).toBeNull();
  });
});

// ================================================================ restricted fields

describe("WS-W3 — restricted SIM/network fields (FR-030, rule 10)", () => {
  const restricted = (a: Asset) => [a.identifiervalue, a.phonenumber, a.staticip];

  it("withholds them from a Field User on every asset-bearing endpoint", async () => {
    const endpoints = [
      `/api/assets/${ottawaSim}`,
      "/api/assets?equipmenttype=CellularService",
      `/api/assets?query=${ottawaSim}`,
      "/api/calibration/due?horizonDays=3650",
    ];
    for (const url of endpoints) {
      const body = (await get(devApp, url, "field")).json();
      const assets: Asset[] = Array.isArray(body) ? body : [body as Asset];
      for (const asset of assets) {
        expect(`${url} ${asset.assetid} → ${restricted(asset).filter((v) => v !== null).length} restricted values`).toBe(
          `${url} ${asset.assetid} → 0 restricted values`
        );
      }
    }
  });

  it("withholds them from the read-only role, which is not an administrator", async () => {
    const listed = (await get(devApp, "/api/assets?equipmenttype=CellularService", "reader")).json() as Asset[];
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((a) => restricted(a).every((v) => v === null))).toBe(true);
  });

  it("gives them to an administrator for their own office only", async () => {
    const listed = (await get(devApp, "/api/assets?equipmenttype=CellularService", "admin")).json() as Asset[];
    const ottawa = listed.filter((a) => a.homeoffice === "Ottawa");
    const elsewhere = listed.filter((a) => a.homeoffice !== "Ottawa");
    expect(ottawa.some((a) => a.identifiervalue !== null)).toBe(true);
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(elsewhere.every((a) => restricted(a).every((v) => v === null))).toBe(true);
  });

  it("gives them to the SystemOwner everywhere, because global scope is what global means", async () => {
    const listed = (await get(devApp, "/api/assets?equipmenttype=CellularService", "owner")).json() as Asset[];
    expect(listed.filter((a) => a.homeoffice === "Toronto").some((a) => a.identifiervalue !== null)).toBe(true);
  });

  it("keeps a SIM findable by a number the caller may not read — findability and disclosure differ", async () => {
    const iccid = (await db.query<{ identifiervalue: string }>("SELECT identifiervalue FROM asset WHERE assetid = $1", [ottawaSim])).rows[0]
      .identifiervalue;
    const found = (await get(devApp, `/api/assets?query=${iccid}`, "field")).json() as Asset[];
    expect(found.map((a) => a.assetid)).toContain(ottawaSim);
    expect(found[0].identifiervalue).toBeNull();
  });
});

// ================================================================ escalation attempts

describe("WS-W3 — the browser owns no authority (rule 1)", () => {
  it("ignores a role, upn, office and scope asserted in the request body", async () => {
    const escalated = await post(
      devApp,
      "/api/commands/ReportFault",
      {
        assetId: ottawaAsset,
        notes: "n",
        clientSubmissionId: sid("esc"),
        // Everything a client might hope the server reads back off the wire.
        roles: ["SystemOwner"],
        role: "SystemOwner",
        upn: "svc-ams@englobecorp.com",
        user: { upn: "svc-ams@englobecorp.com", roles: ["SystemOwner"] },
        office: "Toronto",
        scopedOffices: null,
        homeoffice: "Toronto",
      },
      "reader"
    );
    expect(escalated.statusCode).toBe(403);
    expect(escalated.json().error).toBe("forbidden_role");
  });

  it("ignores an office asserted in the body of an office-scoped write", async () => {
    const res = await put(
      devApp,
      "/api/office-admins/Ottawa",
      { adminUpns: [], clientSubmissionId: sid("esc"), office: "Toronto", scopedOffices: ["Ottawa", "Toronto"] },
      "toronto"
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden_office");
  });

  it("records the authenticated caller as performer, not a `performedby` the client supplied", async () => {
    const res = await post(
      devApp,
      "/api/commands/ReportFault",
      { assetId: ottawaAsset, notes: "escalation probe", clientSubmissionId: sid("perf"), performedby: "svc-ams@englobecorp.com" },
      "field"
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const history = (await get(devApp, `/api/assets/${ottawaAsset}/history`, "field")).json() as Array<{ performedby: string; transactiontype: string }>;
    const fault = history.find((h) => h.transactiontype === "ReportFault");
    expect(fault?.performedby).toBe("tech@englobecorp.com");
  });

  it("never echoes a server-side fact the contract does not carry", async () => {
    const me = (await get(devApp, "/api/me", "owner")).json() as Record<string, unknown>;
    expect(Object.keys(me).sort()).toEqual(["displayName", "homeoffice", "objectId", "roles", "scopedOffices", "upn"]);
    // tenantId, sessionId, `via` and `disabled` are how the server decides; none is the browser's
    // business, and none of them is here.
    for (const leaked of ["tenantId", "sessionId", "via", "disabled", "authenticated", "identityKey"]) {
      expect(`${leaked} present: ${leaked in me}`).toBe(`${leaked} present: false`);
    }
  });
});

// ================================================================ unauthenticated

describe("WS-W3 — unauthenticated", () => {
  it("refuses every protected read and write with 401", async () => {
    for (const endpoint of READ_ENDPOINTS) {
      const res = await get(devApp, endpoint.url, "anonymous");
      expect(`${endpoint.url} → ${res.statusCode}`).toBe(`${endpoint.url} → 401`);
      expect(res.json().error).toBe("unauthenticated");
    }
    for (const endpoint of WRITE_ENDPOINTS) {
      const res = await post(devApp, endpoint.url, endpoint.body(), "anonymous");
      expect(`${endpoint.url} → ${res.statusCode}`).toBe(`${endpoint.url} → 401`);
    }
  });

  it("still answers health and the session endpoint, or sign-in would be a locked door", async () => {
    expect((await get(devApp, "/api/health", "anonymous")).statusCode).toBe(200);
    const session = await get(devApp, "/api/auth/session", "anonymous");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: false, user: null, csrfToken: null });
  });

  it("says out loud that the development header is not authentication", async () => {
    const session = (await get(devApp, "/api/auth/session", "field")).json();
    expect(session.provider).toBe("dev");
    expect(session.authenticationIsReal).toBe(false);
  });
});

// ================================================================ Entra, against a fabricated tenant

/** Drives sign-in end to end and returns the cookie jar plus the callback response. */
async function signIn(user: EntraUser, options: { returnTo?: string; jar?: CookieJar } = {}) {
  entra.nextUser = user;
  const jar = options.jar ?? new Map<string, string>();
  const start = await entraApp.inject({
    method: "GET",
    url: `/api/auth/sign-in${options.returnTo ? `?returnTo=${encodeURIComponent(options.returnTo)}` : ""}`,
    headers: jar.size ? { cookie: cookieHeader(jar) } : {},
  });
  expect(start.statusCode).toBe(302);
  const { code, state } = entra.authorize(String(start.headers.location));
  const callback = await entraApp.inject({
    method: "GET",
    url: `/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: jar.size ? { cookie: cookieHeader(jar) } : {},
  });
  absorb(jar, callback);
  return { jar, callback, code, state, authorizeUrl: String(start.headers.location) };
}

describe("WS-W3 — Entra sign-in, against a fabricated tenant (A-R6)", () => {
  it("redirects to the tenant's authorize endpoint with PKCE and a nonce, and no secret", async () => {
    const start = await entraApp.inject({ method: "GET", url: "/api/auth/sign-in?returnTo=/assets" });
    expect(start.statusCode).toBe(302);
    const url = new URL(String(start.headers.location));
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URI);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    // No Graph scope was asked for — WS-W3 § "Must not own".
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(String(start.headers.location)).not.toContain("client_secret");
  });

  it("completes the flow, sets a hardened cookie, and lands on the deep link", async () => {
    const { callback, jar } = await signIn(ENTRA_ADMIN, { returnTo: `/assets/${ottawaSim}` });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`/assets/${ottawaSim}`);

    const sessionCookie = cookieAttributes(callback, "ams_session");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    // Secure is set from NODE_ENV; a local http:// origin would simply never store it.
    expect(sessionCookie).not.toContain("Secure");

    // The CSRF token and the identity fingerprint are readable on purpose; the credential is not.
    expect(cookieAttributes(callback, "ams_csrf")).not.toContain("HttpOnly");
    expect(cookieAttributes(callback, "ams_identity")).not.toContain("HttpOnly");

    const me = (await entraApp.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(jar) } })).json() as CurrentUser;
    expect(me.upn).toBe(ENTRA_ADMIN.upn);
    expect(me.objectId).toBe(ENTRA_ADMIN.objectId);
    expect(me.roles).toContain("OfficeAdmin");
    expect(me.scopedOffices).toEqual(["Ottawa"]);
  });

  it("lets no token reach the browser — the BFF guarantee, checked rather than asserted", async () => {
    const { callback, jar } = await signIn(ENTRA_ADMIN);
    const everythingTheBrowserSaw = JSON.stringify(callback.headers) + callback.body + cookieHeader(jar);
    expect(everythingTheBrowserSaw).not.toContain("an-access-token-that-must-never-leave-the-server");
    expect(everythingTheBrowserSaw).not.toContain("a-refresh-token-that-must-never-leave-the-server");
    // An id_token is three base64url segments; nothing shaped like one is anywhere in the response.
    expect(everythingTheBrowserSaw).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);

    const session = (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(jar) } })).json();
    expect(session.authenticated).toBe(true);
    expect(session.authenticationIsReal).toBe(true);
    expect(JSON.stringify(session)).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
  });

  it("ignores x-ams-dev-user entirely — the header cannot escalate at an Entra deployment", async () => {
    for (const who of ["owner", "admin", "field"]) {
      const res = await entraApp.inject({ method: "GET", url: "/api/me", headers: { "x-ams-dev-user": who } });
      expect(`${who} → ${res.statusCode}`).toBe(`${who} → 401`);
    }
    // Nor alongside a valid session: the session decides, and the header is not consulted at all.
    const { jar } = await signIn(ENTRA_ADMIN);
    const withBoth = (await entraApp.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieHeader(jar), "x-ams-dev-user": "owner" },
    })).json() as CurrentUser;
    expect(withBoth.upn).toBe(ENTRA_ADMIN.upn);
    expect(withBoth.roles).not.toContain("SystemOwner");
  });

  it("gives an authenticated stranger no roles — a tenant is not an allow-list", async () => {
    const { jar } = await signIn(ENTRA_STRANGER);
    const session = (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(jar) } })).json();
    expect(session.authenticated).toBe(true);
    expect(session.provisioned).toBe(false);

    const assets = await entraApp.inject({ method: "GET", url: "/api/assets", headers: { cookie: cookieHeader(jar) } });
    expect(assets.statusCode).toBe(403);
    expect(assets.json().error).toBe("forbidden_role");
  });

  it("refuses a disabled account even with a valid, freshly minted session", async () => {
    const { jar, callback } = await signIn(ENTRA_DISABLED);
    // Sign-in itself succeeds — Entra vouched for them; it is this system that says no.
    expect(callback.statusCode).toBe(302);

    const assets = await entraApp.inject({ method: "GET", url: "/api/assets", headers: { cookie: cookieHeader(jar) } });
    expect(assets.statusCode).toBe(403);
    expect(assets.json().error).toBe("account_disabled");

    const session = (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(jar) } })).json();
    expect(session).toMatchObject({ authenticated: true, disabled: true, provisioned: false });
  });

  it("revokes an account mid-session, without waiting for the session to expire", async () => {
    const { jar } = await signIn(ENTRA_ADMIN);
    expect((await entraApp.inject({ method: "GET", url: "/api/assets", headers: { cookie: cookieHeader(jar) } })).statusCode).toBe(200);

    await db.query("UPDATE app_user SET is_active = false WHERE upn = $1", [ENTRA_ADMIN.upn]);
    invalidateDirectory();
    const after = await entraApp.inject({ method: "GET", url: "/api/assets", headers: { cookie: cookieHeader(jar) } });
    expect(after.statusCode).toBe(403);
    expect(after.json().error).toBe("account_disabled");

    await db.query("UPDATE app_user SET is_active = true WHERE upn = $1", [ENTRA_ADMIN.upn]);
    invalidateDirectory();
    expect((await entraApp.inject({ method: "GET", url: "/api/assets", headers: { cookie: cookieHeader(jar) } })).statusCode).toBe(200);
  });
});

// ================================================================ CSRF

describe("WS-W3 — CSRF on a cookie-authenticated session", () => {
  it("refuses a state-changing request that does not echo the token", async () => {
    const { jar } = await signIn(ENTRA_ADMIN);
    const res = await entraApp.inject({
      method: "POST",
      url: "/api/commands/Checkout",
      headers: { cookie: cookieHeader(jar) },
      payload: { lines: [], project: "P", clientSubmissionId: sid("csrf") },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("csrf_required");
  });

  it("refuses a forged token, and one belonging to a different session", async () => {
    const { jar } = await signIn(ENTRA_ADMIN);
    const other = await signIn(ENTRA_ADMIN);
    const otherToken = (
      (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(other.jar) } })).json() as {
        csrfToken: string;
      }
    ).csrfToken;

    for (const token of ["not-the-token", otherToken]) {
      const res = await entraApp.inject({
        method: "POST",
        url: "/api/commands/Checkout",
        headers: { cookie: cookieHeader(jar), "x-ams-csrf": token },
        payload: { lines: [], project: "P", clientSubmissionId: sid("csrf") },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("csrf_required");
    }
  });

  it("admits the request when the token matches the session it was issued for", async () => {
    const { jar } = await signIn(ENTRA_ADMIN);
    const session = (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(jar) } })).json() as {
      csrfToken: string;
    };
    expect(jar.get("ams_csrf")).toBe(session.csrfToken); // double submit: cookie and payload agree

    const res = await entraApp.inject({
      method: "POST",
      url: "/api/commands/Checkout",
      headers: { cookie: cookieHeader(jar), "x-ams-csrf": session.csrfToken },
      payload: { lines: [], project: "", clientSubmissionId: sid("csrf") },
    });
    // Past the CSRF gate and into the command, which then gives FR-008's own answer.
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it("does not apply to a header-authenticated request, which carries no ambient credential", async () => {
    const res = await post(devApp, "/api/commands/Checkout", { lines: [], project: "", clientSubmissionId: sid("csrf") }, "field");
    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBeUndefined();
  });

  it("protects sign-out too — a forced sign-out is still a state change", async () => {
    const { jar } = await signIn(ENTRA_ADMIN);
    const without = await entraApp.inject({ method: "POST", url: "/api/auth/sign-out", headers: { cookie: cookieHeader(jar) } });
    expect(without.statusCode).toBe(403);

    const token = (
      (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(jar) } })).json() as { csrfToken: string }
    ).csrfToken;
    const withToken = await entraApp.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie: cookieHeader(jar), "x-ams-csrf": token },
    });
    expect(withToken.statusCode).toBe(200);
    absorb(jar, withToken);
    expect(jar.has("ams_session")).toBe(false);
    // The identity fingerprint survives sign-out on purpose — the next sign-in has to be able to
    // tell whether it is the same person on this device.
    expect(jar.has("ams_identity")).toBe(true);

    const after = await entraApp.inject({ method: "GET", url: "/api/me", headers: { cookie: cookieHeader(jar) } });
    expect(after.statusCode).toBe(401);
  });
});

// ================================================================ same-device user change

describe("WS-W3 — same-device user change", () => {
  it("tells the client when a different identity signs in on this device", async () => {
    const first = await signIn(ENTRA_ADMIN);
    const firstKey = first.jar.get("ams_identity");
    expect(firstKey).toMatch(/^[0-9a-f]{32}$/);
    const firstSession = (
      await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(first.jar) } })
    ).json();
    expect(firstSession.identityChanged).toBe(false);

    // Same device — the browser still holds the readable identity cookie — different person.
    const second = await signIn(ENTRA_STRANGER, { jar: first.jar });
    const secondSession = (
      await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(second.jar) } })
    ).json();
    expect(secondSession.identityChanged).toBe(true);
    expect(secondSession.previousIdentityKey).toBe(firstKey);
    expect(secondSession.identityKey).not.toBe(firstKey);

    // The fingerprint is one-way: it identifies "the same person as before" and nothing else.
    expect(secondSession.identityKey).not.toContain(ENTRA_STRANGER.objectId);
    expect(secondSession.identityKey).not.toContain(ENTRA_STRANGER.upn);
  });

  it("signing in again as the same person is not a change", async () => {
    const first = await signIn(ENTRA_ADMIN);
    const again = await signIn(ENTRA_ADMIN, { jar: first.jar });
    const session = (await entraApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: cookieHeader(again.jar) } })).json();
    expect(session.identityChanged).toBe(false);
  });
});

// ================================================================ sign-in attack surface

describe("WS-W3 — sign-in refusals", () => {
  it("refuses an open-redirect return target rather than quietly rewriting it", async () => {
    const attempts = [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "/%2f%2fevil.example",
      "http://ams.englobecorp.test.evil.example/assets",
      "javascript:alert(1)",
      "/assets\r\nLocation: https://evil.example",
    ];
    for (const returnTo of attempts) {
      const res = await entraApp.inject({ method: "GET", url: `/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}` });
      expect(`${returnTo} → ${res.statusCode}`).toBe(`${returnTo} → 400`);
      expect(res.json().error).toBe("invalid_return_to");
    }
  });

  it("accepts a same-origin deep link, including a query string", async () => {
    for (const returnTo of ["/", "/assets", "/assets/DST013?tab=history", "/reports#calibration"]) {
      const res = await entraApp.inject({ method: "GET", url: `/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}` });
      expect(`${returnTo} → ${res.statusCode}`).toBe(`${returnTo} → 302`);
    }
  });

  it("refuses a replayed state — a stolen authorization code buys nothing", async () => {
    const { code, state } = await signIn(ENTRA_ADMIN);
    const replay = await entraApp.inject({ method: "GET", url: `/api/auth/callback?code=${code}&state=${state}` });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().code).toBe("bad_state");
  });

  it("refuses a callback whose state this server never issued", async () => {
    const res = await entraApp.inject({ method: "GET", url: "/api/auth/callback?code=anything&state=fabricated" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("bad_state");
  });

  it("refuses a valid token from a different Entra tenant", async () => {
    entra.claimOverrides = { tid: OTHER_TENANT_ID };
    try {
      const { callback } = await signIn(ENTRA_ADMIN);
      expect(callback.statusCode).toBe(400);
      expect(callback.json().code).toBe("wrong_tenant");
    } finally {
      entra.claimOverrides = {};
    }
  });

  it("refuses a token claiming a different issuer", async () => {
    entra.claimOverrides = { iss: `${CLOUD}/${OTHER_TENANT_ID}/v2.0` };
    try {
      const { callback } = await signIn(ENTRA_ADMIN);
      expect(callback.statusCode).toBe(400);
      expect(callback.json().code).toBe("id_token_bad_issuer");
    } finally {
      entra.claimOverrides = {};
    }
  });

  it("refuses a token signed with a key that is not in the issuer's JWKS", async () => {
    entra.forgeSignature = true;
    try {
      const { callback } = await signIn(ENTRA_ADMIN);
      expect(callback.statusCode).toBe(400);
      expect(callback.json().code).toBe("id_token_bad_signature");
    } finally {
      entra.forgeSignature = false;
    }
  });

  it("refuses a token minted for another application, and an expired one", async () => {
    for (const [override, code] of [
      [{ aud: "some-other-app" }, "id_token_bad_audience"],
      [{ exp: Math.floor(Date.now() / 1000) - 3600 }, "id_token_expired"],
      [{ nonce: "not-the-nonce" }, "id_token_bad_nonce"],
      [{ oid: undefined }, "no_object_id"],
    ] as Array<[Record<string, unknown>, string]>) {
      entra.claimOverrides = override;
      try {
        const { callback } = await signIn(ENTRA_ADMIN);
        expect(`${code} → ${callback.statusCode} ${callback.json().code}`).toBe(`${code} → 400 ${code}`);
      } finally {
        entra.claimOverrides = {};
      }
    }
  });

  it("has no interactive sign-in under the development provider, and says so", async () => {
    const res = await devApp.inject({ method: "GET", url: "/api/auth/sign-in?returnTo=/" });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toBe("no_interactive_sign_in");
  });
});

// ================================================================ units

describe("WS-W3 — return-target validation", () => {
  it("allows only same-origin absolute paths", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo("/assets/DST013")).toBe("/assets/DST013");
    expect(safeReturnTo("/assets?q=1#top")).toBe("/assets?q=1#top");

    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "assets",
      "/%2f%2fevil.example",
      "/a\nLocation: https://evil.example",
      `/${"x".repeat(600)}`,
      42 as unknown as string,
    ]) {
      expect(`${String(bad).slice(0, 40)} → ${safeReturnTo(bad)}`).toBe(`${String(bad).slice(0, 40)} → null`);
    }
  });
});

describe("WS-W3 — configuration refusals (A-R6)", () => {
  it("names every missing variable instead of failing obscurely", () => {
    expect(() => readOidcSettings({})).toThrow(AuthConfigurationError);
    try {
      readOidcSettings({});
      throw new Error("expected a refusal");
    } catch (err) {
      const e = err as AuthConfigurationError;
      expect(e.missing).toEqual(["AMS_OIDC_TENANT_ID", "AMS_OIDC_CLIENT_ID", "AMS_OIDC_REDIRECT_URI"]);
      expect(e.message).toContain("A-R6");
    }
  });

  it("refuses a multi-tenant authority — WS-W3 requires a tenant-scoped issuer", () => {
    for (const tenant of ["common", "organizations", "consumers"]) {
      expect(() =>
        readOidcSettings({ AMS_OIDC_TENANT_ID: tenant, AMS_OIDC_CLIENT_ID: CLIENT_ID, AMS_OIDC_REDIRECT_URI: REDIRECT_URI })
      ).toThrow(/multi-tenant/);
    }
  });

  it("refuses a non-https redirect URI outside loopback", () => {
    const base = { AMS_OIDC_TENANT_ID: TENANT_ID, AMS_OIDC_CLIENT_ID: CLIENT_ID };
    expect(() => readOidcSettings({ ...base, AMS_OIDC_REDIRECT_URI: "http://ams.englobecorp.test/cb" })).toThrow(/https/);
    expect(readOidcSettings({ ...base, AMS_OIDC_REDIRECT_URI: "http://127.0.0.1:3001/cb" }).redirectUri).toBe("http://127.0.0.1:3001/cb");
  });

  it("builds a tenant-scoped issuer from the tenant id, not from anything a caller supplies", () => {
    const settings = readOidcSettings({
      AMS_OIDC_TENANT_ID: TENANT_ID,
      AMS_OIDC_CLIENT_ID: CLIENT_ID,
      AMS_OIDC_REDIRECT_URI: REDIRECT_URI,
    });
    expect(settings.issuer).toBe(`https://login.microsoftonline.com/${TENANT_ID}/v2.0`);
    expect(settings.clientSecret).toBeNull();
  });

  it("refuses the development identity provider in production", async () => {
    const { authMode } = await import("../src/auth/settings");
    expect(() => authMode({ NODE_ENV: "production" })).toThrow(/not authentication/);
    expect(authMode({ NODE_ENV: "production", AMS_AUTH: "oidc" })).toBe("oidc");
    expect(authMode({})).toBe("dev");
  });
});
