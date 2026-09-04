-- 0002 — identity: who the caller is, and what they are allowed to be.
--
-- The shape here is FROZEN by specs/_planning/BUILD-FREEZE.md § "Identity tables". Agent 2's
-- authorization layer reads these two tables; changing a column name here is a cross-lane break,
-- not a local edit. Add a new migration if the shape must grow.
--
-- Why the database owns this at all, when `server/src/auth/devAuth.ts` already has a hard-coded
-- map of three demo users: because the map is the DEVELOPMENT identity provider, and the
-- authorization decision must not be. CLAUDE.md rule 1 — the browser owns no business authority,
-- including its own role — is only true if role lookup has a server-side home that survives the
-- provider being swapped for Entra (assumption A-R6). These tables are that home. When OIDC
-- replaces the dev header, `object_id` is the Entra objectId that was always the stable key and
-- `upn` becomes the mutable display handle it really is.
--
-- Scope model, assumption A-R5 (BUILD-FREEZE.md): `office IS NULL` means GLOBAL. `SystemOwner`
-- is global; `OfficeAdmin` and `ReportReader` are office-scoped. The unique index below is
-- written over COALESCE(office, '*') rather than over `office` directly because PostgreSQL's
-- ordinary unique index treats every NULL as distinct — without the coalesce, one user could
-- hold the same global role twice.

CREATE TABLE IF NOT EXISTS app_user (
  upn          text PRIMARY KEY,
  object_id    text UNIQUE NOT NULL,     -- Entra objectId; the stable identity key (WS-W3)
  tenant_id    text NOT NULL,
  display_name text NOT NULL,
  homeoffice   text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user_role (
  upn    text NOT NULL REFERENCES app_user(upn) ON DELETE CASCADE,
  role   text NOT NULL CHECK (role IN ('FieldUser','OfficeAdmin','SystemOwner','ReportReader')),
  office text                            -- NULL = global scope; non-NULL = that office only
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_role_uniq ON app_user_role (upn, role, COALESCE(office, '*'));

-- Resolving a caller goes through object_id once OIDC lands, so it gets the covering lookup the
-- UNIQUE constraint on the column already provides; this index is for the reverse direction —
-- "who administers Ottawa" — which the authorization layer asks on every office-scoped read.
CREATE INDEX IF NOT EXISTS app_user_role_office_idx ON app_user_role (office, role);

-- No rows are inserted here. Demo identities are DEVELOPMENT fixtures and belong nowhere near a
-- production migration (the same instinct as CLAUDE.md rule 12); `server/src/db/identity.ts`
-- seeds them at start-up from DEMO_USERS, and refuses to when the environment says production.
