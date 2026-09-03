# Remaining work — parallel workstream map

**As of 2026-09-03.** Two new workstreams — **WS-J** (the desktop surface; the phone becomes a
deliberate slice) and **WS-K** (vehicles and reservations) — were added by Jay's 2026-09-03 scope
decisions. See `docs/08-decisions.md`. WS-A to WS-D and WS-G are complete; WS-H's US1 is built with T012 and T016
now closed; **WS-I (the local full-stack POC) is complete** — see the "Local API (`server/`)"
addendum in `docs/09-build-report.md`. WS-E and WS-F remain open and both need the tenant.

**Test baseline: 317 in `app/` (15 files) and 64 in `server/` (5 files).** Re-verified 2026-09-03
by running both suites, not quoted from a report. Fewer than that is a regression.

**Also landed 2026-09-03 (`7b37683`): the UI-spec gap pass.** Seven of `docs/12-ui-spec.md`'s gaps are
closed — G-07 (label reuse), G-08 (pending-sync badge), G-09 (humanised enum labels), G-10 (shared-serial
line), G-11 (SIM fields, with `f09f0ee`), G-13 (browser `alert`) and G-15 (retire confirmation). They are
struck through in that document rather than deleted. **G-12 (hide vs disable invalid actions) is still
open by choice** — a design decision for Jay, not a deviation; `asset.actions.notAllowed` remains unused.
Do not re-audit the closed seven.

Read `specs/AGENT-BRIEF.md` first — especially §1 (environment) and §5 (why Phase 0 is serial).

This document exists to answer one question: *what can be built right now, by how many agents at
once, without a Microsoft tenant?* Everything below is buildable and verifiable locally against
the real migrated data unless the row says otherwise.

---

## The gate: Phase 0 is serial and comes first

Four files are shared by every workstream (`api/AmsBackend.ts`, `api/types.ts`, `i18n/en.json`,
`App.tsx`). Agents editing them concurrently will clobber each other no matter how good the specs
are. So:

**Phase 0 — orchestrator alone, no subagents.** *(Completed 2026-09-02, commit `cf94ab3`. Kept as
the procedure for the next fan-out — WS-G's FR-060 `store.ts` change and WS-H's T012/T016 `App.tsx`
edits are Phase 0-class work.)*

1. Add every new method signature to `AmsBackend.ts` for the workstreams about to fan out, bodies
   throwing `new Error("not implemented")` in both `api/mock/` and `api/dataverse/`.
2. Add every new entity type to `types.ts`.
3. Add every new i18n key to `i18n/en.json`.
4. Add every new route to `App.tsx`.
5. Split `api/mock/index.ts` into the per-domain modules named in `AGENT-BRIEF.md` §5, then treat
   `index.ts` and `store.ts` as frozen.
6. Verify `npx tsc -b` compiles and `npm run test` still passes (**317 as of 2026-09-03**).

Then fan out. Phase 0 is roughly an hour of careful work and it is what makes the rest parallel.

---

## Workstreams

### WS-A — Feature 005, Deployment & Kits *(COMPLETE 2026-09-02)*

> Delivered — `docs/09-build-report.md` § "Phase 0–2 — multi-agent extension". Its `tasks.md`
> boxes were never ticked; the build report is the record. Text below kept for reference.

**Spec**: [`specs/005-deployment-and-kits/spec.md`](005-deployment-and-kits/spec.md) — 30 FRs,
4 stories. **Plan**: [`plan.md`](005-deployment-and-kits/plan.md). **Tasks**:
[`tasks.md`](005-deployment-and-kits/tasks.md).

Fully buildable against the mock backend. Deploy a station to a site, recover it whole or in part,
read a site's installation history, swap a component in service. This is the feature that turns
"James has a Micromate" into "a Micromate is monitoring 337 Power Street for project 02208928".

Owns `features/deploy/**`, `features/recover/**`, `features/site/**`, `api/mock/deployment.ts`,
`domain/installation.ts`.

One open clarification (FR-006, site coordinates) — proceed on hand-entered with an optional
device capture, marked `// ASSUMPTION`.

### WS-B — Feature 006, Fleet Reporting *(COMPLETE 2026-09-02, except the Power BI publish)*

> Delivered — domain modules, in-app surface, PBIP text model. **The FR-028 defect is FIXED
> (2026-09-03, WS-I)**: the boundary is now the fleet-wide one, passed in explicitly, and an asset
> acquired inside the period is clipped to its acquisition date or excluded rather than reported as
> insufficient history. 006 SC-013 can now pass. `domain/utilisation.ts` tests 14 → 24. Only the
> Power BI publish still needs the tenant. Text below kept for reference.

**Spec**: [`specs/006-fleet-reporting/spec.md`](006-fleet-reporting/spec.md) — 30 FRs, 4 stories.
**Plan**: [`plan.md`](006-fleet-reporting/plan.md). **Tasks**:
[`tasks.md`](006-fleet-reporting/tasks.md).

Power BI itself needs the tenant. Two thirds of this feature does not:

- `domain/pointInTime.ts` — replay an asset's lines to reconstruct its state at any timestamp.
  This is acceptance question 7 and it is pure, testable domain logic.
- `domain/utilisation.ts` — spans per status from consecutive transactions, with the honesty rule
  that it refuses to compute across the migration boundary (FR-028).
- An in-app reports surface as the interim for managers who do have app access.
- Power BI semantic model authored as **PBIP** (TMDL text files) — genuinely offline-authorable,
  importable later.

Owns `features/reports/**`, `api/mock/reporting.ts`, `domain/pointInTime.ts`,
`domain/utilisation.ts`.

### WS-C — Feature 003 US5, offline queueing *(COMPLETE 2026-09-02)*

> Delivered — `api/queue/`, `api/mock/offline.ts`, 17 + 7 tests. Text below kept for reference.

**Spec**: [`specs/003-asset-transactions/spec.md`](003-asset-transactions/spec.md) US5, FR-036 to
FR-040.

`docs/09-build-report.md` is right that the current mock has no network boundary to fail against —
it is a same-origin static fetch plus `localStorage`. So the work here is to **create** that
boundary: a queue module with an injectable transport, a fault-injecting fake transport for tests,
and the three behaviours US5 actually specifies — queue while offline, replay in order on
reconnect, surface a rejected replay for human resolution and never discard it.

Built this way it is genuinely testable now and drops onto `api/dataverse/` unchanged later.
Owns `api/queue/**`, `api/mock/offline.ts`.

Lowest priority by the spec's own ranking (P5) — but a wrong offline implementation is worse than
none, which is exactly why it deserves a real test harness rather than a hopeful one.

### WS-D — Feature 004 US4, office→administrator assignment *(COMPLETE 2026-09-02)*

> Delivered — `OfficeAdminsPage.tsx`, `api/mock/admin.ts`, gap report, 10 tests. Notification
> delivery still needs the tenant. Text below kept for reference.

**Spec**: [`specs/004-calibration-management/spec.md`](004-calibration-management/spec.md) US4,
FR-027, FR-027a.

`data/reference/office_admins.csv` is superseded (see its README) — assignment must derive from
the location table so an eleventh office is covered without configuration. Needs a small admin
screen, plus the gap report FR-027a requires for an office with no administrator.

Notification delivery itself needs the tenant; the assignment data and the gap report do not, and
flow F3 cannot be finished without them.

Owns `features/admin/OfficeAdminsPage.tsx`, `api/mock/admin.ts`.

### WS-E — `api/dataverse/` implementation *(compiles, cannot be tested)*

Every method currently throws. **Read the 95-line docstring at the top of
`app/src/api/dataverse/index.ts` first — it is the contract**, and it fixes the four decisions that
matter: one file per table, every write as a single `$batch` of one transaction plus N lines
(FR-003), `If-Match` etag retry for `eng_idsequence`, and — the easiest thing to get wrong — the
implementation **must not** call `deriveState()` to write `eng_asset` itself. Flow F1 does that.
Doing it here gives the app a second unaudited write path to derived fields and breaks Principle V.

See `docs/10-integration.md` for how this sits against the other six Microsoft surfaces.

**Cannot be verified without a tenant.** Must compile, must be reviewed, must not be reported as
working. Keep every file marked `// DATAVERSE-ONLY`.

### WS-F — Schema and solution artefacts

Author the 10 tables (9 + `eng_idsequence`; `eng_reservation` added 2026-09-03), choice sets, alternate keys, relationships, indexes, the three security roles
and the `AMS Sensitive` field security profile per `docs/01-data-model.md` and `docs/05-security.md`
— as files, for import later.

**Carry the alternate-key correction**: `eng_equipmentmodel` must key on
manufacturer + model + **equipmenttype**, not manufacturer + model alone. `docs/01-data-model.md`
as written would silently merge three real catalogue rows into one. This is recorded in
`docs/08-decisions.md`; `docs/01-data-model.md` and feature 001's FR-010 were both corrected to match
on 2026-09-02.

### WS-G — Feature 007, Synthetic fleet history *(IN PROGRESS 2026-09-02 in a concurrent session — still no `plan.md`)*

**Spec**: [`specs/007-synthetic-data/spec.md`](007-synthetic-data/spec.md) — 60 FRs, 5 stories.

A fictional fleet with twenty years of history and five years of full operational detail, shaped like
the real one, valid under every rule the system enforces, deterministic per seed, impossible to
mistake for real data. It is what lets the history-dependent screens (timeline, site history,
utilisation, compliance) and the Power BI model be demonstrated and tested before years of live use
exist — the real migrated data has one line per asset and, per feature 006's FR-028, correctly refuses
to compute utilisation over it. Ships with an answer key for the seven acceptance questions and a
`large` profile for 006's SC-010 (5,000 assets, 100,000 lines).

Fully buildable without a tenant except US5 (a Dev load, gated on Q14). Owns `data/synthetic/**`
(hand-authored fiction: roster, project and site pools, model windows), `app/scripts/synthetic/**`
(the generator — TypeScript, so FR-014 holds by construction), its outputs beside — not inside —
`migration/staged/`, its verification report, and the synthetic-data indicator component. The
indicator mounts in the app shell, a shared file: coordinate as WS-H does for T016.

**Spec amendments from the 2026-09-02 review bear directly on this work.** 006 FR-028 now
distinguishes before-acquisition from before-records, and the built utilisation guard does not — until
that is fixed, SC-013 cannot pass. Q18 (component calibration despatch) decides what FR-019 must
generate for pre-amps, elements and SIMs. FR-041, FR-049 and FR-060 were corrected. Re-read the spec
before relying on an earlier copy, and write `plan.md` before calling the generator done.

**Done.** Generator at `app/scripts/synthetic/`, inputs at `data/synthetic/`, datasets at
`migration/synthetic/{demo,standard,large}/`, reports at
`migration/reports/07_synthetic_<profile>_report.md`. All three profiles pass every check including
byte-identical regeneration. Read `docs/09-build-report.md`'s feature 007 addendum for measured
counts and the two integration fixes the volume exposed (`store.ts` delta persistence, and an
indexed `getAssetHistory` that took the utilisation report from never rendering to 1.5 s).

**Still open**: US5 (loading into `Englobe-AMS-Dev`) needs Q14 answered — nothing else in the
feature touches a tenant. Q18 is implemented on the no-lines reading (components carry no
transaction lines, calibrated with their parent) pending Jay's confirmation.

### WS-H — Feature 008, Release & Operations *(US1 BUILT 2026-09-02 in a concurrent session; US2–US5 tenant-bound)*

**Spec**: [`specs/008-release-and-operations/spec.md`](008-release-and-operations/spec.md) — 33 FRs,
5 stories. **Plan**: [`plan.md`](008-release-and-operations/plan.md) (added 2026-09-02). **Tasks**:
[`tasks.md`](008-release-and-operations/tasks.md).

**US1 is built**: `release-guard.mjs`, `scan-bundle.mjs`, a mode-conditional `publicDir` and a
separate `build:release`, verified by its author against the staged data (13 files refused with the
mock backend; the release bundle scanned clean against every staged Asset ID, ICCID, phone and IP).

**T012 and T016 are now DONE (2026-09-03, WS-I).** T012: `RoleSwitcher` and `ScanDialog` are
reached only through `app/src/devStandins.tsx`, whose build-time gate keeps them out of a release
bundle entirely — proven both ways (the ordinary build emits both as chunks and contains their
strings; `build:release` emits neither). T016: the router basename follows
`import.meta.env.BASE_URL`, so hosting under `/play/e/{env}/a/{app}` is a config change — recorded
as *prepared, not resolved*, since confirming the real prefix needs `pa app run`. T032 (final
`tsc -b`) passes: both suites and both builds are clean. Before this existed, nothing prevented a `pa app push` from publishing
1,026 real assets — including SIM ICCIDs, phone numbers and static IPs — to a publicly accessible
endpoint with no IP restriction and no recall (`docs/10-integration.md` § Hosting).

US2–US5 are operator documentation (`docs/11-runbook.md`, not yet written) that can only be
*verified* with tenant access; `plan.md` now gates them.

Owns `app/scripts/**` except `app/scripts/synthetic/**` (WS-G), `app/vite.config.ts`,
`app/package.json` scripts, `tests/build/**`, `docs/11-runbook.md`. Two coordination points touch
`App.tsx`: T012's conditional import and T016's routing fix.

**Note the interaction with WS-G**: synthetic data must never reach a release bundle either. WS-H's
bundle scanner should cover `data/synthetic/**` outputs as well as `migration/staged/`.

### WS-I — Local full-stack POC: the TypeScript API over PGlite *(COMPLETE 2026-09-03)*

> Delivered — `server/` (Fastify + in-process PostgreSQL), every read and **every write**, 64
> tests, `server/README.md`, and the browser verification of acceptance questions 1–6 plus a real
> checkout/return, a two-layer refusal, and a deploy/recover cycle against the migrated data. Read
> the "Local API (`server/`)" addendum in `docs/09-build-report.md` for measured results.

**Why it existed**: the mock backend answered every read from memory and applied every write in
the same process as the screen that asked. Nothing had crossed a network boundary, been validated
by a server that does not trust the client, or committed inside a database transaction. WS-I made
all three true without a tenant, so the design could be tested rather than assumed.

**What it proved**: the `AmsBackend` seam held — `VITE_AMS_BACKEND=http` swapped the entire data
source with **no screen change**, which is the same property the constitution's SharePoint-Lists
fallback depends on. It also surfaced three defects the mock could not have: 006's FR-028
utilisation guard, UI-spec gap G-11 (no screen rendered ICCID/phone/static IP, so FR-030 could not
be demonstrated), and `RoleSwitcher` serving data fetched as a different identity. All three fixed.

Owns `server/**`, `app/src/api/http/**`, `app/.env.localapi`, and the `englobe-ams-api` /
`englobe-ams-localapi*` launch configs.

**Still open, and all of it needs the tenant**: nothing in WS-I. It is a proof of concept and
production remains Dataverse plus flows F1–F5 — `server/README.md` has the table mapping each
piece of the server onto the flow that replaces it, and names the one thing `api/dataverse/` must
not do (call `deriveState` to write `eng_asset` itself; that is F1's job).

**If the premium-licensing fallback is ever taken**, `server/README.md` § Swapping in networked
PostgreSQL is the migration path: `schema.sql` runs unchanged on real PostgreSQL, `Queryable` is
the whole surface a `pg` Pool has to satisfy, and the `FOR UPDATE` ordering and `ON CONFLICT`
sequence increment already written for it start doing real work.

---

### WS-J — The desktop surface and the route manifest *(NEW 2026-09-03, not started)*

**Why:** Jay's 2026-09-03 decision — the phone is a slice, desktop is the full-function app
(`docs/08-decisions.md`, `docs/02-app.md` § Surfaces, `docs/12-ui-spec.md` § 1 and § 8, gap G-01
resolved and G-22 opened). All 20 built screens currently live inside a 480 px column, six of them in
the phone's bottom nav including admin and the four reports.

**Phase 0-class — do not fan out around it.** It replaces `App.tsx`'s route table, which
`AGENT-BRIEF.md` § 5 names as one of the four shared files. Sequence:

1. `app/src/routes.ts` — one manifest:
   `{ path, element, roles, surfaces: ("field"|"desk"|"console")[] }`. **Three values, not two** —
   Jay's later 2026-09-03 decision split desktop into a user app and an admin console
   (`docs/17-ux-audit.md` § G). `App.tsx` renders from it; `BottomNav` filters by
   `surfaces.includes("field")`.
2. A surface hook (`useSurface()`, breakpoint 768 px) and an off-surface page — a route opened where it
   does not belong renders "this screen is on the desktop app", **never a 404**: the same deep link has
   to stay valid in an email opened on either device.
3. Desk shell: side nav instead of bottom nav, two-pane list + detail above 900 px, full-width tables
   for S17–S20. Console's own shell is WS-L, not this workstream — but the manifest must carry its
   surface value from the start so WS-L is additive.
4. Trim S03 on mobile — the full history tab moves to desktop, phone keeps the last few events.

**Watch for:** the 317-test baseline. Tests that assert a nav item or route exists will need a surface
argument rather than deletion — a route vanishing from mobile must not read as a route removed.

**Verifiable locally.** No tenant needed; this is layout and routing over the existing backend.

### WS-K — Vehicles and reservations *(NEW 2026-09-03, not started)*

**Why:** Jay's 2026-09-03 decision — cars and trucks are tracked assets, *and* bookable
(`docs/08-decisions.md`). "Vehicle booking" moved from out-of-scope to in-scope in `docs/00-brief.md`.

Two halves of very different size:

- **Vehicles (small).** Choice values only — `eng_assetgroup` + `Vehicles`, `eng_equipmenttype` +
  `PickupTruck`/`Van`/`Car`/`Trailer`, `eng_identifiertype` + `Plate`. No new asset columns; VIN in
  `eng_serialnumber`, plate in `eng_identifiervalue`. Checkout/Return/Transfer and the state machine are
  untouched. Needs a few catalogue rows in `data/reference/equipment_models.csv` and the G-23 visual
  identity (icon, plate on the row).
- **Reservations (a feature).** New table `eng_reservation` (`docs/01-data-model.md`), new flows **F6**
  (conflict arbiter) and **F7** (fulfilment, expiry, reminder) in `docs/03-automation.md`, the checkout
  guard as F1 step 2b, plus screens: Reserve + My reservations on mobile, the calendar on desktop.

**The load-bearing design point:** `Reserved` is **not** an `eng_assetstatus` value, and must not become
one. A booking is a future claim; status answers "where is it now". The two are orthogonal and conflating
them breaks both the state machine and CLAUDE.md rule 1. `docs/01-data-model.md` § "Why this is not a
status" is the argument in full — read it before writing any of this.

**Blocked on Jay:** Q20(a) and (b) — override rights and the no-show grace period — gate F6/F7's README.
Q20(c) (per-asset vs pooled bookings) changes the table if answered late. Q19 (odometer,
inspection-due) is genuinely optional and nothing depends on it.

**Deserves its own spec directory** (`specs/009-vehicles-and-reservations/`) on the pattern of 001–008,
because it adds a table, two flows and four screens — it is not a change to an existing feature.

### WS-L — The admin console *(NEW 2026-09-03, not started, partly blocked)*

**Why:** Jay's second 2026-09-03 decision — "admin should have full control… everything should not be
static". `docs/17-ux-audit.md` is the audit behind it. **Read that document before planning this
workstream**; the summary below is not a substitute for its 23 findings.

The headline: **every reference table is read-only in the app.** `AmsBackend` has `listLocations`,
`listEquipmentModels` and `listProjects` and no writer for any of them; the only reference-data write
in the whole API is `setOfficeAdmins`. Two of the consequences are live defects, not missing features:

- **An administrator cannot create an office** — yet the N-offices decision (2026-09-02) and
  `docs/05-security.md`'s dropping of per-office Entra groups both rest on their being able to.
- **Nothing can re-parent SWO, Mississauga or Thunder Bay**, which `migration/` deliberately left flat
  under Ontario *for an admin to fix on a screen* that was never built.

Scope, in dependency order:

1. **API + backend** — create/update/deactivate for locations, equipment models, projects, categories.
   Phase 0-class for `AmsBackend.ts` and `types.ts` (see the gate at the top of this file).
2. **Console shell** — persistent entity nav, list-and-detail, table-first. Not the phone column.
   G-22 in `docs/12-ui-spec.md`; no screens are specified yet.
3. **Deactivate-not-delete, with a usage count** before any destructive reference edit (audit A4, E5).
4. **Bulk operations** (audit E3) — the highest-value admin affordance and entirely absent today.
5. **Reference-data change history** (audit E4) — auditing is currently on for `eng_asset`,
   `eng_assetrelationship` and `eng_calibrationrecord` only.

**No longer blocked — Q21 and Q22 were answered 2026-09-03.** The schema is settled and written into
`docs/01-data-model.md`:

- **`eng_category`** — one hierarchical table replacing the `eng_assetgroup` / `eng_equipmenttype` option
  sets. `eng_equipmentmodel` takes one lookup to the leaf; the group is derived by walking up. Alternate
  key becomes `manufacturer + model + eng_category`.
- **`eng_carrier`** and **`eng_retirementreason`** — small reference tables, formerly option sets.
- **`eng_transactionline.eng_kitroleindex`** (1..N) — removes the four-sensor cap. `eng_kitrole` keeps
  fixed role *types*. This decomposition is `ASSUMED, pending Jay` in `docs/08-decisions.md`.
- **Employees = attributes of existing staff only** (home office, offices administered). No staff table.
  Home office is the piece that does not exist yet, and the "Available here" filter and calibration
  reminders both use it.

**Carry the reporting change.** `getFleetCounts`'s `byAssetGroup`/`byEquipmentType` are flat
`Record<string, number>` today; against the hierarchy they become count-by-level-1-ancestor and
count-by-leaf. Its tests change with it. Do not leave this to the screens — it is domain work.

**Carry the migration change, and do not touch the cleaning stages.** `02_clean.py` and `03_models.py`
keep emitting flat `assetgroup`/`equipmenttype` strings — the mock backend and all 1,459 synthetic
assets read that shape, and changing it breaks the local build for no gain. What is needed is **one new
step** that derives the category tree from the distinct staged values and resolves each model to its
leaf, plus the loader writing a lookup rather than two choices. Idempotent, with a `*_report.md`, like
every other step. See the note in `docs/04-migration.md`.

**Also enforce `docs/01-data-model.md` § Reference-data rules**: deactivate never delete, usage count
before a destructive edit, and auditing extended to all six reference tables.

**Do not start step 2 before WS-J.** Console shares WS-J's route manifest and shell breakpoints.

## Sequencing

```
Phase 0  (orchestrator, serial)                  DONE 2026-09-02, commit cf94ab3
   │
   ├── WS-A  005 Deployment & Kits                DONE
   ├── WS-B  006 Reporting domain + PBIP          DONE — Power BI publish needs the tenant; FR-028 guard defect recorded
   ├── WS-C  003 US5 offline queue                DONE
   ├── WS-D  004 US4 admin assignment             DONE — delivery needs the tenant
   ├── WS-E  api/dataverse (compile-only)         open — Jay's Developer environment now allows a real test (docs/08)
   ├── WS-F  schema + solution files              open
   ├── WS-G  007 synthetic fleet history          DONE
   ├── WS-H  008 release safety                   US1 DONE incl. T012/T016; US2–US5 need the tenant
   ├── WS-I  local full-stack POC (server/)       DONE 2026-09-03
   │
   ├── WS-J  Field/Desk surfaces + route manifest NEW 2026-09-03 — Phase 0-class, serial, blocks WS-K + WS-L screens
   ├── WS-K  vehicles + reservations              NEW 2026-09-03 — needs a spec dir; F6/F7 blocked on Q20
   └── WS-L  admin console (Console surface)      NEW 2026-09-03 — reference-data CRUD; blocked on Q21/Q22, then WS-J
   │
Integration (orchestrator, serial)
   app:    tsc -b && vitest run && vite build      317 tests, 15 files
   server: tsc --noEmit && vitest run               64 tests, 5 files
   Drive the app at 390px against real data; verify acceptance questions 1–7
   docs/09-build-report.md now records WS-G, WS-H and WS-I
```

**WS-J comes before WS-K's screens.** WS-J owns the route manifest, so a reservation screen added
first would be added to a routing table that is about to be replaced — and would have to guess its own
surface. WS-K's *data* half (choice values, table definition, flows as files) is independent and can go
in parallel with WS-J.

WS-A to WS-D, WS-G, WS-H US1 and WS-I are complete, and `docs/09-build-report.md` records all of
them: § "Phase 0–2 — multi-agent extension" for the first four, the feature 007 addendum for WS-G,
and the "Local API (`server/`)" addendum for WS-I (which also records WS-H's T012/T016). WS-E and WS-F
are open and neither can be verified without the tenant; **WS-J, WS-K and WS-L are open and all three
are fully buildable locally**, which makes them the only work left that does not wait on Microsoft.
WS-L's step 1 (the API) is buildable now; its screens wait on WS-J and on Jay's Q21/Q22.

## Not buildable in any session without the tenant

From `docs/09-build-report.md` § "What needs the tenant" — listed here so nobody spends a session
attempting them:

- `pac auth create`, `pac solution init`, and `pa app init` / `pa app run` / `pa app push`
  (**not** `pac code init/push` — that CLI is deprecated; see `docs/10-integration.md` § Hosting)
- Enabling the "Power Apps code apps" environment feature, and Power Apps Premium licences for
  every end user who plays the app
- Creating any Dataverse table, role or field security profile
- Publishing flows F1–F5 in the Maker Portal
- Camera barcode scanning (needs a Code App running inside Power Apps — `ScanDialog.tsx` is the
  typed stand-in)
- Real Entra role membership (`RoleSwitcher.tsx` is the stand-in)
- Teams or email notification delivery
- A published Power BI report against DirectQuery

## Still needs Jay, not an agent

Tracked in `specs/clarifications.md` and `docs/08-decisions.md`. Agents proceed under the recorded
assumption and mark it; they do not resolve these:

- **Q6** — are the 3 kept "Vision"/"INFRANet" server assets real equipment, or should they be
  excluded with the 13 Azure rows? *(Proceeded on: 13 excluded, 3 kept.)*
- **Q8 / Q9** — expected-return requirement *(proceeded on: optional, prefilled +14 days)*; backdating
  window and the cross-transaction rule *(open)*.
- **Inactive-project rule** — refuse outright, or warn and permit? *(Proceeded on: refuse outright.)*
- **Reminder cadence** — daily until actioned, weekly, or once per threshold? *(Proceeded on: once per
  threshold crossing.)*
- **Q10** — project master to sync from, or admin-maintained?
- **Q11** — report recipients and licences.
- **Q12** — French timing.
- **Q14 / Q15 / Q16** — synthetic data in Dev; fictional identities' domain; the one-modem catalogue
  extension *(Q15 and Q16 proceeded on their recommendation by WS-G; Q14 blocks 007 US5 only)*.
- **Q17** — per-app vs Premium licensing for code apps, roughly four times the dominant cost. Needs
  the reseller.
- **Q18** — how a permanent component (pre-amp, element, SIM) is despatched to calibration without its
  parent. Shapes 003 FR-032b, 004 FR-021 and 007 FR-019; recommendation recorded in `clarifications.md`.
- **Sign-offs**: `migration/reports/03_models_review.md` (35 corrected model rows) and
  `02_conflicts.md` (16 cross-office duplicate resolutions) before any production load — FR-026
  makes the second one a hard gate.
- **Q19** — do vehicles need odometer-at-checkout, safety-inspection due, insurance expiry? Nothing built
  depends on it; deliberately left out rather than guessed *(added 2026-09-03)*.
- **Q20** — reservation override rights, no-show grace period, and per-asset vs pooled bookings.
  (a) and (b) gate F6/F7's README; (c) changes `eng_reservation` if answered late *(added 2026-09-03)*.
