/**
 * Authentication configuration, read from the environment and validated *at use*, never at
 * import.
 *
 * A-R6 (BUILD-FREEZE.md): there is no Azure subscription, no Entra tenant and no app
 * registration. The OIDC path is written out in full anyway, so that when Englobe IT does create
 * the registration the change is three environment variables rather than a design. That only
 * works if nothing here reaches the network — or throws — merely because the module was
 * imported. `readOidcSettings()` is a function, called on the first sign-in, and it fails with a
 * message that names the exact variables that are missing.
 *
 *   AMS_AUTH                  "dev" (default) or "oidc".
 *   AMS_OIDC_TENANT_ID        Entra directory (tenant) ID. Issuer and `tid` are both pinned to it.
 *   AMS_OIDC_CLIENT_ID        Application (client) ID. Becomes the required `aud`.
 *   AMS_OIDC_CLIENT_SECRET    Optional. Omit it: the flow is authorization code + PKCE, which
 *                             needs no secret. Present only for a confidential client that has
 *                             no federated credential yet.
 *   AMS_OIDC_REDIRECT_URI     Absolute https:// callback, registered on the app registration.
 *   AMS_OIDC_AUTHORITY        Override for sovereign clouds. Default login.microsoftonline.com.
 *   AMS_OIDC_SCOPES           Default "openid profile email offline_access".
 *   AMS_OIDC_POST_LOGOUT_URI  Where Entra returns the browser after sign-out.
 *   AMS_SESSION_SECRET        HMAC key for the session cookie signature.
 *   AMS_SESSION_TTL_MINUTES   Idle/absolute session lifetime. Default 480 (one working day).
 *
 * On rule 10 (no credentials in source): nothing here has a default that is a credential.
 * `AMS_OIDC_CLIENT_SECRET` has no default and is not required; `AMS_SESSION_SECRET` falls back to
 * a random per-process key in development *only*, and production refuses to start without it.
 */
import { randomBytes } from "node:crypto";
import type { AuthVia } from "./roles";

export type AuthMode = "dev" | "oidc";

export type Env = Record<string, string | undefined>;

/** Thrown when a configured path is exercised without its configuration. Carries the missing
 * variable names so the operator is told what to set rather than what broke. */
export class AuthConfigurationError extends Error {
  readonly statusCode = 503;
  readonly code = "auth_not_configured";
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(missing.length ? `${message} Missing: ${missing.join(", ")}.` : message);
    this.name = "AuthConfigurationError";
    this.missing = missing;
  }
}

export function isProduction(env: Env = process.env): boolean {
  return (env.NODE_ENV ?? "").toLowerCase() === "production";
}

export function authMode(env: Env = process.env): AuthMode {
  const raw = (env.AMS_AUTH ?? "dev").toLowerCase();
  if (raw === "dev" || raw === "oidc") {
    // The dev provider is a header shortcut, not authentication. It must never be what stands
    // between production data and the internet, so production refuses to select it.
    if (raw === "dev" && isProduction(env)) {
      throw new AuthConfigurationError(
        'AMS_AUTH="dev" is refused when NODE_ENV=production — the dev identity header is not authentication. Set AMS_AUTH=oidc.'
      );
    }
    return raw;
  }
  throw new AuthConfigurationError(`Unknown AMS_AUTH="${env.AMS_AUTH}". Use "dev" (default) or "oidc".`);
}

// ---------------------------------------------------------------- session

export interface SessionSettings {
  /** Opaque server-side session id. HttpOnly — the browser never reads it. */
  cookieName: string;
  /** Double-submit CSRF token. Readable by script on purpose; that is how it gets echoed back. */
  csrfCookieName: string;
  /** Identity fingerprint, readable, long-lived: the offline lane's same-device user-change check. */
  identityCookieName: string;
  /** Set alongside `identityCookieName` when a *different* identity signs in on this device. */
  previousIdentityCookieName: string;
  csrfHeaderName: string;
  secret: string;
  ttlMs: number;
  secure: boolean;
  sameSite: "Lax" | "Strict";
}

const DEFAULT_TTL_MINUTES = 480;

let developmentSecret: string | null = null;

/**
 * In production the signing key is mandatory (managed identity / Key Vault delivers it). In
 * development a random per-process key is generated, which means a restart invalidates every
 * session — correct behaviour for a laptop, and it keeps a guessable default out of the source.
 */
function resolveSecret(env: Env): string {
  const configured = env.AMS_SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32 && isProduction(env)) {
      throw new AuthConfigurationError("AMS_SESSION_SECRET must be at least 32 characters in production.");
    }
    return configured;
  }
  if (isProduction(env)) {
    throw new AuthConfigurationError("A session signing key is required in production.", ["AMS_SESSION_SECRET"]);
  }
  developmentSecret ??= randomBytes(32).toString("base64url");
  return developmentSecret;
}

export function sessionSettings(env: Env = process.env): SessionSettings {
  const minutes = Number(env.AMS_SESSION_TTL_MINUTES ?? DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new AuthConfigurationError(`AMS_SESSION_TTL_MINUTES must be a positive number, got "${env.AMS_SESSION_TTL_MINUTES}".`);
  }
  return {
    cookieName: "ams_session",
    csrfCookieName: "ams_csrf",
    identityCookieName: "ams_identity",
    previousIdentityCookieName: "ams_prev_identity",
    csrfHeaderName: "x-ams-csrf",
    secret: resolveSecret(env),
    ttlMs: minutes * 60_000,
    // Secure in production, and not locally: a laptop serves http://127.0.0.1 and a Secure
    // cookie would simply never be stored, which looks like a bug in the sign-in flow.
    secure: isProduction(env),
    // Lax, not Strict: Strict drops the cookie on the IdP's redirect back to /api/auth/callback,
    // so the browser arrives at its own callback unauthenticated. Lax sends it on a top-level
    // GET navigation, which is exactly and only what the callback is.
    sameSite: "Lax",
  };
}

/** CSRF is a defence against *ambient* credentials. A request that authenticated by header
 * carries no ambient credential, so it neither needs nor gets the check. */
export function csrfApplies(via: AuthVia, method: string): boolean {
  if (via !== "cookie") return false;
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

// ---------------------------------------------------------------- OIDC

export interface OidcSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  /** e.g. https://login.microsoftonline.com/<tenant>/v2.0 */
  authority: string;
  /** The only issuer an id_token may claim. Tenant-scoped, per WS-W3. */
  issuer: string;
  scopes: string;
  postLogoutRedirectUri: string | null;
}

const DEFAULT_CLOUD = "https://login.microsoftonline.com";
const DEFAULT_SCOPES = "openid profile email offline_access";

/**
 * Reads and validates the Entra configuration. Throws `AuthConfigurationError` naming every
 * missing variable — the whole set at once, so an operator configures it in one pass.
 */
export function readOidcSettings(env: Env = process.env): OidcSettings {
  const tenantId = env.AMS_OIDC_TENANT_ID?.trim() ?? "";
  const clientId = env.AMS_OIDC_CLIENT_ID?.trim() ?? "";
  const redirectUri = env.AMS_OIDC_REDIRECT_URI?.trim() ?? "";

  const missing: string[] = [];
  if (!tenantId) missing.push("AMS_OIDC_TENANT_ID");
  if (!clientId) missing.push("AMS_OIDC_CLIENT_ID");
  if (!redirectUri) missing.push("AMS_OIDC_REDIRECT_URI");
  if (missing.length) {
    throw new AuthConfigurationError(
      'AMS_AUTH="oidc" is selected but the Entra app registration is not configured. ' +
        "A-R6 in specs/_planning/BUILD-FREEZE.md records that the registration does not exist yet; " +
        "until it does, leave AMS_AUTH unset to use the development identity header.",
      missing
    );
  }

  // "common" / "organizations" / "consumers" are multi-tenant authorities. WS-W3 requires a
  // tenant-scoped issuer, so they are refused rather than quietly accepted.
  if (["common", "organizations", "consumers"].includes(tenantId.toLowerCase())) {
    throw new AuthConfigurationError(
      `AMS_OIDC_TENANT_ID="${tenantId}" is a multi-tenant authority. WS-W3 requires a tenant-scoped issuer: use the directory (tenant) GUID.`
    );
  }

  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new AuthConfigurationError(`AMS_OIDC_REDIRECT_URI="${redirectUri}" is not an absolute URL.`);
  }
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
    throw new AuthConfigurationError(`AMS_OIDC_REDIRECT_URI must be https:// (loopback excepted for local testing), got "${redirectUri}".`);
  }

  const cloud = (env.AMS_OIDC_AUTHORITY?.trim() || DEFAULT_CLOUD).replace(/\/+$/, "");
  const authority = `${cloud}/${tenantId}/v2.0`;

  return {
    tenantId,
    clientId,
    clientSecret: env.AMS_OIDC_CLIENT_SECRET?.trim() || null,
    redirectUri,
    authority,
    issuer: authority,
    scopes: env.AMS_OIDC_SCOPES?.trim() || DEFAULT_SCOPES,
    postLogoutRedirectUri: env.AMS_OIDC_POST_LOGOUT_URI?.trim() || null,
  };
}
