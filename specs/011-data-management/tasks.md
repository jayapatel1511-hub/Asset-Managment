---
description: "Task list for feature 011 — Data Management & Stewardship"
---

# Tasks: Data Management & Stewardship

**Input**: Design documents from `/specs/011-data-management/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Required at each story. Prefer failing tests before implementation. Direct API role/office tests for every write path.

**Organization**: Phases follow CLAUDE.md order — read-only dictionary + quality first; high-impact writes after 010 foundations.

**Read first**: `specs/_planning/MULTI-AGENT-OWNERSHIP.md`, `.specify/memory/constitution.md`, `CLAUDE.md` (rules 14–20; sequence 6, 10–13), `docs/16-data-management.md`, `docs/15-postgres-data-model.md`.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USn]**: User story from spec.md
- Paths are exact and relative to the repository root
- **Blocked on 010 WS-W3/W4 foundations** marks write work that must not start early

## Path Conventions (when implementation begins)

```text
server/src/modules/data-management/
db/migrations/
packages/contracts/          # created by 010 — 011 adds schemas
app/src/features/data-management/   # Console content; shell is WS-W5
```

Do **not** create empty scaffolding until the first owned implementation task needs a directory.

**Prohibited**: `PATCH /table/{id}`, arbitrary SQL editor, Dataverse/Zite adapters, ordinary hard-delete of referenced records.

---

## Phase 1: Setup / read docs

- [ ] T001 Read `specs/_planning/MULTI-AGENT-OWNERSHIP.md`, `.specify/memory/constitution.md`, `CLAUDE.md` (data-management rules 14–20 and sequence steps 6, 10–13), `docs/16-data-management.md`, `docs/15-postgres-data-model.md` §1–2 and open decisions, `specs/011-data-management/spec.md`, `checklists/requirements.md`, `specs/REMAINING-WORK.md` (WS-W2–W8, surfaces/Console note), and all files under `specs/011-data-management/contracts/`
- [ ] T002 [P] Confirm Power Platform and Zite are parked — no tasks may target `solution/`, `app/src/api/dataverse/`, or `zite/`
- [ ] T003 [P] Record baseline: existing `app/` tests still green (`cd app && npm test`); do not claim monorepo `test:integration` until 010/WS-W1 creates it

**Checkpoint**: Planning inputs understood; no code changes required in Phase 1.

---

## Phase 2: Foundational — dictionary schema + read APIs (after 010 schema gate)

**⚠️ CRITICAL**: Do not start until G0.5 / WS-W2 accepts `docs/15` **including** docs/16 §14 entities (see [data-model.md](data-model.md)). Mark **ASSUMPTION: R3** until then.

**STOP GATE — Open decisions**: OD-4 (classification labels) may use a Dev placeholder enum only if every production path is flagged non-Prod-Accepted; do not invent corporate taxonomy.

- [ ] T004 Align `docs/15-postgres-data-model.md` approval checklist with [data-model.md](data-model.md) entities — Agent 011 drafts the checklist item list in a PR comment or 011 note only; **does not edit docs/15** (orchestrator / Jay owns docs). Stop if entities rejected
- [ ] T005 After schema approval: add forward-safe migrations under `db/migrations/` for `data_dictionary_entry`, `data_quality_rule`, `data_quality_issue` (read-first subset). Defer write-heavy tables (`data_job*`, `data_change_request`, `record_redirect`, `retention_policy`, `legal_hold`, `data_source_record`) to later phases if needed for sequencing — or land all tables inactive if WS-W2 prefers one migration set
- [ ] T006 [P] Add shared TypeScript schemas for dictionary + quality reads to `packages/contracts/` matching `contracts/field-dictionary.md` and `contracts/quality-issue.md` (package must exist from 010/WS-W1)
- [ ] T007 [P] Implement `GET /api/data-management/dictionary`, `GET .../dictionary/{entity}/{field}`, `GET .../dictionary/coverage` in `server/src/modules/data-management/` — Field User denied; server-side paging
- [ ] T008 Seed machine-readable dictionary artifact (path TBD under `db/` or `data/` — prefer committed JSON/YAML checked by CI) covering all fields in the approved schema subset
- [ ] T009 Add `npm run data:dictionary:check` (or equivalent) failing on missing/contradictory production field entries (FR-002 / SC-001 gate wiring)
- [ ] T010 [P] Integration tests: coverage report; unauthorized Field User refused; paging does not require full fleet in memory

**Checkpoint**: Read-only dictionary API + coverage check exist against PostgreSQL.

---

## Phase 3: US1 — Quality dashboard + issue queue (P1) 🎯 First DM proof

**Goal**: Steward sees trustworthy overview counts and owns every issue through assign / resolve / waive / false-positive with re-evaluation.

**Independent Test**: Seed one failure per critical rule family, run rules, assign across two offices, resolve some, waive one with expiry, confirm dashboard and history.

**May begin** after Phase 2 + enough auth to protect routes (WS-W3). Mutating issue commands: **Blocked on 010 WS-W3/W4 foundations**.

**STOP GATE**: OD-1 / OD-2 / OD-12 for production alert SLAs — until decided, store owner + severity; do not invent SLA hours.

### Tests for US1

- [ ] T011 [P] [US1] DB/API test: re-running rules updates one issue per `(rule, entity, scope)` — zero duplicate opens (FR-010, SC-003)
- [ ] T012 [P] [US1] Resolve without re-eval or manual verification refused (FR-012)
- [ ] T013 [P] [US1] Waiver requires reason, approver, expiry; expiry reopens if still failing (FR-013)
- [ ] T014 [P] [US1] Overview filters by office/domain/severity respect same scope as issue list; `dataCurrency` + rule version present (FR-015)
- [ ] T015 [P] [US1] Cross-office Office Admin cannot assign issues outside scope

### Implementation for US1

- [ ] T016 [US1] Implement versioned `data_quality_rule` catalogue seed for initial rules in docs/16 §6 / CHK051–CHK068 (as many as schema supports; mark incomplete rules explicitly)
- [ ] T017 [US1] `POST .../quality/commands/run-rules` as `QualityRuleRun` job — worker-safe; idempotent
- [ ] T018 [US1] Issue read APIs + assign / set-status / waive / false-positive / verify-resolution commands per `contracts/quality-issue.md` — **Blocked on 010 WS-W3/W4 foundations**
- [ ] T019 [P] [US1] Console overview + issue queue UI under `app/src/features/data-management/` — **depends on WS-W5 Console shell**; coordinate routes (`surfaces: console`)
- [ ] T020 [US1] Alert hook stub for critical/age thresholds naming owner — **STOP OD-12** before enabling production notification cadence

**Checkpoint**: First Data Management proof — dictionary + rule-driven issue queue — demonstrable in Dev.

---

## Phase 4: US2 — Reference / master data commands (P1)

**Goal**: Create / edit / deactivate / re-parent / alias / merge reference records with impact preview; never ordinary hard-delete.

**Blocked on 010 WS-W3/W4 foundations** for all write commands.  
**STOP GATE**: OD-1 Data Steward role shape; R5 admin scope; OD-7 Office Admin reference bounds.

### Tests for US2

- [ ] T021 [P] [US2] Duplicate business key refused; cyclic location re-parent refused
- [ ] T022 [P] [US2] Hard delete refused; deactivate hides from new selection; historical display retained
- [ ] T023 [P] [US2] Impact preview required before merge/reclassification
- [ ] T024 [P] [US2] ExternalAuthoritative local edit refused or override-only
- [ ] T025 [P] [US2] Office-scoped admin cannot change global catalogue entries

### Implementation for US2

- [ ] T026 [US2] Reference command module per `contracts/reference-command.md` — create/edit/deactivate/reactivate/reparent/alias/preview/merge
- [ ] T027 [US2] Equipment category hierarchical curated rows (REMAINING-WORK G0.1) — admin maintenance in-app, not CSV-as-source
- [ ] T028 [P] [US2] Console reference management screens (Console shell: WS-W5)
- [ ] T029 [US2] Audit + quality re-eval outbox after applied reference change

**Checkpoint**: Curated reference maintenance without free-text drift.

---

## Phase 5: US3 — Static corrections (P1)

**Goal**: Correct static asset facts with evidence; refuse derived state, canonical ID mutation, history edits.

**Blocked on 010 WS-W3/W4 foundations.**  
**STOP GATE**: OD-3 approval thresholds.

### Tests for US3

- [ ] T030 [P] [US3] Correct serial/model/ownership/notes happy paths with audit
- [ ] T031 [P] [US3] Direct correction of disposition/location/custodian/lifecycle refused with `correction.useBusinessEvent` or `derivedStateForbidden`
- [ ] T032 [P] [US3] Canonical Asset ID change refused; alias add allowed under rules
- [ ] T033 [P] [US3] Transaction line edit/delete refused
- [ ] T034 [P] [US3] Self-approval refused where configured
- [ ] T035 [P] [US3] Applied correction triggers quality re-evaluation

### Implementation for US3

- [ ] T036 [US3] Named correction commands + preview/apply/approve per `contracts/static-correction.md`
- [ ] T037 [US3] Route Rehome / attach / detach to 010 transaction API — do not reimplement state machine
- [ ] T038 [P] [US3] Console correction UI with impact preview for high-impact fields

**Checkpoint**: SC-006 path exists — zero direct derived-state edits via data management.

---

## Phase 6: US4 — Bulk import dry-run / apply (P2)

**Goal**: Versioned templates; dry-run with row outcomes; apply gates; idempotent retries.

**Blocked on 010 WS-W3/W4 foundations**; async apply needs WS-W8 workers; source blobs WS-W7.  
**STOP GATE**: OD-3, OD-7, OD-9.

### Tests for US4

- [ ] T039 [P] [US4] Dry-run writes zero business changes; every row has status
- [ ] T040 [P] [US4] Row with SystemDerived column → Invalid, not hidden translate
- [ ] T041 [P] [US4] Apply refuses source hash change, expired approval, permission loss, target drift
- [ ] T042 [P] [US4] Logical atomic group commits together across batches
- [ ] T043 [P] [US4] Same idempotency identity retry → zero duplicate effects
- [ ] T044 [P] [US4] Failure distinguishes applied / unapplied / uncertain
- [ ] T045 [P] [US4] 5,000-row dry run meets approved budget (SC-007) — record budget when known

### Implementation for US4

- [ ] T046 [US4] Migrations for `data_job` / `data_job_item` if not in Phase 2
- [ ] T047 [US4] Import template registry + downloadable versioned templates + dictionary subset
- [ ] T048 [US4] Dry-run and apply endpoints per `contracts/data-job.md`
- [ ] T049 [US4] Worker apply path — lock budget respects FR-081
- [ ] T050 [P] [US4] Console job review UI (row-level outcomes, approve/apply)

**Checkpoint**: Bulk work is governable; no silent row loss.

---

## Phase 7: US5 — Duplicates / redirect (P2)

**Goal**: Human-reviewed candidates; redirect merge preserves UUIDs/histories; no serial auto-merge.

**Blocked on 010 WS-W3/W4 foundations.**  
**STOP GATE**: OD-11 conflicting post-go-live histories.

### Tests for US5

- [ ] T051 [P] [US5] Shared-serial logger/geophone → candidate only; auto-merge impossible
- [ ] T052 [P] [US5] Merge creates redirect; both UUIDs preserved; transaction lines unchanged
- [ ] T053 [P] [US5] Merged-away refuses new operational commands; search redirects with explanation
- [ ] T054 [P] [US5] Incompatible current state refuses merge
- [ ] T055 [P] [US5] NotDuplicate / RelatedPhysicalAssets suppress repeat until evidence changes
- [ ] T056 [P] [US5] NeedsPhysicalAudit creates owned due issue

### Implementation for US5

- [ ] T057 [US5] `record_redirect` + duplicate candidate APIs per `contracts/duplicate-redirect.md`
- [ ] T058 [US5] Preview-merge + resolve commands with SoD
- [ ] T059 [P] [US5] Console duplicate review UI

**Checkpoint**: SC-010 / SC-011 satisfiable in Dev/UAT.

---

## Phase 8: US6 — External reconciliation (P3)

**Goal**: Authority-aware dry-run and apply for external snapshots; no silent overwrite of local or source-owned fields.

**Blocked on 010 WS-W3/W4 foundations.**  
**STOP GATE**: OD-10 project-master authority; people sync uses Entra/`app_user` — no staff table.

### Tests for US6

- [ ] T060 [P] [US6] Reconciliation reports new/changed/unchanged/missing/conflicting
- [ ] T061 [P] [US6] Locally authoritative field not overwritten by source
- [ ] T062 [P] [US6] Source-authoritative field ordinary local edit refused
- [ ] T063 [P] [US6] Checkpoint retry idempotent
- [ ] T064 [P] [US6] Stale source surfaces age + owner alert hook

### Implementation for US6

- [ ] T065 [US6] Integration contract records + `Reconciliation` job type wiring `data_source_record` lineage
- [ ] T066 [US6] Dry-run/apply commands; conflict queue
- [ ] T067 [P] [US6] Console reconciliation UI

**Checkpoint**: Sync is auditable and authority-safe.

---

## Phase 9: US7 — Governed exports (P3)

**Goal**: Role-limited templates; server field/row scope; private short-lived artifacts.

**Blocked on 010 WS-W3/W4 foundations**; Blob WS-W7.  
**STOP GATE**: OD-8 initial templates and limits; OD-4 classification on artifacts.

### Tests for US7

- [ ] T068 [P] [US7] Field User / Office Admin / Steward / Report Reader each see only permitted templates (SC-013)
- [ ] T069 [P] [US7] Restricted identifiers absent from general export bytes
- [ ] T070 [P] [US7] Expired download refused; artifact deleted/inaccessible (SC-014)
- [ ] T071 [P] [US7] Large/restricted export requires second approval; self-approval refused
- [ ] T072 [P] [US7] No fleet-wide raw export for Field User

### Implementation for US7

- [ ] T073 [US7] Export template registry + request/download per `contracts/governed-export.md`
- [ ] T074 [US7] Async export job + private Blob path + expiry worker
- [ ] T075 [P] [US7] Console export UI (purpose required)

**Checkpoint**: Export is a governed product.

---

## Phase 10: US8 — Retention / legal hold (P4)

**Goal**: Register + hold + preview + purge apply; no general delete path.

**Blocked on 010 WS-W3/W4 foundations.**  
**STOP GATE**: OD-5 retention periods; OD-6 hold authority/release. Until OD-5: preview/register only for non-indefinite classes; do not invent periods.

### Tests for US8

- [ ] T076 [P] [US8] Preview writes zero changes; counts eligible/held/blocked
- [ ] T077 [P] [US8] Hold excludes matching DB + documents from purge
- [ ] T078 [P] [US8] Indefinite asset/history purge without policy change refused
- [ ] T079 [P] [US8] Self-release of hold refused where SoD applies
- [ ] T080 [P] [US8] Ordinary user has no general delete API (`delete.notAvailable`)
- [ ] T081 [P] [US8] Post-purge DB/document reconciliation exact

### Implementation for US8

- [ ] T082 [US8] `retention_policy` + `legal_hold` APIs per `contracts/retention-legal-hold.md`
- [ ] T083 [US8] Preview + purge-apply jobs with recovery prerequisites
- [ ] T084 [P] [US8] Console retention register / hold / preview UI (Console: WS-W5)

**Checkpoint**: SC-015 / SC-016 path exists; purge only via controlled job.

---

## Phase 11: Polish & cross-cutting

- [ ] T085 [P] Lineage “Why does the system say this?” read API for custodian/location/project/model/calibration/merged identity (FR-058) — may ship incrementally after US3/US5
- [ ] T086 [P] Sensitive-value redaction review across job messages, logs, unauthorized artifacts (FR-079)
- [ ] T087 Direct API security matrix for all data-management routes (roles × offices) — feeds WS-W12
- [ ] T088 Scale smoke: overview + issue search at 5,000 assets / 100k lines without full client download (SC-017)
- [ ] T089 Confirm no generic PATCH/SQL editor landed — grep/CI deny-list
- [ ] T090 Pilot evidence checklist: SC-001, SC-006, SC-010, SC-011, SC-013–SC-016, SC-018–SC-019 mapped to dated test runs; migration sign-offs remain 009/WS-W11

---

## Dependencies / STOP summary

| Gate | Blocks |
|---|---|
| docs/15 + 011 entities approved (R3) | Phase 2+ |
| WS-W3 auth + OD-1 / R5 | Authorized reads beyond Dev bypass; all writes |
| **010 WS-W3/W4 foundations** | US2 writes, US3–US8 |
| WS-W5 Console shell | UI tasks T019, T028, T038, T050, T059, T067, T075, T084 |
| WS-W7 Blob | Import sources, export artifacts, purge docs |
| WS-W8 workers | Async apply, scheduled quality, export gen, purge |
| OD-3 / OD-5 / OD-6 / OD-8 / OD-10 / OD-11 / OD-12 | As marked per phase |

## Parallel example

```text
# After Phase 2 schema + contracts package exist:
T006, T007, T008 in parallel once migrations applied
T011–T015 test authoring in parallel before T016–T018
# Never parallelize a write story ahead of 010 W3/W4 freeze
```

## Implementation strategy

1. Complete Phase 2–3 (dictionary + quality) as the first useful DM capability.
2. Hard-stop write stories on 010 atomic command + auth + audit.
3. Deliver US2 → US3 → US4 → US5 before US6–US8.
4. Keep Console UI behind WS-W5 shell; 011 owns data-admin capability only.
5. Every phase leaves independently testable API behaviour even if UI waits on Console.
