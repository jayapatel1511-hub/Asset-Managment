/**
 * Development identity — the local stand-in for Microsoft Entra sign-in.
 *
 * The browser names one of the demo identities in an `x-ams-dev-user` header (the http adapter
 * sends whatever the existing RoleSwitcher stored); the server resolves it to a principal and
 * never trusts anything else the client says about who it is or what role it holds. Only the
 * header-to-user mapping is a dev shortcut — roles and office scope come from `auth/directory.ts`,
 * which reads `app_user` / `app_user_role`, exactly as they will under Entra.
 *
 * **This is not authentication and never becomes it.** `auth/settings.ts` refuses to select this
 * provider when NODE_ENV=production, and the server binds to loopback. Entra arrives by setting
 * `AMS_AUTH=oidc`; nothing outside `auth/` changes, which is the whole point of the provider
 * interface in `auth/providers/`.
 *
 * The three original identities are unchanged, down to their UPNs, because the existing suite
 * asserts on them. Three more were added for WS-W3's cross-role/cross-office matrix — a
 * read-only ReportReader, a Toronto administrator to be refused at Ottawa's border, and an
 * explicit "no identity at all" so the unauthenticated path can be exercised without standing up
 * an OIDC flow.
 */
import { createHash } from "node:crypto";
import type { CurrentUser } from "../../../app/src/api/types";
import type { AppRole } from "./roles";

/** The local tenant name from A-TENANT (BUILD-FREEZE.md) — the value the offline cache partitions
 * on, so the dev principal partitions the same way the Entra one will. */
export const DEV_TENANT_ID = "englobe.local";

/** A `CurrentUser` with the two identity fields made mandatory: a demo identity always has an
 * object id and a tenant, because those are what the Entra principal will carry and the dev
 * provider exists to be shaped exactly like it. */
export interface DemoUser extends CurrentUser {
  roles: AppRole[];
  objectId: string;
  tenantId: string;
}

/** A stable, obviously-fake object id. Stable so a session survives a restart's directory lookup;
 * obviously fake so it can never be mistaken for an Entra GUID in a log. */
function devObjectId(upn: string): string {
  return `dev-${createHash("sha256").update(upn).digest("hex").slice(0, 24)}`;
}

function demo(upn: string, displayName: string, homeoffice: string | null, roles: AppRole[]): DemoUser {
  return { upn, displayName, homeoffice, roles, objectId: devObjectId(upn), tenantId: DEV_TENANT_ID };
}

export const DEMO_USERS: Record<string, DemoUser> = {
  field: demo("tech@englobecorp.com", "Sam Tech (demo Field User)", "Ottawa", ["FieldUser"]),
  admin: demo("admin@englobecorp.com", "Alex Admin (demo Office Admin)", "Ottawa", ["FieldUser", "OfficeAdmin"]),
  owner: demo("svc-ams@englobecorp.com", "System Owner (demo)", "Ottawa", ["FieldUser", "OfficeAdmin", "SystemOwner"]),
  // ---- added for WS-W3; the three above are untouched ----
  reader: demo("reader@englobecorp.com", "Riya Reader (demo Report Reader)", "Ottawa", ["ReportReader"]),
  toronto: demo("toronto-admin@englobecorp.com", "Tomás Admin (demo Toronto Office Admin)", "Toronto", ["FieldUser", "OfficeAdmin"]),
};

export const DEV_USER_HEADER = "x-ams-dev-user";

/** Header values that mean "send this request with no identity at all", so the unauthenticated
 * refusal path is reachable from a test or a devtools console. */
const NO_IDENTITY = new Set(["anonymous", "none", ""]);

/**
 * Resolves the header to a demo identity.
 *
 * An unrecognised or absent header still resolves to the Field User, unchanged from the original
 * shortcut — every existing test depends on it, and a laptop with no header is a developer, not
 * an attacker. `anonymous` / `none` is the explicit opt-out.
 */
export function resolveDevUser(headerValue: string | string[] | undefined): DemoUser | null {
  const key = (Array.isArray(headerValue) ? headerValue[0] : headerValue)?.trim() ?? "";
  if (NO_IDENTITY.has(key.toLowerCase())) return null;
  return DEMO_USERS[key] ?? DEMO_USERS.field;
}

/**
 * FR-030's "is this an administrator" test, kept at this call site because
 * `services/readModel.ts` imports it and lives in another lane.
 *
 * The parameter is structural rather than `CurrentUser` so that both the frozen contract shape
 * and the wider `AuthUser` satisfy it. Note what it does *not* do: office scope. The read model
 * cannot apply scope because it is handed a user and an asset separately; `routes/read.ts`
 * narrows further, per office, on the way out.
 */
export function isAdminUser(user: { roles: readonly string[] }): boolean {
  return user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner");
}
