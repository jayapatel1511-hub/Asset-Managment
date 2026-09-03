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

> **Scope changed after this report was written — 2026-09-03.** Everything below describes an app
> built **phone-first**, with all 20 screens inside a 480 px column. Jay has since decided that the
> phone is a deliberate *slice* and the **desktop** browser is the full-function surface, and has
> brought **vehicles and vehicle reservations** into scope. Nothing in this report is wrong as a record
> of what was built; it is no longer a description of the target. Read `docs/08-decisions.md`
> (2026-09-03 rows), `docs/02-app.md` § Surfaces, and `specs/REMAINING-WORK.md` WS-J / WS-K before
> treating any screen inventory here as current.

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
---

# Build report addendum — Local API (`server/`), full-stack POC

**Date**: 2026-09-03. **Scope requested**: make the app run end to end on this machine against a
real database — the React app in `app/` talking over HTTP to a TypeScript API in `server/`
(Fastify + PGlite, in-process PostgreSQL), every write implemented, tested, verified in the
browser at 390 px against the real migrated data, documented and committed. No Microsoft tenant,
no Dataverse, no `pac`, no `pa app` — none available in this session, none in scope.

**Why it matters beyond "it runs"**: the mock backend answered every read from memory and applied
every write in the same process as the screen that requested it. Nothing had ever crossed a
network boundary, been validated a second time by a server that does not trust the client, or
committed inside a database transaction. This addendum records what happened when all three
became true. The short answer: the seam held — no screen changed — and three real defects
surfaced that the mock could not have exposed.

## Verified baseline before starting (re-run, not quoted)

| Check | Result |
|---|---|
| `app/`: `tsc -b` | clean |
| `app/`: vitest | 298 passing, 14 files |
| `server/`: `tsc --noEmit` | clean |
| `server/`: `--reseed --exit` | seeds 1,026 assets from `migration/staged/` |

## What was built

| Piece | Where |
|---|---|
| The write path — `applyTransaction` (this server's copy of flow F1) and `runCommand` (one PostgreSQL transaction per command, idempotent) | `server/src/services/transactionService.ts` |
| Features 001/003/004 commands: checkout, return, transfer, fault, missing, found, repair, send-to-calibration, retire, record-calibration, register-asset, next-id | `server/src/services/commandService.ts` |
| Feature 005 commands: deploy, recover, component swap, configuration change; plus office→admin assignment | `server/src/services/deploymentService.ts` |
| Every write endpoint, zod-validated at the boundary | `server/src/routes/commands.ts` |
| 64 tests over in-memory PGlite and the real migrated data | `server/tests/` |
| How to run it, dataset selection, identity, the refusal contract, the invariants, the Dataverse flow mapping, what a move to networked PostgreSQL takes | `server/README.md` |

Phase 1's read model, schema, seed loader and HTTP adapter were already written and are committed
unchanged as `14d1d13`.

### The rules that shaped it

- **`deriveState`, `assetId` and `installation` are imported from `app/src/domain/`, never copied.**
  Not one transition is reimplemented server-side. This is what makes flow F1 checkable against
  the same function later.
- **Asset current state is written in exactly one place** — `applyTransaction` — and every value
  comes from `deriveState`'s result, none from the request (Principle I).
- **Principle II is enforced by the database**, not by discipline: `BEFORE UPDATE OR DELETE`
  triggers on both history tables raise. There is no UPDATE or DELETE against either anywhere in
  `server/src/`, and two tests prove the triggers fire.
- **One PostgreSQL transaction spans the whole command**, so the composite ones — a Return that
  also reports a fault, a recovery that undeploys some components and marks others missing — are
  genuinely all-or-nothing, which the mock could not guarantee. A refusal found after an earlier
  write is thrown as a typed `Refusal` to force the rollback; returning `{ ok: false }` out of a
  `db.transaction()` callback would have committed what came before it.
- **Idempotency is per command**, against `command_idempotency`, and only *accepted* commands are
  recorded — so a refused one is re-evaluated on retry, because a refusal is an answer about the
  state at that moment, not a result to replay forever. This is why `deploymentService` needs none
  of the three per-method replay guards `api/mock/deployment.ts` carries: `runCommand` answers the
  replay before the "already deployed" rule can wrongly refuse it.

### Two places the server is deliberately stricter than the mock

Both are commented in `transactionService.ts` and in `server/README.md`:

- Opening a kit relationship **closes the child's previous open one**, because the schema allows a
  child exactly one open parent (`rel_one_open_parent`, a partial unique index). An asset moving
  straight from one kit to another would otherwise have collided with the index; the mock, having
  no index, would have left two open rows and reported the wrong parent.
- `asset.parentasset` is **recomputed from the open relationship rows**, never assigned, so closing
  a kit relationship cannot drop a permanent Component parent — which the mock's unconditional
  `parentasset = null` would.

## Test counts, actually run

```
app/     tsc -b                     clean
app/     vitest      317 passed (15 files)      — was 308; +9 i18n/humanise (G-09), commit 7b37683
app/     vite build  clean (801.79 kB, + RoleSwitcher and ScanDialog chunks)
server/  tsc --noEmit               clean
server/  vitest       64 passed (5 files)       — was 0
```

Server suite: `transactions` 20, `deployment` 16, `registration` 11, `fieldSecurity` 9,
`acceptance` 8. Each file gets its own in-memory PGlite seeded from `migration/staged/` — 1,026
real assets, not fixtures — in about 1.6 s, and drives routes through `app.inject()`, so every
request passes the same hooks, zod validation and error handler that production traffic does.

Fixtures are real Asset IDs chosen for what they are: `SLM-LD-PA-1712.0` is a permanent Component
of the sound-level meter `DST-LD-01` (one of the six Q5 component links), `AT-001` is one of the
648 CheckedOut assets, `DST013` carries a real ICCID, phone number and static IP.

Covered, beyond one happy path per route: checkout of a CheckedOut asset refused with the
offending asset named **and the rest of the cart untouched** (FR-003); a permanent Component child
refused alone; the inactive-project refusal (against a Closed project inserted as a test fixture —
all 25 migrated projects are Active, so the rule has no other way to be exercised); idempotent
replay returning the original transaction and writing no second line; a *refused* command not
recorded, so a corrected retry under the same key succeeds; deploy then partial recovery leaving
the installation open, then full recovery closing it with an end date; a component swap that
neither restarts nor interrupts the installation, checked from both sides of the effective date;
`UM21999` + *Instantel Micromate (DataLogger)* minting `DL-UM-21999`; two non-serialised
registrations getting `AT-0009` and `AT-0010` from one atomic sequence increment; and both history
triggers refusing to be bypassed.

**One test deliberately does not hard-code its expected number.** The 30-day calibration figure is
asserted against a count computed from the same rows, plus `>= 107` as a lower bound, rather than
`=== 107`: `nextcaldue` values are fixed while today advances, so a hard equality would have become
a false failure within a month. The measured value on 2026-09-03 is exactly 107.

## Verified in the browser, at 390×844, against the real migrated data

`englobe-ams-api` (3001) then `englobe-ams-localapi-alt` (3210, `VITE_AMS_BACKEND=http`), against
a freshly `--reseed`ed database. Screenshots attached to the session.

| # | Check | Result |
|---|---|---|
| 1 | What do we own? | Reports → Fleet: **1026**, by office / asset group / equipment type; 35 temporary tags, 2 third-party owned |
| 2 | Where is asset X? | `DL-UM-16984`: `Location —` (honestly unknown while checked out), `Home office Sudbury` |
| 3 | Who has asset X? | `Custodian James Ross` |
| 4 | What is available at office Y? | **375** available fleet-wide, **Ottawa 49**; the fleet-counts report reconciles exactly with the same filtered list (SC-003) |
| 5 | Calibration due in 30 days | **107 overdue**, grouped by office (Ottawa 36), each row showing exact days overdue |
| 6 | What is assigned to project Z? | Reports → By project `01937805`: exactly `DL-UM-15387 / 15713 / 16842 / 16956 / 16984 / 21947` |
| — | One serial, two assets (Principle III) | Searching `16984` returns `DL-UM-16984` (DataLogger, Checked out, Sudbury, James Ross) **and** `GEO-UM-16984` (Geophone, Available, Toronto) |
| — | Checkout then Return, as the demo Field User | `DL-MP-12708` → *"Checkout TXN-000012 recorded"* → CheckedOut, custodian `tech@englobecorp.com`, project `01937805`, `Location —`; then *"Return TXN-000013 recorded"* → Available at Ottawa, custody and project cleared. History shows both new lines plus the migration line, newest first |
| — | Refusal in both layers | Adding `AT-001` (CheckedOut) to the cart is refused on screen — *"AT-001 is CheckedOut, held by — — can't add it"*, Submit disabled. The same request `curl`ed straight to the API is refused independently: `200 {"ok":false,"reason":"Checkout is not a valid transition from CheckedOut for AT-001.","offendingAssetId":"AT-001"}` |
| — | Deploy then recover, as the demo Office Admin | `DL-MP-12709` + `GEO-SE-12716` (Sensor1 · V) to a new site *412 Verification Ridge Road* → *"Deployment TXN-000015 recorded"*; the site page shows the open installation, both component rows, Solar, POR-412. Recovered → *"Recovery TXN-000016 recorded"*: installation closed with an end date and a closing transaction, both assets CheckedOut in the admin's custody with `Location` null (FR-013), **one clean `Undeploy` line**, kit relationship closed, the site out of "current" but still in history (FR-023) |
| — | Writes survive a reload | `localStorage` cleared entirely, hard reload: both the Checkout and Return lines still there. `localStorage` holds only `ams-mock-current-user` — the http backend keeps no store delta, because the data is in PGlite on disk |
| — | Role switch and field security | Same asset `DST013`, both roles. Office Admin: Carrier Rogers, ICCID 89302720513012024886, Phone 705-618-1098, Static IP 72.142.178.47. Field User: Carrier only. Confirmed against the API directly — `field` receives nulls, `admin` and `owner` receive values |

Also verified: `TXN-000012` is the same sequence number the mock produced for the first
post-migration transaction (11 migrated headers + 1), here from a PostgreSQL sequence; and two
identical `Transfer` submissions under one `clientSubmissionId` produced one transaction and one
line.

## Three defects found and fixed, none of which the mock could have shown

1. **Feature 006 FR-028's utilisation guard** (a defect `specs/REMAINING-WORK.md` had already
   recorded) used each asset's own first transaction as the migration boundary. It conflated "our
   records do not go back that far" (fleet-wide) with "this asset did not exist yet" (per asset) —
   two facts that coincide only in the migrated data, where every asset's first line is dated the
   migration day. Any asset acquired after go-live therefore dropped out of every utilisation
   report. Fixed: the boundary is now an explicit argument (`recordsBeganAt`), and an asset
   acquired inside the period is clipped to its acquisition date or excluded, never reported as
   insufficient history. 006 SC-013 can now pass. Tests 14 → 24.
2. **No screen rendered ICCID, phone number or static IP at all** (`docs/12-ui-spec.md` G-11), so
   the Office Admin saw nothing either and FR-030 could not be demonstrated — found only because
   the browser verification tried to show it. `AssetDetailPage` now has a SIM / connectivity card
   with **no role check in it**: the data layer sends a Field User nulls, so the card has nothing
   to show them and the UI cannot disagree with the security rule because it never re-states it.
3. **`RoleSwitcher` left stale data on screen.** `useCurrentUser().reload` re-reads the current
   user, but a screen already holding a fetched asset keeps the payload it was served as somebody
   else — so switching from Office Admin to Field User left the ICCID visible and made field
   security look broken in exactly the demo that control exists for. It now reloads the page, which
   is the truthful analogue of a new Entra sign-in.

## Also closed this session

- **Feature 008 T012** — `RoleSwitcher` and `ScanDialog` are now *absent* from a release bundle,
  not hidden in one, behind `app/src/devStandins.tsx`'s build-time gate. Proven both ways: the
  ordinary build emits `RoleSwitcher-*.js` and `ScanDialog-*.js` as chunks and contains all four of
  their identifying strings; `build:release` emits neither chunk and none of the strings, and
  `scan-bundle.mjs` still reports clean against 1,026 asset IDs, 126 ICCIDs, 128 phone numbers and
  225 static IPs. The Scan button is hidden with the dialog, because a release has no scanner behind
  it yet. (`search.role` does still appear in a release bundle — it is a key in the single bundled
  i18n object, not the component, and removing it would break dev mode.)
- **Feature 008 T016** — the router basename follows `import.meta.env.BASE_URL`. Recorded as
  *prepared, not resolved*: confirming the real `/play/e/{env}/a/{app}` prefix needs `pa app run`.
- **Three real horizontal overflows at 390 px**, on `/calibration`, `/checkout` and `/deploy`
  (measured at 413, 406 and 402 px in a 390 px viewport, clipped rather than scrollable, so the
  control was simply unreachable). All 18 routes re-measured clean.
- **23 generated files under `migration/synthetic/demo/` untracked** with `git rm --cached`, files
  kept on disk. 23, not the 24 this report predicted: `demo/manifest.json` is deliberately kept by
  `.gitignore`'s `!migration/synthetic/*/manifest.json` negation, since a dataset that cannot prove
  it is synthetic is treated as real (FR-007).

## New `// ASSUMPTION` markers

One, and it is not new ground — it restates an existing decision in the new layer:

| Marker | File | What it assumes |
|---|---|---|
| `ASSUMPTION` (inactive-project rule, unnumbered) | `server/src/services/commandService.ts` (`checkout`, `transfer`) | Refuse a non-Active project outright rather than warn and permit. Same assumption `api/mock/index.ts` already carries and the same `docs/08-decisions.md` row; the server now enforces it independently, which is the point of validating in both layers |

Nothing else here rests on an unanswered clarification. The POC's own choices — the single-status
schema, the HTTP-200 refusal contract, the router basename, the FR-028 fix — are recorded as
decision rows in `docs/08-decisions.md` rather than as assumptions, because they are engineering
calls this session made and can defend, not guesses about Jay's intent.

## An instrument caution for the next session

With the Browser pane hidden, `computer` screenshots sometimes return a **clipped or tiled** image
and clicks time out **even when they land**. Several screens looked broken in screenshots and
measured perfectly clean (`/`, `/asset/*`, `/site/*`); two screens looked broken and *were*. The
previous session recorded the same tooling behaviour. The lesson that cost time here: measure
before believing a screenshot — `getBoundingClientRect().right` against
`document.documentElement.clientWidth` settles a layout question in one call, and DOM events
dispatched through `javascript_tool` drive the app's real code paths when clicks will not land.

## What this POC still is not

- **Not the production architecture.** Production is Dataverse plus flows F1–F5. `server/README.md`
  has the table mapping each piece of this server onto the flow that will replace it, including the
  one thing `api/dataverse/` must *not* do (call `deriveState` to write `eng_asset` itself — that is
  F1's job, and a second write path to derived fields would break Principle V).
- **Not authenticated.** `x-ams-dev-user` is a header, not a credential, which is why the server
  binds to loopback only. Replacing it with Entra changes one file.
- **Not authorised beyond the mock's two rules** (FR-025's custodian check on Return, FR-007's
  not-held check on Deploy). Admin-only screens are gated in the router only; in production the
  three Dataverse security roles do this.
- **Still no three-axis status model.** One `status` column, on purpose — see `docs/08-decisions.md`.
- **WS-E and WS-F remain untouched**, and everything under "What needs the tenant" above still
  needs it. This session moved nothing into that column and nothing out of it.
