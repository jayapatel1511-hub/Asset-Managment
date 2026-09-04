/**
 * The one seam between "a request arrived" and "this is who is calling".
 *
 * app.ts calls `resolveUser` and nothing else; every identity implementation — the dev header
 * shortcut, Entra OIDC over a session cookie — lives behind it. That is what makes WS-W3 a change
 * inside auth/ rather than a change to the composition root.
 *
 * The order of resolution matters and is deliberate:
 *
 *   1. **The session cookie**, if there is one. A browser that has signed in authenticates this
 *      way under every provider, and it is checked first so that no request-borne credential can
 *      override an established session.
 *   2. **The provider's own request credential** — the `x-ams-dev-user` header under `dev`, and
 *      nothing at all under `oidc`. This is why sending `x-ams-dev-user: owner` at an Entra
 *      deployment does nothing: the provider that reads it is not installed.
 *   3. **Nobody.** `ANONYMOUS`, with no roles, which every guard refuses.
 *
 * Then, whatever the answer, the roles and office scope are looked up in `app_user` /
 * `app_user_role`. The provider says *who*; the database says *what they may do*. A principal
 * Entra vouches for who has no row here gets no roles — authentication is not authorization.
 *
 * `resolveUser` returns a `CurrentUser` and never throws. A request whose identity cannot be
 * established is not an error, it is an unauthenticated request, and turning it into a 401 is the
 * guards' job at the route boundary — where the route also knows whether it is one of the few
 * (health, session) that does not need one.
 *
 * Owned by the identity lane (specs/_planning/BUILD-FREEZE.md, Agent 2).
 */
import type { FastifyRequest } from "fastify";
import type { CurrentUser } from "../../../app/src/api/types";
import type { Queryable } from "../db/database";
import { parseCookies, unsign } from "./cookies";
import { lookupDirectoryUser, type DirectoryRecord } from "./directory";
import { createDevProvider } from "./providers/devProvider";
import type { IdentityProvider, Principal } from "./providers/index";
import { createOidcProviderFromEnv } from "./providers/oidcProvider";
import { ANONYMOUS, toCurrentUser, type AuthUser, type AuthVia } from "./roles";
import { identityKeyOf, type SessionRecord, type SessionStore } from "./session";
import { authMode, sessionSettings, type SessionSettings } from "./settings";

/**
 * Everything the identity layer needs that is built once, at boot, and shared by every request.
 * `routes/session.ts` constructs it and decorates the Fastify instance with it, because that is
 * the only file in this lane that app.ts hands the `AppContext` to.
 */
export interface AuthRuntime {
  db: Queryable | null;
  sessions: SessionStore;
  settings: SessionSettings;
  provider: IdentityProvider;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Present once `registerSessionRoutes` has run. Optional so a harness that builds an app
     * without it degrades to header identity rather than crashing. */
    amsAuth?: AuthRuntime;
  }
}

// ---------------------------------------------------------------- provider selection

let installed: IdentityProvider | null = null;

/**
 * The provider for this process, memoised. Selected from `AMS_AUTH`; `dev` unless told otherwise,
 * which is what keeps every existing test and every laptop working unchanged.
 */
export function identityProvider(): IdentityProvider {
  if (installed) return installed;
  installed = authMode() === "oidc" ? createOidcProviderFromEnv() : createDevProvider();
  return installed;
}

/**
 * Installs a provider explicitly.
 *
 * `server/src/app.ts` is the composition root and belongs to the integrator lane, so a test
 * cannot inject a provider by building the app differently. This is the seam that lets
 * `tests/authorization.test.ts` stand up a fabricated Entra tenant — a real OIDC provider with an
 * injected `fetch` — and drive the genuine sign-in flow through the genuine routes.
 */
export function installIdentityProvider(provider: IdentityProvider): void {
  installed = provider;
}

/** Restores selection-from-environment. A test that installs a provider must call this after. */
export function resetIdentityProvider(): void {
  installed = null;
}

// ---------------------------------------------------------------- resolution

function runtimeOf(req: FastifyRequest): AuthRuntime | null {
  return req.server?.amsAuth ?? null;
}

/** The session named by a valid, correctly signed cookie — or null. Never throws. */
export function sessionOf(req: FastifyRequest, runtime: AuthRuntime | null): SessionRecord | null {
  if (!runtime) return null;
  const cookies = parseCookies(req.headers.cookie);
  const signed = cookies[runtime.settings.cookieName];
  const sessionId = unsign(signed, runtime.settings.secret);
  return runtime.sessions.get(sessionId);
}

function principalOfSession(record: SessionRecord): Principal {
  return {
    upn: record.principal.upn,
    objectId: record.principal.objectId,
    tenantId: record.principal.tenantId,
    displayName: record.principal.displayName,
  };
}

/**
 * Builds the principal from an identity plus its directory record. The only constructor of an
 * authenticated `AuthUser` in the system — every role and every office scope in the running
 * server passed through these lines.
 */
export function buildAuthUser(input: {
  principal: Principal;
  record: DirectoryRecord | null;
  via: AuthVia;
  session: SessionRecord | null;
}): AuthUser {
  const { principal, record, via, session } = input;
  const identityKey = session?.identityKey ?? identityKeyOf(principal);

  // No directory row: authenticated, provisioned for nothing. Not an error and not a default
  // role — `/api/auth/session` reports it and an administrator fixes it.
  if (!record) {
    return {
      upn: principal.upn,
      displayName: principal.displayName,
      homeoffice: null,
      roles: [],
      objectId: principal.objectId,
      tenantId: principal.tenantId,
      scopedOffices: [],
      authenticated: true,
      disabled: false,
      via,
      sessionId: session?.id ?? null,
      identityKey,
    };
  }

  // Disabled: authenticated by the IdP, refused by us, and stripped of every role on the way
  // through so that a guard which somehow forgot the `disabled` check still refuses.
  if (!record.isActive) {
    return {
      upn: record.upn,
      displayName: record.displayName,
      homeoffice: record.homeoffice,
      roles: [],
      objectId: principal.objectId,
      tenantId: principal.tenantId,
      scopedOffices: [],
      authenticated: true,
      disabled: true,
      via,
      sessionId: session?.id ?? null,
      identityKey,
    };
  }

  return {
    upn: record.upn,
    displayName: record.displayName || principal.displayName,
    homeoffice: record.homeoffice,
    roles: record.roles,
    objectId: principal.objectId,
    tenantId: principal.tenantId,
    scopedOffices: record.scopedOffices,
    authenticated: true,
    disabled: false,
    via,
    sessionId: session?.id ?? null,
    identityKey,
  };
}

/**
 * Resolves the caller. Called once per request by app.ts's onRequest hook.
 */
export async function resolveUser(req: FastifyRequest): Promise<CurrentUser> {
  const runtime = runtimeOf(req);
  const provider = runtime?.provider ?? identityProvider();

  let principal: Principal | null = null;
  let via: AuthVia = "anonymous";
  let session: SessionRecord | null = null;

  const record = sessionOf(req, runtime);
  if (record) {
    principal = principalOfSession(record);
    via = "cookie";
    session = record;
  } else {
    principal = (await provider.authenticateRequest(req)) ?? null;
    if (principal) via = "header";
  }

  if (!principal) return toCurrentUser(ANONYMOUS);

  const directory = await lookupDirectoryUser(
    runtime?.db ?? null,
    { objectId: principal.objectId, upn: principal.upn },
    // The demo directory stands in for `app_user` only under the dev provider — see
    // `directory.ts` § LookupOptions for why that restriction is not cosmetic.
    { allowDemoFallback: provider.name === "dev" }
  );

  return toCurrentUser(buildAuthUser({ principal, record: directory, via, session }));
}

/** The session settings this process will use. Exported so `routes/session.ts` and the tests
 * agree on cookie names without re-reading the environment in two places. */
export function currentSessionSettings(): SessionSettings {
  return sessionSettings();
}
