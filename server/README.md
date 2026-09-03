# server/ — the local TypeScript API

A full-stack proof of concept that needs no Microsoft tenant: the React app in `app/` talks over
HTTP to a Fastify API backed by **PGlite** — real PostgreSQL, compiled to WebAssembly, running
in this process — seeded from `migration/staged/` (1,026 real assets) or any synthetic profile.

It exists to answer one question that the mock backend could not: *does the design hold up with a
real network boundary and a real database between the screens and the data?* Everything the mock
did in memory now crosses a wire, gets validated a second time by a server that does not trust the
client, and commits inside a database transaction.

**This is not the production architecture.** Production is Dataverse plus Power Automate flows
(`CLAUDE.md`'s stack table). See § What maps to which Dataverse flow for how the two line up, and
§ Swapping in networked PostgreSQL if the premium-licensing fallback is ever taken.

---

## Run it

Both commands need the portable Node and the corporate CA cert (`specs/AGENT-BRIEF.md` §1). The
`/c/…` form for `PATH` and the `C:/…` form for `NODE_EXTRA_CA_CERTS` are both required and are not
interchangeable:

```bash
export PATH="/c/Files/Asset Managment/.tools/node-v22.14.0-win-x64:$PATH"
export NODE_EXTRA_CA_CERTS="C:/Files/Asset Managment/.tools/zscaler-root.pem"
```

Then, from `server/`:

```bash
node node_modules/tsx/dist/cli.mjs src/main.ts                  # serve on 127.0.0.1:3001
node node_modules/tsx/dist/cli.mjs src/main.ts --reseed         # discard local writes, reload the dataset
node node_modules/tsx/dist/cli.mjs src/main.ts --reseed --exit  # reload and stop (scripts, CI)
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit  # typecheck
node node_modules/vitest/vitest.mjs run                         # 64 tests
```

`npm run start` / `dev` / `reseed` / `typecheck` / `test` wrap the same commands, but npm lifecycle
scripts do not inherit the portable Node, so invoke `node.exe` directly when in doubt.

Preferred, from the Claude Code preview tool (`.claude/launch.json`) — start the API **first**, so
Vite has something to proxy to:

| Config | What it is | Port |
|---|---|---|
| `englobe-ams-api` | this server | 3001 |
| `englobe-ams-localapi` | Vite in `--mode localapi`, proxying `/api` → 3001 | 3200 |
| `englobe-ams-localapi-alt` | the same, for a concurrent session (3200 is `--strictPort`) | 3210 |

The app reaches the API through Vite's same-origin `/api` proxy (`app/vite.config.ts`), so there is
no CORS configuration and no absolute URL anywhere in the client. `app/.env.localapi` sets
`VITE_AMS_BACKEND=http`, which is the only thing that selects `app/src/api/http/` over the mock.

The server binds **loopback only** (`127.0.0.1`). It has no authentication worth the name — see
§ Identity — so it must not be exposed on a network interface.

---

## Dataset selection and reseeding

`AMS_DATASET` names a directory under `migration/`, using the same vocabulary as
`app/scripts/copy-staged-data.mjs`:

```bash
AMS_DATASET=staged            node .../src/main.ts   # the real migrated data (default)
AMS_DATASET=synthetic/demo    node .../src/main.ts   # feature 007's small fictional fleet
AMS_DATASET=synthetic/large   node .../src/main.ts   # 5,312 assets, 438,619 lines
```

Each dataset gets **its own database directory** under `server/data/` (gitignored), so switching
between real and synthetic never replays one dataset's writes onto the other — the same rule
`MockStore`'s `datasetKey` enforces in the browser.

Seeding is idempotent by dataset key: starting against an already-seeded database does nothing, so
a technician's own transactions survive a restart. `--reseed` forces a reload, which is the local
equivalent of the mock's "reset to the migrated snapshot". **`--reseed` is the only supported way
to change what is in `server/data/`.**

Feature 007 FR-056 carries over: a synthetic dataset whose `manifest.json` says `verified: false`
is refused outright, never loaded. A dataset with no manifest is treated as real — never the other
way round.

To point the *app* at a synthetic dataset as well (for the banner and the static-file mock), run
`node scripts/copy-staged-data.mjs --dataset synthetic/demo` from `app/`.

---

## Identity

`x-ams-dev-user` names one of three demo identities, which `src/auth/devAuth.ts` resolves to a
`CurrentUser`:

| Header | UPN | Roles |
|---|---|---|
| `field` (default) | `tech@englobecorp.com` | FieldUser |
| `admin` | `admin@englobecorp.com` | FieldUser, OfficeAdmin |
| `owner` | `svc-ams@englobecorp.com` | FieldUser, OfficeAdmin, SystemOwner |

The browser sends whatever the existing `RoleSwitcher` stored in `localStorage`. The server never
trusts anything else the client says about who it is or what role it holds — but a header is not
authentication, which is why this binds to loopback only.

**Replacing this with Entra changes only `src/auth/devAuth.ts`.** Routes and services receive a
`CurrentUser` either way. The real shape is OIDC plus a backend-for-frontend session cookie; the
header goes away and nothing else here changes.

Field security (FR-030) is enforced in the **read model**, not the routes and not the UI: a Field
User's response simply does not contain `identifiervalue` (ICCID), `phonenumber` or `staticip`, so
there is nothing for devtools, a copied URL or a CSV export to reveal.

---

## The refusal contract

The offline queue (`app/src/api/queue/`) has to tell "the server said no" apart from "the request
never arrived", because the first is an answer to show a technician and the second is something to
retry. So:

| Response | Meaning | What the queue does |
|---|---|---|
| `200 { ok: true, transactionId, transactionName }` | accepted | done |
| `200 { ok: false, reason, offendingAssetId? }` | **refused** — a business answer | marks it answered, shows the reason |
| `400` | malformed body (zod) | a client bug; retrying will not help |
| `4xx` / `5xx` | a real failure | keeps the submission and retries |

A refusal is deliberately **not** an HTTP error. A 422 would be defensible in the abstract, but
`app/src/api/http/index.ts` and the queue behind it treat any JSON body carrying `ok` as an answer,
and everything else as a transport failure — which is the distinction that actually matters here.
Recorded in `docs/08-decisions.md`.

Every request body is validated with zod at the route boundary, so no service function has to
defend against a missing field.

---

## Architecture

```
src/main.ts                        open the database, seed if needed, listen
src/app.ts                         build the Fastify instance (tests use this with app.inject())
src/config.ts                      AMS_DATASET / AMS_DATA_DIR / AMS_PORT / AMS_HOST
src/auth/devAuth.ts                the Entra stand-in
src/db/schema.sql                  the schema, idempotent, applied on every start
src/db/pglite.ts                   open the database; the Queryable interface services share
src/db/rows.ts                     row <-> app type mapping, in one file
src/db/seed.ts                     load a dataset directory, idempotent by dataset key
src/routes/read.ts                 one endpoint per AmsBackend read method
src/routes/commands.ts             one endpoint per write, zod-validated
src/services/readModel.ts          every read, with field security applied
src/services/transactionService.ts THE write path — applyTransaction and runCommand
src/services/commandService.ts     features 001/003/004 commands
src/services/deploymentService.ts  feature 005 commands, plus office-admin assignment
tests/                             64 tests over in-memory PGlite and the real migrated data
```

### Three invariants, and where they live

1. **Asset current state is derived, never assigned** (Principle I). `status`,
   `currentlocation`, `custodian`, `currentproject` and `parentasset` are written in exactly one
   place — `transactionService.applyTransaction` — and every value comes from
   `app/src/domain/deriveState.ts`, which is **imported, not copied**. No transition is
   reimplemented here. `lastcaldate` / `nextcaldue` are derived from calibration records instead,
   and are written by `recordCalibration`.

2. **History is append-only** (Principle II), enforced by the database itself:
   `BEFORE UPDATE OR DELETE` triggers on `asset_transaction` and `asset_transaction_line` raise.
   There is no UPDATE or DELETE against either table anywhere in `src/`, and a test proves the
   trigger fires. (`TRUNCATE`, used only by the seed loader when replacing a dataset wholesale,
   does not fire row triggers — which is exactly why `--reseed` works and a stray `DELETE` cannot.)

3. **Every write is one PostgreSQL transaction.** `runCommand` holds it across the whole command,
   so the composite ones — a Return that also reports a fault, a recovery that undeploys some
   components and marks others missing — are genuinely all-or-nothing. A refusal discovered after
   an earlier write is thrown as a typed `Refusal` to force the rollback and caught at the
   boundary; returning `{ ok: false }` out of a `db.transaction()` callback would **commit** what
   came before it.

### Idempotency

Per **command**, against `command_idempotency`, keyed on `clientSubmissionId` (FR-007): a replay
returns the stored response and writes nothing. Only *accepted* commands are recorded, so a
refused one is re-evaluated on retry — a refusal is an answer about the state at that moment, not
a result to replay forever.

This is why `deploymentService` needs none of the three per-method replay guards
`api/mock/deployment.ts` carries: the second call never reaches the business rules that would
wrongly refuse it as "already deployed", because `runCommand` answers it first.

A submission id replayed with a *different* body returns the original outcome and logs a warning.
An idempotency key's job is to answer as it answered before; refusing would make a replay fail
after a success the caller may already have seen.

### Concurrency

PGlite is single-connection, so `db.transaction()` serialises the command path for free: two
overlapping checkouts apply one after the other, and the second sees the first's result. The SQL is
nonetheless written the way networked PostgreSQL needs it — `SELECT … FOR UPDATE` on the affected
assets **in assetid order** (a deterministic order, so no deadlock), and a single
`INSERT … ON CONFLICT DO UPDATE … RETURNING` for the ID sequence, which is what makes FR-007's
"one sequence value to at most one asset" true rather than hopeful. Nothing would change on a real
server.

### Two deliberate divergences from the mock

Both are commented where they live, and both make the server *more* correct than
`api/mock/store.ts`:

- **Opening a kit relationship closes the child's previous open one.** The schema allows a child
  exactly one open parent (`rel_one_open_parent`, a partial unique index). An asset moving straight
  from one kit to another therefore has its old membership closed on the same date rather than
  colliding with the index — the mock, having no index, would leave two open rows and report the
  wrong parent.
- **`asset.parentasset` is recomputed from the open relationship rows, never assigned.** So closing
  a kit relationship cannot drop a *permanent Component* parent, which the mock's unconditional
  `parentasset = null` would.

---

## What maps to which Dataverse flow

`solution/flows/` holds the specifications; this table is the correspondence, so whoever builds
them in the Maker Portal can check agreement rather than re-deriving the logic.

| Here | Dataverse equivalent | Note |
|---|---|---|
| `transactionService.applyTransaction` pass 1 (deriveState per line) | **F1** steps 1–4 | Same function. F1's README maps its steps onto `deriveState.ts` case by case. |
| `applyTransaction`'s asset UPDATE | **F1** step 4 | The flow writes `eng_asset`; the app must not. `api/dataverse/` deliberately does **not** call `deriveState` for this reason — that is F1's job, and a second write path to derived fields would break Principle V. |
| `mirrorComponentChildren` | **F1** step 5 | A store-wide fan-out over the relationship table, which is why it is not in `deriveState.ts` in either implementation. |
| `commandService.recordCalibration`'s `ReturnFromCalibration` | **F2** | Recording a calibration for an asset at the lab brings it back through a transaction, never a status edit. |
| — (no equivalent) | **F3** calibration reminders | Needs Teams/email delivery. `listOfficeAdminAssignments` and `setOfficeAdmins` supply the assignment data and the FR-027a gap report F3 depends on. |
| `expectedreturn` on the header | **F4** overdue nudges | Only checkouts that kept an expected-return date can be nudged (ASSUMPTION Q8). |
| `db/seed.ts` | **migration `04_load.py`** | Same JSON inputs; a Dataverse load needs a Web API `$batch` writer instead. |
| `command_idempotency` | `eng_transaction`'s own dedup on `clientSubmissionId` | |
| `SELECT … FOR UPDATE` / `ON CONFLICT` on `id_sequence` | `If-Match` etag retry on `eng_idsequence` | Same guarantee, different mechanism. |

`installation` / `installation_component` correspond to `eng_installation` /
`eng_installationcomponent` — **two tables beyond the nine in `docs/01-data-model.md`, still
pending Jay's agreement** (`docs/08-decisions.md`). Same for `office_admin_assignment`. Creating
them locally commits nobody to anything; creating them in Dataverse needs his answer first.

---

## Swapping in networked PostgreSQL

If the premium-licensing fallback is taken and this stops being a proof of concept:

1. Replace `openDatabase()` in `src/db/pglite.ts` with a `pg` `Pool`. `Queryable` — the
   `query(sql, params)` interface every service depends on — is already the whole surface, and
   `node-postgres` satisfies it. `db.transaction(cb)` becomes `BEGIN` / `COMMIT` / `ROLLBACK`
   around a checked-out client.
2. `schema.sql` runs unchanged. It is ordinary PostgreSQL: no PGlite extension, no WASM
   dependency. Move it behind a migration tool at that point, since `CREATE … IF NOT EXISTS` on
   every start stops being appropriate once there is data you cannot reseed.
3. The `FOR UPDATE` ordering and the `ON CONFLICT` sequence increment start doing real work
   instead of documenting intent.
4. Replace `devAuth.ts` with OIDC and a session cookie before it is reachable from anything but
   loopback.
5. Dates are ISO-8601 **text**, deliberately, because that is exactly what the app exchanges and
   what `deriveState` compares. Moving to `timestamptz` would be a real improvement and a real
   migration: it changes every comparison in the read model and the meaning of every stored value.
   `docs/08-decisions.md` records why the POC did not.

## What this POC does not do

- **No three-axis status model.** One `status` column, from
  `data/reference/state_machine.json`, matching `app/src/api/types.ts` one for one so the existing
  screens run unchanged. The three-axis split is a product decision still marked PROPOSED in
  `docs/08-decisions.md`, deliberately out of scope.
- **No write authorization beyond the two rules the mock has** (FR-025's custodian check on
  Return, FR-007's not-held check on Deploy). Admin-only *screens* are gated in the router only.
  In production the three Dataverse security roles do this; here, treat every caller as trusted,
  which is another reason for loopback.
- **No `eng_`-prefixed names.** Column names match the app's field names wherever PostgreSQL
  allows (`start`/`end` are reserved, so `start_at`/`end_at`; a line's `transaction` becomes
  `transaction_id`). The prefix belongs to Dataverse's logical names, not to this database.
