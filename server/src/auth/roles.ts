/**
 * The vocabulary of authorization: the four application roles, the principal every route sees,
 * and the office-scope predicates that decide what that principal may read or administer.
 *
 * Why this file exists at all, rather than a `role` string on the request: CLAUDE.md rule 1 says
 * the browser owns no business authority. That is easy to say and easy to lose — one route that
 * reads `req.body.role` and the whole guarantee is gone. Keeping the principal in one frozen
 * shape, built only by `auth/identity.ts` from a session or a provider, means there is exactly
 * one place a role can come from, and it is never the request body.
 *
 * A-R5 (specs/_planning/BUILD-FREEZE.md), assumed and pending Jay's confirmation:
 *
 *   SystemOwner   global. `app_user_role.office IS NULL` is what "global" looks like in the row.
 *   OfficeAdmin   office-scoped. Administers only the offices its role rows name.
 *   ReportReader  office-scoped, read-only. Sees rows for its offices and issues no commands.
 *   FieldUser     office-scoped.
 *
 * What "office-scoped" is *taken to mean* here needs saying out loud, because A-R5 settled the
 * scope of the administrator and not the scope of the fleet:
 *
 *   - **Administration** is scoped hard. An Ottawa OfficeAdmin cannot administer Toronto: 403.
 *   - **Restricted SIM/network fields** are scoped hard. FR-030 already withholds ICCID, phone
 *     and static IP from non-administrators; office scope narrows it further, so an Ottawa
 *     administrator reads Ottawa's SIM credentials and not Toronto's. Guessing a Toronto asset
 *     id therefore gains an attacker nothing.
 *   - **Fleet visibility** is *not* scoped for FieldUser and OfficeAdmin. A technician in Ottawa
 *     must be able to look up the logger that arrived from Toronto this morning — that is the
 *     whole point of a transfer, and refusing the lookup would make the transfer workflow
 *     unusable. ReportReader, which exists to read and nothing else, *is* row-scoped.
 *
 * The third bullet is a policy call inside A-R5 rather than a consequence of it, and it is
 * flagged for Jay rather than buried: reversing it means changing `scopeRestrictedFields` /
 * `scopeAssetRows` in routes/read.ts, not the whole model.
 */
import type { FastifyRequest } from "fastify";
import type { CurrentUser } from "../../../app/src/api/types";

export const APP_ROLES = ["FieldUser", "OfficeAdmin", "SystemOwner", "ReportReader"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Roles that may issue a command. ReportReader is deliberately absent — read-only means it. */
export const WRITE_ROLES: readonly AppRole[] = ["FieldUser", "OfficeAdmin", "SystemOwner"];
/** Roles that administer an office (assign administrators, and read restricted fields). */
export const ADMIN_ROLES: readonly AppRole[] = ["OfficeAdmin", "SystemOwner"];
/** Every role — "any authenticated principal", written so a new role cannot silently bypass. */
export const ALL_ROLES: readonly AppRole[] = APP_ROLES;

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** How the principal was established. Only "cookie" carries ambient browser credentials, which
 * is precisely the condition CSRF protection exists for — see routes/session.ts. */
export type AuthVia = "anonymous" | "header" | "cookie";

/**
 * The authenticated principal: the frozen `CurrentUser` from BUILD-FREEZE.md, plus the facts only
 * the server ever needs. It extends the contract rather than paralleling it, so `req.user` is
 * literally this object and there is no conversion step to get wrong.
 *
 * The additions are all things the browser must never be told or be able to assert: which tenant
 * the token came from, whether the account is disabled, how the request authenticated (which
 * decides whether CSRF applies), and the session it belongs to.
 */
export interface AuthUser extends CurrentUser {
  roles: AppRole[];
  /** Entra objectId — the stable identity key (WS-W3). Synthetic under the dev provider. */
  objectId?: string;
  tenantId: string | null;
  /** Offices this principal is scoped to. `null` means global (SystemOwner). Required here,
   * optional on the wire: the server always knows the answer, the browser may not have been told. */
  scopedOffices: string[] | null;
  authenticated: boolean;
  /** `app_user.is_active = false`. Authenticated by the IdP, refused by us. */
  disabled: boolean;
  via: AuthVia;
  sessionId: string | null;
  /** Stable per-identity fingerprint the client compares to detect a same-device user change. */
  identityKey: string | null;
}

/** The principal for a request that carried no identity at all. Frozen: it is shared. */
export const ANONYMOUS: AuthUser = Object.freeze({
  upn: "",
  displayName: "Anonymous",
  homeoffice: null,
  roles: Object.freeze([]) as unknown as AppRole[],
  tenantId: null,
  scopedOffices: Object.freeze([]) as unknown as string[],
  authenticated: false,
  disabled: false,
  via: "anonymous",
  sessionId: null,
  identityKey: null,
});

/** Widening, not conversion: `AuthUser` *is* a `CurrentUser`. Named so the call sites read as
 * "hand this to app.ts's contract" rather than as an incidental assignment. */
export function toCurrentUser(user: AuthUser): CurrentUser {
  return user;
}

/**
 * Recovers the full principal `resolveUser` put on the request.
 *
 * `app.ts` declares `req.user: CurrentUser`, which is the narrower public contract, so this
 * narrows back down — guarded, because a request that somehow reached a route without the
 * onRequest hook must resolve to *no* authority rather than to a partially-built object.
 */
export function authOf(req: Pick<FastifyRequest, "user">): AuthUser {
  const user = req.user as Partial<AuthUser> | undefined;
  return user && typeof user === "object" && typeof user.authenticated === "boolean" ? (user as AuthUser) : ANONYMOUS;
}

/**
 * The `/api/me` wire shape — exactly BUILD-FREEZE.md's frozen `CurrentUser`, nothing more.
 * `tenantId`, `sessionId`, `via` and `disabled` are server-side facts and stay server-side.
 */
export function publicUser(user: AuthUser): CurrentUser {
  return {
    upn: user.upn,
    displayName: user.displayName,
    homeoffice: user.homeoffice,
    roles: user.roles,
    ...(user.objectId ? { objectId: user.objectId } : {}),
    scopedOffices: user.scopedOffices,
  };
}

export function hasAnyRole(user: AuthUser, roles: readonly AppRole[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

/** SystemOwner, or any principal whose role rows carry `office IS NULL`. */
export function isGlobalScope(user: AuthUser): boolean {
  return user.scopedOffices === null;
}

/**
 * Does this principal's office scope cover `office`?
 *
 * An unknown office (null/blank — an asset with no home office recorded) is covered only by a
 * global principal. Conservative on purpose: "we do not know which office owns this" must not
 * resolve to "therefore everyone owns it".
 */
export function scopeCovers(user: AuthUser, office: string | null | undefined): boolean {
  if (!user.authenticated || user.disabled) return false;
  if (isGlobalScope(user)) return true;
  const target = (office ?? "").trim();
  if (!target) return false;
  return (user.scopedOffices ?? []).some((o) => o.toLowerCase() === target.toLowerCase());
}

/**
 * FR-030 plus office scope: ICCID, phone number and static IP are released only to an
 * administrator of the office that owns the asset. Rule 10 — field users never receive or cache
 * restricted SIM/network fields — is the floor, not the ceiling.
 */
export function canReadRestrictedFields(user: AuthUser, office: string | null | undefined): boolean {
  return hasAnyRole(user, ADMIN_ROLES) && scopeCovers(user, office);
}

/** A read-only principal: it holds ReportReader and nothing that can write. */
export function isReadOnly(user: AuthUser): boolean {
  return user.roles.length > 0 && !hasAnyRole(user, WRITE_ROLES);
}

/**
 * Should this principal's *rows* be filtered to its office scope?
 *
 * True only for the office-scoped read-only role. See the header: field and administrative users
 * keep national fleet visibility because the transfer workflow depends on it; ReportReader has no
 * operational reason to see another office's inventory, so it does not.
 */
export function rowsAreScoped(user: AuthUser): boolean {
  return isReadOnly(user) && !isGlobalScope(user);
}

/** The office that owns an asset for scope purposes. Custody moves; the home office is the owner. */
export function owningOffice(asset: { homeoffice?: string | null; currentlocation?: string | null }): string | null {
  return asset.homeoffice ?? null;
}
