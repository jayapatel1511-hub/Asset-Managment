/**
 * Who the caller *is* comes from the identity provider. What the caller may *do* comes from
 * here, and only from here.
 *
 * That separation is the point. Entra can prove a person works at Englobe; it cannot know that
 * they administer Sudbury, and rule 1 forbids asking the browser. So the roles and the office
 * scope are read from `app_user` / `app_user_role` — the tables frozen in
 * BUILD-FREEZE.md § "Identity tables" and owned by the database lane — keyed on the Entra
 * objectId, with the UPN as a secondary key because a UPN can be renamed and an objectId cannot.
 *
 * Two behaviours worth knowing about:
 *
 *   - **The tables may not exist yet.** When the query comes back "relation does not exist", this
 *     records the fact and stops asking, and — *under the development provider only* — falls back
 *     to `DEMO_USERS`. That is what kept this lane independently testable while the database lane
 *     was still creating the tables, and it is why the existing suite behaves identically with or
 *     without them. Under OIDC there is no fallback: see `LookupOptions` for why that asymmetry
 *     is a security property rather than an inconsistency.
 *   - **An authenticated stranger gets nothing.** A principal Entra vouches for who has no
 *     `app_user` row resolves to zero roles — every guard refuses them, `/api/auth/session`
 *     answers honestly, and an administrator provisions them. Authentication is not
 *     authorization; a tenant is not an allow-list.
 *
 * A short cache sits in front of the query because otherwise every request pays a round trip for
 * a value that changes when an administrator edits it, which is rarely. `is_active` is inside the
 * cache, so a disabled account keeps working for at most `ttlMs` — 10 seconds by default, and
 * `invalidateDirectory()` is called on sign-out and available to an administrative command.
 */
import type { Queryable } from "../db/database";
import { DEMO_USERS, type DemoUser } from "./devAuth";
import { type AppRole, isAppRole } from "./roles";

export interface DirectoryRecord {
  upn: string;
  objectId: string | null;
  tenantId: string | null;
  displayName: string;
  homeoffice: string | null;
  isActive: boolean;
  roles: AppRole[];
  /** `null` = global. Derived from `app_user_role.office IS NULL` per A-R5. */
  scopedOffices: string[] | null;
  source: "database" | "demo";
}

export interface DirectoryKey {
  objectId?: string | null;
  upn?: string | null;
}

interface UserRoleRow {
  upn: string;
  object_id: string | null;
  tenant_id: string | null;
  display_name: string | null;
  homeoffice: string | null;
  is_active: boolean | null;
  role: string | null;
  office: string | null;
}

const LOOKUP_SQL = `
  SELECT u.upn, u.object_id, u.tenant_id, u.display_name, u.homeoffice, u.is_active,
         r.role, r.office
    FROM app_user u
    LEFT JOIN app_user_role r ON r.upn = u.upn
   WHERE ($1::text IS NOT NULL AND u.object_id = $1)
      OR ($2::text IS NOT NULL AND lower(u.upn) = lower($2))
`;

let cacheTtlMs = 10_000;
const cache = new Map<string, { at: number; record: DirectoryRecord | null }>();
/** Databases whose identity tables are absent. Per handle, so a test database that has them is
 * not tarred with a production database that does not. */
const withoutIdentityTables = new WeakSet<object>();

export function configureDirectory(options: { ttlMs?: number }): void {
  if (options.ttlMs !== undefined) cacheTtlMs = Math.max(0, options.ttlMs);
}

export function invalidateDirectory(): void {
  cache.clear();
}

/** True when the identity tables have already been found missing on this handle. */
export function identityTablesMissing(db: object | null): boolean {
  return db ? withoutIdentityTables.has(db) : true;
}

function cacheKey(key: DirectoryKey): string {
  return `${key.objectId ?? ""}|${(key.upn ?? "").toLowerCase()}`;
}

/** PostgreSQL 42P01 = undefined_table. PGlite reports the same SQLSTATE; the message check is
 * the belt for a driver that does not surface `code`. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01") return true;
  return /relation .*app_user.* does not exist|no such table/i.test(e.message ?? "");
}

function foldRows(rows: UserRoleRow[]): DirectoryRecord | null {
  const first = rows[0];
  if (!first) return null;

  const roles: AppRole[] = [];
  const offices: string[] = [];
  let global = false;
  for (const row of rows) {
    if (!row.role) continue;
    if (!isAppRole(row.role)) continue; // a role the CHECK constraint allows but this build does not know
    if (!roles.includes(row.role)) roles.push(row.role);
    // A-R5: office IS NULL on a role row means that role is held globally.
    if (row.office === null || row.office === undefined) global = true;
    else if (!offices.includes(row.office)) offices.push(row.office);
  }

  return {
    upn: first.upn,
    objectId: first.object_id ?? null,
    tenantId: first.tenant_id ?? null,
    displayName: first.display_name ?? first.upn,
    homeoffice: first.homeoffice ?? null,
    // Absent or NULL is read as active; only an explicit false disables.
    isActive: first.is_active !== false,
    roles,
    scopedOffices: global ? null : offices.length ? offices : first.homeoffice ? [first.homeoffice] : [],
    source: "database",
  };
}

/** The `DEMO_USERS` fallback, shaped like a directory row. SystemOwner is global (A-R5); every
 * other demo identity is scoped to its home office. */
export function demoDirectoryRecord(key: DirectoryKey): DirectoryRecord | null {
  const upn = (key.upn ?? "").toLowerCase();
  const demo: DemoUser | undefined = Object.values(DEMO_USERS).find(
    (u) => u.upn.toLowerCase() === upn || (key.objectId != null && u.objectId === key.objectId)
  );
  if (!demo) return null;
  const global = demo.roles.includes("SystemOwner");
  return {
    upn: demo.upn,
    objectId: demo.objectId,
    tenantId: demo.tenantId,
    displayName: demo.displayName,
    homeoffice: demo.homeoffice,
    isActive: true,
    roles: [...demo.roles],
    scopedOffices: global ? null : demo.homeoffice ? [demo.homeoffice] : [],
    source: "demo",
  };
}

export interface LookupOptions {
  /**
   * Whether a miss may resolve to `DEMO_USERS`.
   *
   * True only under the development identity provider. Under OIDC it must be false, and the
   * reason is not hypothetical: `admin@englobecorp.com` is a plausible real Entra UPN, and a
   * fallback that matched it would hand a genuine employee the demo administrator's roles the
   * first time the identity tables were unavailable. Under OIDC a missing row means no roles.
   */
  allowDemoFallback: boolean;
}

/**
 * Resolves roles and office scope for a principal. `null` means "authenticated, but not a user of
 * this system" — the guards turn that into a 403, never into a default role.
 */
export async function lookupDirectoryUser(
  db: Queryable | null,
  key: DirectoryKey,
  options: LookupOptions
): Promise<DirectoryRecord | null> {
  if (!key.objectId && !key.upn) return null;

  const ck = `${options.allowDemoFallback ? "d" : "s"}:${cacheKey(key)}`;
  const cached = cache.get(ck);
  if (cached && Date.now() - cached.at < cacheTtlMs) return cached.record;

  let record: DirectoryRecord | null = null;
  if (db && !withoutIdentityTables.has(db as object)) {
    try {
      const res = await db.query<UserRoleRow>(LOOKUP_SQL, [key.objectId ?? null, key.upn ?? null]);
      record = foldRows(res.rows);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      withoutIdentityTables.add(db as object);
    }
  }

  // No row — or no table. Under the dev provider, fall back to the demo directory so this lane is
  // never blocked on another lane's migration and the existing suite behaves exactly as it did.
  if (!record && options.allowDemoFallback) record = demoDirectoryRecord(key);

  cache.set(ck, { at: Date.now(), record });
  return record;
}
