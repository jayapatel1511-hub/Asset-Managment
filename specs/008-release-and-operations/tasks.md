---

description: "Task list for feature 008 — Release & Operations"
---

# Tasks: Release & Operations

**Input**: Design documents from `/specs/008-release-and-operations/`

**Prerequisites**: [spec.md](spec.md); `docs/10-integration.md` § Hosting (the verified command sequence and limitations)

**Tests**: Required for US1. The release-safety checks are the only part of this feature that must be *impossible* to get wrong, so they are tested, not documented.

**Read first**: [`specs/AGENT-BRIEF.md`](../AGENT-BRIEF.md) — §1 environment, §5 ownership. This feature is **WS-H** and owns `app/scripts/`, `app/vite.config.ts`, `docs/11-runbook.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5 from spec.md

## Path Conventions

Commands run from `app/`. Note this feature touches `vite.config.ts` and `package.json`, which no
other workstream owns — but `package.json` scripts are read by everyone, so changes must not break
`npm run test` or `npm run dev`.

---

## Phase 1: Setup

- [x] T001 Toolchain per `AGENT-BRIEF.md` §1 — **`/c/…` PATH form**. Confirm baseline: `npx tsc -b && npm run test` passes (**281 as of 2026-09-02**)
- [x] T002 Read `docs/10-integration.md` § Hosting in full, then `app/vite.config.ts`, `app/package.json`, `app/scripts/copy-staged-data.mjs`, `app/src/api/index.ts` (how the backend is selected), `app/src/components/RoleSwitcher.tsx` and `app/src/features/search/ScanDialog.tsx` (the two `MOCK-ONLY` stand-ins)

---

## Phase 2: User Story 1 — A release that cannot leak data (Priority: P1) 🎯 MVP

**Goal**: The dangerous mistake becomes impossible. A release build refuses to produce output that
contains fleet data or targets the development backend.

**Independent Test**: Attempt a release build with the development backend, and with staged data
present. Both fail, naming the cause. Then grep a successful bundle for a real Asset ID, an ICCID, a
phone number and a static IP — none present.

**Why this is the whole MVP**: publishing is a one-way door. Everything else in this feature is
recoverable; this is not.

### Tests for User Story 1

> **Write first, confirm they FAIL.**

- [x] T003 [P] [US1] `app/tests/build/releaseGuard.test.ts` — the guard refuses when the backend variable is unset
- [x] T004 [P] [US1] refuses when the backend is set to the development backend
- [x] T005 [P] [US1] passes when set to the production backend
- [x] T006 [P] [US1] the guard's refusal message names the variable and the required value (SC-002)
- [x] T007 [P] [US1] a bundle-scan helper detects a planted Asset ID, ICCID, phone number and static IP in a fixture directory, and reports clean on a fixture without them (FR-003)

### Implementation for User Story 1

- [x] T008 [US1] `app/scripts/release-guard.mjs` — fails non-zero unless the backend is the production one (FR-001). Print the value seen and the value required
- [x] T009 [US1] `app/scripts/scan-bundle.mjs` — scan the built output for real values drawn from `migration/staged/` (a sample of Asset IDs, plus every non-empty `identifiervalue`, `phonenumber`, `staticip`). Fail non-zero on any hit, naming the file and the matched kind — **never print the matched value itself** (FR-003)
- [x] T010 [US1] `app/vite.config.ts` — ensure `public/data/` is excluded from the release build. **Do not** break `npm run dev`, which needs it. Prefer a mode-conditional `publicDir`, so exclusion is structural rather than a cleanup step (FR-002)
- [x] T011 [US1] `app/package.json` — add `build:release` running, in order: release-guard → generate-state-machine → `tsc -b` → `vite build` → scan-bundle. **Leave `build` alone** so existing workflows and CI keep working
- [ ] T012 [US1] **NOT DONE — deliberately deferred.** `RoleSwitcher.tsx` and `ScanDialog.tsx` carry no fleet data, so they are a hygiene item, not a disclosure risk; the data leak is `public/data/`, which T010 closes structurally. Truly removing them needs a conditional dynamic import in `App.tsx`, a shared file this workstream does not own. Exclude the `MOCK-ONLY` stand-ins from a release bundle — `RoleSwitcher.tsx` and the scan stub. Absent, not hidden (FR-004). A build-time flag that tree-shakes them is acceptable; a runtime `if` is not
- [x] T013 [US1] `build:release` prints a summary: backend targeted, data excluded, scan result (FR-005)
- [x] T014 [US1] Verify by running it: attempt with the dev backend (must fail), then with the production backend (must pass), then grep the output yourself and report the actual result

**Checkpoint**: The leak is now structurally impossible. This alone is worth shipping.

---

## Phase 3: User Story 2 — Verify before anyone uses it (Priority: P2)

**Goal**: A written list that proves a release works against real data before technicians see it.

**Independent Test**: Run the list against a published release; break one thing deliberately and
confirm the list catches it.

- [ ] T015 [P] [US2] `docs/11-runbook.md` § Verification — the item-by-item list: identity resolves to a real account with a real role and no role picker; search, checkout, return, calibration due against real data; a deep link cold-loads; 390 px layout; header suppressed with `?hideNavBar=true` (FR-013)
- [ ] T016 [US2] **Resolve the routing question** (FR-010). The app uses `BrowserRouter` with absolute paths and is served from `/play/e/{env}/a/{app}`. Determine, against `pa app run`, whether a `basename` or `HashRouter` is required, then change `App.tsx` accordingly. **Coordinate — `App.tsx` is a shared file** (`AGENT-BRIEF.md` §5)
- [ ] T017 [P] [US2] Record in the runbook that verification runs against development first, and that a failed item blocks promotion (FR-014, FR-015)

**Checkpoint**: A release can be trusted before it is promoted.

---

## Phase 4: User Story 3 — Roll back (Priority: P3)

- [ ] T018 [P] [US3] Establish and document how to return users to the previous published version, and how to stop a release outright (quarantine) — both are platform capabilities, not code (FR-016, FR-018)
- [ ] T019 [P] [US3] Document that rollback alters no records, and why — the app is a client and state is derived (FR-017, Principle I)
- [ ] T020 [P] [US3] Add a release log to the runbook: version, date, who, live/rolled-back (FR-008, FR-019)

---

## Phase 5: User Story 4 — Promotion and lifecycle (Priority: P4)

- [ ] T021 [P] [US4] Document the promotion order and its confirmations: schema → reference data → assets → flows → app (FR-021)
- [ ] T022 [P] [US4] Enumerate environment-specific configuration and separate it from promotable artefacts (FR-023)
- [ ] T023 [P] [US4] Document the sign-off gate: no production promotion until `migration/reports/02_conflicts.md` and `03_models_review.md` are signed off (FR-022, and feature 002's FR-026)
- [ ] T024 [P] [US4] Confirm and document per-environment sequence isolation (FR-024)
- [ ] T025 [US4] Walk the empty-environment test on paper against the repository and record every step that is currently undocumented — each one is a defect against FR-020 and Principle VI

---

## Phase 6: User Story 5 — Operational visibility (Priority: P5)

- [ ] T026 [P] [US5] Name and assign an owner to the alert destination. Record who watches it (FR-030) — an unwatched channel is a log file with extra steps
- [ ] T027 [P] [US5] Document how to find and reprocess unprocessed submissions, and the threshold beyond which that is expected (FR-029)
- [ ] T028 [P] [US5] Document where platform health and usage metrics live (FR-031)

---

## Phase 7: Prerequisites and documentation

- [ ] T029 [P] `docs/11-runbook.md` — assemble into one operator document: prerequisites, publish, verify, roll back, promote, monitor. Written for someone who did not build the system (FR-032, Principle VI)
- [ ] T030 [P] Enumerate out-of-repository prerequisites with the exact place each is configured — environment feature toggle, end-user premium licences, service account, groups, `pac auth` (FR-033). Cross-check against `docs/06-delivery-plan.md` Step 0 and reconcile any difference
- [ ] T031 [P] `docs/08-decisions.md` — record the routing decision from T016 and any deviation found in T025
- [ ] T032 Final: `npx tsc -b && npm run test && npm run build && npm run build:release`. Report actual output. Test count must be ≥ 281 plus this feature's additions. **Blocked 2026-09-02**: `tsc -b` fails on two `noUnusedLocals` errors in `app/scripts/synthetic/lib/sim.ts` — WS-G's in-progress work, untracked, not this workstream's file. `npx tsc --noEmit` confirms those are the *only* errors in the project. Re-run once WS-G lands

---

## Dependencies & Execution Order

- **Phase 1**: none
- **Phase 2 (US1)**: after setup. **Independent of every other story and of every other workstream** — it touches only `scripts/`, `vite.config.ts` and `package.json`
- **Phase 3 (US2)**: T016 needs `App.tsx`, a shared file — coordinate. The rest is documentation and can proceed
- **Phases 4–6**: documentation, fully parallel, no code dependencies
- **Phase 7**: last

### Parallel Opportunities

- T003–T007 together
- All of Phases 4, 5 and 6 together — they are independent documents
- **This whole feature runs in parallel with WS-A…WS-F**, with one exception: T016 touches `App.tsx`

### What cannot be done without a tenant

T016's routing answer, and the whole of Phases 3–6, are **verified** only with tenant access. They
can be *written* now from `docs/10-integration.md`, and must be marked as unverified until someone
with `pa app push` confirms them. US1 is the exception: it is fully buildable and fully testable
today, which is another reason it is the MVP.

## Implementation Strategy

Do **US1 alone, now**. It is the only part that is both fully achievable without a tenant and
genuinely protective. Everything else is documentation that should be written when the person who
will run the procedures can try them.

## Notes

- Never print a matched sensitive value in scan output — the log becomes the leak
- `build` and `build:release` are separate on purpose; do not merge them
- Do not report Phases 3–6 as verified. They are written, not tested
