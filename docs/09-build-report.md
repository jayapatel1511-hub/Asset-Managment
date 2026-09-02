# 09 — Build report

**Date**: 2026-09-02. **Scope requested**: a runnable, testable Power Apps Code App covering
features 001 (Asset Registry), 003 (Asset Transactions) and 004 (Calibration Management), P1–P2
stories, loaded with the real migrated inventory, state-derivation logic and migration scripts
complete and tested, demoable on a phone viewport. Features 002 (Inventory Migration) was
substantially exceeded as a foundation; 005 (Deployment & Kits, explicitly Phase 2) and 006 (Fleet
Reporting / Power BI) were not attempted — out of the requested scope, not a gap.

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

## What is stubbed

- **Camera scanning** (`ScanDialog.tsx`, marked `MOCK-ONLY`): accepts typed/pasted text instead of
  a camera feed. The Power Apps SDK's barcode scanner needs a Code App running inside Power Apps,
  not available in a local browser. The resolution logic it feeds (`SearchPage.handleScanned`) —
  exact match, bare-serial disambiguation, unknown-tag fallback — is fully implemented and
  exercised through this stand-in.
- **Role switching** (`RoleSwitcher.tsx`, marked `MOCK-ONLY`): a manual picker standing in for
  Entra security-group membership, which doesn't exist without a tenant. Deleted the day
  `api/dataverse/` goes live.
- **Offline queueing** (feature 003 US5, P5 — lowest priority by the spec's own ranking): not
  implemented. The mock backend has no real network round-trip to queue against (it's a same-
  origin static-file fetch plus `localStorage`), so the *specific* failure modes US5 tests for
  (queue-while-offline, replay-in-order-on-reconnect, surface-a-rejected-replay) aren't
  meaningfully exercisable against this backend regardless of effort spent — they need a real
  Dataverse network boundary to fail against. `SearchPage.tsx` does show a basic
  online/offline banner via `navigator.onLine`.
- **Calibration reminder notifications** (feature 004 US4, F3): specified as a file
  (`solution/flows/F3`), not running — no tenant, no Teams/email to send to. Also depends on an
  office→administrator assignment screen that was not built this session (flagged in
  `solution/flows/F3/README.md`).
- **Power BI** (feature 006): out of the requested scope for this session entirely.

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
