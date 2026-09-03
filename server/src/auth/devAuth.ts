/**
 * Development identity — the local stand-in for Microsoft Entra sign-in.
 *
 * The browser names one of three demo identities in an `x-ams-dev-user` header (the http
 * adapter sends whatever the existing RoleSwitcher stored); the server resolves it to a
 * CurrentUser and never trusts anything else the client says about who it is or what role it
 * holds (server/README.md § Identity — the browser owns no authority; only the header-to-user
 * mapping is a dev shortcut).
 *
 * Replacing this with Entra (OIDC + BFF session cookie) changes only this file: routes and
 * services receive a CurrentUser either way.
 */
import type { CurrentUser } from "../../../app/src/api/types";

export const DEMO_USERS: Record<string, CurrentUser> = {
  field: { upn: "tech@englobecorp.com", displayName: "Sam Tech (demo Field User)", homeoffice: "Ottawa", roles: ["FieldUser"] },
  admin: { upn: "admin@englobecorp.com", displayName: "Alex Admin (demo Office Admin)", homeoffice: "Ottawa", roles: ["FieldUser", "OfficeAdmin"] },
  owner: { upn: "svc-ams@englobecorp.com", displayName: "System Owner (demo)", homeoffice: "Ottawa", roles: ["FieldUser", "OfficeAdmin", "SystemOwner"] },
};

export const DEV_USER_HEADER = "x-ams-dev-user";

export function resolveDevUser(headerValue: string | string[] | undefined): CurrentUser {
  const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return DEMO_USERS[key ?? ""] ?? DEMO_USERS.field;
}

export function isAdminUser(user: CurrentUser): boolean {
  return user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner");
}
