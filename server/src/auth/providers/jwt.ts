/**
 * JWT verification against a JWKS — written out rather than imported, for the same reason as
 * `auth/cookies.ts`: `server/package.json` belongs to another lane, so `jose` and
 * `openid-client` are not available. `node:crypto` imports a JWK directly and verifies RSA
 * signatures, which is the entirety of what an Entra id_token needs.
 *
 * The security of the whole OIDC path reduces to this file, so the rules it enforces are worth
 * stating explicitly rather than leaving to be read out of the code:
 *
 *   1. **The algorithm comes from an allow-list, never from the token.** `alg: none` and every
 *      HMAC algorithm are refused before a key is fetched. Trusting the header's `alg` is the
 *      original JWT vulnerability: an attacker signs with HS256 using the *public* key as the
 *      HMAC secret and a naive verifier accepts it.
 *   2. **The key comes from the issuer's JWKS, selected by `kid`.** A token whose `kid` is
 *      unknown triggers exactly one refetch (Entra rotates keys), then fails. Embedded `jwk` /
 *      `jku` / `x5u` headers are ignored entirely — they let the token nominate its own key.
 *   3. **`iss` must equal the configured tenant-scoped issuer**, string-for-string. This is what
 *      makes the deployment tenant-scoped: a valid token from another Entra tenant is a valid
 *      token, and must still be refused.
 *   4. **`aud` must equal the configured client id**, `exp`/`nbf` are checked with a small clock
 *      skew, and `nonce` must match the one this server generated for this sign-in.
 *
 * No network call happens at import. The JWKS is fetched lazily on first use and cached.
 */
import { createPublicKey, constants as cryptoConstants, verify as cryptoVerify, type KeyObject } from "node:crypto";

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export class JwtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JwtError";
    this.code = code;
  }
}

/** RSA only. Entra signs id_tokens with RS256; nothing here needs to accept more, and every
 * algorithm accepted is an algorithm that must be got right. */
const ALGORITHMS: Record<string, { hash: string; pss: boolean }> = {
  RS256: { hash: "sha256", pss: false },
  RS384: { hash: "sha384", pss: false },
  RS512: { hash: "sha512", pss: false },
  PS256: { hash: "sha256", pss: true },
  PS384: { hash: "sha384", pss: true },
  PS512: { hash: "sha512", pss: true },
};

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  nonce?: string;
  /** Entra: the tenant. */
  tid?: string;
  /** Entra: the immutable object id — the identity key WS-W3 requires. */
  oid?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  name?: string;
  [claim: string]: unknown;
}

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(json) as unknown;
}

// ---------------------------------------------------------------- JWKS

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

const JWKS_CACHE_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFETCH_MS = 30_000;

export class JwksCache {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;

  constructor(
    private readonly jwksUri: string,
    private readonly fetcher: Fetcher,
    private readonly now: () => number = Date.now
  ) {}

  async keyFor(kid: string | undefined): Promise<KeyObject> {
    if (!kid) throw new JwtError("missing_kid", "The token header carries no key id.");
    const cached = this.keys.get(kid);
    if (cached && this.now() - this.fetchedAt < JWKS_CACHE_TTL_MS) return cached;

    // Unknown kid, or a stale cache: refetch once. Rate-limited, so a stream of tokens carrying
    // a bogus kid cannot be turned into a stream of requests at the IdP.
    if (!cached && this.now() - this.fetchedAt < JWKS_MIN_REFETCH_MS && this.keys.size > 0) {
      throw new JwtError("unknown_kid", `No signing key "${kid}" in the issuer's JWKS.`);
    }
    await this.refresh();
    const fresh = this.keys.get(kid);
    if (!fresh) throw new JwtError("unknown_kid", `No signing key "${kid}" in the issuer's JWKS.`);
    return fresh;
  }

  private async refresh(): Promise<void> {
    let payload: unknown;
    try {
      const res = await this.fetcher(this.jwksUri);
      if (!res.ok) throw new JwtError("jwks_unavailable", `JWKS request failed with HTTP ${res.status}.`);
      payload = await res.json();
    } catch (err) {
      if (err instanceof JwtError) throw err;
      throw new JwtError("jwks_unavailable", `Could not fetch the JWKS at ${this.jwksUri}: ${(err as Error).message}`);
    }

    const keys = (payload as { keys?: Jwk[] } | null)?.keys;
    if (!Array.isArray(keys)) throw new JwtError("jwks_malformed", "The JWKS document has no `keys` array.");

    const next = new Map<string, KeyObject>();
    for (const jwk of keys) {
      if (jwk.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e) continue;
      if (jwk.use && jwk.use !== "sig") continue;
      try {
        next.set(jwk.kid, createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" }));
      } catch {
        // A key we cannot import is a key we will not use. Skipping it beats failing the whole
        // set, because the token in hand may be signed by one of the others.
      }
    }
    if (next.size === 0) throw new JwtError("jwks_malformed", "The JWKS document contained no usable RSA signing keys.");
    this.keys = next;
    this.fetchedAt = this.now();
  }
}

// ---------------------------------------------------------------- verification

export interface VerifyOptions {
  /** The exact issuer this deployment trusts. Tenant-scoped (WS-W3). */
  issuer: string;
  /** The exact audience — the application (client) id. */
  audience: string;
  /** The nonce this server minted for this sign-in. Omitted only for a token with no nonce flow. */
  nonce?: string;
  clockSkewSec?: number;
  now?: () => number;
}

const DEFAULT_SKEW_SEC = 60;

/**
 * Verifies signature then claims, in that order, and returns the claims. Throws `JwtError` with a
 * code naming the first failure — codes are for logs and metrics, not for the browser.
 */
export async function verifyJwt(token: string, keys: JwksCache, options: VerifyOptions): Promise<JwtClaims> {
  if (typeof token !== "string" || token.length > 16_384) throw new JwtError("malformed", "Not a token this server will parse.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed", "A JWT has three dot-separated segments.");

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = decodeSegment(parts[0]) as JwtHeader;
    claims = decodeSegment(parts[1]) as JwtClaims;
  } catch {
    throw new JwtError("malformed", "The token header or payload is not base64url-encoded JSON.");
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") {
    throw new JwtError("malformed", "The token header or payload is not an object.");
  }

  // Rule 1: the allow-list decides, not the token.
  const algorithm = ALGORITHMS[header.alg];
  if (!algorithm) throw new JwtError("unsupported_alg", `Refusing algorithm "${header.alg}".`);

  // Rule 2: the key comes from the issuer's JWKS, by kid.
  const key = await keys.keyFor(header.kid);
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  const ok = cryptoVerify(
    algorithm.hash,
    signed,
    algorithm.pss
      ? { key, padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST }
      : { key, padding: cryptoConstants.RSA_PKCS1_PADDING },
    signature
  );
  if (!ok) throw new JwtError("bad_signature", "The token signature does not verify against the issuer's key.");

  // Rules 3 and 4: the claims.
  const nowSec = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const skew = options.clockSkewSec ?? DEFAULT_SKEW_SEC;

  if (claims.iss !== options.issuer) {
    throw new JwtError("bad_issuer", `Token issuer "${claims.iss}" is not the configured tenant issuer.`);
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(options.audience)) {
    throw new JwtError("bad_audience", "Token audience is not this application.");
  }
  if (typeof claims.exp !== "number" || nowSec > claims.exp + skew) {
    throw new JwtError("expired", "The token has expired.");
  }
  if (typeof claims.nbf === "number" && nowSec + skew < claims.nbf) {
    throw new JwtError("not_yet_valid", "The token is not valid yet.");
  }
  if (typeof claims.iat === "number" && nowSec + skew < claims.iat) {
    throw new JwtError("not_yet_valid", "The token was issued in the future.");
  }
  if (options.nonce !== undefined && claims.nonce !== options.nonce) {
    throw new JwtError("bad_nonce", "The token nonce does not match this sign-in.");
  }

  return claims;
}
