/**
 * The identity provider interface — the seam A-R6 turns on.
 *
 * BUILD-FREEZE.md records that there is no Azure subscription and no Entra app registration, and
 * that this must not stop the build. The answer is not a stub: it is an interface with two full
 * implementations, one of which happens to be a header shortcut and the other of which is a real
 * tenant-scoped OIDC client that has simply never been pointed at a real tenant. Swapping them is
 * one environment variable, and `server/src/app.ts` — which this lane may not edit — does not
 * mention either.
 *
 * What a provider is responsible for:
 *
 *   - turning a request that carries its own credential into a principal (`authenticateRequest`);
 *   - starting an interactive sign-in (`beginSignIn`);
 *   - finishing one (`completeSignIn`);
 *   - saying where the browser goes to sign out at the IdP (`endSessionUrl`).
 *
 * What a provider is *not* responsible for: sessions, cookies, CSRF, roles, office scope. Those
 * are the same whichever IdP is in front of them, so they live in `auth/session.ts`,
 * `auth/directory.ts` and `routes/session.ts` and are written once.
 */
import type { FastifyRequest } from "fastify";
import type { AuthMode } from "../settings";

/** The identity as the IdP asserts it, before this system decides what it may do. */
export interface Principal {
  /** Entra `preferred_username` / UPN. Human-readable, and renameable — never the key. */
  upn: string;
  /** Entra `oid`. The stable identity key (WS-W3): survives a rename, unique within the tenant. */
  objectId: string;
  /** Entra `tid`. Pinned to the configured tenant; a token from anywhere else is refused. */
  tenantId: string;
  displayName: string;
}

export interface SignInStart {
  /** Where to send the browser. Absolute, at the IdP. */
  authorizationUrl: string;
}

export interface SignInCompletion {
  principal: Principal;
  /** The validated same-origin path this sign-in was deep-linking to. */
  returnTo: string;
}

export interface IdentityProvider {
  readonly name: AuthMode;
  /** False for a provider with no redirect flow: `/api/auth/sign-in` answers 501, not a redirect. */
  readonly interactive: boolean;

  /**
   * An identity carried by the request itself — a development header today. Returns null when the
   * request carries none, which is not an error: the session cookie is checked first and this is
   * the fallback, not the other way round.
   */
  authenticateRequest(req: FastifyRequest): Promise<Principal | null> | Principal | null;

  /** Begins an interactive sign-in. Throws `AuthConfigurationError` when unconfigured. */
  beginSignIn(input: { returnTo: string }): Promise<SignInStart>;

  /** Completes the IdP's redirect back. Throws `SignInError` on any validation failure. */
  completeSignIn(input: { query: Record<string, string | undefined> }): Promise<SignInCompletion>;

  /** The IdP's end-session endpoint, or null when signing out is purely local. */
  endSessionUrl(input: { postLogoutRedirectUri: string | null }): string | null;
}

/**
 * A sign-in that failed for a reason the *user* caused or an attacker attempted: a replayed
 * state, a bad nonce, a token from the wrong tenant. Distinct from `AuthConfigurationError`,
 * which is the operator's problem. The message is safe to log; it is not safe to render, because
 * it names what was wrong with an attacker-supplied value.
 */
export class SignInError extends Error {
  readonly statusCode = 400;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}
