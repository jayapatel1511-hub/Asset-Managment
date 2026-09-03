# Remaining work — parallel workstream map

**As of 2026-09-02**, after the build recorded in `docs/09-build-report.md`. **Refreshed the same
evening after the spec review**: WS-A to WS-D are complete; WS-G and WS-H were in progress in
concurrent sessions at the time of writing — check `git status` and `ListAgents` before starting
either.

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
6. Verify `npx tsc -b` compiles and `npm run test` still passes (**281 as of 2026-09-02**).

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

> Delivered — domain modules, in-app surface, PBIP text model. **One recorded defect** against the
> spec as clarified 2026-09-02: the utilisation guard treats an asset's first transaction as the
> migration boundary, so any asset acquired inside the period reads as insufficient history. See
> 006 FR-028 and `docs/08-decisions.md`. Text below kept for reference.

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

Author the 9 tables, choice sets, alternate keys, relationships, indexes, the three security roles
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

**One shared-file dependency, orchestrator work**: the spec's FR-060 needs the mock store to serve
the base dataset from static files and persist only the user's own writes. `api/mock/store.ts` today
writes the whole snapshot to `localStorage` (about 5 MB ceiling) on every write and silently
continues in memory when that throws; a `standard`-profile dataset is roughly 60 MB. That file is
frozen for workstreams, so this lands as a Phase 0-style change before WS-G fans out.

### WS-H — Feature 008, Release & Operations *(US1 BUILT 2026-09-02 in a concurrent session; US2–US5 tenant-bound)*

**Spec**: [`specs/008-release-and-operations/spec.md`](008-release-and-operations/spec.md) — 33 FRs,
5 stories. **Plan**: [`plan.md`](008-release-and-operations/plan.md) (added 2026-09-02). **Tasks**:
[`tasks.md`](008-release-and-operations/tasks.md).

**US1 is built**: `release-guard.mjs`, `scan-bundle.mjs`, a mode-conditional `publicDir` and a
separate `build:release`, verified by its author against the staged data (13 files refused with the
mock backend; the release bundle scanned clean against every staged Asset ID, ICCID, phone and IP).
Two loose ends in its `tasks.md`: T012 (removing the `MOCK-ONLY` stand-ins from the bundle) is
deferred because it needs `App.tsx`; T032 (final `tsc -b`) is blocked on two unused-local errors in
WS-G's in-progress `sim.ts`. Before this existed, nothing prevented a `pa app push` from publishing
1,026 real assets — including SIM ICCIDs, phone numbers and static IPs — to a publicly accessible
endpoint with no IP restriction and no recall (`docs/10-integration.md` § Hosting).

US2–US5 are operator documentation (`docs/11-runbook.md`, not yet written) that can only be
*verified* with tenant access; `plan.md` now gates them.

Owns `app/scripts/**` except `app/scripts/synthetic/**` (WS-G), `app/vite.config.ts`,
`app/package.json` scripts, `tests/build/**`, `docs/11-runbook.md`. Two coordination points touch
`App.tsx`: T012's conditional import and T016's routing fix.

**Note the interaction with WS-G**: synthetic data must never reach a release bundle either. WS-H's
bundle scanner should cover `data/synthetic/**` outputs as well as `migration/staged/`.

---

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
   ├── WS-G  007 synthetic fleet history          IN PROGRESS — store.ts persistence change still pending; no plan.md
   └── WS-H  008 release safety                   US1 DONE; T012/T016 need App.tsx; US2–US5 need the tenant
   │
Integration (orchestrator, serial)
   npx tsc -b && npm run test && npm run build && npm run build:release
   Drive the app at 390px against real data; verify acceptance questions 1–7
   Update docs/09-build-report.md — the WS-G and WS-H sections are not there yet
```

WS-A to WS-D are complete and WS-H US1 is built; `docs/09-build-report.md` § "Phase 0–2 —
multi-agent extension" records the first four. It does **not** yet record WS-G or WS-H — the sessions
doing that work must add their sections when they finish (`AGENT-BRIEF.md` §8), and the test
baseline moves from 281 to whatever they add (WS-H reports 291).

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
