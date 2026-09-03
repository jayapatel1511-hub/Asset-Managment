# Implementation Plan: Release & Operations

**Branch**: `008-release-and-operations` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-release-and-operations/spec.md`;
`docs/10-integration.md` § Hosting (verified against Microsoft Learn 2026-08-19);
`docs/06-delivery-plan.md` Step 0

> Written 2026-09-02 after the spec review found `tasks.md` without a plan. US1 had already been
> built by then, so this plan records its approach retrospectively and gates US2–US5 prospectively.
> The Constitution Check below is the gate the constitution's workflow requires before tasks are
> executed; for US1 it is a check after the fact, and it passes with two carry-forwards.

## Summary

Make the dangerous release impossible, then make the routine release repeatable by someone who did
not build the system. US1 is tooling: a release build that refuses the local mock backend and an
unset backend, structurally excludes the staged fleet data, scans its own output for real values, and
reports what it did. US2–US5 are operator procedure — verify, roll back, promote, monitor — written
from the verified Microsoft documentation and marked unverified until someone with tenant access has
run them.

## Technical Context

**Language/Version**: Node 22.14 (portable — `AGENT-BRIEF.md` §1) for the build scripts; the
TypeScript 5.x / Vite app they wrap.

**Primary Dependencies**: none added. `release-guard.mjs` and `scan-bundle.mjs` use `node:`
built-ins only, so a dependency bump cannot break the safety path.

**Storage**: none. This feature writes no business data. Its record is `docs/11-runbook.md` (release
log, procedures) and `docs/08-decisions.md`.

**Testing**: vitest, running the scripts as subprocesses. The contract relied on is the non-zero
exit code that stops `npm run build:release` before `pa app push` can see the output; testing an
exported function would prove less.

**Target Platform**: Power Apps code-app hosting via `pa app push`. The command sequence has
changed once already (`pac code` → `pa app`); the runbook must carry its verification date and be
re-checked at each release.

**Project Type**: build tooling plus operator documentation.

**Performance Goals**: `build:release` no slower than `build` by more than the scan.

**Constraints**: no tenant for US2–US5 verification at the time of writing. `App.tsx` is a shared
file (T012's conditional import, T016's routing) and is coordinated, not edited unilaterally.

**Scale/Scope**: 5 user stories, 2 scripts, 1 test file, 1 Vite config change, 1 runbook.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature complies | Risk |
|---|---|---|
| **I — state is derived** | No writes to business data. Rolling back or republishing the app changes nothing in the store — which is what makes US3 cheap. | None. |
| **II — append-only history** | Nothing here touches a transaction line. | None. |
| **III — Asset ID is a tag** | Not applicable. | — |
| **IV — reference data is picked** | Not applicable. | — |
| **V — refuse at both layers** | The same philosophy applied to the build: a release that would leak is refused by tooling, not by convention or a checklist. | A script that bypasses `build:release` by calling `vite build` directly is the gap. The runbook must name `build:release` as the only publish path, and `build` must never grow a publish step. |
| **VI — maintainable by a successor** | US2–US5 exist for this principle; FR-020's empty-environment test is Principle VI's own stated test. | Procedures written without tenant access are unverified and must say so until run. |
| **VII — no credentials, minimum sensitive data** | **The live risk and the reason for US1.** The mock backend bundles ICCID, phone number and static IP from `public/data/`. FR-001–FR-005 make a release containing them impossible; FR-006 forbids secrets in the bundle. | T012 leaves the `MOCK-ONLY` stand-ins in the bundle. They carry no fleet data, so this is hygiene rather than disclosure, but FR-004 is not met until `App.tsx` is coordinated. |

**Result: PASS**, with two carry-forwards: FR-004 (T012) deferred on a shared-file dependency, and
US2–US5 unverifiable without a tenant. Neither weakens US1's guarantee.

## Project Structure

### Documentation (this feature)

```text
specs/008-release-and-operations/
├── spec.md       # written; FR-001 reworded 2026-09-02
├── plan.md       # this file
└── tasks.md      # written; US1 ticked by its author, T012 deferred, T032 blocked

docs/11-runbook.md    NEW (US2–US5) — not yet written
```

### Source Code (repository root)

```text
app/
├── scripts/
│   ├── release-guard.mjs        BUILT   FR-001: refuses unset or mock backend, names the variable and value
│   ├── scan-bundle.mjs          BUILT   FR-003: scans dist/ for staged Asset IDs, ICCIDs, phones, IPs; never prints a match
│   └── synthetic/**             WS-G's — excluded from this feature's ownership
├── vite.config.ts               CHANGED publicDir false when mode === "release" (FR-002, structural)
├── package.json                 CHANGED build:release = guard → generate → tsc → vite build --mode release → scan
└── tests/build/
    └── releaseGuard.test.ts     BUILT   runs both scripts as subprocesses against fixtures
```

**Structure Decision**: scripts live under `app/scripts/` beside the existing generators, because
the release path is an `npm` script and operators will look for it in `package.json`. The
`synthetic/` subdirectory belongs to WS-G; this feature's ownership of `app/scripts/**` excludes it
(`AGENT-BRIEF.md` §5).

## Phase 0 — research

1. **Where does the leak come from?** `scripts/copy-staged-data.mjs` copies `migration/staged/*.json`
   into `app/public/data/` for the mock backend, and Vite copies `public/` into every bundle. So the
   exclusion is a `publicDir` decision, not a cleanup step — and a machine that never ran the copy
   builds identically (spec edge case).
2. **What decides the backend?** `VITE_AMS_BACKEND`, read in `api/index.ts`. An unset value falls
   back to the mock, so the guard must refuse unset as well as `mock`.
3. **What does "no real value in the bundle" mean operationally?** Every non-empty ICCID, phone and IP
   in the staged data plus every Asset ID, searched for in the built output, with the kind and file
   reported on a hit and the value never printed — the log must not become the leak.
4. **Routing under `/play/e/{env}/a/{app}`.** `BrowserRouter` with absolute paths will not survive a
   deep-link reload under a hosted sub-path. Unverifiable without `pa app run`; deferred to T016 and
   recorded as a first-publish risk.

**Consequence**: US1 is additive and touches no shared file. US2–US5 are documentation.

## Phase 1 — design

- **Guard first, compile second, scan last.** The guard runs before `tsc` so a refused build costs
  seconds, and the scan runs on the artefact that would actually be pushed.
- **Mode-conditional `publicDir`** rather than a delete step, so exclusion cannot be forgotten and
  `npm run dev` / `npm run build` keep the data they need.
- **Scan fails closed** on any hit, exits non-zero, and reports kind and file only.
- **Runbook sections mirror the user stories one to one** — Publish, Verify, Roll back, Promote,
  Monitor — so an operator finds "roll back" without reading the spec. Each section states its
  verification date and whether it has been run against a tenant.

**Post-design constitution re-check: PASS**, same two carry-forwards.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| FR-004 not yet met — the `MOCK-ONLY` stand-ins (`RoleSwitcher.tsx`, `ScanDialog.tsx`) remain in the release bundle (T012 deferred) | Removing them cleanly needs a conditional import in `App.tsx`, a shared file this workstream does not own | A runtime `if` was rejected by the spec itself ("absent, not hidden"). A build-time flag that tree-shakes them is the fix; it waits for the next shared-file window and is hygiene, not disclosure — the stand-ins carry no fleet data |
