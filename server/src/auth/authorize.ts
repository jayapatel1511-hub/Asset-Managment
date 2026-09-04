/**
 * The guards. Every protected route names one, at the route boundary, in the route file — so the
 * authorization matrix can be read off `routes/read.ts` and `routes/commands.ts` rather than
 * reconstructed from behaviour.
 *
 * Three things this file is careful about.
 *
 * **It never reads the request body, query or headers for identity.** Not the role, not the
 * office, not the user id. Everything it decides with comes from `authOf(req)`, which
 * `auth/identity.ts` built from a session or a provider. CLAUDE.md rule 1 is only true if it is
 * true at every call site, and the way to make it true at every call site is to give the call
 * sites nothing else to reach for.
 *
 * **Refusals are structured and boring.** A code the client can branch on, a message a developer
 * can act on, and nothing that discloses what the caller was not allowed to know — no "asset
 * ATL0042 belongs to Toronto", because that sentence answers the question the attacker asked.
 *
 * **The order is authenticated → enabled → role → scope.** An unauthenticated caller gets 401 and
 * learns nothing about roles; a disabled account gets 403 and learns nothing about scope. Each
 * step only runs once the previous one has passed, so the errors do not leak the shape of the
 * next check.
 *
 * Status codes: 401 means "you have not proved who you are"; 403 means "you have, and it is not
 * enough". A 404 appears in one place only — `routes/read.ts` returns it for a row outside an
 * office-scoped reader's scope, because a 403 there would confirm the row exists.
 */
import type { FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import { ADMIN_ROLES, ALL_ROLES, WRITE_ROLES, authOf, hasAnyRole, scopeCovers, type AppRole, type AuthUser } from "./roles";

export interface RefusalBody {
  error: string;
  message: string;
  /** The roles that would have been accepted. Present only on a role refusal, and safe: it
   * describes this endpoint, not this caller. */
  requiredRoles?: readonly AppRole[];
  correlationId?: string;
}

function send(reply: FastifyReply, status: number, body: Omit<RefusalBody, "correlationId">): FastifyReply {
  return reply.code(status).send({ ...body, correlationId: reply.request.id });
}

export function refuseUnauthenticated(reply: FastifyReply): FastifyReply {
  return send(reply, 401, {
    error: "unauthenticated",
    message: "This endpoint requires an authenticated caller. Sign in at /api/auth/sign-in.",
  });
}

export function refuseDisabled(reply: FastifyReply): FastifyReply {
  return send(reply, 403, {
    error: "account_disabled",
    message: "This account is deactivated in the asset management system. Contact the system owner.",
  });
}

export function refuseRole(reply: FastifyReply, required: readonly AppRole[]): FastifyReply {
  return send(reply, 403, {
    error: "forbidden_role",
    message: "This account does not hold a role that permits this operation.",
    requiredRoles: required,
  });
}

export function refuseOffice(reply: FastifyReply, office: string): FastifyReply {
  return send(reply, 403, {
    error: "forbidden_office",
    message: `This account is not scoped to administer ${office}.`,
  });
}

/**
 * The common prefix of every guard: is there a caller, and are they still allowed to exist?
 * Returns the principal, or null having already sent the refusal.
 */
export function requireAuthenticated(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = authOf(req);
  if (!user.authenticated) {
    refuseUnauthenticated(reply);
    return null;
  }
  if (user.disabled) {
    refuseDisabled(reply);
    return null;
  }
  return user;
}

/**
 * A route-level guard requiring one of `roles`.
 *
 * Returned as a `RouteShorthandOptions` rather than a bare function so the route reads
 * `app.get(url, requireRole("OfficeAdmin"), handler)` — the guard sits between the path and the
 * handler, where it is impossible to miss while reading.
 */
export function requireRole(...roles: AppRole[]): RouteShorthandOptions {
  const required: readonly AppRole[] = roles.length ? roles : ALL_ROLES;
  return {
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
      const user = requireAuthenticated(req, reply);
      if (!user) return reply;
      if (!hasAnyRole(user, required)) return refuseRole(reply, required);
      return undefined;
    },
  };
}

/** Any authenticated, enabled caller — the read floor. Written as a role list rather than a bare
 * authentication check so that adding a fifth role forces a decision here. */
export const requireAnyRole = (): RouteShorthandOptions => requireRole(...ALL_ROLES);

/** A command endpoint. ReportReader is refused: read-only is enforced, not merely documented. */
export const requireWriteAccess = (): RouteShorthandOptions => requireRole(...WRITE_ROLES);

/** An administrative endpoint. Office scope is a *separate* check — see `requireOfficeScope`. */
export const requireAdminRole = (): RouteShorthandOptions => requireRole(...ADMIN_ROLES);

/**
 * Resolves the office an administrative request targets. Returning `null` means "this request
 * does not name a *known* office", which is handled below.
 */
export type OfficeResolver = (req: FastifyRequest) => Promise<string | null> | string | null;

/**
 * Office-scope enforcement for an administrative operation (A-R5): the caller must be global, or
 * scoped to the office the request targets.
 *
 * One subtlety that is easy to get wrong in the other direction. A resolver returns `null` when
 * the request names something that is not an office at all — "Vancouver", when Englobe has no
 * Vancouver office. That is a *validation* answer, not an authorization one, and it is passed
 * through to the command so the caller is told "not a known office" rather than "forbidden".
 * Refusing it here would be worse on both counts: it would hide a typo behind a permissions
 * error, and it would still disclose nothing an attacker could not learn by enumerating the
 * public office list. Authorization applies to offices that exist.
 */
export function requireOfficeScope(resolve: OfficeResolver): RouteShorthandOptions {
  return {
    preHandler: async (req: FastifyRequest, reply: FastifyReply) => {
      const user = requireAuthenticated(req, reply);
      if (!user) return reply;
      const office = await resolve(req);
      if (office === null) return undefined; // not a known office — the command answers
      if (!scopeCovers(user, office)) return refuseOffice(reply, office);
      return undefined;
    },
  };
}

/** Composes several `RouteShorthandOptions` guards into one, preserving order. */
export function guards(...options: RouteShorthandOptions[]): RouteShorthandOptions {
  const handlers = options.flatMap((o) => (Array.isArray(o.preHandler) ? o.preHandler : o.preHandler ? [o.preHandler] : []));
  return { preHandler: handlers };
}
