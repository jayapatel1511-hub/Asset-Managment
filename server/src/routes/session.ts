/**
 * The session boundary (WS-W3): sign in, come back, look at who you are, sign out.
 *
 * This is a backend-for-frontend. The browser's whole credential is one opaque, signed,
 * `HttpOnly` cookie; the id_token, access token and refresh token are verified in
 * `auth/providers/oidcProvider.ts` and dropped before this file ever sees them. There is no
 * password store — there is nothing for this system to store, because Entra holds the credential
 * and this system holds a session id pointing at four claims.
 *
 * Four protections live here, and each is here rather than in the provider because each is the
 * same under any IdP.
 *
 * **CSRF — double-submit token, not an Origin check.** The session cookie is `SameSite=Lax`,
 * which already stops a cross-site form POST in a current browser. Lax is not the whole answer:
 * it treats every `*.englobecorp.com` origin as same-site, so a compromised or merely sloppy
 * sibling application on the corporate domain is *inside* the boundary Lax draws. An `Origin`
 * check would close that, but it fails in two ways that matter here: some corporate proxies strip
 * the header, and a stripped header is indistinguishable from a same-origin request that never
 * had one, so the check must either fail closed (and break real users behind that proxy) or fail
 * open (and not be a check). A double-submit token has neither problem — it is present or it is
 * not — and it is verifiable from a test without a browser, which is what makes the guarantee
 * something this repository can *prove* rather than assert. The token is compared against the
 * server-side session record, not merely against the cookie, so it is stronger than classic
 * double-submit: an attacker who can set cookies on the domain still cannot mint a valid one.
 *
 * The check applies only to requests authenticated **by cookie**. A request that authenticated by
 * header carries no ambient credential — the browser will not attach that header on an
 * attacker's behalf — so CSRF is not a thing that can happen to it. That is also why the existing
 * suite, which uses the dev header, needs no token and is unchanged.
 *
 * **Open redirect.** `auth/redirect.ts`, applied to `returnTo` before it is stored and again
 * before it is used.
 *
 * **Disabled users.** Checked on every request, not only at sign-in — an account deactivated at
 * 09:05 must not keep working until its session expires at 17:00.
 *
 * **Same-device user change.** `identityKey` is a one-way fingerprint of tenant + object id,
 * published in a readable cookie and on `/api/auth/session`. The offline lane stores it beside
 * its command queue; when the value changes, the queue belongs to somebody else and must not be
 * replayed. `identityChanged` is the server saying so first, at the moment of sign-in.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../app";
import {
  currentSessionSettings,
  identityProvider,
  sessionOf,
  type AuthRuntime,
} from "../auth/identity";
import { parseCookies, safeEqual, serializeCookie, sign } from "../auth/cookies";
import { invalidateDirectory } from "../auth/directory";
import { safeReturnTo } from "../auth/redirect";
import { authOf, publicUser } from "../auth/roles";
import { MemorySessionStore, identityKeyOf, type SessionRecord } from "../auth/session";
import { AuthConfigurationError, csrfApplies, type SessionSettings } from "../auth/settings";
import { SignInError } from "../auth/providers/index";

/** One year. The identity fingerprint outlives the session on purpose: the point is to notice a
 * *different* user on this device, which is a question asked after the first session ended. */
const IDENTITY_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/** Routes that an unauthenticated or disabled caller must still be able to reach, or sign-in is
 * a locked door with the key inside. */
const ALWAYS_OPEN = new Set(["/api/health", "/api/auth/sign-in", "/api/auth/callback", "/api/auth/session", "/api/auth/sign-out"]);

function setCookies(reply: FastifyReply, cookies: string[]): void {
  const existing = reply.getHeader("set-cookie");
  const all = Array.isArray(existing) ? [...existing, ...cookies] : existing ? [String(existing), ...cookies] : cookies;
  reply.header("set-cookie", all);
}

function sessionCookies(settings: SessionSettings, record: SessionRecord, signedId: string): string[] {
  const base = { path: "/", secure: settings.secure, sameSite: settings.sameSite } as const;
  const maxAge = Math.floor(settings.ttlMs / 1000);
  return [
    // The credential. HttpOnly: script never reads it, so an XSS bug cannot exfiltrate the session.
    serializeCookie(settings.cookieName, signedId, { ...base, httpOnly: true, maxAge }),
    // The CSRF token. Readable on purpose — that is the mechanism, not an oversight.
    serializeCookie(settings.csrfCookieName, record.csrfToken, { ...base, httpOnly: false, maxAge }),
    // The identity fingerprint. Readable, long-lived, and discloses nothing: it is a SHA-256 of
    // tenant + object id, so it identifies "the same person as before" without saying who.
    serializeCookie(settings.identityCookieName, record.identityKey, {
      ...base,
      httpOnly: false,
      maxAge: IDENTITY_COOKIE_MAX_AGE_SEC,
    }),
    ...(record.previousIdentityKey
      ? [serializeCookie(settings.previousIdentityCookieName, record.previousIdentityKey, { ...base, httpOnly: false, maxAge })]
      : []),
  ];
}

function clearedCookies(settings: SessionSettings): string[] {
  const base = { path: "/", secure: settings.secure, sameSite: settings.sameSite, maxAge: 0 } as const;
  return [
    serializeCookie(settings.cookieName, "", { ...base, httpOnly: true }),
    serializeCookie(settings.csrfCookieName, "", { ...base, httpOnly: false }),
    // `identityCookieName` is deliberately *not* cleared. Sign-out is not "forget who used this
    // device" — the next sign-in has to be able to tell whether it is the same person.
  ];
}

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Throws in production when AMS_SESSION_SECRET is unset — at boot, loudly, rather than at the
  // first sign-in with a per-process key that silently invalidates every other replica's sessions.
  const settings = currentSessionSettings();
  const provider = identityProvider();
  const runtime: AuthRuntime = {
    db: ctx.db,
    sessions: new MemorySessionStore(settings.ttlMs),
    settings,
    provider,
  };
  app.decorate("amsAuth", runtime);

  // ------------------------------------------------------------ cross-cutting gate
  //
  // Registered here, before every other route module, so it covers routes this lane does not own
  // — including ones added after it. Deny-by-default for the three things that must never depend
  // on a route author remembering them.
  //
  // The per-route guards in routes/read.ts and routes/commands.ts still exist and still matter:
  // they say which *roles* an endpoint takes, which is a decision only the endpoint can make.
  // This hook says the thing that is true of every endpoint, so that a route added in another
  // lane next week is closed before it is opened rather than after someone notices.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/")) return;
    const user = authOf(req);

    // 1. No identity: 401 everywhere except the endpoints that let a caller acquire one.
    if (!user.authenticated && !ALWAYS_OPEN.has(url)) {
      return reply.code(401).send({
        error: "unauthenticated",
        message: "This endpoint requires an authenticated caller. Sign in at /api/auth/sign-in.",
      });
    }

    // 2. A deactivated account is refused everywhere except the endpoints that let it find out
    // why and sign out. Checked per request: deactivation takes effect within the directory cache
    // window, not at session expiry.
    if (user.disabled && !ALWAYS_OPEN.has(url)) {
      return reply.code(403).send({
        error: "account_disabled",
        message: "This account is deactivated in the asset management system. Contact the system owner.",
      });
    }

    // 3. CSRF, below.

    if (!csrfApplies(user.via, req.method)) return;
    const provided = req.headers[settings.csrfHeaderName];
    const token = Array.isArray(provided) ? provided[0] : provided;
    const record = runtime.sessions.get(user.sessionId);
    if (!token || !record || !safeEqual(token, record.csrfToken)) {
      return reply.code(403).send({
        error: "csrf_required",
        message: `A state-changing request authenticated by session cookie must echo the CSRF token in ${settings.csrfHeaderName}. Read it from GET /api/auth/session.`,
      });
    }
    return;
  });

  // ------------------------------------------------------------ sign in

  app.get("/api/auth/sign-in", async (req, reply) => {
    const returnTo = safeReturnTo((req.query as { returnTo?: unknown } | undefined)?.returnTo);
    if (returnTo === null) {
      // Refused, not silently rewritten: the caller sent something that is not a path on this
      // site, and the only two explanations are a bug and an attempt.
      return reply.code(400).send({
        error: "invalid_return_to",
        message: "returnTo must be a path on this site, beginning with a single '/'.",
      });
    }

    if (!provider.interactive) {
      return reply.code(501).send({
        error: "no_interactive_sign_in",
        message:
          "This deployment uses the development identity header and has no sign-in flow. Set AMS_AUTH=oidc with an Entra app registration.",
      });
    }

    try {
      const { authorizationUrl } = await provider.beginSignIn({ returnTo });
      return reply.redirect(authorizationUrl, 302);
    } catch (err) {
      return signInFailure(reply, err);
    }
  });

  app.get("/api/auth/callback", async (req, reply) => {
    if (!provider.interactive) {
      return reply.code(501).send({ error: "no_interactive_sign_in", message: "This deployment has no sign-in flow." });
    }

    let completion;
    try {
      completion = await provider.completeSignIn({ query: (req.query ?? {}) as Record<string, string | undefined> });
    } catch (err) {
      return signInFailure(reply, err);
    }

    // Re-validated after the round trip. It was validated before it was stored, and it is
    // validated again before it is reflected: the store is in this process, but "it was safe when
    // we put it there" is not a property worth betting a redirect on.
    const returnTo = safeReturnTo(completion.returnTo) ?? "/";

    const previous = parseCookies(req.headers.cookie)[settings.identityCookieName] ?? null;
    const incomingKey = identityKeyOf(completion.principal);
    const record = runtime.sessions.create(completion.principal, {
      previousIdentityKey: previous && previous !== incomingKey ? previous : null,
    });

    // A new sign-in ends every older session for the same identity. It also drops the directory
    // cache, so a role changed while the user was away takes effect on their first request.
    invalidateDirectory();

    setCookies(reply, sessionCookies(settings, record, sign(record.id, settings.secret)));
    return reply.redirect(returnTo, 302);
  });

  // ------------------------------------------------------------ who am I

  app.get("/api/auth/session", async (req) => {
    const user = authOf(req);
    const record = sessionOf(req, runtime);
    return {
      authenticated: user.authenticated,
      /** Authenticated by the IdP but deactivated here. The client shows an explanation, not a
       * sign-in button — signing in again will not help. */
      disabled: user.disabled,
      /** Authenticated, enabled, and provisioned for nothing: no `app_user_role` row. */
      provisioned: user.authenticated && !user.disabled && user.roles.length > 0,
      provider: provider.name,
      user: user.authenticated ? publicUser(user) : null,
      identityKey: user.identityKey,
      previousIdentityKey: record?.previousIdentityKey ?? null,
      identityChanged: Boolean(record?.previousIdentityKey),
      /** Only ever issued to the holder of the session it belongs to. */
      csrfToken: record?.csrfToken ?? null,
      expiresAt: record ? new Date(record.expiresAt).toISOString() : null,
      /** The dev header is identity, not authentication — say so, so no screen mistakes it. */
      authenticationIsReal: provider.name !== "dev",
    };
  });

  // ------------------------------------------------------------ sign out

  app.post("/api/auth/sign-out", async (req, reply) => {
    const user = authOf(req);
    const record = sessionOf(req, runtime);
    if (record) runtime.sessions.destroy(record.id);
    // Every session for this identity, not just this device's: "sign me out" from a lost tablet
    // has to mean it.
    if (user.objectId) runtime.sessions.destroyForObjectId(user.objectId);
    invalidateDirectory();

    setCookies(reply, clearedCookies(settings));
    return reply.code(200).send({
      ok: true,
      endSessionUrl: provider.endSessionUrl({ postLogoutRedirectUri: null }),
    });
  });
}

/**
 * One place turns a sign-in failure into a response, so no branch can accidentally reflect an
 * attacker-supplied string. `SignInError.code` is stable and safe; the message is for the log.
 */
function signInFailure(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AuthConfigurationError) {
    reply.log?.error({ err: err.message, missing: err.missing }, "sign-in attempted without an identity provider configuration");
    return reply.code(503).send({ error: err.code, message: err.message });
  }
  if (err instanceof SignInError) {
    reply.log?.warn({ code: err.code, detail: err.message }, "sign-in refused");
    return reply.code(400).send({ error: "sign_in_failed", code: err.code, message: "The sign-in could not be completed." });
  }
  reply.log?.error({ err }, "sign-in failed unexpectedly");
  return reply.code(500).send({ error: "sign_in_failed", message: "The sign-in could not be completed." });
}
