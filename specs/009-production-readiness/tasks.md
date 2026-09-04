---
description: "Task list for feature 009 — Production Readiness (evidence gate)"
---

# Tasks: Production Readiness

**Input**: Design documents from `/specs/009-production-readiness/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md), [contracts/](contracts/)

**Tests**: Required. 009 tasks are **prove / record / refuse-to-claim**. Implementers build harnesses against **010** APIs and PostgreSQL; they do **not** invent UI screens under this feature.

**Organization**: Tasks follow user stories US1–US6. Map to **WS-W4** (atomic/identity local proof) and **WS-W12** (security, device, cutover, recovery, pilot). Device harness targets are built under WS-W6; 009 records evidence.

**Read first**: constitution, `CLAUDE.md`, `docs/23-canonical-product-ux-contract.md`,
`docs/25-need-to-know-access-ux.md`, and `specs/REMAINING-WORK.md` (WS-W4, WS-W12, pilot gate).
`specs/_planning/MULTI-AGENT-OWNERSHIP.md` is historical ownership context only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US6 from spec.md
- Paths are exact and relative to the repository root where named; 010 contract paths are **consume targets** (“consumes 010 contracts”)

## Path Conventions

- Evidence contracts: `specs/009-production-readiness/contracts/`
- Command shapes: `specs/010-web-application-platform/contracts/` — do not redefine
- Harness code: lives with 010 server/integration tests when that tree exists (e.g. `server/` or monorepo `test/integration/`) — create only when implementing, not as empty scaffolding from 009
- Dated evidence: record per contract schema; prefer `docs/evidence/009/` once the orchestrator creates it

## Gates

- **R1–R4** must be decided/frozen enough before claiming local WS-W4 pass
- **R2** 010 atomic command contract freeze blocks T020+ implementation claims
- **R5** is decided: OfficeAdmin is assigned-office scoped; SystemOwner has a global row-scope ceiling
- **R6** blocks Azure recovery drills and hosted production-env device claims — does **not** block local five-asset race

---

## Phase 1: Setup

- [ ] T001 Read `specs/009-production-readiness/spec.md`, `plan.md`, all files under `contracts/`, `docs/13-production-readiness-review.md` § P0 atomic/identity and Gates C–E, and `specs/REMAINING-WORK.md` WS-W4 / WS-W12 / pilot gate
- [ ] T002 [P] Confirm maturity vocabulary in use is Spec Approved → Mock Implemented → API Implemented → Azure Integrated → Security Verified → Device Verified → Migration Rehearsed → Pilot Accepted → Production Accepted — **never** “Tenant Implemented” or bare “Built”
- [x] T003 [P] Spec scrub applied 2026-09-03: FR-031 / CHK035 Code App → without Power Apps runtime; FR-041 → README maturity vocabulary

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No US1/US2 pass claim until 010 contracts freeze and a real PostgreSQL target exists. Do not substitute PGlite alone for lock-order / race proofs.

- [ ] T004 Confirm consume pointers exist for 010 contracts: `specs/010-web-application-platform/contracts/transaction-command.md`, `idempotency.md`, `auth-session.md`, `error-codes.md`, `outbox-envelope.md`, `health.md` (and `document-upload.md` for recovery). If missing, mark blocked — **consumes 010 contracts**; do not draft command shapes here
- [ ] T005 Confirm R1–R4 status: record ASSUMPTION markers for any still-open Q8/Q9 fields; refuse to claim WS-W4 done while R2 command contract was frozen 2026-09-03
- [ ] T006 Confirm reproducible local PostgreSQL (WS-W1/W2) is available for concurrency tests — container or Flexible Server Dev
- [ ] T007 Preflight: health endpoint from 010 `health.md` returns ready against the test database before any race batch
- [ ] T008 Create evidence log template (owner, date, environment, commit/image/schema, pass/fail, artifact links) matching fields required by FR-043 / SC-014 — reuse across all contracts

**Checkpoint**: Foundations ready. Command shapes owned by 010. 009 may only assert outcomes.

---

## Phase 3: User Story 1 — Apply one complete event or none (P1) 🎯 First proof / WS-W4

**Goal**: Prove one multi-asset command commits all or none against real PostgreSQL (SC-001–SC-005, SC-014 for this gate).

**Independent Test**: Run `contracts/five-asset-race.md` scenarios; retain dated evidence. Building the transaction service is **010 / WS-W4** — this story proves it.

### Harnesses for User Story 1

> **Write harnesses first; they must FAIL against stubs. Pass only against real Postgres + 010 API.**

- [ ] T009 [P] [US1] Integration harness for scenario **S1** (five valid assets) per `contracts/five-asset-race.md` — one event, five immutable lines, five consistent derived states, outbox present
- [ ] T010 [P] [US1] Harness **S2** — one invalid among five → refuse all; zero headers/lines/state/outbox
- [ ] T011 [P] [US1] Harness **S3** — fault injection after partial work → full rollback
- [ ] T012 [P] [US1] Harness **S4** — concurrent incompatible requests → exactly one success (batch toward SC-002 × 100)
- [ ] T013 [P] [US1] Harness **S5** — lost-response retry same ID+hash → original result, no duplicate (batch toward SC-003 × 100)
- [ ] T014 [P] [US1] Harness **S6** — same ID different payload → refused (hash mismatch)
- [ ] T015 [P] [US1] Harness **S7** — reversed lock order / overlapping sets → no unsafe deadlock; stable arbitration
- [ ] T016 [P] [US1] Harness **S8** — browser-supplied `statusBefore`/`statusAfter` (and peers) ignored; server snapshots win (SC-005)
- [ ] T017 [P] [US1] Harness **S9** — correction is compensating event; original lines unchanged
- [ ] T018 [US1] Run deliberate multi-asset failure suite toward **SC-001** (100 runs, zero partial events); record dated evidence
- [ ] T019 [US1] **Refuse-to-claim**: do not mark features 001–005 API Implemented until T009–T018 pass on real PostgreSQL

**Checkpoint**: WS-W4 first proof outcomes green locally (R1–R4). Azure retest is T050.

---

## Phase 4: User Story 2 — Allocate stable identity safely (P1) / WS-W4

**Goal**: 100 concurrent registrations → 100 unique canonical Asset IDs; aliases; no browser sequence authority (SC-004, SC-007).

- [ ] T020 [P] [US2] Harness **R1–R5** per `contracts/registration-concurrency.md` — concurrent allocate, no client sequence reserve, TMP alias retention, immutable canonical ID, non-unique serial search
- [ ] T021 [US2] Run **100 concurrent registrations** under one prefix; assert 100 unique committed IDs (SC-004); dated evidence
- [ ] T022 [US2] **Refuse-to-claim**: registration is not API Implemented if sequence can be advanced from the browser or via elevated client credentials

**Checkpoint**: Identity allocation proved with WS-W4 registration proof.

---

## Phase 5: User Story 3 — Preserve simultaneous asset facts (P1)

**Goal**: Lifecycle, disposition, serviceability and calibration currency remain independent (`R1 APPROVED 2026-09-03`).

- [ ] T023 [P] [US3] Harness: fault report does not clear custody/project/location
- [ ] T024 [P] [US3] Harness: repair completion does not invent office return
- [ ] T025 [P] [US3] Harness: overdue deployed asset excluded from availability and present in calibration oversight
- [ ] T026 [P] [US3] Harness: missing/found and in-transit have complete attributable entry/exit paths
- [ ] T027 [US3] Cross-check SC-006 with in-app read-only reports and/or approved reporting views (**not** Power Apps runtime) once WS-W9 exists — record evidence or mark blocked on reporting
- [ ] T028 [US3] Calibration create/correct/void/fail date recalculation checks toward SC-008 — consume 010 calibration commands when available; else block

**Checkpoint**: Three-axis facts survive ordinary events; R1 assumptions explicit in evidence.

---

## Phase 6: User Story 4 — Prove authorization through every path (P2) / WS-W12

**Goal**: Prove the workspace × purpose × capability × row-scope × projection matrix through every path;
forbidden direct routes fetch no protected data, and Field Work / general Reports receive only their
allowlisted projections (SC-009, SC-010, SC-016–SC-018). Depends on WS-W3.

- [ ] T029 [US4] Freeze `contracts/security-matrix.md` for the decided R5 model and D18 dimensions:
  identity, tenant/environment, workspace, purpose, named capability, row scope and projection
- [ ] T030 [P] [US4] Field Work direct-response/cache/export tests: assert exact allowlist and zero
  calibration/evidence, maintenance, cost, performer, quality, audit, secured-network, free-text and
  internal-identifier fields
- [ ] T031 [P] [US4] Direct API tests: OfficeAdmin cannot read or write another office; SystemOwner is
  denied without the exact workspace, purpose, capability or projection despite its global row ceiling
- [ ] T032 [P] [US4] General Reports tests: exact allowlist, no secured or evidential fields, read-only
  Reports navigation and zero Work/Scan/Administration fetches for ReportReader (SC-010, SC-018)
- [ ] T033 [P] [US4] Server refuses relationship cycles, self-parenting, second open parent, historical line edits
- [ ] T034 [P] [US4] Automation / worker identity is least privilege — assert its exact purpose,
  capabilities, row scope and projection rather than a broad owner role
- [ ] T035 [US4] Include document, export, report and wrong-workspace direct routes in the SC-009 sweep;
  assert authorization occurs before lookup, zero protected fetches, no existence leak, and cache purge
  after workspace/identity/capability change (SC-016–SC-017). UI-only checks do **not** count
- [ ] T036 [US4] **Refuse-to-claim**: Security Verified requires dated matrix evidence; interface filtering is never the boundary

**Checkpoint**: Security Verified eligible only after T029–T036 pass in the target environment (full Entra on Azure Integrated).

---

## Phase 7: User Story 5 — Establish real mobile and offline behavior (P2) / WS-W6 build + WS-W12 evidence

**Goal**: Hosted iOS/Android evidence for every claimed offline/scanner behavior (SC-011). Mock queue ≠ Device Verified.

- [ ] T037 [US5] Create empty evidence sheets from `contracts/device-evidence.md` for each device in the supported matrix
- [ ] T038 [P] [US5] Record online→offline, cold reopen offline, reboot offline, queue persist, conflict→Needs Attention, auth expiry before replay, identity change isolation, no secured fields in Field User storage
- [ ] T039 [US5] Camera permission denied/granted/interrupted cases on supported devices
- [ ] T040 [US5] Any behavior that fails: **remove from pilot acceptance** or mark unsupported (FR-034) — do not claim Device Verified
- [ ] T041 [US5] **Refuse-to-claim**: Device Verified needs hosted published-client evidence under R6-capable environments for production claim; local desktop mock is insufficient

**Checkpoint**: Device Verified or explicit unsupported carve-out documented.

---

## Phase 8: User Story 6 — Cut over and recover safely (P3) / WS-W11 + WS-W12

**Goal**: Migration rehearsal acceptance (SC-012) and separate app / platform / data+document recovery (SC-013). Recovery drills need **R6**.

### Cutover

- [ ] T042 [US6] Execute `contracts/cutover-reconciliation.md` checklist against UAT rehearsal — snapshot, delta, freeze, legacy read-only, every post-rehearsal change loaded or reported
- [ ] T043 [US6] Confirm model-review and conflict-report sign-offs block production load when absent (FR-039)
- [ ] T044 [US6] Ambiguous calibration remains unmatched until human confirm (FR-038)
- [ ] T045 [US6] Final source/staged/target reconciliation accounts for every row (SC-012); dated evidence → Migration Rehearsed eligibility

### Recovery (R6)

- [ ] T046 [US6] App revision rollback drill per `contracts/recovery-drill.md` — **no** business data change
- [ ] T047 [US6] PostgreSQL restore drill — measured RTO/RPO; metadata reconciliation
- [ ] T048 [US6] Private Blob / calibration document restore drill — hash reconciliation; retired-asset retrieval
- [ ] T049 [US6] Confirm three procedures remain separate with named owners (FR-040); dated evidence

**Checkpoint**: Migration Rehearsed and recovery evidence ready for pilot gate (Azure).

---

## Phase 9: Polish — Retest, pilot checklist, status honesty

- [ ] T050 [P] Retest five-asset race + registration concurrency on Dev/UAT after Azure Integrated (same contracts)
- [ ] T051 [P] WS-W12 scale sample as pilot evidence: overlapping load toward 5,000 assets / 100,000+ lines — record pass/fail honestly; do not block local WS-W4 on this
- [ ] T052 Pilot checklist: 20+ real checkout/return cycles, deliberate double booking, offline conflict path, calibration certificate path, physical stock sample, seven acceptance questions from live data (SC-015)
- [ ] T053 Verify every gate has named owner, date, evidence link, pass/fail (SC-014 / FR-043)
- [ ] T054 **Refuse-to-claim** Production Accepted until SC-015 and all seven programme questions are answered from tenant data
- [ ] T055 Update feature status language only to levels actually evidenced; never “Tenant Implemented”

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: blocks all pass claims; waits on 010 contract freeze + Postgres
- **US1 / US2 (Phases 3–4)**: after Phase 2; **WS-W4**; R1–R4; local OK without R6
- **US3 (Phase 5)**: after US1 command path; R1
- **US4 (Phase 6)**: after WS-W3; R5 is decided; full D18/Entra matrix and cache evidence remain required
  after Azure Integrated
- **US5 (Phase 7)**: after WS-W6 client exists; Device Verified needs hosted evidence
- **US6 (Phase 8)**: cutover after WS-W11; recovery drills after R6 / WS-W10
- **Polish (Phase 9)**: after intended stories; pilot gate last

### Parallel Opportunities

- T009–T017 harness authoring in parallel once contracts + 010 freeze
- T023–T026 state harnesses in parallel
- T030–T034 security tests in parallel after matrix filled
- T046–T048 recovery drills are separate procedures — can schedule on different days with different owners
- **Do not** parallelize “claim status” with incomplete evidence

### Mapping reminder

| Tasks | Workstream |
|---|---|
| T009–T022 | WS-W4 evidence |
| T029–T036, T046–T054 | WS-W12 evidence |
| T037–T041 | WS-W12 device evidence (build in WS-W6) |
| T042–T045 | WS-W11 outputs / WS-W12 migration evidence |

## Implementation Strategy

### MVP first (local proof)

Phase 1 → 2 → 3 (five-asset) → 4 (registration) → **stop and retain evidence**. This is the architecture soundness gate from docs/13.

### Then

US3 state facts → US4 security matrix → US5 device → US6 cutover/recovery → pilot checklist.

### Notes

- `[P]` = different files / independent harnesses
- Do not report a proof task complete without dated evidence artifact
- Do not invent screens; point builders at feature **010**
- Do not redefine 010 command JSON in 009 contracts


---

## Ledger reconcile — 2026-09-04

Feature 009's checkboxes were not part of this pass and are **not** individually reconciled. What
changed underneath them:

- The **five-asset race** and the registration burst have run against containerised PostgreSQL
  since 2026-09-03 (`server/tests/concurrency.test.ts`, 34 tests, including an opposite-lock-order
  control that deadlocks with SQLSTATE 40P01 — the control is what proves the ordered path is doing
  the work rather than getting lucky).
- The legacy **role × office matrix** is exercised by direct API call
  (`tests/authorization.test.ts`, 57), but that evidence does not prove the newer D18
  workspace/purpose/capability/projection, zero-fetch, document and cache-revocation requirements.
- **Health, readiness and metrics** are implemented, and metrics now carry per-route latency keyed
  by route PATTERN so no asset id reaches `/api/metrics` (`tests/health.test.ts`).
- Everything in G0.2 / R6 — subscription, region, Entra tenant, DNS/TLS, RTO/RPO, alert owner —
  remains an Englobe IT dependency. No Azure resource exists and none was created.

Nothing here is *Security Verified*, *Device Verified*, *Migration Rehearsed* or *Pilot Accepted*.
