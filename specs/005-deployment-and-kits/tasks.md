---

description: "Task list for feature 005 — Deployment & Kits"
---

# Tasks: Deployment & Kits

**Input**: Design documents from `/specs/005-deployment-and-kits/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (user stories), [contracts/ams-backend-deployment.md](contracts/ams-backend-deployment.md)

**Tests**: Required. This repository has 163 passing tests and a convention of testing domain logic and backend behaviour. Reducing the count is a regression.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

**Read first**: [`specs/AGENT-BRIEF.md`](../AGENT-BRIEF.md) — §1 environment setup (nothing works without it), §3 architecture invariants, §5 file ownership.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 from spec.md
- Paths are exact and relative to the repository root

## Path Conventions

App code under `app/src/`, tests under `app/tests/`. This feature owns `domain/installation.ts`,
`api/mock/deployment.ts`, `features/deploy/`, `features/recover/`, `features/site/` and its own
tests — nothing else. Every verification command runs from `app/`.

---

## Phase 1: Setup

- [ ] T001 Set up the toolchain per `AGENT-BRIEF.md` §1 — **use the `/c/…` PATH form, not `C:/…`; the latter silently fails**, then confirm the baseline: `npx tsc -b && npm run test` shows **163 passing**. If it does not, stop and report — do not build on a broken base.
- [ ] T002 Read `docs/09-build-report.md`, `app/src/api/AmsBackend.ts`, `app/src/api/types.ts`, `app/src/domain/deriveState.ts` and `app/src/features/checkout/CheckoutPage.tsx`. The last is the closest existing model for US1's form.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: T003–T007 edit files shared with every other workstream. They are done **by the orchestrator, serially, before any agent fans out** (`AGENT-BRIEF.md` §5). No user story work begins until T008 passes.

- [ ] T003 Add every type from `contracts/ams-backend-deployment.md` § Types and § Inputs to `app/src/api/types.ts`
- [ ] T004 Add the eight method signatures from § Methods to `app/src/api/AmsBackend.ts`
- [ ] T005 Split `app/src/api/mock/index.ts` into the per-domain modules named in `AGENT-BRIEF.md` §5; create `app/src/api/mock/deployment.ts` with all eight methods throwing `new Error("not implemented")`; add the same eight stubs to `app/src/api/dataverse/index.ts` marked `// DATAVERSE-ONLY`
- [ ] T006 Add every i18n key to `app/src/i18n/en.json`: the eleven refusal keys from § Refusal reasons plus screen labels for `deploy.*`, `recover.*`, `site.*`, `swap.*`, `config.*`
- [ ] T007 Add routes to `app/src/App.tsx`: `/deploy`, `/recover/:installationId`, `/sites`, `/site/:site`
- [ ] T008 Verify `npx tsc -b` compiles and `npm run test` still shows **163 passing**. Commit.

**Checkpoint**: Foundation ready. `api/mock/index.ts`, `api/mock/store.ts`, `api/types.ts`, `api/AmsBackend.ts`, `i18n/en.json` and `App.tsx` are now **frozen for this feature** — WS-A must not edit them again.

---

## Phase 3: User Story 1 — Install a monitoring kit at a site (Priority: P1) 🎯 MVP

**Goal**: A technician records a seven-component station at a site in one action — project, site detail, orientation per sensor, power source — and the system knows the whole station as a unit from that date.

**Independent Test**: Install a station of seven components against the real migrated data, then have someone who was not present state from the app what is at that site, how each sensor is oriented, and what it logs through. Testable with recovery not yet built.

### Tests for User Story 1

> **Write these first and confirm they FAIL before implementing.**

- [ ] T009 [P] [US1] `app/tests/domain/installation.test.ts` — `componentsAsOf` returns components whose `start <= asOf` and (`end` null or `end > asOf`); boundary cases at exactly `start` and exactly `end`
- [ ] T010 [P] [US1] `app/tests/features/deploy.test.ts` — happy path: seven components, one Deploy transaction, seven lines, one Installation, seven InstallationComponent rows, all assets `Deployed`
- [ ] T011 [P] [US1] `app/tests/features/deploy.test.ts` — every refusal in § Refusal reasons for deployment: `noPrimary`, `primaryNotLogger`, `notHeld`, `alreadyDeployed`, `orientationRequired`, `inactiveProject`, `componentAlone`. Assert the exact `reason` key and that `offendingAssetId` is set where the contract says it is
- [ ] T012 [P] [US1] `app/tests/features/deploy.test.ts` — atomicity (FR-003/FR-010): a submission with one bad component records **no** transaction, no installation and leaves every asset's status unchanged
- [ ] T013 [P] [US1] `app/tests/features/deploy.test.ts` — idempotency (FR-007): the same `clientSubmissionId` submitted twice records one transaction

### Implementation for User Story 1

- [ ] T014 [US1] `app/src/domain/installation.ts` — pure functions: `componentsAsOf(components, asOf)`, `requiresOrientation(kitRole)`, `openComponents(components)`, `isFullyRecovered(components)`. No store access, no React (`AGENT-BRIEF.md` §3.3)
- [ ] T015 [US1] `app/src/api/mock/deployment.ts` — implement `submitDeployment`. Build the transaction and lines, call `deriveState` per line, let it set status/location/custodian/project. **Never assign those fields directly** (Principle I). Create the Site location when `input.site` is new. Persist through the existing store
- [ ] T016 [US1] `app/src/api/mock/deployment.ts` — implement `listSites`, `getSiteInstallations`, `getAssetInstallations`, `getInstallationSnapshot` using `domain/installation.ts`
- [ ] T017 [US1] `app/src/features/deploy/SiteFields.tsx` — location type (choice), site name, position (free text), latitude/longitude with an optional "use device" button. Mark the coordinate-source default `// ASSUMPTION: FR-006`
- [ ] T018 [US1] `app/src/features/deploy/ComponentPicker.tsx` — add assets by scan or search, assign kit role, require orientation where `requiresOrientation` says so, capture power source. Refuse to add a permanent Component directly
- [ ] T019 [US1] `app/src/features/deploy/DeployPage.tsx` — compose the form, client-side validation mirroring every backend refusal with an explained message (Principle V, both layers), submit, confirmation naming the transaction
- [ ] T020 [US1] `app/src/features/deploy/DraftStore.ts` — FR-028: persist the partly-filled form to `localStorage` so an interruption on site does not lose it. Restore on reopen, clear on successful submit
- [ ] T021 [US1] `app/src/features/asset/AssetDetailPage.tsx` — **coordinate with the orchestrator before editing; this file is outside WS-A's exclusive ownership.** Add a deployments section showing the asset's installations and its role in each (FR-021)

**Checkpoint**: US1 is independently functional. A station can be deployed and read back; nothing can recover it yet.

---

## Phase 4: User Story 2 — Recover a station from site (Priority: P2)

**Goal**: A technician recovers a station, whole or in part; components return to their custody and the site record accurately shows what remains.

**Independent Test**: Recover seven components, then three of seven, and verify the site record shows the remaining four and the recovered three are back in custody.

### Tests for User Story 2

- [ ] T022 [P] [US2] `app/tests/features/deploy.test.ts` — full recovery closes every `InstallationComponent` **and** the `Installation` with an end date (FR-014)
- [ ] T023 [P] [US2] partial recovery leaves the `Installation` open and `getInstallationSnapshot` returns exactly the remaining components (FR-015)
- [ ] T024 [P] [US2] a component with `disposition: "Missing"` becomes `Missing`, not `Available`, and is not falsely recovered (FR-016)
- [ ] T025 [P] [US2] a recovered component with condition `Damaged` or `NeedsService` does not become `Available` (FR-017)
- [ ] T026 [P] [US2] recovering the primary while components remain, with no `leaveBehind`, is refused with `recover.error.leaveBehindUndecided` (FR-018)

### Implementation for User Story 2

- [ ] T027 [US2] `app/src/api/mock/deployment.ts` — implement `submitRecovery`: per-component Undeploy or MarkMissing lines through `deriveState`, close component rows, close the installation when nothing remains open
- [ ] T028 [US2] `app/src/features/recover/RecoverPage.tsx` — cart prefilled from the installation's open components, per-component disposition and condition, the FR-018 leave-behind decision when required, submit
- [ ] T029 [US2] Add a recover entry point from `features/site/SiteDetailPage.tsx`

**Checkpoint**: The deploy/recover cycle is complete and the site record stays honest.

---

## Phase 5: User Story 3 — Know what was installed where, and when (Priority: P3)

**Goal**: Someone asks what was monitoring 50 Diorite Street last October and how the geophones were oriented, and reads the answer.

**Independent Test**: Deploy, swap and recover over several simulated dates, then reconstruct composition and configuration at three past dates.

### Tests for User Story 3

- [ ] T030 [P] [US3] `app/tests/domain/installation.test.ts` — reconstruction across a mid-installation swap returns the outgoing component before the swap date and the incoming one after (FR-022)
- [ ] T031 [P] [US3] a closed installation and a closed project remain fully readable (FR-023)

### Implementation for User Story 3

- [ ] T032 [P] [US3] `app/src/features/site/SiteListPage.tsx` — sites with a current-installation filter, count per site
- [ ] T033 [US3] `app/src/features/site/SiteDetailPage.tsx` — current and historical installations with dates, project, components, configuration; an as-at date picker driving `getInstallationSnapshot` (FR-019, FR-020)

**Checkpoint**: Acceptance question 7 is answerable in full — location, custodian, project and attached components as at a past date.

---

## Phase 6: User Story 4 — Change a station without taking it down (Priority: P4)

**Goal**: A modem is swapped or a sensor reoriented while the station stays in service, each change separately dated.

**Independent Test**: Swap a modem, reorient a sensor and change a power source on a live installation; verify the installation never shows an interruption and each change is separately dated in history.

### Tests for User Story 4

- [ ] T034 [P] [US4] a swap produces paired transactions on one effective date, leaves `Installation.start` unchanged, and leaves no coverage gap for the role (FR-024, FR-026)
- [ ] T035 [P] [US4] an orientation change is recorded as a dated transaction and the previous value is still retrievable — **not** an in-place update (FR-025, Principle II)
- [ ] T036 [P] [US4] moving the station to another project moves every component in one action (FR-027)

### Implementation for User Story 4

- [ ] T037 [US4] `app/src/api/mock/deployment.ts` — implement `submitComponentSwap` and `submitConfigurationChange`
- [ ] T038 [US4] `app/src/features/site/SwapDialog.tsx` — swap and configuration-change UI from the site detail screen

**Checkpoint**: All four stories complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T039 [P] `solution/flows/F1/README.md` — extend the step mapping to cover Deploy and Undeploy, naming the exact `deriveState.ts` and `api/mock/deployment.ts` functions doing the same job, including any deliberate divergence. **Coordinate — WS-F may also touch `solution/`**
- [ ] T040 [P] Verify FR-029 and FR-030 hold: retirement of a deployed asset is refused until recovery, and a deployed asset still appears in calibration due lists with its site and project
- [ ] T041 [P] `docs/09-build-report.md` — record what was built, what was verified with real output, what is stubbed, and every new `// ASSUMPTION` marker
- [ ] T042 [P] `docs/08-decisions.md` — record the two new tables as a decision needing Jay's agreement (`CLAUDE.md` § Ask before doing), and the FR-006 coordinate assumption
- [ ] T043 Final verification from `app/`: `npx tsc -b && npm run test && npm run build`. Report actual output. Test count must be **≥ 163 plus this feature's new tests**
- [ ] T044 Drive the app in a browser at 390×844 against the real migrated data: deploy a station, read the site, recover part of it, reconstruct an as-at date. Report the text read back from the rendered page, not a paraphrase

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: orchestrator only, serial, **blocks everything**
- **US1 (Phase 3)**: after Phase 2. No dependency on other stories
- **US2 (Phase 4)**: needs US1's `submitDeployment` to have something to recover
- **US3 (Phase 5)**: needs US1; reads across US2 and US4 output but is testable with US1 alone
- **US4 (Phase 6)**: needs US1 and US2's component-closing logic
- **Polish (Phase 7)**: after the stories you intend to ship

### Within Each User Story

Tests before implementation, and they must fail first. Domain functions before mock methods
before screens — `installation.ts` has no dependencies, `deployment.ts` depends on it, screens
depend on both.

### Parallel Opportunities

- T009–T013 (all US1 tests) run in parallel — same file in places, so if two agents share
  `deploy.test.ts`, one agent writes all of them
- T030–T031, T034–T036 in parallel within their stories
- T039–T042 in parallel
- **Across workstreams**: WS-A through WS-F all run in parallel after Phase 2, per
  `specs/REMAINING-WORK.md`

## Implementation Strategy

### MVP first

Phase 1 → Phase 2 → Phase 3 (US1) → **stop and validate**. A station that can be deployed and read
back, with no recovery, is already more than the current system has ever recorded — the source
spreadsheet's deployment sheet has sixteen columns and zero rows.

### Incremental

US1 → US2 gives the complete operational cycle. US3 makes it worth having recorded. US4 is
refinement. Ship after US2 if time runs out; that is a coherent product.

## Notes

- `[P]` = different files, no dependencies
- Commit after each task or logical group
- Do not report a task complete without running its test
- The one file this feature needs outside its ownership is `AssetDetailPage.tsx` (T021) —
  coordinate with the orchestrator rather than editing it concurrently
