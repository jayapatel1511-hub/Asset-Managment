# Remaining work — parallel workstream map

**As of 2026-09-02**, after the build recorded in `docs/09-build-report.md`.

Read `specs/AGENT-BRIEF.md` first — especially §1 (environment) and §5 (why Phase 0 is serial).

This document exists to answer one question: *what can be built right now, by how many agents at
once, without a Microsoft tenant?* Everything below is buildable and verifiable locally against
the real migrated data unless the row says otherwise.

---

## The gate: Phase 0 is serial and comes first

Four files are shared by every workstream (`api/AmsBackend.ts`, `api/types.ts`, `i18n/en.json`,
`App.tsx`). Agents editing them concurrently will clobber each other no matter how good the specs
are. So:

**Phase 0 — orchestrator alone, no subagents.**

1. Add every new method signature to `AmsBackend.ts` for workstreams A, B, C and D, bodies
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

### WS-A — Feature 005, Deployment & Kits *(largest remaining piece)*

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

### WS-B — Feature 006, Fleet Reporting *(partially tenant-bound)*

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

### WS-C — Feature 003 US5, offline queueing

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

### WS-D — Feature 004 US4, office→administrator assignment

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
`docs/08-decisions.md`; `docs/01-data-model.md` itself still needs correcting to match.

---

## Sequencing

```
Phase 0  (orchestrator, serial, ~1h)
   │
   ├── WS-A  005 Deployment & Kits      ← largest, start first
   ├── WS-B  006 Reporting domain + PBIP
   ├── WS-C  003 US5 offline queue
   ├── WS-D  004 US4 admin assignment
   ├── WS-E  api/dataverse (compile-only)
   └── WS-F  schema + solution files
   │
Integration (orchestrator, serial)
   npx tsc -b && npm run test && npm run build
   Drive the app at 390px against real data; verify acceptance questions 1–7
   Update docs/09-build-report.md
```

WS-A and WS-B are the two with real user-visible value. If capacity is limited, run those two and
skip the rest.

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
  excluded with the 13 Azure rows?
- **Q8 / Q9** — expected-return requirement; backdating window and the cross-transaction rule.
- **Inactive-project rule** — refuse outright, or warn and permit?
- **Reminder cadence** — daily until actioned, weekly, or once per threshold?
- **Q10** — project master to sync from, or admin-maintained?
- **Q11** — report recipients and licences.
- **Q12** — French timing.
- **Sign-offs**: `migration/reports/03_models_review.md` (35 corrected model rows) and
  `02_conflicts.md` (16 cross-office duplicate resolutions) before any production load — FR-026
  makes the second one a hard gate.
