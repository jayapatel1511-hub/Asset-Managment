# Remaining Work — Azure Web Application Workstream Map

**As of 2026-09-03**, after the local/mock build, production-readiness review, and System Owner decision to pivot to a conventional web application.

Read, in order:

1. `CLAUDE.md`
2. `.specify/memory/constitution.md`
3. `docs/14-webapp-architecture.md`
4. `docs/15-postgres-data-model.md`
5. `specs/009-production-readiness/spec.md`
6. `specs/010-web-application-platform/spec.md`
7. `docs/06-delivery-plan.md`

The previous workstream map optimized local feature construction and then a Dataverse production route. Both produced useful requirements and mock evidence. The active remaining work is now the TypeScript/PostgreSQL/PWA/Azure path.

---

## Current status

- Features 001–006: **Mock Implemented**
- Feature 007: **Built 2026-09-02** — three profiles, byte-identical on regeneration; US5 blocked on Q14
- Feature 008 US1: release-data guard implemented locally; rebound to `VITE_AMS_BACKEND=http` on 2026-09-03
- Feature 009: **Spec Draft**, production-readiness evidence gate — [plan](009-production-readiness/plan.md) / [tasks](009-production-readiness/tasks.md) / [contracts](009-production-readiness/contracts/) written 2026-09-03
- Feature 010: **Spec Draft**, active platform — [plan](010-web-application-platform/plan.md) / [tasks](010-web-application-platform/tasks.md) / [contracts](010-web-application-platform/contracts/) (R2 draft) / data-model written 2026-09-03
- Feature 011: **Spec Draft** — [plan](011-data-management/plan.md) / [tasks](011-data-management/tasks.md) / [contracts](011-data-management/contracts/) written 2026-09-03; write stories blocked on 010 W3/W4
- Constitution: **2.0.0**, web pivot recorded
- Power Platform: **parked 2026-09-03**; the Dataverse adapter is no longer imported
- Zite: **parked 2026-09-03**
- Pilot: not approved

### Local end-to-end build — 2026-09-03

The list that used to sit here said "not implemented" nine times. Most of those lines are now
wrong, and leaving them would be worse than having written nothing. What follows is what is
actually true, and — more usefully — what each thing has been *evidenced* to do, in the vocabulary
of § Progress labels below.

The governing freeze for this pass is [`_planning/BUILD-FREEZE.md`](_planning/BUILD-FREEZE.md);
every assumption taken to get past a blocker is recorded in `docs/08-decisions.md` and is still
awaiting Jay's confirmation.

| | State | Evidence |
|---|---|---|
| React/Vite client | reusable, now a PWA | manifest, icons and a service worker ship in the release bundle; **478 tests** |
| **HTTP API** (`server/`) | **API Implemented** | Fastify over **containerised PostgreSQL 17**, both drivers green, **386 tests**; every `AmsBackend` method has a route, checked mechanically by `tests/contract.test.ts` |
| **PostgreSQL schema/migrations** | **implemented** | `db/migrations/` — **twelve** forward-only files, a `schema_migration` ledger, `npm run db:migrate` / `db:check`; second run is a no-op; drift refused three ways |
| **Database-enforced invariants** | **implemented** | append-only history incl. TRUNCATE, asset-ID immutability, relationship acyclicity, installation spans, rule-12 environment guard, four-axis state |
| **Identity / authorization** | **implemented**, unprovisioned | pluggable provider; Entra OIDC written and proven against a *fabricated* issuer; deny-by-default on every `/api/*`; role × office matrix tested by direct API call. **R6 (a real tenant) is still an Englobe IT dependency** |
| **PWA offline shell / IndexedDB** | **implemented** | partitioned by tenant + environment + user; drafts, durable command queue, replay, conflicts |
| **Blob document path** | **implemented behind an interface** | local `DocumentStore`; Azure Blob is a second implementation (assumption A-DOC). No Azure resource created |
| **Outbox / workers** | **implemented and wired** | the outbox row commits inside the business event's own transaction — CLAUDE.md rule 2's last clause is now literal, not aspirational. Worker and scheduler start in `main.ts` |
| **UI — S01 Field home** | **rebuilt** | D2 accepted the Console Mobile layout; built in Fluent + Englobe green per **G-24 = A**. Search moved to `/search` |
| **Reporting** | **implemented** | seven reports over approved SQL views; no view exposes a restricted identifier |
| Shared contracts (`packages/`) | **exists** | `packages/contracts/` owns the entity shapes, the `AmsBackend` interface and the generated state machine |
| CI (`.github/`) | **exists** | two workflows, no cloud credentials |
| **Scale** | **evidenced** | 6,626 assets / 438,619 transaction lines: fleet list 32 ms, search 17 ms, busiest asset's 322-line history 7 ms, reports reconcile exactly (`server/tests/scale.test.ts`, opt-in) |
| Azure infrastructure (`infra/`) | **not implemented** | gated on R6, which is not Jay's alone |
| PostgreSQL migration rehearsal | **not completed** | WS-W11 |

**One command proves it**: `scripts/verify.sh` — container up, migrations from empty, idempotent
re-run, typecheck, server suite on **both** drivers, client suite, client build.

**Proven in a real browser, not only in tests**: a checkout committed through the actual UI as
`TXN-000015`, landing in PostgreSQL with the right custodian, project and appended history; role
switching changing what the server returns; and IndexedDB partitioned per user with no restricted
field in it.

**What this is not.** None of the above is *Azure Integrated*, *Security Verified*, *Device
Verified*, *Migration Rehearsed* or *Pilot Accepted*. It is a complete, evidenced local system.
The pilot gate at the end of this file is unchanged and unmet.

### Environment change — 2026-09-03

Development moved from the locked-down Windows corporate machine to macOS with **Docker 29.7.2 and
Colima**. This is a capability change, not a preference: `server/` uses PGlite (PostgreSQL compiled
to WASM, in-process) precisely because a real database daemon was not available, and
`server/README.md` is explicit that PGlite "is single-connection, so `db.transaction()` serialises
the command path **for free**".

~~Everything concurrent in the design is therefore currently *asserted and unexercised*~~ —
**no longer true.** When this paragraph was written, the `SELECT … FOR UPDATE` ordering and the
`ON CONFLICT` sequence increment were, in that README's own words, "documenting intent". They are
now exercised: `server/tests/concurrency.test.ts` runs against the container and holds 34 tests
including 100 simultaneous races for an overlapping asset (exactly one winner each), a 100-way
registration burst minting 100 unique canonical IDs, and a deliberate opposite-lock-order
**control** that deadlocks with SQLSTATE 40P01 — which is what proves the ordered path is doing
the work rather than getting lucky. The same suite is kept green on PGlite, where those 12 tests
skip themselves and say why.

This unblocked **WS-W1**'s "reproducible local PostgreSQL" and, with it, the parts of **WS-W4**
PGlite structurally cannot prove. It did not change any requirement — it changed what could be
tested before Azure exists, and therefore how much of WS-W4 could be closed without spend. The
answer turned out to be: all of it.

---

## Readiness — what is missing before development starts

*Written 2026-09-03, after both alternative tracks were parked. The gate below (G0.1–G0.5) is the
authority; this section is a triage of it, separating what genuinely blocks the first line of code
from what blocks the pilot. Everything here is already required somewhere in this file — nothing
new is being introduced.*

### 1. Decisions — the real blockers

| # | Missing | Blocks | Owner |
|---|---|---|---|
| ~~**R1**~~ | **APPROVED 2026-09-03** — four-axis state in `docs/15` §3 / `docs/08` | Unblocked. Mock/`server/` POC may keep single `status` until HTTP cutover | Jay |
| ~~**R2**~~ | **FROZEN for first proof** — `010/contracts/transaction-command.md` (+ auth, errors, outbox) | Unblocked for WS-W4; extend carefully for later event types | Jay |
| ~~**R3**~~ | **First-proof subset APPROVED** — `010/data-model.md`. Full `docs/15`+`16` still needs table-by-table review for complete WS-W2 | Unblocked for race migrations; full parallel schema still gated | Jay |
| ~~**R4**~~ | **Q8 confirmed** (optional +14d); **Q9 decided** (admin backdate ≤30d, refuse crossing history) | Unblocked for checkout command fields | Jay |
| **R5** | Global vs office-scoped administrator | Authorization model, WS-W3 | **Jay** |
| **R6** | G0.2 enterprise set — Azure subscription, Canadian region, Entra app registration owner, RTO/RPO, DNS/TLS, alert owner | Azure deployment only. **Does not block local development** | **Englobe IT**, not Jay alone |

### 2. Artifacts that do not exist

| Missing | Note |
|---|---|
| ~~`plan.md` / `tasks.md` / `contracts/` for 009, 010, 011~~ | **Closed 2026-09-03** via multi-agent planning (`specs/_planning/MULTI-AGENT-OWNERSHIP.md`). Specs remain Draft. **R1–R4 closed same day**; remaining STOP gates are **R5** (admin scope) and product opens for later stories. |
| `db/` | No migrations, no migration runner — **unblocked to start** first-proof subset |
| `packages/contracts/` | Spec contracts exist under `specs/010…/contracts/` and `specs/011…/contracts/`; shared TypeScript package not created yet — `app/` and `server/` still agree by hand |
| `infra/` | No IaC |
| `.github/` | **No CI at all.** Nothing runs the 382 existing tests on push |
| Local PostgreSQL | No `docker-compose.yml`. Now possible — see *Environment change* |

### 3. Review gates not started

- Feature 010 checklist: **5 of 112 reviewed**. The 107 remaining are a specification review, not implementation.
- Features 009 and 011 checklists: unreviewed.
- `migration/reports/03_models_review.md` and `02_conflicts.md` sign-offs — hard production gates, still open.

### 4. What is *not* blocking, and is worth saying

The container change removes the largest technical excuse for waiting. The first proof —
WS-W4's five-asset checkout race — needs **no Azure, no Entra, no subscription and no spend**.
**R1–R4 are closed (2026-09-03).** Remaining local prerequisites: Postgres container + implementing
`010/tasks.md` foundational → WS-W4. G0.2 (R6) gates deployment, not development.

**The critical path is now implementation of the first-proof race**, not a product undecided.
R5 still blocks production auth scope; it does not block the local five-asset proof with test doubles.

---

## The serial architecture gate

Do not start parallel backend, offline, migration and infrastructure implementation until the shared contracts below are frozen. Otherwise each workstream will encode a different state, identity and transaction model.

### G0.1 Product decisions

Record in `docs/08-decisions.md`:

- Q6 server/configuration treatment
- Q8 expected return
- Q9 backdating
- Q10 project source
- Q11 reporting audience
- Q18 component calibration
- global versus office-scoped administrator
- permanent home-office rehome behavior
- failed calibration versus physical lab receipt
- structured ownership values
- supported offline workflows
- supported device/browser matrix

#### Resolved 2026-09-03 — carried in from master, restate in PostgreSQL/API terms

Five product decisions were taken and recorded in `docs/08-decisions.md` before this branch merged.
They are **decided, not open**, but they were written against Dataverse and need restating for the
web-app target. `docs/17-ux-audit.md` is the audit that produced two of them.

| Decision | What it settles here |
|---|---|
| **Three surfaces** — Field (mobile), Desk (desktop user), Console (desktop admin) | Answers "supported device/browser matrix" above, from the product side. One codebase, one URL; per-route `surfaces: ("field"\|"desk"\|"console")[]` in a single manifest. The phone is a deliberate slice — find, check out, return, transfer, report fault, deploy/recover, reserve — and nothing else. Feeds **WS-W5** and **WS-W6** |
| **Categories are rows, hierarchical** | Resolves `docs/15-postgres-data-model.md`'s explicitly undecided `equipment_type` / `asset_group` ("fixed **or** curated reference", § line 192-193) in favour of a **curated reference table**, self-referential, on the `location` precedent. Its own § 56 already prefers reference tables "for values that administrators may extend". Unique key stays `(manufacturer, model, equipment_type)`. Feeds **WS-W2** and **feature 011** |
| **Carrier and retirement reason become reference tables; the four-sensor kit-role cap is removed by decomposition** — fixed role *types* plus a 1..N index | `docs/15` currently has `retirement_reason` as an enum. Role types stay fixed because the transaction service branches on them. Feeds **WS-W2** |
| **Vehicles are ordinary assets; reservations are in scope** | Adds a `reservation` table. **A reservation is not a state** — with this branch's `lifecycle` / `disposition` / `serviceability` split the point is sharper than it was under the single status: a booking is a future claim, orthogonal to all three. It advises exactly one command — checkout — and the overlap rule needs the API/database to enforce it, since no exclusion constraint exists. Feeds **WS-W2** and **WS-W4** |
| **"Add an employee" = attributes of existing staff only** | Home office and offices administered. **No staff table.** Identity stays Entra (§ 4.5's four app roles). Still coupled to Q17: if licensing forces unlicensed technicians, non-user custodians stop being optional. Feeds **WS-W3** and **feature 011** |

Master's WS-A…WS-I workstreams are complete and are **not** carried forward into this map — the
evidence is `docs/09-build-report.md` and the git history. Master's WS-J (surfaces), WS-K (vehicles and
reservations) and WS-L (admin console) are superseded as *workstreams* by WS-W1…WS-W9 and features 010
and 011; their **content** is the table above. The admin-console capability gaps specifically
(`docs/17-ux-audit.md` § A, § D, § E) are feature 011's territory, and § E1–E7 have no coverage there
yet: 011 governs data administration, but "there is no admin console and an admin gets the field
technician's screens" is a UI gap that WS-W5 must own.

### G0.2 Enterprise platform decisions

- Azure subscription and owner
- approved Canadian region
- public-behind-Entra versus private-network-only access
- Dev/UAT/Prod environment ownership
- Entra app-registration owner
- RTO/RPO/HA tier and budget
- certificate malware-scanning route
- DNS/TLS owner
- alert/support owner

### G0.3 State and identity contract

**State axes: APPROVED 2026-09-03 (R1).** Still confirm before production auth:

- ~~lifecycle / disposition / serviceability / calibration currency~~ — approved
- canonical Asset ID and aliases;
- stable user identity by Entra tenant/object ID;
- role and office-scope model (**R5 open**);
- component exceptions (Q18 open).

### G0.4 Atomic command contract

**Frozen for first proof 2026-09-03 (R2)** — see `specs/010-web-application-platform/contracts/transaction-command.md`.

Freeze held:

- authenticated caller context;
- client submission ID;
- canonical request hashing;
- event type/effective time;
- item inputs;
- server-owned fields;
- deterministic asset locking;
- validation and refusal codes;
- before/after snapshots;
- relationship/installation effects;
- outbox events;
- all-or-nothing result;
- retry behavior;
- correction behavior.

### G0.5 Canonical PostgreSQL schema

Approve `docs/15-postgres-data-model.md`, including every table, constraint, index, role, view, retention rule and migration mapping.

**Gate definition of done:** The product decisions, enterprise prerequisites, state/identity contract, API command contract and physical schema are approved. Shared TypeScript contracts and migrations can then be authored without re-litigation.

---

## WS-W1 — Monorepo and local platform foundation

**Runs after:** architecture gate sufficiently stable  
**Blocks:** API, PWA and Azure work

### Owns

- root workspace/package orchestration
- `server/` foundation
- `packages/contracts/`
- `packages/domain/` where approved
- local PostgreSQL developer/test setup — a real server in a container, not PGlite (see *Environment change* above)
- common lint/typecheck/test commands
- baseline CI

### Deliverables

- [ ] current `app/` tests stay green
- [ ] local API health endpoint
- [ ] reproducible local PostgreSQL — containerised, version-pinned to the Azure Flexible Server major
- [ ] migration runner
- [ ] isolated integration-test database
- [ ] shared request/response schemas
- [ ] generated OpenAPI or equivalent contract artifact
- [ ] root `dev`, `typecheck`, `lint`, `test`, `test:integration`, `build` commands
- [ ] CI without personal cloud credentials

### Must not own

- final transaction logic
- Entra policy decisions
- offline UX
- visual redesign

**Definition of done:** A clean checkout starts the existing client, API and database locally; CI is green.

---

## WS-W2 — PostgreSQL schema and database invariants

**Runs after:** G0.3–G0.5  
**Can run with:** WS-W3 after contracts freeze  
**Blocks:** transaction service and real migration

### Owns

- `db/migrations/`
- database test fixtures
- immutable-history protections
- relationship/installation constraints
- reporting views
- database principals/grants

### Deliverables

- [ ] user/role/office scope tables
- [ ] equipment model, location and project tables
- [ ] asset and identifier/alias tables
- [ ] transaction and transaction-line tables
- [ ] idempotency table
- [ ] relationship tables and cycle/open-parent protection
- [ ] installation/component span tables
- [ ] calibration and document metadata tables
- [ ] sequence allocation table
- [ ] outbox and audit tables
- [ ] reporting views
- [ ] migration up/down or forward-recovery policy

### Required database tests

- duplicate Asset ID refused
- canonical Asset ID mutation refused
- shared serials allowed
- temporary alias retained
- transaction line update/delete refused
- second open parent refused
- relationship cycle refused
- overlapping installation membership refused
- synthetic production load refused
- restricted report views expose no sensitive fields

**Definition of done:** Migrations apply to an empty database, schema tests pass, and a second migration run makes no change.

---

## WS-W3 — Identity, session and authorization

**Runs after:** role/office decision and shared contract freeze  
**Can run with:** WS-W2, WS-W4

### Owns

- Entra application integration
- server session/BFF boundary
- user synchronization
- role and office-scope authorization middleware
- CSRF/redirect/logout protections
- direct authorization tests

### Deliverables

- [ ] tenant-scoped OIDC sign-in
- [ ] secure session cookies
- [ ] no separate password store
- [ ] stable tenant/object-ID user key
- [ ] Field User, Office Admin, System Owner, Report Reader
- [ ] API office-scope checks
- [ ] disabled user handling
- [ ] same-device user-change handling contract
- [ ] deep-link after sign-in
- [ ] direct API cross-role/cross-office test suite

### Must not own

- UI-only permission checks as security evidence
- broad Graph permissions without an approved requirement

**Definition of done:** Authorized test users receive only permitted API data/actions; unauthorized direct requests are refused.

---

## WS-W4 — Atomic transaction and registration service

**Runs after:** WS-W2 core schema and WS-W3 caller context  
**Blocks:** all production write workflows

### Owns

- `POST /api/transactions`
- request canonicalization and hash
- idempotency claim/result
- deterministic row locking
- transition/relationship validation
- transaction header/line creation
- derived state application
- outbox write
- server-side Asset ID registration/allocation
- concurrency/fault-injection tests

### First proof

Five-asset checkout:

1. five valid assets commit completely;
2. invalid fifth asset writes nothing;
3. exception after third material step rolls back everything;
4. two users race for an overlapping asset and one wins;
5. accepted response is lost and retry returns the original result;
6. same key with different payload is refused;
7. reversed input order does not create unsafe deadlock behavior;
8. browser before/after state cannot alter the result;
9. accepted header/lines cannot be edited normally.

### Registration proof

- 100 concurrent registrations under one prefix
- 100 unique committed canonical IDs
- temporary tags retained as aliases
- browser never reserves the sequence

**Definition of done:** Feature 009/010 atomicity and idempotency outcomes pass against real PostgreSQL. No other write workflow is called API Implemented before this passes.

---

## WS-W5 — HTTP client integration and workflow migration

**Runs after:** WS-W4  
**Can run with:** WS-W6 after the HTTP/cache contracts freeze

### Owns

- `app/src/api/http/`
- production `AmsBackend` adapter
- command/error mapping
- pending/applied/conflict UI state
- ~~removal of runtime dependence on `api/dataverse/`~~ — **done 2026-09-03**: no longer imported, and `VITE_AMS_BACKEND=dataverse` throws

### Migration order

1. checkout
2. return
3. transfer
4. register/complete temporary tag
5. fault/repair
6. missing/found
7. calibration dispatch/physical return
8. calibration record/correction
9. retire/rehome
10. component attach/detach
11. deploy/recover
12. component swap/configuration change
13. audit

### Requirements per workflow

- shared contract tests
- server-side authorization
- atomicity and idempotency
- structured refusal codes
- history/current-state reconciliation
- no direct state edits
- race test where applicable

**Definition of done:** Features 001–005 use the HTTP API in Dev and pass shared behavior tests.

---

## WS-W6 — PWA, IndexedDB and offline replay

**Runs after:** HTTP/cache contracts frozen  
**Can run with:** WS-W5, WS-W7

### Owns

- web manifest
- service worker
- asset/reference cache projections
- IndexedDB schema and migrations
- draft persistence
- pending-command queue
- replay coordinator
- Needs-attention conflict surface
- service-worker update behavior
- device test harness/procedure

### Rules

- cache partition: tenant + environment + user object ID
- no restricted SIM/network fields or certificate bytes for Field Users
- pending is not accepted
- replay while app is active; Background Sync is optional enhancement
- no replay under another identity
- commands persist through app/device restarts
- conflicts are visible and never silently dropped

### Required device tests

- installed PWA online sync
- app close
- device reboot
- airplane-mode cold start
- offline search
- queue multiple commands
- conflict from second device
- reconnect/replay
- accepted response loss
- expired auth
- same-device user change
- storage eviction
- update with queued commands
- camera permission paths

**Definition of done:** Supported devices have dated evidence for cold start and replay. Unsupported behavior is removed from pilot claims or triggers a native-wrapper decision.

---

## WS-W7 — Calibration documents and Blob Storage

**Runs after:** calibration command contract and Azure identity baseline  
**Can run with:** WS-W6, WS-W8

### Owns

- private Blob Storage integration
- document metadata API
- upload/download authorization
- integrity hash
- file/type/size enforcement
- malware scan/quarantine state
- replacement history
- calibration summary recalculation
- database/object reconciliation

### Required tests

- successful upload
- upload failure after calibration fact accepted
- later attachment
- replacement/reissue
- failed calibration
- older historical record entry
- correction/supersession/void
- retired asset retrieval
- unauthorized direct document access
- database restore/document mismatch report

**Definition of done:** Truthful calibration records survive file failures; private document access and recovery are verified.

---

## WS-W8 — Outbox, workers and optional Microsoft 365 integration

**Runs after:** WS-W4 outbox contract  
**Can run with:** WS-W7, WS-W9

### Owns

- outbox claim/lease/retry
- reminder scheduling
- overdue-return jobs
- reconciliation jobs
- Teams/email adapters
- notification suppression/cadence state
- operational alerts

### Rules

- business event and outbox commit together
- notification delivery is best-effort
- consumer is idempotent
- failed delivery does not change asset truth
- backlog age alerts a named owner
- office recipients derive from live office/admin data
- messages are bounded

**Definition of done:** Worker failure/retry produces no duplicate business effect and reaches an owned alert destination.

---

## WS-W9 — Reporting

**Runs after:** WS-W2 views and first representative data load  
**Can run with:** WS-W7/WS-W8

### Owns

- Fleet
- Where/Who
- Availability
- Calibration
- By Project
- Asset Timeline
- Site/Installation Timeline
- Utilisation
- export routes
- Report Reader authorization

### Rules

- reports are read-only
- data currency visible
- manager DTOs/views exclude sensitive identifiers
- every figure reconciles to operational data
- acquisition/go-live boundaries protect utilisation
- Power BI optional and uses approved views only

**Definition of done:** A Report Reader answers all seven questions without operational write access or restricted fields.

---

## WS-W10 — Azure infrastructure and deployment

**Runs after:** enterprise platform decisions  
**Can begin in Dev while application work proceeds, after shared names/contracts freeze

### Owns

- `infra/`
- Container Apps environment
- web/API app
- worker/job
- Container Registry
- PostgreSQL
- private networking
- Blob Storage
- managed identities
- Key Vault where needed
- monitoring
- DNS/TLS inputs
- budgets
- environment parameters
- GitHub Actions OIDC deployment

### Required proof

- fresh Dev deployment from repository
- no long-lived Azure secret in GitHub
- immutable revision recorded by commit/image/schema
- health/smoke check
- controlled traffic promotion
- compatible rollback
- environment isolation

**Definition of done:** Dev and UAT can be reproduced from IaC plus documented enterprise prerequisites.

---

## WS-W11 — PostgreSQL migration, delta and cutover

**Runs after:** WS-W2 and sufficient WS-W3 user resolution  
**Can run with:** representative API/report work after first Dev load

### Preserve

- source profile
- corrected calibration export
- model mapping
- one-to-one office mapping
- conflict reports
- completion queue
- unknown-custodian sweep
- source-row traceability
- idempotent reports

### Add

- PostgreSQL target writer
- user resolution by stable directory identity
- asset aliases
- inventory events
- calibration/document metadata
- relationship evidence
- source/staged/target reconciliation
- second-run empty business diff
- rehearsal delta
- freeze/read-only procedure
- final delta
- rollback criteria

Ambiguous calibration records remain unmatched pending human confirmation.

Production load remains blocked by model and conflict sign-offs.

**Definition of done:** UAT rehearsal accounts for every record, fits the cutover window and is reversible by the approved procedure.

---

## WS-W12 — Security, scale, recovery and pilot evidence

**Runs after:** integrated Dev/UAT system  
**Blocks:** Ottawa pilot

### Security

- direct API role/office matrix
- insecure object access tests
- CSRF/session/redirect tests
- document authorization
- export authorization
- sensitive network/cache inspection
- container/dependency/IaC scanning

### Scale

- 5,000 active assets
- 100,000+ transaction lines
- overlapping transaction load
- long timeline
- report performance
- migration performance
- outbox backlog recovery

### Recovery

- PostgreSQL point-in-time restore
- document recovery
- metadata/object/hash reconciliation
- application revision rollback
- schema compatibility/forward recovery
- measured RTO/RPO
- alert escalation test

### Pilot evidence

- migration sign-offs
- supported device matrix
- 20+ real checkout/return cycles
- deliberate double booking
- offline queue/conflict path
- calibration certificate path
- physical stock sample
- seven questions from production data

**Definition of done:** Features can move through Azure Integrated, Security Verified, Device Verified, Migration Rehearsed and Pilot Accepted with dated evidence.

---

## Parallelization map

```text
SERIAL GATE
  product + enterprise decisions
  state/identity contract
  atomic command contract
  PostgreSQL schema approval
        │
        ├── WS-W1 foundation
        │      │
        │      ├── WS-W2 database ──┐
        │      └── WS-W3 identity ──┼── WS-W4 atomic transaction
        │                           │          │
        │                           │          ├── WS-W5 HTTP workflows
        │                           │          ├── WS-W6 PWA/offline
        │                           │          ├── WS-W7 documents
        │                           │          └── WS-W8 workers
        │                           │
        │                           ├── WS-W9 reporting
        │                           ├── WS-W10 Azure infrastructure
        │                           └── WS-W11 migration
        │
        └────────────────────────────────────── WS-W12 verification/pilot
```

Shared files and contracts are frozen before parallel agents are launched. Each workstream receives an explicit ownership map to avoid collisions.

---

## First next task

~~The highest-value next implementation task~~ — **that task is done.**

> **Closed 2026-09-03.** Local PostgreSQL stood up, migrations landed from `010/data-model.md`,
> the atomic command implemented, and the five-asset race / retry / fault-injection tests run
> green against the container. See § *Local end-to-end build* above.

The boundary now exists, so the things that were waiting on it are safe to start. In rough order
of value:

0. **~~Settle G-24~~ — done.** Fluent + Englobe green wins (option A) and Console Mobile is the
   new S01 (D2). Screen work is unblocked; `docs/12-ui-spec.md` § 5.1 is superseded. Still open on
   the UI: **G-22**'s remainder (the four report screens, the reservation calendar and the rest of
   the desktop Console family) and **G-23** (vehicles have no visual identity).
1. **Get Jay's confirmation on the assumptions.** `docs/08-decisions.md` carries six taken to get
   past blockers, plus the lane calls. **A-STATE** and **D-AUTH-5** (fleet row visibility) are the
   two most worth a second opinion. Everything below is cheaper to change before more is built on
   it.
2. **R6 — the enterprise prerequisites.** Azure subscription, Canadian region, Entra app
   registration, DNS/TLS and alert owners. Not Jay's alone; this is the long-lead item and it now
   blocks more than it did, because the OIDC client is written and waiting for a tenant.
3. **Fold the outbox and document DDL into `db/migrations/`.** Recorded in `docs/08-decisions.md`;
   it is a real coupling today, not a tidiness item.
4. **WS-W11 — the PostgreSQL migration rehearsal.** The loader path exists and the schema is
   settled; the reconciliation and delta work is not done.
5. **Temporary-tag completion.** 35 assets in the real migrated data carry `TMP-*` tags with no
   workflow to resolve them. This needs a decision before code — see § *Known gap* below.
6. **The specification review gates**, which no amount of implementation closes: feature 010's
   checklist is 5 of 112 reviewed, 009 and 011 are unreviewed, and both migration sign-offs are
   still open.

---

## Known gap — temporary-tag completion needs a decision, not code

CLAUDE.md rule 6 says "temporary and legacy tags remain aliases", and WS-W4's registration proof
asks for "temporary tags retained as aliases". Neither is satisfied, and the reason is worth
stating precisely rather than filing as a to-do.

**There is no alias table.** `server/tests/concurrency.test.ts` carries a deliberate tripwire that
asserts `asset_alias` and `asset_identifier` do *not* exist, so the day one lands, that test fails
and forces this proof to be extended. That is the right shape for the gap.

**Two cases hide behind one requirement, and only one of them is easy:**

- *A newly registered asset that had a temporary sticker on it.* Clean. There is no history under
  the temporary tag, so an alias row pointing at the asset's UUID resolves it, and scanning the old
  sticker finds the asset. This is what WS-W4 actually asks for.
- *The 35 assets in `migration/staged/` already carrying `TMP-*` tags.* Not clean, and not a coding
  problem. **The compatibility schema keys transaction history on `asset.assetid`, not on the
  UUID** — `asset_transaction_line.asset` holds the tag. So "completing" one of those tags means
  either rewriting history rows, which rule 5 forbids, or leaving history addressed by a tag that
  is no longer the asset's identity. `db/migrations/0004_asset_identity.sql` now refuses the rename
  outright, deliberately and with no escape hatch.

That is an **identity-model** question, which CLAUDE.md's *Ask before doing* reserves for Jay. It
was not decided unilaterally. `docs/15-postgres-data-model.md` carries the alias table for the
canonical schema, where history is keyed on UUID and the problem does not arise; the practical
question is whether those 35 assets wait for that schema or get an interim answer.

---

## Pilot gate

Do not approve Ottawa until:

- feature 009 and 010 atomicity/idempotency outcomes pass;
- Entra and office-scope direct API tests pass;
- supported mobile offline behavior is recorded;
- private document access and failed-calibration behavior pass;
- migration rehearsal and both sign-offs exist;
- reports reconcile and expose no restricted fields;
- database/document restore is exercised;
- alerts and support ownership are active;
- all seven questions are answerable from production data.

---

## Progress labels

Use only:

- Spec Draft
- Spec Approved
- Mock Implemented
- API Implemented
- Azure Integrated
- Security Verified
- Device Verified
- Migration Rehearsed
- Pilot Accepted
- Production Accepted

Do not label a feature **Built** without stating which level has been evidenced.
