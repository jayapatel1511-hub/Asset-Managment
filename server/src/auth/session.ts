/**
 * The server-side session: what a signed cookie points *at*.
 *
 * The one architectural claim this file makes is that **no token ever reaches the browser**. The
 * browser receives an opaque 256-bit identifier and a CSRF token; the id_token, the access token
 * and the refresh token are read once during the callback, verified, reduced to four claims, and
 * dropped. Nothing to steal from devtools, nothing to cache in a service worker, nothing to leak
 * in a bug report — which is what rules 10 and 11 are actually asking for. A backend-for-frontend
 * is only a BFF if the F never holds the bearer.
 *
 * The store is in-process. That is correct for the local server and wrong for Azure Container
 * Apps, where revisions are immutable and replicas are plural: a shared store (Redis, or a
 * `session` table on the same PostgreSQL the rest of the system already trusts) replaces
 * `MemorySessionStore` behind the `SessionStore` interface, and nothing above it changes. It is
 * called out here rather than left to be discovered at the first two-replica deployment.
 *
 * Also here: the same-device user-change contract WS-W3 owes the offline lane. Two users share a
 * field tablet; the second must never replay the first's queued commands. The server publishes a
 * stable, non-reversible `identityKey` per principal — the client stores it beside its queue and
 * compares. `identityChanged` on the session payload is the server noticing first.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface SessionPrincipal {
  upn: string;
  objectId: string;
  tenantId: string;
  displayName: string;
}

export interface SessionRecord {
  id: string;
  principal: SessionPrincipal;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  identityKey: string;
  /** The identity that held this device before this sign-in, when it was a different one. */
  previousIdentityKey: string | null;
}

export interface SessionStore {
  create(principal: SessionPrincipal, options?: { previousIdentityKey?: string | null }): SessionRecord;
  get(id: string | null | undefined): SessionRecord | null;
  destroy(id: string | null | undefined): void;
  /** Every session for one identity — what a disabled account or a forced sign-out needs. */
  destroyForObjectId(objectId: string): number;
  readonly size: number;
}

/**
 * A one-way fingerprint of tenant + object id. One-way on purpose: it is written to a readable
 * cookie so the offline lane can compare it before its first fetch, and a readable cookie must
 * not disclose who the user is.
 */
export function identityKeyOf(principal: Pick<SessionPrincipal, "objectId" | "tenantId">): string {
  return createHash("sha256").update(`${principal.tenantId}|${principal.objectId}`).digest("hex").slice(0, 32);
}

const MAX_SESSIONS = 10_000;

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  create(principal: SessionPrincipal, options: { previousIdentityKey?: string | null } = {}): SessionRecord {
    this.sweep();
    // A bound, so a sign-in flood cannot grow the process without limit. Oldest first: an
    // attacker evicting their own stale sessions is not a threat, evicting everyone's is.
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt).slice(0, MAX_SESSIONS / 10);
      for (const record of oldest) this.sessions.delete(record.id);
    }
    const at = this.now();
    const record: SessionRecord = {
      // 256 bits from the CSPRNG. Not a UUID: a session id is a bearer secret, and v4 UUIDs
      // spend 6 of their 128 bits on version and variant bits.
      id: randomBytes(32).toString("base64url"),
      principal,
      csrfToken: randomBytes(32).toString("base64url"),
      createdAt: at,
      lastSeenAt: at,
      expiresAt: at + this.ttlMs,
      identityKey: identityKeyOf(principal),
      previousIdentityKey: options.previousIdentityKey ?? null,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  get(id: string | null | undefined): SessionRecord | null {
    if (!id) return null;
    const record = this.sessions.get(id);
    if (!record) return null;
    const at = this.now();
    if (record.expiresAt <= at) {
      this.sessions.delete(id);
      return null;
    }
    record.lastSeenAt = at;
    return record;
  }

  destroy(id: string | null | undefined): void {
    if (id) this.sessions.delete(id);
  }

  destroyForObjectId(objectId: string): number {
    let removed = 0;
    for (const [id, record] of this.sessions) {
      if (record.principal.objectId === objectId) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweep(): void {
    const at = this.now();
    for (const [id, record] of this.sessions) if (record.expiresAt <= at) this.sessions.delete(id);
  }
}

// ---------------------------------------------------------------- in-flight sign-ins

/**
 * State held between the redirect *to* the IdP and the redirect back. It is not a session — the
 * user is not signed in yet — and it is deliberately short-lived and single-use: replaying a
 * `state` is how an attacker turns a stolen authorization code into a session.
 */
export interface PendingSignIn {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;
const MAX_PENDING = 2_000;

export class PendingSignInStore {
  private readonly pending = new Map<string, PendingSignIn>();

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = PENDING_TTL_MS) {}

  create(input: { nonce: string; codeVerifier: string; returnTo: string; state?: string }): PendingSignIn {
    this.sweep();
    if (this.pending.size >= MAX_PENDING) this.pending.clear();
    const at = this.now();
    const record: PendingSignIn = {
      state: input.state ?? randomBytes(24).toString("base64url"),
      nonce: input.nonce,
      codeVerifier: input.codeVerifier,
      returnTo: input.returnTo,
      createdAt: at,
      expiresAt: at + this.ttlMs,
    };
    this.pending.set(record.state, record);
    return record;
  }

  /** Single use: a `state` that has been redeemed is gone, whether or not the exchange succeeds. */
  take(state: string | undefined | null): PendingSignIn | null {
    if (!state) return null;
    const record = this.pending.get(state);
    if (!record) return null;
    this.pending.delete(state);
    return record.expiresAt > this.now() ? record : null;
  }

  get size(): number {
    return this.pending.size;
  }

  private sweep(): void {
    const at = this.now();
    for (const [state, record] of this.pending) if (record.expiresAt <= at) this.pending.delete(state);
  }
}

/** A correlation id for a sign-in attempt, for logs. Never a secret. */
export function signInAttemptId(): string {
  return randomUUID();
}
