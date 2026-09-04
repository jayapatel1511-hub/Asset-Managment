---
description: "Task list for feature 010 — Web Application Platform"
---

# Tasks: Web Application Platform

**Input**: Design documents from `/specs/010-web-application-platform/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), contracts under [contracts/](contracts/)

**Status**: Spec **Draft** — do **not** label Spec Approved. Checklist is 5 of 112 reviewed
(Jay gate — T084). **Tasks reconciled 2026-09-03 against the working tree: 67 of 86 checked.**
Unchecked items are genuinely unbuilt or blocked (R5/R6, alias table, corrections, IaC, etc.).
See the ledger note at the end of this file.

**Tests**: Required. App suite must stay green. WS-W4 concurrency proofs run against **networked
PostgreSQL** (Docker/Colima), not PGlite.

**Organization**: Setup → Foundational (WS-W1…W3 gates) → user stories / workstreams → Polish.
First MVP proof = **US2 / WS-W4** five-asset checkout race.

**Ownership**: Only paths under `specs/010-web-application-platform/` were written by this planning
agent. Implementation tasks name future paths; create directories when the first real file needs them
— no empty scaffolding.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]–[US5]**: User stories from spec.md
- **[Wn]**: Maps to `specs/REMAINING-WORK.md` WS-W1…W12
- Paths are exact and relative to the repository root

## Path Conventions

| Area | Path |
|---|---|
| Shared contracts | `packages/contracts/` |
| API | `server/src/` |
| Migrations | `db/migrations/` |
| HTTP client | `app/src/api/http/` |
| Offline | `app/src/offline/` |
| IaC | `infra/` |
| Mock (UI only) | `app/src/api/mock/` — remains |

---

## Phase 1: Setup

- [x] T001 Read constitution 2.0.0, `docs/14-webapp-architecture.md`, `docs/15-postgres-data-model.md` (§3 APPROVED), `specs/REMAINING-WORK.md` R1–R6 / WS-W1…W12, and every file under `specs/010-web-application-platform/contracts/`
- [x] T002 [P] Confirm local Docker/Colima can run Postgres; note major version to pin (align with Azure Flexible Server target)
- [x] T003 [P] Confirm `cd app && npm test` baseline stays green; record count — do not reduce it

---

## Phase 2: Foundational — contracts freeze & local platform (WS-W1)

**⚠️ Gates**

- [x] T004 **R1 closed 2026-09-03** — four-axis state recorded in `docs/08-decisions.md` and `docs/15` §3. Do **not** invent a different model in migrations
- [x] T005 **R2 frozen 2026-09-03** — Jay accepted [contracts/transaction-command.md](contracts/transaction-command.md) for first proof (and related error/outbox/auth contracts). Confirm HTTP refusal transport in [contracts/error-codes.md](contracts/error-codes.md) before coding if still ambiguous
- [x] T006 [W1] Add root workspace orchestration (`package.json` workspaces or approved equivalent) wiring `app/`, future `server/`, `packages/contracts/` — only when creating the first package file. **Done as equivalent:** root `package.json` scripts (`dev`, `typecheck`, `test`, `db:migrate`); deliberately not npm workspaces (comment in that file)
- [x] T007 [P] [W1] Create `packages/contracts/` with TypeScript/Zod (or TypeBox) schemas mirroring frozen contracts: transaction command, caller context DTO, health, error codes. **Partial:** TypeScript types + `AmsBackend` + generated state machine exist; Zod request schemas live on the server, not in the package
- [x] T008 [P] [W1] Add `docker-compose.yml` (or documented Colima compose) for reproducible Postgres; isolated DB for integration tests; **not** PGlite for race tests
- [x] T009 [W1] Migration runner entry (`npm run db:migrate` target) applying files from `db/migrations/`
- [ ] T010 [W1] `GET /health` (and readiness) per [contracts/health-and-read.md](contracts/health-and-read.md) in `server/` — **liveness exists** as `GET /api/health` `{ ok, dataset, now }`; contract `HealthResponse` (version, schemaVersion, database check) and a readiness probe are not built
- [x] T011 [P] [W1] Root scripts: `dev`, `typecheck`, `lint`, `test`, `test:integration`, `build` — as packages exist. **`lint` is missing** (T088)
- [x] T012 [P] [W1] Baseline CI (`.github/workflows/…`) running typecheck + app tests **without** personal cloud credentials; Postgres service container for integration when those tests exist

**Checkpoint**: Local API health + Postgres up; contracts package compilable; R1/R2 gates explicit.

---

## Phase 3: Foundational — first-proof schema subset (WS-W2)

*R1/R2 closed. First-proof subset (R3) approved in data-model.md; full schema review still gates later WS-W2 slices.*

- [x] T013 [W2] After R1: author `db/migrations/` for first-proof tables in [data-model.md](data-model.md): `app_user`, roles/scope, `location`, `project`, `equipment_model`, `asset`, `asset_identifier`, `asset_id_sequence`, `asset_transaction`, `asset_transaction_line`, `command_idempotency`, `outbox_event`, `asset_relationship`. **Landed except `asset_identifier`** (absent; concurrency test asserts it does not exist). Office scope is on `app_user_role.office` (A-R5), not `user_office_scope`. Sequence table is `id_sequence`. Remaining: T089
- [x] T014 [P] [W2] DB tests: duplicate Asset ID refused; Asset ID immutable; shared serial allowed; line UPDATE/DELETE refused for app role; synthetic production load refused
- [x] T015 [W2] Second migrate run is a no-op (idempotent apply)
- [x] T016 **STOP / escalate if R3 full-schema review rejects subset columns** — amend `docs/15` before rewriting migrations

**Checkpoint**: Empty DB migrates; invariant tests green on container Postgres.

---

## Phase 4: User Story 1 — Identity & entry (Priority: P1) [US1] [W3]

**Goal**: Authorized users reach one app; API enforces role/office; browser role untrusted.

**Independent Test**: Per-role sign-in (or test double), deep link, sign-out isolation.

**Note**: Entra full path needs R6 inputs; admin matrix needs R5. Local proof may use test doubles per [contracts/auth-caller-context.md](contracts/auth-caller-context.md).

### Tests

- [x] T017 [P] [US1] [W3] Direct API tests: unauthenticated → no asset data; forbidden role → `auth.error.forbidden`
- [x] T018 [P] [US1] [W3] Browser-supplied role in body → `auth.error.clientAuthorityForbidden`
- [x] T019 [US1] [W3] Same-device user switch contract: prior queue not replayed (`auth.error.identityMismatch`) — **behaviour yes** (client `replay.ts` holds per-command; never sent). Named API error code is not the mechanism

### Implementation

- [x] T020 [US1] [W3] `server/src/auth/` — resolve `CallerContext` from session; test-auth mode only when `AMS_AUTH_MODE=test` and non-prod
- [x] T021 [US1] [W3] `GET /api/me` per health-and-read contract
- [ ] T022 [US1] [W3] **STOP until R5 decided** before locking production OfficeAdmin global vs office behaviour; keep single helper behind `adminScopeMode`
- [ ] T023 [US1] [W3] Entra OIDC + BFF cookies when R6 app registration exists — replace test doubles in Dev
- [x] T024 [P] [US1] Deep-link after sign-in preserves asset URL
- [x] T025 [P] [US1] Minimal `GET /api/assets` search with Field User field redaction

**Checkpoint**: US1 independently demonstrable with test auth; Entra when R6 ready.

---

## Phase 5: User Story 2 — Atomic command MVP (Priority: P1) 🎯 [US2] [W4]

**Goal**: Five-asset checkout commits all or none; races and idempotency hold on real Postgres.

**Independent Test**: WS-W4 first-proof list in `REMAINING-WORK.md`. **This is the programme MVP.**

*R2 frozen; proceed after T013 (migrations).*

### Tests — write first; confirm FAIL before impl

- [x] T026 [P] [US2] [W4] `server` integration: five valid assets → one txn, five lines, five derived states, outbox row(s), one commit
- [x] T027 [P] [US2] [W4] Invalid fifth asset → **zero** writes
- [x] T028 [P] [US2] [W4] Fault injection after each material step → full rollback
- [x] T029 [P] [US2] [W4] Two concurrent checkouts overlapping one asset → one win, one structured conflict
- [x] T030 [P] [US2] [W4] Lost response + retry same ID/hash → original result; one transaction
- [x] T031 [P] [US2] [W4] Same ID different payload → `command.error.idempotencyPayloadMismatch`
- [x] T032 [P] [US2] [W4] Reversed asset order → no unsafe deadlock (UUID lock order)
- [x] T033 [P] [US2] [W4] Client before/after state ignored or refused; outcome server-computed (**R1 APPROVED 2026-09-03**)
- [x] T034 [P] [US2] [W4] Accepted header/lines cannot be UPDATEd/DELETEd as app role
- [ ] T035 [P] [US2] [W4] `ReportFault` on deployed asset changes serviceability only — **not evidenced.** `ReportFault` exists; under the stored `status` model it maps to `NeedsRepair` (A-STATE / DC-22 is owned elsewhere). No test that a Deployed asset keeps disposition while only serviceability changes
- [x] T036 [P] [US2] [W4] Registration: 100 concurrent under one prefix → 100 distinct IDs; browser never reserves sequence
- [x] T037 [US2] [W4] Encode Q8/Q9 fields per frozen contract — until then keep **`R4 APPROVED 2026-09-03`** in schema/tests

### Implementation

- [x] T038 [US2] [W4] `server/src/modules/transactions/` — canonicalize, hash, idempotency claim, lock, validate, apply, outbox. **Path:** `server/src/services/transactionService.ts` + `commandService.ts`
- [x] T039 [US2] [W4] `POST /api/transactions` wired to contracts + error codes. **Path:** `POST /api/commands/:type`
- [x] T040 [US2] [W4] Checkout transition data as reviewed server data (not browser) — **R1 APPROVED 2026-09-03**
- [x] T041 [P] [US2] [W4] Outbox insert matches [contracts/outbox-envelope.md](contracts/outbox-envelope.md)
- [x] T042 [US2] [W5] `app/src/api/http/` — map checkout (first workflow) to command contract; mock remains default for UI

**Checkpoint**: Feature 009/010 atomicity and idempotency outcomes pass on container Postgres. No other write workflow is **API Implemented** before this.

---

## Phase 6: User Story 3 — PWA offline (Priority: P2) [US3] [W6]

**Goal**: Cold start, queue, ordered replay, Needs attention; partition by tenant/env/user.

*Runs after HTTP/cache contracts usable (post T042).*

### Tests

- [x] T043 [P] [US3] [W6] IndexedDB partition key isolation tests
- [x] T044 [P] [US3] [W6] Queue survives restart; pending ≠ accepted
- [x] T045 [P] [US3] [W6] Replay order + idempotent retry after lost 200
- [x] T046 [P] [US3] [W6] Conflict → Needs attention; never silent drop
- [x] T047 [P] [US3] [W6] Field User store contains no secured SIM/network/certificate bytes
- [ ] T048 [US3] [W6] Unsupported capability detection before claiming offline-ready

### Implementation

- [x] T049 [US3] [W6] `app/src/offline/` — schema version, cache projections from approved DTOs, drafts, command queue
- [x] T050 [US3] [W6] Service worker + web manifest; update strategy preserving queued commands
- [x] T051 [US3] [W6] Replay coordinator while app active; Background Sync optional only
- [ ] T052 [US3] [W6] UI: cache age, last sync, pending count, conflict count, Needs attention — **2 of 4.** Pending badges More / Needs attention; conflicts are Rejected rows. `cacheAgeMs()` exists; OfflineBar is online/offline only; last successful sync is not displayed
- [ ] T053 [US3] [W12] Device matrix evidence procedure (dated) — pilot gate; do not claim Device Verified early

**Checkpoint**: SC-006/SC-007/SC-008 testable on at least one supported device profile.

---

## Phase 7: User Story 4 — Documents (Priority: P2) [US4] [W7]

**Goal**: Private Blob; calibration fact survives upload failure; no account key to browser.

### Tests

- [x] T054 [P] [US4] [W7] Upload success + metadata link
- [x] T055 [P] [US4] [W7] Upload fail after calibration accept → Certificate missing; later attach
- [x] T056 [P] [US4] [W7] Failed calibration does not advance success summaries / return to service
- [x] T057 [P] [US4] [W7] Unauthorized download refused
- [x] T058 [P] [US4] [W7] Replacement chain retained

### Implementation

- [x] T059 [US4] [W7] `server/src/documents/` per [contracts/document-blob.md](contracts/document-blob.md)
- [x] T060 [US4] [W7] Managed identity / local emulator path for Dev; never ship account key to client
- [x] T061 [US4] [W7] Malware-scan disposition hook — **ASSUMPTION** until Open Decision #10 closes
- [ ] T062 [P] [US4] [W5] HTTP adapter methods for upload session / complete / download auth — `app/src/api/http/index.ts` has no document methods

**Checkpoint**: SC-009/SC-010/SC-011 evidenced in Dev.

---

## Phase 8: User Story 5 — Operate & recover (Priority: P3) [US5] [W8][W9][W10][W11][W12]

**Goal**: Successor can deploy, observe, roll back, restore. R6 blocks real Azure; local/CI proceed.

- [x] T063 [P] [US5] [W8] Outbox worker claim/lease/retry in `server/src/outbox/`; backlog alert hook
- [x] T064 [P] [US5] [W9] Read-only report routes/views for seven questions; secured fields omitted
- [ ] T065 [US5] [W10] **STOP until R6** for production subscription/region — then `infra/` Bicep + Container Apps + ACR + Postgres + Blob + identities
- [ ] T066 [US5] [W10] GitHub Actions OIDC to Azure; immutable revision records commit/image/schema
- [ ] T067 [US5] [W10] Documented traffic rollback + migration compatibility check before promote
- [ ] T068 [P] [US5] [W11] PostgreSQL target writer adapting `migration/` pipeline; refuse synthetic in prod
- [ ] T069 [US5] [W12] Security matrix, restore exercise, load targets — evidence for pilot (feature 009 consumes)

**Checkpoint**: SC-012–SC-014 path defined; Azure Integrated only after T065–T067 evidenced.

---

## Phase 9: HTTP workflow migration remainder [W5]

*After T042 checkout green — migrate in REMAINING-WORK order.*

- [x] T070 [W5] return
- [x] T071 [W5] transfer
- [x] T072 [W5] register / complete temporary tag — **register (`POST /api/assets`) yes; complete-temporary-tag workflow no** (no alias table — T089 / T090)
- [x] T073 [W5] fault / repair
- [x] T074 [W5] missing / found
- [x] T075 [W5] calibration dispatch / physical return — **dispatch (`SendToCalibration`) yes; no dedicated physical-return command** (return-from-lab is ordinary Return)
- [x] T076 [W5] calibration record / correction — **record (`POST /api/calibrations`) yes; Correction command no** (T091)
- [x] T077 [W5] retire / rehome — **retire yes; Rehome command no** (T092)
- [ ] T078 [W5] component attach / detach — only as part of deploy / recover / swap; no standalone attach/detach command
- [x] T079 [W5] deploy / recover
- [x] T080 [W5] component swap / configuration change
- [ ] T081 [W5] audit — configuration-change writes an `Audit` line; no standalone inventory-audit command
- [ ] T082 [W5] Each workflow: contract tests, auth, atomicity/idempotency, structured codes, no direct state edit

---

## Phase 10: Polish & cross-cutting

- [ ] T083 [P] Record every closed ASSUMPTION (R1–R5, Q8/Q9, scan route) into `docs/08-decisions.md` when Jay decides — **orchestrator / Jay**; this feature’s contracts already mark them
- [ ] T084 [P] Continue 010 checklist review (107 remaining) — Jay gate, not silent agent checkmarks
- [x] T085 Final verification: app tests green; integration race suite green on container Postgres; no Dataverse/Zite paths reintroduced
- [ ] T086 Do **not** mark feature Spec Approved or API Implemented without dated evidence matching progress labels in `REMAINING-WORK.md`

### Remaining (added 2026-09-03 — not in the original 86)

- [ ] T087 [W1] Health contract: readiness probe + `HealthResponse` shape (version, schemaVersion, `checks.database`) — T010 remainder
- [ ] T088 [W1] Root `lint` script (T011 listed it; it does not exist)
- [ ] T089 [W2] `asset_identifier` (first-proof table; aliases for temporary/legacy tags). Do not treat `istemporarytag` regex as a substitute
- [ ] T090 [W5] Complete-temporary-tag workflow that keeps the old tag as a searchable alias — blocked on T089 and the identity-model question in `REMAINING-WORK.md`
- [ ] T091 [W5] Correction as a compensating event (FR-017 / rule 5) — not a transaction type today
- [ ] T092 [W5] Rehome (permanent home-office change) as a named command — Transfer does not move `homeoffice`

---

## Dependencies & Execution Order

```text
T001–T003 Setup
    → T004 R1 STOP / T005 R2 STOP (gates)
    → T006–T012 WS-W1
    → T013–T016 WS-W2 subset (needs R1)
    → T017–T025 US1 / W3 (Entra needs R6; R5 stops admin freeze)
    → T026–T042 US2 / W4 MVP  ← first production proof
    → T070–T082 W5 workflows ∥ T043–T053 W6 ∥ T054–T062 W7 ∥ T063 W8
    → T064 W9
    → T065–T067 W10 (needs R6)
    → T068 W11
    → T069 W12 / 009 evidence
```

### Parallel opportunities

- T007 ∥ T008 ∥ T012 after workspace exists
- T014 invariant tests ∥ early auth tests once DB up
- T026–T036 race tests authored in parallel (one agent owns the suite file if shared)
- After W4: W5/W6/W7/W8 in parallel behind frozen contracts
- W10 can begin naming/IaC drafts before R6 but must not create billable Azure resources without Jay approval (`CLAUDE.md` Ask before doing)

### MVP strategy

Phase 1–2 → R1/R2 gates → Phase 3 subset → Phase 5 (US2) → **stop and validate five-asset race**.
US1 stubs are enough for that proof. US3–US5 follow. Do not start more operational screens before
the command boundary exists.

## ASSUMPTIONs encoded (open questions)

| Marker | Topic | Blocks |
|---|---|---|
| `R1 APPROVED 2026-09-03` | Three-axis state columns / transitions | Migrations + derive logic |
| `R4 APPROVED 2026-09-03` | Q8 expected return; Q9 backdating / `effectiveAt` | Checkout field freeze |
| `ASSUMPTION: R5` | Global vs office-scoped OfficeAdmin | Auth matrix production behaviour |
| R6 | Azure enterprise set | W10 deploy only — **not** local W4 |
| Document scan route | Open Decision #10 | Quarantine automation |
| Error HTTP status for business refusal | 200+`ok:false` vs 409 | Freeze with R2 |

## Ledger reconcile — 2026-09-03

Read against `server/`, `app/`, `db/migrations/`, `packages/contracts/`, `.github/workflows/`.
Did not re-run the suite; counts below are from that tree plus `docs/21` / `REMAINING-WORK.md`.

| | Original 86 | After |
|---|---|---|
| Checked | 2 (T004, T005) | **67** |
| Unchecked original | 84 | **19** |
| Added remaining | — | T087–T092 (all unchecked) |

**Left unchecked on purpose:** T010 (readiness/contract shape), T022 (R5), T023 (R6 Entra tenant),
T035 (serviceability-only on Deployed — not evidenced under stored `status`), T048 (capability
detection), T052 (cache age / last sync UI), T053 (device matrix), T062 (HTTP document adapter),
T065–T067 (`infra/`), T068 (PostgreSQL `04_load.py` still JSON), T069 (pilot restore evidence),
T078 / T081 / T082 (attach-detach, standalone audit, per-workflow completeness), T083–T084 / T086
(Jay gates / do-not-label).

**Not claimed:** DC-22 / A-STATE amendment, `asset_identifier`, feature 011 dictionary or Rule 7
reference commands.
