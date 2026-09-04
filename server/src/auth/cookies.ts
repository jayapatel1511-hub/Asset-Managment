/**
 * Cookie parsing, serialising and signing — about eighty lines rather than a dependency.
 *
 * `server/package.json` belongs to the integrator lane and this lane may not add to it, so
 * `@fastify/cookie` is not available. That turns out to be the better answer anyway: the whole
 * surface used here is "read one header, write one header, and prove the value came from us",
 * and `node:crypto` already does the only hard part.
 *
 * The signature is HMAC-SHA256 over the value, appended after a dot and compared with
 * `timingSafeEqual`. It does not encrypt: the session id is opaque and carries no data, so
 * confidentiality is not what the signature is for. It exists so that a forged or edited cookie
 * is rejected before it is ever used as a store key.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  /** Seconds. 0 expires the cookie immediately; undefined makes it a session cookie. */
  maxAge?: number;
}

/** Parses a `Cookie:` header. Unknown, malformed or duplicated pairs are ignored, first wins. */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const COOKIE_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new Error(`Refusing to set a cookie named "${name}".`);
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
    // Max-Age alone is ignored by some corporate proxies; Expires is the belt to its braces.
    parts.push(`Expires=${new Date(Date.now() + options.maxAge * 1000).toUTCString()}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function sign(value: string, secret: string): string {
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}

/** Returns the value only when the signature verifies. Never throws on malformed input. */
export function unsign(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const provided = signed.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(value).digest("base64url");
  return safeEqual(provided, expected) ? value : null;
}

/** Constant-time string comparison that does not leak length through an early return. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still do the work, against a same-length buffer, so the timing does not distinguish
    // "wrong length" from "wrong content".
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
