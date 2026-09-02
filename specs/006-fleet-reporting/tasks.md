---

description: "Task list for feature 006 — Fleet Reporting"
---

# Tasks: Fleet Reporting

**Input**: Design documents from `/specs/006-fleet-reporting/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (user stories)

**Tests**: Required for the domain modules — they are the substance of this feature. Screens are verified by driving them.

**Organization**: Grouped by user story. US3's domain work (point-in-time replay) is the hard part and is deliberately front-loaded into Phase 2, because US1 and US4 both need it.

**Read first**: [`specs/AGENT-BRIEF.md`](../AGENT-BRIEF.md) — §1 environment, §3 invariants, §5 ownership.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 from spec.md

## Path Conventions

This feature owns `domain/pointInTime.ts`, `domain/utilisation.ts`, `api/mock/reporting.ts`,
`features/reports/`, its own tests, and `solution/powerbi/`. Nothing else. Commands run from
`app/`.

---

## Phase 1: Setup

- [ ] T001 Set up the toolchain per `AGENT-BRIEF.md` §1 — **use the `/c/…` PATH form, not `C:/…`; the latter silently fails**; confirm `npx tsc -b && npm run test` shows **163 passing**. Stop and report if not
- [ ] T002 Read `app/src/api/types.ts` (`HistoryEntry`, `Asset`), `app/src/domain/deriveState.ts` (`AssetSnapshot` — the shape `stateAsOf` must match), and `docs/09-build-report.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ T003–T005 edit shared files — orchestrator only, serially, per `AGENT-BRIEF.md` §5.**

- [ ] T003 Add to `app/src/api/AmsBackend.ts`:
  ```ts
  export interface FleetCounts {
    byOffice: Record<string, number>;
    byAssetGroup: Record<string, number>;
    byEquipmentType: Record<string, number>;
    total: number;
    temporaryTags: number;      // FR-011 — distinct from fully catalogued
    thirdPartyOwned: number;    // FR-012
  }
  export interface CalibrationCounts {
    byOffice: Record<string, { inCalibration: number; dueSoon: number; overdue: number; unknown: number }>;
    asOf: string;
  }
  ```
  plus `getFleetCounts(filter?: AssetFilter): Promise<FleetCounts>` and
  `getCalibrationCounts(horizonDays: number): Promise<CalibrationCounts>`
- [ ] T004 Create `app/src/api/mock/reporting.ts` with both methods throwing `new Error("not implemented")`; add the same stubs to `api/dataverse/index.ts` marked `// DATAVERSE-ONLY`
- [ ] T005 Add `reports.*` i18n keys to `app/src/i18n/en.json` and routes `/reports`, `/reports/compliance`, `/reports/timeline/:assetId`, `/reports/utilisation` to `app/src/App.tsx`
- [ ] T006 Verify `npx tsc -b` compiles and tests still show **163 passing**. Commit

**Checkpoint**: shared files frozen for this feature.

---

## Phase 3: User Story 3 — Point-in-time reconstruction (Priority: P3, built FIRST) 🎯

**Built out of priority order deliberately.** US1's fleet views and US4's utilisation both depend
on this derivation, and it is the one part of the feature that is genuinely hard. Building it first
de-risks everything else; building it last would mean discovering late that question 7 cannot be
answered.

**Goal**: An asset's status, location, custodian and project as at any past timestamp, and a full
exportable timeline.

**Independent Test**: Take an asset with a known transaction sequence, reconstruct its state at
three past dates, and confirm each matches what the derived columns held then.

### Tests for User Story 3

> **Write first, confirm they FAIL.**

- [ ] T007 [P] [US3] `app/tests/domain/pointInTime.test.ts` — `stateAsOf(history, asOf)` returns the same shape as `AssetSnapshot`; replaying all of an asset's lines reproduces its current derived values exactly (the spec's own agreement claim, FR-035 of feature 003)
- [ ] T008 [P] [US3] boundary cases: `asOf` before the first line returns the pre-history state; `asOf` exactly on a transaction timestamp includes that transaction; `asOf` after the last line equals current state
- [ ] T009 [P] [US3] an asset with only its migration `AddToInventory` line reconstructs correctly — this is 1,026 of the staged assets, so it is the common case, not an edge one
- [ ] T010 [P] [US3] attachment and detachment appear as events naming the other asset and the role (FR-019)
- [ ] T011 [P] [US3] a retired asset's timeline is fully available (FR-022)

### Implementation for User Story 3

- [ ] T012 [US3] `app/src/domain/pointInTime.ts` — `stateAsOf(history: HistoryEntry[], asOf: string)`. Pure. Sort by `transactiondate` then replay; return the `AssetSnapshot` shape so it is directly comparable with `deriveState`'s output. Must be linear in the asset's own lines, not the whole table (SC-010)
- [ ] T013 [US3] `app/src/features/reports/TimelinePage.tsx` — chronological history with date, action, from, to, performer, notes; a date-range filter that states the asset's state at the range start (FR-020); attachment events inline
- [ ] T014 [US3] Export a timeline as a document (FR-021). CSV via a client-side blob is sufficient and adds no dependency. **Note**: a published Artifact viewer blocks page-initiated downloads — this is the app, not an artifact, so a blob download is fine here

**Checkpoint**: Acceptance question 7 is answerable per asset, with an exportable document.

---

## Phase 4: User Story 1 — The fleet questions (Priority: P1)

**Goal**: What we own, where it is, who has it, what is free at each office — by office, asset group
and equipment type.

**Independent Test**: Hand the views to someone unfamiliar with the system and ask acceptance
questions 1, 2, 3, 4 and 6. Time them.

### Tests for User Story 1

- [ ] T015 [P] [US1] `app/tests/api/reporting.test.ts` — `getFleetCounts` totals reconcile **exactly** with `listAssets` over the same filter (SC-003, zero discrepancy)
- [ ] T016 [P] [US1] availability counts exclude Retired, Deployed, InCalibration, NeedsRepair and Missing (FR-007)
- [ ] T017 [P] [US1] assets with an unknown custodian are counted separately from assets in the office (FR-010) — this matters because 592 staged assets are exactly that case
- [ ] T018 [P] [US1] temporary tags are counted separately from fully catalogued assets (FR-011); third-party-owned assets are excluded or marked (FR-012)

### Implementation for User Story 1

- [ ] T019 [US1] `app/src/api/mock/reporting.ts` — implement `getFleetCounts` and `getCalibrationCounts`. Derive everything from assets and transactions; hold no separate copy (FR-030)
- [ ] T020 [US1] `app/src/features/reports/ReportsHomePage.tsx` — fleet totals, availability by office and equipment type, by-project view, consistent filtering across all views (FR-009), and **the data-currency line on every view** (FR-002, SC-008)
- [ ] T021 [US1] Ensure secured attributes (ICCID, phone, static IP) never appear in any report view or export (FR-003). Mark `// ASSUMPTION` where real role checks are unavailable and record in the build report that **SC-005 is unverifiable without a tenant** — design for it, do not claim it tested

**Checkpoint**: Acceptance questions 1, 2, 3, 4 and 6 answerable from the reports surface.

---

## Phase 5: User Story 2 — Calibration compliance (Priority: P2)

**Goal**: An evidential pack for a client or auditor: calibration status of every instrument on a
project, with certificates.

**Independent Test**: Produce a pack for a completed project and have the admin who would send it
to a client confirm it is sufficient with no manual supplementation.

### Tests for User Story 2

- [ ] T022 [P] [US2] calibration counts by office cover in-calibration, due-soon, overdue and unknown, and unknown is counted explicitly rather than omitted (FR-013, FR-017)
- [ ] T023 [P] [US2] filtering to a project lists every asset assigned to it with its calibration status (FR-014)
- [ ] T024 [P] [US2] overdue rows carry days overdue, custodian and location (FR-015)

### Implementation for User Story 2

- [ ] T025 [US2] `app/src/features/reports/CompliancePage.tsx` — the counts, the per-project view, certificate links (FR-016), and an export that stands alone as a document for a recipient with no system access

**Checkpoint**: Acceptance question 5 answerable in evidential form.

---

## Phase 6: User Story 4 — Utilisation (Priority: P4)

**Goal**: What sits idle, what is always out, where the shortages are — and an honest refusal when
there is not enough history to say.

**Independent Test**: With deliberately short history, confirm the view refuses to present a
figure. With synthesised longer history, confirm the proportions are right.

### Tests for User Story 4

- [ ] T026 [P] [US4] `app/tests/domain/utilisation.test.ts` — `statusSpans(history, from, to)` produces correct durations per status from consecutive transactions
- [ ] T027 [P] [US4] `hasSufficientHistory(history, from)` returns **false** when `from` precedes the asset's first line, and the view then states insufficiency rather than showing a number (FR-027, FR-028, SC-009)
- [ ] T028 [P] [US4] time out of service for repair or calibration is distinguished from productive use (FR-026)
- [ ] T029 [P] [US4] idle detection lists assets with no transaction in a selectable period (FR-024)

### Implementation for User Story 4

- [ ] T030 [US4] `app/src/domain/utilisation.ts` — `statusSpans`, `hasSufficientHistory`, `idleSince`. Pure. The migration-boundary guard lives here, not in the UI, so it cannot be forgotten by a second consumer
- [ ] T031 [US4] `app/src/features/reports/UtilisationPage.tsx` — proportions by equipment type and office, idle list, lowest-availability types, and the insufficiency notice wherever it applies

**Checkpoint**: All four stories complete in their locally-buildable form.

---

## Phase 7: Power BI semantic model — authored, not published

- [ ] T032 [P] `solution/powerbi/EnglobeAMS.pbip/` — author the semantic model as **TMDL text**: tables mirroring `docs/01-data-model.md`'s `eng_*`, relationships, and measures for fleet counts, availability, calibration status and days overdue. Text only — no `.pbix` binary, so it is diffable and a successor can read it (Principle VI)
- [ ] T033 [P] `solution/powerbi/README.md` — how to open the project, bind it to `Englobe-AMS-Dev`, and publish; which measures answer which acceptance question; and that **DirectQuery, row-level security and field security are untested** because there was no tenant
- [ ] T034 [P] Document in the README that US1's licence-free requirement is satisfied by **this**, not by the in-app surface, so nobody reads the in-app pages as closing the story

---

## Phase 8: Polish

- [ ] T035 [P] `docs/09-build-report.md` — what was built, verified with real output, what is stubbed. State plainly that FR-003/SC-005 (field security in reporting) and the Power BI publish are **not verified**
- [ ] T036 [P] `docs/08-decisions.md` — record the no-charting-library and PBIP-over-PBIX decisions
- [ ] T037 Final verification from `app/`: `npx tsc -b && npm run test && npm run build`. Report actual output; count must be ≥ 163 plus this feature's tests
- [ ] T038 Drive the reports surface at 390×844 against real migrated data. Verify the live figures against the known baselines — **107** assets overdue at a 30-day horizon, **592** with unknown custodian, **44** in the field-completion queue. A mismatch is a bug in this feature, not a stale baseline

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: none
- **Foundational (2)**: orchestrator only, serial, **blocks everything**
- **US3 (3)**: after Phase 2. **Built first** — US1 and US4 depend on its derivation
- **US1 (4)**: after Phase 2; independent of US3 for its counts, but shares the surface
- **US2 (5)**: after Phase 2; independent
- **US4 (6)**: needs US3's replay approach
- **Power BI (7)**: independent of everything; can run in parallel from the start
- **Polish (8)**: last

### Within Each User Story

Tests first and failing. Domain before backend before screens.

### Parallel Opportunities

- T007–T011, T015–T018, T022–T024, T026–T029 within their stories
- Phase 7 (T032–T034) in parallel with any story — it touches only `solution/powerbi/`
- **Across workstreams**: WS-A through WS-F after Phase 2, per `specs/REMAINING-WORK.md`

## Implementation Strategy

### MVP first

Phase 2 → US3 → **stop and validate**. Point-in-time reconstruction with an exportable timeline is
the single highest-value thing here: it answers the one acceptance question nothing else in the
system can, and it is the foundation for the rest.

### Then

US1 (widest audience) → US2 (external consequence) → US4 (needs real history to mean anything, and
says so honestly until it has some). Phase 7 whenever there is capacity — it is fully isolated.

## Notes

- `[P]` = different files, no dependencies
- This feature writes nothing to the operational data. If you find yourself adding a write path,
  stop — it is out of scope and violates the plan
- Two things must not be claimed as done: US1 is closed by **Power BI**, not the in-app surface;
  and field security in reporting cannot be verified this session
