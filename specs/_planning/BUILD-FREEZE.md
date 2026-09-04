# Build freeze — end-to-end completion, 2026-09-03

> **HISTORICAL COORDINATION SNAPSHOT — DO NOT IMPLEMENT AS CURRENT AUTHORITY.** R5 is decided,
> A-STATE was superseded by stored authoritative axes, and D18 extends A-TENANT with active workspace,
> projection version and revocation purge. Use `CLAUDE.md`, `docs/23`, `docs/25`, current feature specs
> and `specs/REMAINING-WORK.md`. The frozen shapes below explain the 2026-09-03 build only.

Frozen boundaries for the parallel completion of the local end-to-end build (app → HTTP API →
PostgreSQL). Every agent working this pass reads this file first and stays inside its lane.

CLAUDE.md's rule set is unchanged and still governs. This file only settles *who owns which file*
and *what shape the shared things have*, so five workstreams can run at once without re-litigating
the same decision in five places.

## Assumptions taken to unblock (record, do not re-decide)

These are the "assume blockers" calls. Each is written into `docs/08-decisions.md` as an
ASSUMPTION pending Jay's confirmation, and each is reversible in one named place.

| ID | Blocker | Assumption taken | Reversible at |
|---|---|---|---|
| **A-R5** | R5 — global vs office-scoped administrator | `OfficeAdmin` is **office-scoped**; `SystemOwner` is **global**; `ReportReader` is office-scoped and read-only. A role row with `office IS NULL` means global. | `app_user_role.office` + `server/src/auth/authorize.ts` |
| **A-R6** | R6 — Azure subscription, region, Entra registration | Not required locally. Identity is a **provider interface** with a `dev` implementation; the OIDC implementation is written against the same interface and selected by `AMS_AUTH=oidc`. No Azure resource is created and no cost is incurred. | `server/src/auth/providers/` |
| **A-DOC** | WS-W7 — private Blob Storage | Documents go through a `DocumentStore` interface. Local implementation writes to `server/data/documents/` (gitignored) with the same private-by-default, hash-verified, metadata-in-PostgreSQL contract. Azure Blob is a second implementation of the same interface. | `server/src/documents/` |
| **A-PG** | PostgreSQL major | 17 (already recorded as D-2026-09-03-PG). | `docker-compose.yml` |
| **A-STATE** | Four-axis state (R1 approved) vs single `status` in the POC schema | The **`asset.status` column stays** as the operational value the screens already use, and the four approved axes are added as **generated/derived columns plus a view**, not a rewrite. `REMAINING-WORK.md` explicitly permits the single status until HTTP cutover; deriving rather than replacing keeps 416 green tests green and satisfies rule 9's separation. | `db/migrations/` |
| **A-TENANT** | Offline cache partition needs tenant + environment + user object ID | Locally: tenant `englobe.local`, environment from `import.meta.env.MODE`, object ID from `/api/me`. | `app/src/offline/partition.ts` |

## Frozen shared shapes

### Identity tables (owned by Agent 1, consumed by Agent 2)

```sql
CREATE TABLE app_user (
  upn          text PRIMARY KEY,
  object_id    text UNIQUE NOT NULL,     -- Entra objectId; the stable identity key (WS-W3)
  tenant_id    text NOT NULL,
  display_name text NOT NULL,
  homeoffice   text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user_role (
  upn    text NOT NULL REFERENCES app_user(upn) ON DELETE CASCADE,
  role   text NOT NULL CHECK (role IN ('FieldUser','OfficeAdmin','SystemOwner','ReportReader')),
  office text                            -- NULL = global scope; non-NULL = that office only
);
CREATE UNIQUE INDEX app_user_role_uniq ON app_user_role (upn, role, COALESCE(office, '*'));
```

Seeded from `DEMO_USERS` so existing tests keep passing.

### `CurrentUser` (frozen — do not change shape)

`packages/contracts` owns it. `roles` gains `"ReportReader"`. Two **optional** fields are added
and every existing construction site stays valid without them:

```ts
export interface CurrentUser {
  upn: string;
  displayName: string;
  homeoffice: string | null;
  roles: Array<"FieldUser" | "OfficeAdmin" | "SystemOwner" | "ReportReader">;
  objectId?: string;
  scopedOffices?: string[] | null;   // null/undefined = global
}
```

### Route module contract

Every route module exports `register<Name>Routes(app: FastifyInstance, ctx: AppContext): void`.
`server/src/app.ts` is **owned by the integrator only**; it is already wired to every module
below, including the ones that are still stubs. Fill in your own file; never edit `app.ts`.

## File ownership — do not write outside your lane

| Agent | Owns (exclusive write access) |
|---|---|
| **1 — DB** | `db/**`, `server/src/db/**`, `server/tests/schema.test.ts`, `server/tests/migrations.test.ts` |
| **2 — Auth** | `server/src/auth/**`, `server/src/routes/session.ts`, `server/src/routes/read.ts`, `server/src/routes/commands.ts`, `server/tests/authorization.test.ts` |
| **3 — PWA** | `app/public/**`, `app/src/offline/**`, `app/src/sw.ts`, `app/index.html`, `app/vite.config.ts`, `app/src/main.tsx`, `app/tests/offline/**` |
| **4 — Reports** | `server/src/services/reportService.ts`, `server/src/routes/reports.ts`, `server/tests/reports.test.ts`, `app/src/features/reports/**` |
| **5 — Outbox+docs** | `server/src/outbox/**`, `server/src/documents/**`, `server/src/routes/documents.ts`, `server/tests/outbox.test.ts`, `server/tests/documents.test.ts` |
| **Integrator** | `server/src/app.ts`, `server/src/main.ts`, `server/src/config.ts`, `packages/**`, root `package.json`, `app/src/api/**`, `docs/**`, `specs/**`, `server/package.json` |

Shared read access is unrestricted — read anything, write only your lane.

## Non-negotiables that apply to every lane

- `npm run typecheck` and the full test suite stay green. A lane that cannot land green says so.
- No lane weakens an existing test to make a new one pass.
- No credentials, no synthetic data in a production path, no browser-owned authority.
- Every deviation from a spec is recorded in `docs/08-decisions.md`.
