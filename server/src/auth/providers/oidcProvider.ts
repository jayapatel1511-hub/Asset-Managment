/**
 * Microsoft Entra ID sign-in: OpenID Connect authorization code flow with PKCE, tenant-scoped.
 *
 * A-R6 (BUILD-FREEZE.md) says the tenant, the subscription and the app registration do not exist
 * and are not this lane's to create. So this is written to be *finished* rather than *sketched*:
 * every check that a production sign-in needs is here, and the only thing missing is three
 * environment variables. `AMS_AUTH=oidc` selects it; unconfigured, it fails with an
 * `AuthConfigurationError` naming exactly what to set, at the moment someone tries to sign in and
 * never at import time — importing this module opens no socket and reads no configuration.
 *
 * How it is proved without a tenant: every outbound call goes through an injected `fetch`, and
 * `tests/authorization.test.ts` stands up a fabricated issuer — a locally generated RSA key pair
 * published as a JWKS, a discovery document, and a token endpoint that mints a real, correctly
 * signed id_token. The flow that runs in that test is the flow that will run against Entra;
 * only the host on the other end differs. The negative cases matter as much: a token from
 * another tenant, a replayed `state`, a mismatched `nonce` and a tampered signature are each
 * asserted to be refused.
 *
 * What it deliberately does not do:
 *
 *   - **Keep tokens.** The id_token is verified, reduced to four claims, and dropped along with
 *     the access and refresh tokens. Nothing bearer-shaped survives the callback, so nothing
 *     bearer-shaped can reach the browser (see `auth/session.ts`).
 *   - **Ask for Graph scopes.** WS-W3 § "Must not own" is explicit: no broad Graph permission
 *     without an approved requirement. The default scope set is `openid profile email
 *     offline_access` and nothing else.
 *   - **Read roles from the token.** Entra app roles would be a second, competing source of
 *     authority against `app_user_role`. One source, in the database — `auth/directory.ts`.
 */
import { createHash, randomBytes } from "node:crypto";
import { PendingSignInStore } from "../session";
import { AuthConfigurationError, readOidcSettings, type OidcSettings } from "../settings";
import { SignInError, type IdentityProvider, type Principal, type SignInCompletion, type SignInStart } from "./index";
import { JwksCache, JwtError, verifyJwt, type Fetcher } from "./jwt";

export interface OidcDependencies {
  /** Injected so a test can stand up a fabricated tenant. Defaults to the global `fetch`. */
  fetch?: Fetcher;
  now?: () => number;
}

interface DiscoveryDocument {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
}

/** The subset this flow uses, once validated. Separate from the raw document so no code path can
 * read an endpoint that was never checked. */
interface Endpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

const DISCOVERY_TTL_MS = 60 * 60_000;

/** Entra's multi-tenant metadata returns this placeholder in `issuer`; a tenant-scoped authority
 * returns the concrete value. Accept the placeholder only after resolving it to our own tenant. */
const TENANT_PLACEHOLDER = "{tenantid}";

export function createOidcProvider(settings: OidcSettings, deps: OidcDependencies = {}): IdentityProvider {
  const now = deps.now ?? Date.now;
  const fetcher: Fetcher =
    deps.fetch ??
    ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Fetcher>);

  const pending = new PendingSignInStore(now);
  let discovery: { at: number; endpoints: Endpoints } | null = null;
  let jwks: JwksCache | null = null;

  async function discover(): Promise<Endpoints> {
    if (discovery && now() - discovery.at < DISCOVERY_TTL_MS) return discovery.endpoints;

    const url = `${settings.authority.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    let doc: DiscoveryDocument;
    try {
      const res = await fetcher(url);
      if (!res.ok) throw new SignInError("discovery_failed", `Identity provider metadata request failed with HTTP ${res.status}.`);
      doc = (await res.json()) as DiscoveryDocument;
    } catch (err) {
      if (err instanceof SignInError) throw err;
      throw new SignInError("discovery_failed", `Could not read identity provider metadata from ${url}: ${(err as Error).message}`);
    }

    // The metadata itself is checked against the configured tenant before anything in it is used.
    // Without this, a mis-set AMS_OIDC_AUTHORITY would silently move the whole trust anchor.
    const declared = (doc.issuer ?? "").replace(TENANT_PLACEHOLDER, settings.tenantId);
    if (declared !== settings.issuer) {
      throw new SignInError(
        "issuer_mismatch",
        `Identity provider metadata declares issuer "${doc.issuer}", which is not the configured tenant issuer "${settings.issuer}".`
      );
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new SignInError("discovery_incomplete", "Identity provider metadata is missing an endpoint this flow needs.");
    }
    for (const endpoint of [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri]) {
      if (!/^https?:\/\//.test(endpoint)) throw new SignInError("discovery_incomplete", "Identity provider metadata contains a non-absolute endpoint.");
    }

    const endpoints: Endpoints = {
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwksUri: doc.jwks_uri,
    };
    discovery = { at: now(), endpoints };
    jwks = new JwksCache(endpoints.jwksUri, fetcher, now);
    return endpoints;
  }

  function newPkcePair(): { verifier: string; challenge: string } {
    // 43–128 characters of unreserved ASCII, per RFC 7636. base64url of 32 bytes is 43.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
  }

  return {
    name: "oidc",
    interactive: true,

    /**
     * Under OIDC a request carries no credential of its own. The browser authenticates with the
     * server-side session cookie, which `auth/identity.ts` resolves before ever asking the
     * provider — so this returns null, and in particular it *ignores* `x-ams-dev-user`
     * completely. That is the property that makes "a browser-supplied header cannot escalate"
     * true rather than merely intended.
     *
     * Bearer-token access for machine clients is out of scope until there is an approved
     * requirement for one; adding it here would mean a second audience to validate and a second
     * path to authorize, both without a stated need.
     */
    authenticateRequest(): Principal | null {
      return null;
    },

    async beginSignIn({ returnTo }): Promise<SignInStart> {
      const doc = await discover();
      const { verifier, challenge } = newPkcePair();
      const record = pending.create({ nonce: randomBytes(24).toString("base64url"), codeVerifier: verifier, returnTo });

      const url = new URL(doc.authorizationEndpoint);
      url.searchParams.set("client_id", settings.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", settings.redirectUri);
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", settings.scopes);
      url.searchParams.set("state", record.state);
      url.searchParams.set("nonce", record.nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return { authorizationUrl: url.toString() };
    },

    async completeSignIn({ query }): Promise<SignInCompletion> {
      if (query.error) {
        // Entra's own refusal — consent withheld, account blocked, conditional access. Surfaced
        // by code only; `error_description` is attacker-influenceable text and is not reflected.
        throw new SignInError("idp_error", `The identity provider refused the sign-in (${query.error}).`);
      }

      // Single-use: `take` removes the record whether or not the rest succeeds, so an
      // authorization code cannot be replayed against a state that is still open.
      const record = pending.take(query.state);
      if (!record) throw new SignInError("bad_state", "This sign-in was not started here, or it has already been completed or expired.");
      if (!query.code) throw new SignInError("missing_code", "The callback carried no authorization code.");

      const doc = await discover();
      const body = new URLSearchParams({
        client_id: settings.clientId,
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: settings.redirectUri,
        code_verifier: record.codeVerifier,
      });
      // Only for a confidential client that has no federated credential yet. The Azure target is
      // workload identity federation, which is why this is optional rather than required.
      if (settings.clientSecret) body.set("client_secret", settings.clientSecret);

      let tokens: TokenResponse;
      try {
        const res = await fetcher(doc.tokenEndpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: body.toString(),
        });
        tokens = (await res.json()) as TokenResponse;
        if (!res.ok) throw new SignInError("token_exchange_failed", `Token exchange failed (${tokens.error ?? `HTTP ${res.status}`}).`);
      } catch (err) {
        if (err instanceof SignInError) throw err;
        throw new SignInError("token_exchange_failed", `Token exchange failed: ${(err as Error).message}`);
      }
      if (!tokens.id_token) throw new SignInError("no_id_token", "The token response carried no id_token.");
      if (!jwks) throw new SignInError("discovery_failed", "The issuer's signing keys are not available.");

      let claims;
      try {
        claims = await verifyJwt(tokens.id_token, jwks, {
          issuer: settings.issuer,
          audience: settings.clientId,
          nonce: record.nonce,
          now,
        });
      } catch (err) {
        if (err instanceof JwtError) throw new SignInError(`id_token_${err.code}`, `The id_token was refused: ${err.message}`);
        throw err;
      }

      // Belt to the issuer check's braces: `iss` already pins the tenant, and `tid` is checked
      // again because it is the claim the rest of the system keys on.
      if (claims.tid !== settings.tenantId) {
        throw new SignInError("wrong_tenant", "The id_token was issued for a different Entra tenant.");
      }
      const objectId = typeof claims.oid === "string" ? claims.oid : "";
      if (!objectId) {
        throw new SignInError("no_object_id", "The id_token carries no `oid` claim, so there is no stable identity key.");
      }

      const upn =
        (typeof claims.preferred_username === "string" && claims.preferred_username) ||
        (typeof claims.upn === "string" && claims.upn) ||
        (typeof claims.email === "string" && claims.email) ||
        "";
      const displayName = (typeof claims.name === "string" && claims.name) || upn || objectId;

      // Everything else — the id_token itself, the access token, any refresh token — goes out of
      // scope here and is never stored. That is the BFF guarantee, enforced by not writing the line.
      return { principal: { upn, objectId, tenantId: claims.tid, displayName }, returnTo: record.returnTo };
    },

    endSessionUrl({ postLogoutRedirectUri }): string | null {
      // Synchronous by contract, so the discovery document may not be loaded. The v2.0 logout
      // endpoint is a stable, documented path under the configured authority.
      const base = `${settings.authority.replace(/\/+$/, "")}/logout`;
      const target = postLogoutRedirectUri ?? settings.postLogoutRedirectUri;
      if (!target) return base;
      const url = new URL(base);
      url.searchParams.set("post_logout_redirect_uri", target);
      return url.toString();
    },
  };
}

/**
 * Builds the provider from the environment, or throws with the variables that are missing.
 *
 * `readOidcSettings` throws rather than returning a partial configuration, and that throw is
 * deliberately not caught here: an operator who set AMS_AUTH=oidc without an app registration
 * must be told which variables to set, in `AuthConfigurationError`'s own words.
 */
export function createOidcProviderFromEnv(env: NodeJS.ProcessEnv = process.env, deps: OidcDependencies = {}): IdentityProvider {
  let settings: OidcSettings;
  try {
    settings = readOidcSettings(env);
  } catch (err) {
    if (err instanceof AuthConfigurationError) throw err;
    throw new AuthConfigurationError(`The Entra configuration could not be read: ${(err as Error).message}`);
  }
  return createOidcProvider(settings, deps);
}
