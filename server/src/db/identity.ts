/**
 * Development identities, written into `app_user` / `app_user_role`.
 *
 * `server/src/auth/devAuth.ts` holds the demo users and resolves one from an `x-ams-dev-user`
 * header. That map is the development identity PROVIDER — the local stand-in for an Entra
 * sign-in. It is deliberately not the authorization store: CLAUDE.md rule 1 says the browser owns
 * no business authority including its own role, and that is only true if the role lookup has a
 * server-side home that outlives the provider being swapped. `db/migrations/0002_identity.sql`
 * builds that home; this file populates it; `server/src/auth/directory.ts` reads it.
 *
 * DEMO_USERS stays the single source of truth for who the demo users ARE — including their
 * `objectId` and `tenantId`, which that module already derives. Nothing is re-derived here, and
 * that matters more than it looks: `directory.ts` keys its lookup on `object_id` FIRST, so an
 * object id invented here that differed from the provider's by one character would make every
 * database lookup miss and every request quietly fall through to the demo fallback. The rows
 * would exist, the tests would pass, and the identity tables would be decorative.
 *
 * WHAT THIS FILE ADDS is the one thing a `DemoUser` has no field for: OFFICE SCOPE, per
 * BUILD-FREEZE.md assumption A-R5.
 *
 *   SystemOwner              office NULL — global, by definition.
 *   OfficeAdmin,             office = the user's home office.
 *   ReportReader,
 *   FieldUser
 *
 * FieldUser is scoped rather than global, which A-R5 does not spell out, and the reason is
 * `directory.ts`'s fold: ANY role row with `office IS NULL` makes the whole principal global.
 * Give a demo administrator a global FieldUser row and their OfficeAdmin scope evaporates —
 * `toronto-admin` would be admitted at Ottawa's border, which is the exact case WS-W3's matrix
 * exists to refuse. Scoping every non-owner role to the home office also makes the database
 * answer byte-identical to `demoDirectoryRecord`'s fallback, so authorization behaves the same
 * whether the tables are present or not. That equivalence is the property worth protecting.
 *
 * KNOWN GAP: a demo user with `homeoffice === null` and no SystemOwner role cannot be expressed —
 * a NULL office means global, not "scoped to nothing". No demo identity is in that position; if
 * one ever is, `app_user_role` needs an explicit scope discriminator rather than an overloaded
 * NULL.
 *
 * PRODUCTION REFUSES THIS. Demo identities are fixtures, and this fixture hands out roles — the
 * same class of mistake as synthetic asset data reaching production (CLAUDE.md rule 12). It skips
 * rather than throws, because a production start-up should proceed against the real identity
 * store, not fail.
 */
import { DEMO_USERS } from "../auth/devAuth";
import { resolveEnvironment, type Database, type Tx } from "./database";

/**
 * A-R5 as a function rather than a comment. Typed on plain strings so this module does not depend
 * on the auth lane's `AppRole` union; `app_user_role`'s CHECK constraint is what actually bounds
 * the vocabulary.
 */
export function officeScopeFor(role: string, homeoffice: string | null): string | null {
  return role === "SystemOwner" ? null : homeoffice;
}

export interface DevIdentityRow {
  /** The `x-ams-dev-user` header value this identity answers to. */
  key: string;
  upn: string;
  objectId: string;
  tenantId: string;
  displayName: string;
  homeoffice: string | null;
  roles: Array<{ role: string; office: string | null }>;
}

/** The rows DEMO_USERS implies. Pure, so the projection can be asserted without a database and
 * the auth lane can read the expected shape without running a seed. */
export function devIdentityRows(): DevIdentityRow[] {
  return Object.entries(DEMO_USERS).map(([key, user]) => ({
    key,
    upn: user.upn,
    objectId: user.objectId,
    tenantId: user.tenantId,
    displayName: user.displayName,
    homeoffice: user.homeoffice,
    roles: user.roles.map((role) => ({ role: role as string, office: officeScopeFor(role, user.homeoffice) })),
  }));
}

export interface IdentitySeedResult {
  seeded: boolean;
  /** Why not, when `seeded` is false. */
  reason?: string;
  users: number;
  roles: number;
}

/**
 * Idempotent upsert, run on every start-up rather than only on a dataset reload — identity is not
 * dataset data. A server restarted against an already-seeded database still needs its users, and
 * `--reseed` must not be the only way to get them.
 *
 * Roles are replaced wholesale per user instead of merged, so removing a role from DEMO_USERS
 * actually removes it. A merge would leave a revoked role in place, which is the wrong direction
 * for an authorization store to fail in.
 */
export async function seedDevIdentities(db: Database): Promise<IdentitySeedResult> {
  const environment = resolveEnvironment();
  if (environment === "production" || environment === "prod") {
    return { seeded: false, reason: `refusing demo identities in environment "${environment}"`, users: 0, roles: 0 };
  }

  const rows = devIdentityRows();
  let roles = 0;

  await db.transaction(async (tx: Tx) => {
    for (const row of rows) {
      await tx.query(
        `INSERT INTO app_user (upn, object_id, tenant_id, display_name, homeoffice, is_active)
              VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (upn) DO UPDATE
                 SET object_id = EXCLUDED.object_id, tenant_id = EXCLUDED.tenant_id,
                     display_name = EXCLUDED.display_name, homeoffice = EXCLUDED.homeoffice,
                     is_active = true, updated_at = now()`,
        [row.upn, row.objectId, row.tenantId, row.displayName, row.homeoffice]
      );
      await tx.query("DELETE FROM app_user_role WHERE upn = $1", [row.upn]);
      for (const { role, office } of row.roles) {
        await tx.query("INSERT INTO app_user_role (upn, role, office) VALUES ($1, $2, $3)", [row.upn, role, office]);
        roles += 1;
      }
    }
  });

  return { seeded: true, users: rows.length, roles };
}
