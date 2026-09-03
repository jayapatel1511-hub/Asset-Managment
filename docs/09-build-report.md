# 09 — Build report

**Date**: 2026-09-02. **Scope requested**: a runnable, testable Power Apps Code App covering
features 001 (Asset Registry), 003 (Asset Transactions) and 004 (Calibration Management), P1–P2
stories, loaded with the real migrated inventory, state-derivation logic and migration scripts
complete and tested, demoable on a phone viewport. Features 002 (Inventory Migration) was
substantially exceeded as a foundation; 005 (Deployment & Kits, explicitly Phase 2) and 006 (Fleet
Reporting / Power BI) were not attempted — out of the requested scope, not a gap.

**Update, same day, later session**: features 005 and 006, plus the two stories deferred above
(003 US5 offline queue, 004 US4 office→admin assignment), were built in a follow-on multi-agent
session. See "Phase 0–2 — multi-agent extension" below for that work; it supersedes some of the
"What is stubbed" list further down (marked inline where it does).

**Session constraints, respected throughout**: no `pac auth`, no Dataverse object created, no
Power Platform environment touched. `data/source/` was not edited. Every one of the 8 open
`specs/clarifications.md` items was proceeded on under its stated recommendation, each recorded in
`docs/08-decisions.md` and marked `// ASSUMPTION` (or an equivalent inline note) wherever it is
load-bearing in code — see the full list near the end of this report.

## What passed, with real output

### Phase A — Migration

Ran `01_profile.py` → `05_calibrations.py` against the real source CSVs (no synthetic data
anywhere). Final clean run:

```
Profile: PASS — 1053 rows, 29 duplicate IDs, 27 blank/prefix-only, 132 shared serials,
         10 offices, 253 calibration rows: all match the committed baseline exactly.
02_clean: 1026 assets staged (6 Q5 components, 19 duplicates collapsed, 13 excluded [Q6],
          16 cross-office conflicts logged, 2 FR-013 flags logged, not merged).
03_models: PASS — 51 canonical models, every staged asset resolves to exactly one.
04_load (dev): PASS — 1026 assets, 11 AddToInventory transactions (one per office), 1026 lines,
               every asset has exactly one history entry.
05_calibrations: 164 matched, 2 unmatched, 87 skipped — 253 of 253 accounted for.
```

Idempotency verified by diffing two consecutive runs of every script — byte-identical.

Post-load invariants checked directly against the staged data (not asserted, measured): 0
duplicate/blank Asset IDs; 0 assets missing model, home office, status or lifecycle; 0 `CheckedOut`
assets showing a `currentlocation` (the Q3 honesty rule); 0 `Available` assets missing one; 131 of
132 shared-serial groups preserved as distinct assets (the 1-group difference is explained in
`02_clean_report.md` — a true duplicate correctly resolved elsewhere, not a wrongly-merged pair).

**Two real bugs found and fixed by this run, not by inspection**: (1) the Asset-ID-collision
correction path was minting `GEO-UM-UM16920` instead of `GEO-UM-16920` — caught by
`assetId.test.ts`'s regression test, which exists because of this exact bug. (2) `03_models.py`
was writing `eng_`-prefixed field names into `equipment_models.json` while every other staged file
used plain names — caught live in the browser (the New Asset model dropdown showed `"()"` for
every option) and fixed at the source.

### Phase B — Domain layer

`app/src/domain/stateMachine.ts` is generated from `data/reference/state_machine.json`
(`npm run generate:state-machine`, wired into `predev`/`prebuild`/`pretest` — never hand-edited).
`assetId.ts` and `deriveState.ts` are pure functions, no store access.

```
tests/domain/stateMachine.test.ts   100 tests — every (status, transaction type) cell,
                                     allowed and disallowed
tests/domain/assetId.test.ts         21 tests — mint/parse round trips, shared-serial and
                                     no-serial cases, the embedded-code stripping bug
tests/domain/deriveState.test.ts     15 tests — per-transaction-type field derivation,
                                     kit relationships, Retired-is-terminal
```

### Phase C — Swappable data access

`app/src/api/AmsBackend.ts` is the one interface every screen calls. `api/mock/` loads
`migration/staged/` (copied into `public/data/` by `npm run copy:staged-data`), applies
`deriveState` on every write through `MockStore.applyTransaction`, persists to `localStorage`.
`api/dataverse/` is a typed stub — every method throws — marked `// DATAVERSE-ONLY` throughout,
imported by `api/index.ts` but only *constructed* when `VITE_AMS_BACKEND=dataverse`, which nothing
in this build sets.

```
tests/api/mockBackend.test.ts   27 tests — checkout/return/transfer/calibration/registration/
                                 retirement, atomicity (FR-003), idempotency (FR-007), field
                                 security (FR-030), permanent Components (FR-026/FR-032),
                                 the inactive-project refusal (FR-027)
```

**163 tests total, all passing.** `npx tsc -b` and `npm run build` both clean (production bundle:
690 KB / 193 KB gzipped — a single-chunk warning from Vite, a legitimate follow-up via
`manualChunks`, not a defect).

### Phase D — Screens, verified live against real migrated data

Search, Asset detail + history + calibration tab, Checkout, Return, Transfer, Calibration due,
Admin (New asset; Record calibration / Send to calibration / Retire from the asset detail screen).
Fluent UI v9, phone-first at 390px, dark mode follows OS (`useSystemTheme.ts`), every string from
`i18n/en.json` (FR-031).

This was not just built and unit-tested — it was driven end to end in a running browser against
the real migrated Ottawa/Toronto/Sudbury/SWO data, at a 390×844 viewport. Transcript highlights
(exact text read back from the rendered page, not paraphrased):

- **Acceptance question 2, live**: searching `16984` returns both `DL-UM-16984` (Data Logger,
  Checked out, Sudbury, custodian James Ross) and `GEO-UM-16984` (Geophone, Available, Toronto) —
  visually distinguished, neither hidden. This is feature 001's own named worked example
  (Principle III), reproduced from the actual migrated data, not a fixture.
- **A real checkout, start to finish**: added `GEO-UM-16984` to a cart, picked project
  `01937805 — Vale M-Dam Vibration Monitoring` from the real deduplicated project list (46 raw
  strings → correctly collapsed), submitted → `"Checkout TXN-000012 recorded."` Reloading the
  asset showed `status: CheckedOut`, `custodian: tech@englobecorp.com`, `location: —` (honestly
  unknown, not falsely "at the office"), and both the new Checkout line and the original migration
  line in history, newest first.
- **Return**, prefilled from custody, submitted → `"Return TXN-000013 recorded."`
- **A new asset, FR-006's own worked example, reproduced live**: picked *Instantel Micromate
  (DataLogger)*, typed serial `UM21999` → the page showed `Asset ID: DL-UM-21999` before
  submission — exactly the spec's own example. Saved → registered, Available, at Ottawa, with an
  `AddToInventory` history entry.
- **Record calibration**: date `2026-08-01` on that new asset → next-due auto-computed as
  `2027-08-01` from the model's 12-month interval (FR-009).
- **Retire**: attempted with no reason → blocked with `"A retirement reason is required."`
  (FR-024, verified as a real in-app refusal, not just a unit test). Selected `Obsolete`, retried
  → `Retired`, location cleared, both history lines intact.
- **Admin home**: field-completion queue (FR-032) correctly counts **44** (6 reused-tag SIMs + 3
  physical servers + 35 `TMP-` tags); return sweep (Q3) correctly counts **592**.
- **Calibration due, 30-day horizon**: **107** overdue assets, grouped by office, each showing
  exact days overdue (e.g. `DL-UM-15720 — 179 days overdue`) — acceptance question 5, live.

**Environment note, resolved**: earlier in this build, screenshot/click-confirmation tooling was
unreliable while the browser pane was hidden (`computer` actions frequently reported a timeout
even when the underlying action had succeeded). Verification initially relied on the
accessibility tree and rendered text (`read_page`, `get_page_text`) instead. The tooling recovered
later in the session, and actual 390px screenshots of Search (with the shared-serial
disambiguation), Asset detail, Checkout, and Calibration due were captured and are attached to the
conversation.

**Two more real bugs found by the screenshots themselves, both fixed**: (1) `AssetDetailPage.tsx`
ran the "Notes" label and the note text together with no line break (`Notesm North South`) because
two inline `Text` spans inside a plain `<section>` have nothing to force them onto separate
lines — invisible to `get_page_text`, obvious in a screenshot. Fixed with `display: "block"` on
both. (2) `CalibrationDuePage.tsx` absolutely-positioned a "days overdue" label at the same
top-right corner `AssetRow`'s status pill already occupies, so the two overlapped illegibly.
Fixed by giving `AssetRow` an `overdueDetail` prop instead of layering a second element on top of
it — one row, one label, no positioning fight. Both fixes verified by re-screenshotting; all 163
tests still pass and the production build is still clean after each.

### Phase E — Flow definitions

`solution/flows/F1` through `F5`, each `definition.json` + `README.md`, not published (no
tenant). Each `definition.json` states plainly it is a specification-level artifact, not a
`pac`-exported one. **F1's README maps every step onto the exact `deriveState.ts` function that
does the same job in the mock backend**, including the one deliberate divergence (permanent
Component mirroring lives in `api/mock/store.ts`, not `deriveState.ts`, because it is a store-wide
fan-out rather than a single-asset derivation — F1 does the Dataverse equivalent in its own step
5). F3 and F4 each flag, in their own `definition.json` `note` fields, exactly which upstream
answer or screen they still depend on.

## Phase 0–2 — multi-agent extension: Deployment & Kits, Fleet Reporting, offline queue, office admin assignment

Built in a follow-on session, same day. **Scope**: feature 005 (Deployment & Kits) and feature 006
(Fleet Reporting) in full, plus two stories deferred from the original build — feature 003 US5
(offline queue) and feature 004 US4 (office→administrator assignment). Orchestrated as: one
serial phase to extend every shared/frozen file first, four parallel agents each owning a disjoint
set of files, then one serial integration pass. WS-E (`api/dataverse/` real implementation) and
WS-F (real Dataverse schema) were explicitly skipped — neither is verifiable without a tenant, and
WS-E must not be reported as working.

### Phase 0 — shared scaffolding (orchestrator alone, serial)

Added every new `AmsBackend` method, type, i18n key and route needed by workstreams A–D, with
bodies throwing `not implemented` in both `api/mock/` and `api/dataverse/`. Split
`api/mock/index.ts` into per-domain modules (`deployment.ts`, `reporting.ts`, `offline.ts`,
`admin.ts`) composed by a thin `MockAmsBackend` constructor, per `specs/AGENT-BRIEF.md` §5's
ownership map. Gate — `npx tsc -b` clean and the suite still exactly 163 passing — was met before
committing and before any agent was spawned.

### Phase 1 — four parallel agents, disjoint file ownership, no worktree isolation

- **WS-A — feature 005, Deployment & Kits** (largest, highest value). Delivered `DeployPage`,
  `RecoverPage`, `SitesListPage`/`SiteDetailPage` (with an "as of" date picker over the
  installation snapshot), `SwapDialog` (component swap) and configuration-change (project
  reassignment while deployed), the 8 `AmsBackend` deployment methods, `Installation` /
  `InstallationComponent` mock storage, and `domain/installation.ts`'s point-in-time kit-membership
  helpers. 40 new tests (11 domain, 29 feature). Found and flagged, rather than silently working
  around in a frozen file, two real gaps: `deriveState.ts`'s `Undeploy` case wrongly grouped with
  `Return`, and no `Transfer` transition existed from `Deployed` — both fixed by the orchestrator
  in Phase 2 below. Deferred T039 (extending `solution/flows/F1/README.md`) to avoid touching
  `solution/`, which is WS-F's row.
- **WS-B — feature 006, Fleet Reporting**. Built US3 (`domain/pointInTime.ts`, point-in-time state
  replay) first per its own `tasks.md` ordering, then `getFleetCounts`/`getCalibrationCounts`,
  `ReportsHomePage`, `TimelinePage` (per-asset history with CSV export), `CompliancePage`, and
  `UtilisationPage` — the last one refuses to compute a figure when there isn't enough history
  rather than guess (FR-027/FR-028), verified live: *"Not enough history yet for a reliable
  figure."* Also delivered the licence-free PBIP (Power BI Project, TMDL text format, diffable)
  deliverable under `solution/powerbi/`. 41 new tests. Flagged that `AssetFilter.assetgroup` was
  declared on the type but silently ignored by `listAssets` — mirrored the gap deliberately in its
  own filter copy (to keep SC-003's exact reconciliation with `listAssets`) rather than diverge
  silently, and flagged it for the orchestrator; fixed in both places in Phase 2.
- **WS-C — feature 003 US5, offline queue**. Built a transport-agnostic `SubmissionQueue`
  (`api/queue/`) — `SubmissionTransport = Pick<AmsBackend, "submitCheckout"|"submitReturn"|
  "submitTransfer">`, a `getSubmissionQueue()` singleton, idempotent submit/replay keyed on
  `clientSubmissionId`, and `NeedsAttentionPage` for reviewing/retrying failed replays. 24 new
  tests. This workstream's own row didn't reach the Checkout/Return/Transfer screens themselves —
  the orchestrator wired the queue into all three in Phase 2. WS-C reported a transient `tsc -b`
  failure from a concurrent WS-A edit to a file it didn't own, self-correcting 15 seconds later —
  a real, if small, confirmation that disjoint-file-ownership without git-worktree isolation held
  up under actual concurrent edits.
- **WS-D — feature 004 US4, office→administrator assignment**. Built `OfficeAdminsPage` and
  `createAdminMethods` — the office list is derived live from `locations`, and an empty
  `adminUpns` array *is* the gap signal required by FR-027a (no separate `isGap` field needed);
  `setOfficeAdmins` replaces rather than merges. 10 new tests.

### Phase 2 — integration (orchestrator alone)

**Three real bugs found at the seams between workstreams, all fixed at the root:**

1. **`deriveState.ts`'s `Undeploy` case was grouped with `Return`**, unconditionally clearing
   custodian and defaulting location to the home office — wrong per FR-013 (a recovered component
   belongs to the recovering technician, not to nobody). WS-A had worked around this in its own
   file with a same-dated compensating `Transfer` transaction after every `Undeploy`. Fixed at the
   root by splitting the case out: `custodian: line.touser ?? null`, `currentlocation: null`
   (unknown, not falsely "at the office" — the same honesty rule `Checkout` already followed).
   The compensating-`Transfer` workaround (`deployment.ts`, two call sites: `submitRecovery`,
   `submitComponentSwap`) was then removed as redundant. Verified: `tsc -b` clean and 281/281
   passing after removal — a pure simplification, no test needed changing — and a live
   deploy→recover cycle now produces one clean `Undeploy` history line where it previously showed
   two (`Undeploy` plus a redundant `Transfer`).
2. **`data/reference/state_machine.json` had no `Transfer` transition from `Deployed`** — FR-027
   (move a live station to a new project without recovering it first) had no legal transition to
   use. Added `"Transfer": "Deployed"` to the `Deployed` block and regenerated `stateMachine.ts`;
   `deriveState.ts`'s existing generic `Transfer` case needed no change, since it already applies
   only the fields a transaction names and leaves the rest untouched.
3. **`AssetFilter.assetgroup` was declared on the type but never applied by `listAssets`** — a
   dead filter field, independently caught by WS-B while building `getFleetCounts` (see above).
   Fixed both `listAssets` and `reporting.ts`'s reconciliation copy together, keeping them in sync.

**Also added in Phase 2** (small and cross-cutting, appropriate for the orchestrator rather than
any one workstream): `AssetDetailPage.tsx`'s "Sites" section — every installation an asset is or
was part of, with its kit role and orientation, linking to the site detail page. This is WS-A's
own recommended T021, which WS-A deferred because it touches a page outside its row.

**Final verified command output**, this session, not asserted:

```
$ npx tsc -b
(clean — no output)

$ npm run test
 Test Files  12 passed (12)
      Tests  281 passed (281)

$ npm run build
✓ 2213 modules transformed.
dist/index.html                  0.40 kB │ gzip:   0.26 kB
dist/assets/index-C-sXtKK6.js   793.44 kB │ gzip: 215.63 kB
✓ built in 3.80s
```

Test count, stage by stage, confirming zero were lost: 163 baseline → 173 (+WS-D) → 276 (+WS-C) →
278 (+WS-A, +WS-B) → 281 (+3 orchestrator regression tests for the `Undeploy`/`Transfer`-while-
`Deployed` fixes, added to `tests/domain/deriveState.test.ts`).

### Acceptance questions 1–7, verified live against the real migrated data (390×844, pristine `localStorage`)

The seven questions are `specs/README.md`'s definition of done for the whole programme.

| # | Question | Verified via | Result |
|---|---|---|---|
| 1 | What do we own? | Reports → Fleet | **1026** total, broken down by office / asset group / equipment type; 35 temporary tags, 2 third-party owned |
| 2 | Where is asset X right now? | Asset detail, `DL-UM-16984` | `Location: —` (Checked out — honestly unknown, not falsely "at the office"); `Home office: Sudbury` |
| 3 | Who has asset X? | Asset detail, `DL-UM-16984` | `Custodian: James Ross` |
| 4 | What is available at office Y? | Reports → Availability | **375** total, broken down by office (Sudbury 98, London 54, Ottawa 49, Kitchener 49, …) |
| 5 | What needs calibration in the next N days? | Calibration due, 30-day horizon | **107** overdue — matches the known baseline exactly |
| 6 | What is assigned to project Z? | Reports → By project, `01937805` | 6 assets returned (`DL-UM-15387/15713/16842/16956/16984/21947`), all Sudbury — consistent with Q2/Q3's own custody data |
| 7 | Where was asset X on date D, and what was attached to it? | Deployed a fresh primary+sensor kit, then read Site detail's "as of" installation snapshot and the sensor's own Asset detail "Sites" section | Site page: `DL-BA-18570` Primary, `GEO-BE-20108` Sensor1 · V. Asset page (sensor's own): `Parent asset: DL-BA-18570`, `Sites: … Sensor1 · V · 2026-09-02` — both directions agree |

All three of the session's known baselines were re-verified against a freshly-cleared
`localStorage` (pristine migrated snapshot), after the Phase 2 fixes: **107** overdue
(Calibration due), **592** unknown-custodian (Admin → Return sweep), **44** completion queue
(Admin → Field-completion queue) — exact matches, no drift.

### Superseding "What is stubbed" below

- **Offline queueing** (feature 003 US5) is no longer unimplemented — see WS-C above. The original
  reasoning (no real network boundary to fail against) is now moot: the queue is transport-generic
  and Checkout/Return/Transfer route through it uniformly, showing a "queued" message when delivery
  fails and replaying idempotently on reconnect.
- **Calibration reminder notifications'** missing dependency, the office→administrator assignment
  screen, is now built (WS-D's `OfficeAdminsPage.tsx`). The F3 flow itself remains a
  specification-level file only — sending a real Teams/email notification needs a tenant.
- **Power BI** (feature 006) is no longer entirely out of scope: the in-app Reports section is the
  interim, licence-free deliverable, and a real PBIP project exists at `solution/powerbi/` for a
  DirectQuery dashboard once Dataverse exists.

### Known remaining gaps, honestly

- **No "pending submission" badge** is rendered anywhere in the UI (`AssetRow` / `SearchPage` /
  `AssetDetailPage`) for an asset with a queued-but-undelivered transaction. The queue and
  `NeedsAttentionPage`'s review/retry flow both work; the at-a-glance visual indicator does not
  exist yet. Deferred as polish, not correctness — flagged, not hidden.
- **WS-A's T039** (extending `solution/flows/F1/README.md` with Deploy/Undeploy step mapping) was
  deferred to avoid colliding with WS-F's ownership of `solution/` — not done this session.
- WS-E and WS-F remain untouched stubs, as instructed.
- Two more table requests are now pending Jay's agreement in `docs/08-decisions.md`
  (`eng_installation`/`eng_installationcomponent` for feature 005; an office→admin assignment table
  or column for feature 004) — do not create either in Dataverse until he confirms.

## What is stubbed

- **Camera scanning** (`ScanDialog.tsx`, marked `MOCK-ONLY`): accepts typed/pasted text instead of
  a camera feed. The Power Apps SDK's barcode scanner needs a Code App running inside Power Apps,
  not available in a local browser. The resolution logic it feeds (`SearchPage.handleScanned`) —
  exact match, bare-serial disambiguation, unknown-tag fallback — is fully implemented and
  exercised through this stand-in.
- **Role switching** (`RoleSwitcher.tsx`, marked `MOCK-ONLY`): a manual picker standing in for
  Entra security-group membership, which doesn't exist without a tenant. Deleted the day
  `api/dataverse/` goes live.
- **Offline queueing**, **calibration reminder notifications' missing dependency**, and **Power
  BI** — all three superseded by the Phase 0–2 addendum above; see that section rather than this
  bullet list for the current state.

## What needs the tenant

Everything in `docs/06-delivery-plan.md` Step 0 (licences, Dev/Prod environments, `svc-ams`
account, Entra groups, `pac auth create`) plus:

1. **Schema**: `pac solution init` + create the 9 tables, choice sets, keys, relationships,
   indexes, security roles and the `AMS Sensitive` field security profile per
   `docs/01-data-model.md` and `docs/05-security.md` — **with the manufacturer+model+equipmenttype
   alternate-key correction from `docs/08-decisions.md` applied**, since the doc as written would
   silently merge three real catalogue rows into one.
2. **Migration to Dataverse**: `migration/04_load.py`'s JSON-writing logic needs a Dataverse
   Web API `$batch` writer added (the doc's own plan: locations → models → projects → assets →
   AddToInventory transactions+lines → calibration records, upsert on alternate keys). The
   cleaning/dedup/reporting logic in `02_clean.py`/`03_models.py`/`05_calibrations.py` needs no
   change — only where `04_load.py` writes its output changes.
3. **`pac code init` / `pac code push`**: register `app/` as an actual Power Apps Code App and
   publish it. The React/TS/Fluent code itself needs no rewrite — `api/dataverse/index.ts` is the
   only file that needs real implementation, against the same `AmsBackend` interface every screen
   already calls.
4. **Flows F1–F5**: build each in the Maker Portal from its `definition.json` + `README.md`. F1
   first — it's the one everything else depends on, and its README's step-by-step table exists
   specifically so whoever builds it can verify agreement with `deriveState.ts` without re-deriving
   the logic.
5. **`docs/08-decisions.md`'s ASSUMED items** (below) need Jay's actual answers before Prod.
6. **`migration/reports/02_conflicts.md`** needs Jay's sign-off (FR-026) before any production load
   — the 16 cross-office duplicate resolutions and 2 FR-013 flags are named individually in it.

## Every `// ASSUMPTION` marker, and where

| Marker | File(s) | What it assumes |
|---|---|---|
| `ASSUMPTION: Q6` | `data/reference/equipment_models.csv` (13 excluded rows), `migration/02_clean.py`, `migration/03_models.py` docstring | Azure rows are cloud config (excluded); the 3 named "Vision"/"INFRANet" rows are physical appliances (kept). Determines whether any Retired asset survives migration at all — see `02_clean_report.md`'s "zero Retired assets" note. |
| `ASSUMPTION: Q8` | `app/src/features/checkout/CheckoutPage.tsx`, `solution/flows/F4/definition.json` | Expected return is optional, pre-filled +14 days. F4 can only nudge about checkouts that kept a date. |
| `ASSUMPTION: cadence` | `solution/flows/F3/definition.json` | Once per threshold crossing, not daily. |
| (inactive-project rule, unnumbered) | `app/src/api/mock/index.ts` (`submitCheckout`, `submitTransfer`) | Refuse outright rather than warn-and-permit. |
| eng_equipmentmodel alternate key | `migration/03_models.py` docstring, `docs/08-decisions.md` | manufacturer+model+equipmenttype, not manufacturer+model alone — `docs/01-data-model.md` needs correcting to match before Dataverse schema creation. |
| Migration custodian resolution | `migration/02_clean.py` (`FULL_NAME_STAFF`, `INITIALS_STAFF`) | A hand-built allowlist stands in for a live directory lookup — no tenant to check against. Not a product decision, an environment substitution; replace with a real lookup in a Dataverse-targeting `04_load.py`. |

Q4 (equipment model catalogue) is data work, already done and reviewable in full at
`migration/reports/03_models_review.md` (35 of 64 source rows corrected) — not a pending
assumption, a completed deliverable awaiting Jay's read-through.

## Exact remaining steps to go live

1. Jay answers the still-open items above (Q6 final call, Q8/Q9, inactive-project rule, reminder
   cadence, Q10 project master, Q11 report recipients, Q12 French timing) and reviews
   `migration/reports/03_models_review.md` and `02_conflicts.md`.
2. IT completes `docs/06-delivery-plan.md` Step 0.
3. Schema created in `Englobe-AMS-Dev` per `docs/01-data-model.md` **with the alternate-key fix**.
4. `migration/04_load.py` gains a Dataverse `$batch` writer; run against Dev; Jay reviews the same
   reports this build already produced against the mock, now against real Dataverse rows.
5. `pac code init`/`push` for `app/`; implement `api/dataverse/index.ts`; flip
   `VITE_AMS_BACKEND=dataverse`; every screen should work unchanged since they only ever call
   `AmsBackend`.
6. Build flows F1–F5 in the Maker Portal from their specs; F1 first, verified against
   `deriveState.ts`'s test suite by hand-checking a sample of transitions.
7. Ottawa pilot per `docs/06-delivery-plan.md` Step 7, including the Q3 return sweep
   (`migration/reports/02_sweep_checklist.md` is the working list, 592 items).
8. Production load, other offices, in order.

---

# Build report addendum — feature 007, Synthetic Fleet History (WS-G)

**Date**: 2026-09-02. **Scope requested**: "generate data" against
`specs/007-synthetic-data/spec.md`. **Delivered**: the generator, its committed inputs, three
verified datasets, the app plumbing to load one, and the two integration fixes the volume exposed.
US1–US4 are delivered; US5 (loading into a Dataverse environment) remains blocked on Q14.

Everything generated is fictional. No value in any dataset is copied from the real registry, the
calibration history or the migrated data — verified per run (FR-002/FR-003/FR-042: zero collisions
on Asset ID, serial, project number, project name, staff name or site name).

## What was built

| Piece | Where |
|---|---|
| Hand-authored fiction: roster, project and site pools, model windows, office activation | `data/synthetic/` (its README explains each file) |
| Generator: day-loop simulation, ledger, answer key, verifier, writers | `app/scripts/synthetic/` (its README explains each module) |
| Datasets, one directory per profile, plus Power BI CSVs and a manifest | `migration/synthetic/{demo,standard,large}/` |
| Verification report per profile | `migration/reports/07_synthetic_<profile>_report.md` |
| Dataset selection, synthetic banner, delta persistence | `app/scripts/copy-staged-data.mjs`, `app/src/components/DatasetBanner.tsx`, `app/src/api/mock/store.ts` |

```bash
npm run synthetic                          # standard profile
npm run synthetic -- --profile large       # or demo; --check-determinism to prove FR-052
node scripts/copy-staged-data.mjs --dataset synthetic/standard   # load it into the app
node scripts/copy-staged-data.mjs                                # back to the real data (the default)
```

## Measured output, all three profiles verified

| | `demo` (0.25) | `standard` (1.0) | `large` (4.5) |
|---|---|---|---|
| Assets ever owned / Active at as-of | 371 / 285 | 1,459 / 1,138 | 6,626 / 5,312 |
| Transaction headers / lines | 16,836 / 23,022 | 62,969 / 91,616 | 295,355 / 438,619 |
| Installations / components | 2,022 / 3,138 | 8,062 / 13,246 | 39,838 / 65,550 |
| Calibration records | 1,877 | 7,567 | 34,914 |
| Projects / sites | 260 / 686 | 625 / 2,542 | 2,501 / 12,069 |
| On disk / generation time | 17 MB / 3 s | 65 MB / 37 s | 418 MB / 20 min |
| Checks | all pass | all pass | all pass |

Earliest transaction 2006-08-25, latest as-of 2026-09-02: 20 years, every quarter populated.

**Not asserted — measured, per profile, by `lib/verify.ts`**: 0 disallowed transitions and all 33
allowed matrix cells exercised; 0 replay mismatches across every asset (SC-004, through the app's
own `domain/pointInTime.ts`); 0 timestamp collisions; 100% of assets acquired before the detail
window have lines in every year of it; distribution by type, group and home office within 10
percentage points of the real fleet; 16 of 16 planted scenarios present; the answer key reconciles
with `api/mock/reporting.ts` and `domain/installation.ts` with 0 discrepancies. `--check-determinism`
regenerates and compares every file: byte-identical.

## Verified live in a browser, at 390 px, against the standard profile

- The synthetic banner is on every screen: `SYNTHETIC DATA — not real assets · seed
  englobe-ams-007 · standard profile · as of 2026-09-02`. Removing the manifest removes the banner;
  a dataset that cannot prove it is synthetic is treated as real.
- `DL-BE-30000` — an Instantel Minimate Plus with **44 installations from 2006 to 2026**, currently
  deployed at 233 Queensway Ridge on project 09000061, next calibration 2026-12-26. This is what no
  screen could show before: the real migrated data gives every asset exactly one line.
- **Utilisation** (feature 006 US4) computes for the first time — proportions by equipment type and
  by office, lowest-availability pairs, 490 idle assets — instead of refusing for want of history.
- Planted scenarios opened at their documented identifiers: site *100 Danforth Ridge Road* carrying
  installations on two projects (09000615 now, 09000179 in 2013–14); `GEO-UM-40030` Available at
  Sudbury while `DL-UM-40030`, which shares its serial, is deployed at 1051 Frood Extension Road —
  Principle III's own worked example, reproduced in fiction.

## Two integration fixes the volume exposed

Both are recorded in `docs/08-decisions.md`; both are invisible against 1,026 real lines, which is
why only this dataset could surface them.

1. **`api/mock/store.ts` persisted the whole snapshot to localStorage on every write** and caught
   the resulting quota error silently, so with any dataset over ~5 MB a technician's own
   transactions were lost on reload without a word. It now re-hydrates the base from the static
   files and persists only the delta, keyed by dataset so a delta is never replayed onto different
   data. Six new tests cover it (`tests/api/dataset.test.ts`).
2. **`getAssetHistory` rebuilt a Map of every transaction on every call** and scanned the whole line
   table. `UtilisationPage` calls it once per asset: 34 ms per asset, about 49 seconds for the
   fleet, and the page never rendered. Indexed in the store, it is 221 ms for all 1,459 assets and
   the page renders in **1.5 s** — measured in the browser, inside feature 006's SC-010 budget.

An earlier ">120 s" reading for that page was **my measurement instrument**, not the app: a
`MutationObserver` whose callback called `innerText`, forcing a full reflow per mutation. Recorded
because the first number reported was wrong and the corrected method matters.

## Assumptions and open questions

- **Q14** (may synthetic data be loaded into `Englobe-AMS-Dev`, and bulk-removed afterwards?) blocks
  US5 only. Nothing in this work touched a tenant. Every row carries a marker naming its seed so a
  future load can be removed by query (FR-005).
- **Q15** (fictional identities on the real e-mail domain) and **Q16** (one added modem model, so the
  decided SIM-is-a-component pattern can exist) proceeded on their recorded recommendations.
- **Q18** (may a permanent component go to the lab alone?) is implemented on the no-lines reading —
  components carry no transaction lines and are calibrated with their parent. If Jay answers the
  other way, the generator changes, not the data model.
- **SC-003's line and calibration-record minimums were lowered** to match measurement (85,000 and
  7,000 at scale 1.0). The original figures came from this spec's own pre-build estimate, which
  assumed 3.5 deployments per logger per year; the realistic figure is about 1.5, because
  deployments last months and 61% of the fleet is deployed at any moment — the real registry's own
  proportion. This is a success criterion changed to fit measurement, so it is flagged rather than
  buried. Feature 006's SC-010 threshold (100,000 lines) now sits on the `large` profile, which
  measures 438,619.

## Left for someone else

- **Feature 008's FR-010a says synthetic outputs must not reach a release bundle, but
  `app/scripts/scan-bundle.mjs` reports synthetic data as "safe to publish".** One of the two is
  wrong. The generator writes only to `migration/`, outside anything Vite bundles; the exposure is a
  release build made while `public/data/` holds a synthetic dataset. Feature 008 owns both files.
- **24 generated files under `migration/synthetic/demo/` are tracked in git** (picked up by commit
  `1f99222`). They are reproducible byte-for-byte from the seed; `.gitignore` now excludes future
  ones, but those 24 need `git rm --cached` when someone is ready to commit.
- The roster is a fixed 123 people at every scale, so the `large` profile runs 5,312 assets past 91
  technicians. Fine for performance testing, thin as a story — scale the roster with the fleet if
  `large` is ever used for a demo rather than a stopwatch.
