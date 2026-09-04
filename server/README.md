# server/ — the local TypeScript API

A full-stack proof of concept that needs no Microsoft tenant: the React app in `app/` talks over
HTTP to a Fastify API backed by **PostgreSQL 17 in a container** (`docker-compose.yml`), seeded
from `migration/staged/` (1,026 real assets) or any synthetic profile.

*(Until 2026-09-03 that database was **PGlite** — PostgreSQL compiled to WebAssembly, running
in-process — because the development machine could not run a database daemon. That driver is
still here and still passes all 64 tests; `AMS_DB=pglite` selects it. See § Swapping in networked
PostgreSQL for what the move cost and what it proved.)*

It exists to answer one question that the mock backend could not: *does the design hold up with a
real network boundary and a real database between the screens and the data?* Everything the mock
did in memory now crosses a wire, gets validated a second time by a server that does not trust the
client, and commits inside a database transaction.

**This is not the production architecture** — it is a local proof of concept: PGlite in-process,
no identity, no TLS, every caller trusted. Production is the Azure web application in
`docs/14-webapp-architecture.md`: the same TypeScript API shape against Azure Database for
PostgreSQL, behind Entra. This server is the closest thing the repo has to it, which is why the
transaction work here is worth reading. See § Swapping in networked PostgreSQL.

*(Corrected 2026-09-03. This paragraph said production was "Dataverse plus Power Automate flows",
written before the web-app pivot and left stale by it. The Power Platform is parked — `CLAUDE.md`,
§ Parked — Power Platform.)*

---

## Run it

From a clean checkout, three commands:

```bash
docker compose up -d --wait
cd server && npm ci
npm test
```

`docker compose up -d --wait` starts PostgreSQL 17.11 on `127.0.0.1:5433` and blocks until its
healthcheck passes, so the next command never races the database. `npm test` creates one
throwaway database per test file, applies the schema, seeds `migration/staged/` into it, and drops
it again — nothing shares state between files and nothing survives the run.

Then, from `server/`:

```bash
npm run dev            # watch mode
npm start              # serve on 127.0.0.1:3001
npm start -- --reseed  # discard local writes, reload the dataset
npm run reseed         # reload and stop (scripts, CI)
npm run typecheck
npm test               # 64 tests, against the container
npm run test:pglite    # the same 64, against in-process PGlite — no container needed
npm run test:both      # both drivers in sequence
npm run db:up          # docker compose up -d --wait, from server/
npm run db:down        # stop, keeping the volume
npm run db:reset       # discard the volume and start clean
```

`server/.env.example` documents every environment variable. Nothing in it is a secret: the
container's password is a local development password that never reaches Azure or a browser
bundle. Copy it to `server/.env` only if you need to override something.

*(Before 2026-09-03 this section carried `export PATH="/c/Files/…"` and `NODE_EXTRA_CA_CERTS`
incantations for a locked-down Windows machine with a portable Node and a corporate CA cert.
Development has moved to macOS; `npm run …` works directly and those exports are gone.)*

Preferred, from the Claude Code preview tool (`.claude/launch.json`) — start the database, then
the API, so Vite has something to proxy to:

| Config | What it is | Port |
|---|---|---|
| `englobe-ams-api` | this server | 3001 |
| `englobe-ams-localapi` | Vite in `--mode localapi`, proxying `/api` → 3001 | 3200 |
| `englobe-ams-localapi-alt` | the same, for a concurrent session (3200 is `--strictPort`) | 3210 |

The app reaches the API through Vite's same-origin `/api` proxy (`app/vite.config.ts`), so there is
no CORS configuration and no absolute URL anywhere in the client. `app/.env.localapi` sets
`VITE_AMS_BACKEND=http`, which is the only thing that selects `app/src/api/http/` over the mock.

The server binds **loopback only** (`127.0.0.1`), and so does the database's published port. It has
no authentication worth the name — see § Identity — so it must not be exposed on a network
interface.

## Dataset selection and reseeding

`AMS_DATASET` names a directory under `migration/`, using the same vocabulary as
`app/scripts/copy-staged-data.mjs`:

```bash
AMS_DATASET=staged            npm start   # the real migrated data (default)
AMS_DATASET=synthetic/demo    npm start   # feature 007's small fictional fleet
AMS_DATASET=synthetic/large   npm start   # 5,312 assets, 438,619 lines
```

On PGlite each dataset gets **its own database directory** under `server/data/` (gitignored), so
switching between real and synthetic never replays one dataset's writes onto the other — the same
rule `MockStore`'s `datasetKey` enforces in the browser. PostgreSQL has a database rather than a
directory, so there the same rule is enforced by the seed loader's dataset key alone: switching
`AMS_DATASET` against an already-seeded database reseeds it wholesale rather than mixing.

Seeding is idempotent by dataset key: starting against an already-seeded database does nothing, so
a technician's own transactions survive a restart. `--reseed` forces a reload, which is the local
equivalent of the mock's "reset to the migrated snapshot". **`--reseed` is the only supported way
to replace a seeded dataset in place.**

Feature 007 FR-056 carries over: a synthetic dataset whose `manifest.json` says `verified: false`
is refused outright, never loaded. A dataset with no manifest is treated as real — never the other
way round.

To point the *app* at a synthetic dataset as well (for the banner and the static-file mock), run
`node scripts/copy-staged-data.mjs --dataset synthetic/demo` from `app/`.

---

## Identity

Identity is chosen by `AMS_AUTH` and lives entirely behind `src/auth/providers/`. `app.ts` calls
`resolveUser(req)` and knows nothing else.

**`AMS_AUTH=dev` (default)** — `x-ams-dev-user` names one of five demo identities:

| Header | UPN | Roles | Office |
|---|---|---|---|
| `field` (default) | `tech@englobecorp.com` | FieldUser | Ottawa |
| `admin` | `admin@englobecorp.com` | FieldUser, OfficeAdmin | Ottawa |
| `owner` | `svc-ams@englobecorp.com` | FieldUser, OfficeAdmin, SystemOwner | *global* |
| `reader` | `reader@englobecorp.com` | ReportReader | Ottawa |
| `toronto` | `toronto-admin@englobecorp.com` | FieldUser, OfficeAdmin | Toronto |
| `anonymous` / `none` | — | — | no identity at all |

The last three exist for the cross-role/cross-office matrix in `tests/authorization.test.ts`:
a read-only reader, an administrator to be refused at another office's border, and an explicit way
to exercise the unauthenticated path without standing up an OIDC flow.

The browser sends whatever the existing `RoleSwitcher` stored in `localStorage`. **Roles and office
scope do not come from the header** — they are read from `app_user` / `app_user_role`, exactly as
they will under Entra; only the header-to-principal mapping is the shortcut. A header is still not
authentication, which is why this binds to loopback only and why `auth/settings.ts` refuses to
select this provider when the environment is production.

**`AMS_AUTH=oidc`** — the real Microsoft Entra client: discovery with the issuer pinned to the
configured tenant, authorization code + PKCE (S256), RS256/JWKS verification with the algorithm
taken from an allow-list rather than from the token, and `iss`/`aud`/`exp`/`nbf`/`nonce`/`tid`
checked before `oid` is accepted as the identity key. No token ever reaches the browser: the
session is an opaque 256-bit id in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production,
against a server-side store. State-changing requests authenticated *by that cookie* must echo a
double-submit CSRF token in `x-ams-csrf`; header-authenticated requests carry no ambient credential
and are exempt, which is why the pre-existing suite needed no change.

Configuration lives in `.env.example`. Nothing is provisioned yet — the Entra app registration is
an Englobe IT dependency (R6, recorded as assumption A-R6) — so the provider is proven instead
against a fabricated issuer with a locally generated key pair, including the negative cases: wrong
tenant, forged signature, wrong audience, expired, replayed `state`, and seven open-redirect
payloads.

> **One session-store caveat for Azure.** The store is in-memory. That is correct for one process
> and wrong for Container Apps running more than one replica, where a user would be signed out
> every time the load balancer moved them. It is behind a `SessionStore` interface for exactly this
> reason; a shared implementation is required before the first multi-replica deployment.

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
src/auth/identity.ts               the one seam app.ts calls; selects a provider
src/auth/providers/                dev header shortcut, and the real Entra OIDC client
src/auth/authorize.ts              requireRole / requireOfficeScope guards
src/auth/directory.ts              roles and office scope, read from app_user
src/auth/session.ts                opaque session records and the CSRF token
src/auth/devAuth.ts                the five demo identities
src/db/migrate.ts                  the migration runner and the schema_migration ledger
src/db/migrateCli.ts               `npm run db:migrate` / `npm run db:check`
src/db/identity.ts                 seeds app_user / app_user_role from the demo directory
../db/migrations/*.sql             the schema — nine numbered, forward-only files
src/db/database.ts                 the Queryable / Tx / Database interfaces services share
src/db/open.ts                     pick a driver; AMS_DB / AMS_DATABASE_URL / AMS_DB_POOL_MAX
src/db/postgres.ts                 the pg Pool driver, and isolated test databases
src/db/pglite.ts                   the in-process driver, kept green as a fallback
src/db/rows.ts                     row <-> app type mapping, in one file
src/db/seed.ts                     load a dataset directory, idempotent by dataset key
src/routes/read.ts                 one endpoint per AmsBackend read method
src/routes/commands.ts             one endpoint per write, zod-validated
src/services/readModel.ts          every read, with field security applied
src/services/transactionService.ts THE write path — applyTransaction and runCommand
src/services/commandService.ts     features 001/003/004 commands
src/services/deploymentService.ts  feature 005 commands, plus office-admin assignment
tests/                             64 tests over an isolated database and the real migrated data
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

Per **command**, against `command_idempotency`, keyed on `clientSubmissionId` (FR-007). Two rules,
both from CLAUDE.md rule 3:

| | |
|---|---|
| same id + **same** request | returns the original outcome, writes nothing |
| same id + **different** request | **refused**, carrying `[command.error.idempotencyPayloadMismatch]` |

Only *accepted* commands are recorded. A refused one is re-evaluated on retry — a refusal is an
answer about the state at that moment, not a result to replay forever — and the mechanism is that
a `Refusal` rolls the claim back with everything else.

This is why `deploymentService` needs none of the three per-method replay guards
`api/mock/deployment.ts` carries: the second call never reaches the business rules that would
wrongly refuse it as "already deployed", because `runCommand` answers it first.

#### The claim is taken first, and it is the concurrency control

`runCommand` INSERTs the idempotency row **before it touches an asset**, with `response` NULL, and
UPDATEs the outcome in before COMMIT. A second copy of the same submission blocks on the primary
key until the first commits or rolls back — PostgreSQL's own duplicate-key wait, not a lock we
invented. So a simultaneous duplicate is answered from the winner's row instead of running the
command a second time, and duplicates never contend for asset rows at all.

`response` is NULL only between the claim and the outcome, and no other session can observe that:
the row is uncommitted for the whole window, and a crash in between rolls the claim away rather
than stranding it.

*(Corrected 2026-09-03, findings WS-W4-F1/F2/F3. Two things this section previously said were
wrong, and both were found by running the concurrency proof against real PostgreSQL rather than by
reading the code.*

*It said a mismatched replay "returns the original outcome and logs a warning", and defended it:
"An idempotency key's job is to answer as it answered before; refusing would make a replay fail
after a success the caller may already have seen." That answers the wrong question. A client that
reuses one submission id for two different requests has a bug; handing it someone else's success
hides the bug and silently drops the second request. CLAUDE.md rule 3 and the frozen R2 contract
both say refuse, and rule 13 says the specification wins.*

*It also described a check that was read-then-insert — SELECT at the top, INSERT at the bottom —
under which two copies of one submission in flight together both found no row and both ran the
command. PGlite could never have shown this, because it is single-connection. See
`server/tests/concurrency.test.ts` S5 and S6.)*

### Concurrency

**Read this paragraph as history.** It used to say: *"PGlite is single-connection, so
`db.transaction()` serialises the command path for free… Nothing would change on a real server."*
The SQL was written the way networked PostgreSQL needs it — `SELECT … FOR UPDATE` on the affected
assets **in assetid order**, and a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` for the ID
sequence — but on a single connection none of that had to work. In that README's own words, it was
"documenting intent".

That excuse is gone. The default driver is now a `pg` Pool against the container in
`docker-compose.yml`, `transaction()` checks out one client and holds it for the whole callback,
and two commands can genuinely be in flight at once. The ordering and the atomic sequence
increment now have to be right rather than merely present.

That exercise has now run: `tests/concurrency.test.ts`, 34 tests, WS-W4's first proof. What it
settled, and what it did not:

**Settled.** Five-asset atomic commit; an invalid line writing nothing (100 deliberate failures,
zero partial writes); rollback after the third material step; **two users racing and exactly one
winning, across a 100-race batch with zero double-bookings**; reversed input order not deadlocking
across 45 contended commands in three orders; browser-supplied before/after state being stripped;
**100 concurrent registrations minting 100 unique contiguous canonical IDs** with the sequence
advanced by exactly 100.

**Believable because the negative controls fail.** Remove `FOR UPDATE` and the same harness
double-books. Reverse the lock order and PostgreSQL kills one side with SQLSTATE 40P01. Do
read-then-increment on `id_sequence` and eight callers get the same number. So the harness can
race, and the protections are what stop it.

**Found broken, and fixed the same day.** Idempotency failed three ways — see § Idempotency. That
is the proof earning its keep: none of the three was visible on PGlite.

**Still not proven.** Serialization-failure retry (`runCommand` has no retry loop; under READ
COMMITTED nothing raised one, so its absence never bit). Role and office-scope authorization —
`devAuth` is a header, so "a browser cannot claim to be another user" is untested; only "a browser
cannot claim a role in the request body" is. And the winner's *post-state* assertions are written
against this compatibility schema's single `status` column, so they will need restating when the
approved axes land. **Sharper still: the eligibility rule deciding which asset may be checked out
at all is not yet specified** — `010/contracts/transaction-command.md:172` defers it to a
transition table. "Exactly one contender wins the row" is settled; "who was eligible to contend"
is not.

The 12 race tests **skip** on `AMS_DB=pglite` rather than pass. A green tick from a
single-connection driver is evidence of nothing.

The pool defaults to 10 clients (`AMS_DB_POOL_MAX`). `AMS_DB=pglite` still forces the
single-connection driver, which by construction cannot exhibit a race — useful as a control, and
useless as evidence.

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

## What maps to which Dataverse flow *(LEGACY-POWER-PLATFORM — parked)*

`solution/flows/` holds the flow specifications. Power Automate is parked and nothing below is
going to be built in the Maker Portal. The table is kept because it is the clearest statement in
the repo of *which business rule each flow encoded* — and every one of those rules still has to
hold in the production API. Read the left column as the requirement and the right as its origin.

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

## Swapping in networked PostgreSQL — done 2026-09-03, and what it cost

This section used to be a plan. It has been executed, so it is now a report. The plan said five
things; four were right, one was optimistic, and the difference is worth reading before trusting
a similar estimate elsewhere in this repository.

**The load-bearing claim held.** The plan asserted that `schema.sql` "runs unchanged. It is
ordinary PostgreSQL: no PGlite extension, no WASM dependency." That had never been executed, and
the entire delivery plan rested on it. It is true. Against PostgreSQL 17.11 — this was measured
while the schema was still one file; that file is now `db/migrations/0001_initial_schema.sql`,
byte-identical from `CREATE TABLE meta` onward, so the measurement stands:

- `psql -v ON_ERROR_STOP=1 < src/db/schema.sql` — exit 0, no errors, no edits to the file. The
  only output beyond DDL confirmations is two `NOTICE`s from `DROP TRIGGER IF EXISTS` on a fresh
  database.
- The same file as **one multi-statement `query()`**, which is what the driver actually does, is
  accepted too. That is a different code path from psql's statement-at-a-time and it was worth
  checking separately.
- Re-applying changes nothing: 14 tables, 32 indexes, 2 triggers, 1 sequence after one apply and
  after three.
- The plpgsql append-only triggers fire, `rel_one_open_parent` refuses a second open parent, and
  `INSERT ... ON CONFLICT ... RETURNING` on `id_sequence` returns.

**The "connection layer only" claim did not hold, and the gap is small but real.** `Queryable` is
genuinely the whole surface the services depend on, exactly as claimed — not one service file
changed. But four files *outside* `src/db/` named `PGlite` as the type of the root handle, and a
root handle is not a `Queryable`: it also has to offer `transaction()` (the command wrapper) and
`exec()` (the seed loader's `TRUNCATE`). So:

| File | Change |
|---|---|
| `src/app.ts` | `AppContext.db: PGlite` → `Database` |
| `src/db/seed.ts` | `seedIfNeeded(db: PGlite)` → `Database`; `(tx: Transaction)` → `Tx` |
| `src/services/transactionService.ts` | `runCommand(db: PGlite)` → `Database` |
| `tests/helpers.ts` | `TestApp.db: PGlite` → `Database`; `openDatabase()` → `openTestDatabase()` |

Type annotations only — no logic, no SQL and no test assertion moved. `Queryable` itself is
untouched; `Tx` and `Database` are supersets added above it, not modifications to it. Call it a
connection-layer change plus four type annotations, and do not call the next one "only" until it
has been run.

**One thing the plan got right for free.** Two places could have diverged between drivers, both
returning `bigint`: `count(*)` and `nextval`. The POC had already written them as `count(*)::int`
and `Number(res.rows[0].nextval)`. Whoever wrote that was thinking about this swap, and it saved
a debugging session.

### What is in place now

```text
src/db/database.ts   the Queryable / Tx / Database interfaces; the schema text
src/db/postgres.ts   the pg Pool driver, plus isolated test databases
src/db/pglite.ts     the in-process driver, still green, selected by AMS_DB=pglite
src/db/open.ts       chooses one; owns AMS_DB / AMS_DATABASE_URL / AMS_DB_POOL_MAX
docker-compose.yml   (repo root) PostgreSQL 17.11, pinned, loopback 5433, healthchecked
```

Both drivers pass all 64 tests. That is deliberate: keeping them both green is the evidence that
nothing above `src/db/` knows which one it has, and the moment a service needs to care, a test
will say so. PostgreSQL is also the faster of the two here — 681 ms against 1.69 s — because the
per-file cost of standing up a WASM PostgreSQL exceeds the cost of `CREATE DATABASE`.

### Still not done

1. ~~**`schema.sql` is still applied on every start-up.**~~ **Done 2026-09-03.** The plan's own
   advice was to "move it behind a migration tool at that point, since `CREATE ... IF NOT EXISTS`
   on every start stops being appropriate once there is data you cannot reseed." That is now what
   happens: `db/migrations/` holds nine numbered, forward-only files, `src/db/migrate.ts` applies
   them one transaction each through a `schema_migration` ledger, and both drivers call it on
   open. A second run is a no-op; an edited, deleted or under-numbered migration is refused before
   anything is applied. `schema.sql` and its `SCHEMA_SQL` export were deleted rather than kept, so
   there is exactly one description of the schema. See `docs/08-decisions.md` § "Database lane
   calls".
2. ~~**`devAuth.ts` is still a header.**~~ **Superseded 2026-09-03.** Identity moved behind
   `src/auth/providers/`, the Entra OIDC client is written and tested against a fabricated issuer,
   and every `/api/*` route is now authenticated deny-by-default with office scope enforced
   server-side. The header provider remains the default for local development, is refused in
   production, and the server still binds to loopback. What is genuinely outstanding is the Entra
   *app registration* (R6), which is an Englobe IT dependency, and a shared session store before
   multi-replica deployment.
3. **Dates are still ISO-8601 text, not `timestamptz`.** Point 5 stands unaltered — it is a real
   migration, not a driver concern, and `docs/08-decisions.md` records why the POC did not.
4. **This schema is still the POC's single-`status` schema**, not the canonical model. See
   § What this POC does not do.

## What this POC does not do

- **No three-axis status model in this POC.** One `status` column, from
  `data/reference/state_machine.json`, matching `app/src/api/types.ts` one for one so the existing
  screens run unchanged. **Production target is the four-axis model approved 2026-09-03 (R1)** in
  `docs/15` §3 / `docs/08-decisions.md`. Replacing this POC column is in-scope for WS-W2/W4, not
  for keeping the POC as the schema of record.
- **No write authorization beyond the two rules the mock has** (FR-025's custodian check on
  Return, FR-007's not-held check on Deploy). Admin-only *screens* are gated in the router only.
  In production the three Dataverse security roles do this; here, treat every caller as trusted,
  which is another reason for loopback.
- **No `eng_`-prefixed names.** Column names match the app's field names wherever PostgreSQL
  allows (`start`/`end` are reserved, so `start_at`/`end_at`; a line's `transaction` becomes
  `transaction_id`). The prefix belongs to Dataverse's logical names, not to this database.
