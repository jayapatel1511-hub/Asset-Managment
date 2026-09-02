# Implementation Plan: Deployment & Kits

**Branch**: `005-deployment-and-kits` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-deployment-and-kits/spec.md`

## Summary

Add site deployment to a system that already records custody. Checkout says an instrument left the
office with a person; deployment says it is bolted to a pier at POR-403, facing north, on solar
power, logging through a modem, for project 02208928 — and that it stayed that way from one date to
another.

The approach is to reuse everything: the transaction mechanism from feature 003 already carries
`Deploy` and `Undeploy` in the generated state machine, `deriveState` already handles them, and
`eng_assetrelationship` already models dated parent/child links with kit roles. What is genuinely
new is a **dated installation record** — the thing `Assets - Current Deployment` in the source
spreadsheet was reaching for with 16 columns and zero rows — plus the screens to create, recover
and read one, and the point-in-time reconstruction that makes acceptance question 7 answerable in
full.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18, Node 22.14 (portable — see `AGENT-BRIEF.md` §1)

**Primary Dependencies**: `@fluentui/react-components` v9, `react-router-dom`, `@microsoft/power-apps` (types only in this session)

**Storage**: `api/mock/` — `migration/staged/` JSON loaded via `public/data/`, mutations persisted to `localStorage`. Dataverse behind the same `AmsBackend` interface, unimplemented.

**Testing**: vitest + jsdom. 163 tests pass today; this feature must not reduce that number.

**Target Platform**: Power Apps Code App, phone-first at 390 px, scaling to desktop. Dark mode follows OS.

**Project Type**: Single Vite + React app with a swappable data layer.

**Performance Goals**: Deployment form usable on a phone with no signal; a seven-component station recorded in under 4 minutes (SC-001).

**Constraints**: No tenant. No Dataverse object may be created. `data/source/` is read-only. Site coordinates cannot use a real device GPS in a browser test — hand entry with optional capture.

**Scale/Scope**: 1,026 staged assets; installations expected in the low hundreds per year; 4 user stories, ~6 new screens, 1 new domain module.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature complies | Risk |
|---|---|---|
| **I — state is derived** | Deploy and Undeploy go through `submitDeployment` / `submitRecovery`, which create a transaction and let `deriveState` set status, location, custodian and project. No screen writes them. | The installation record itself *is* directly written — it is not derived state, it is transaction detail. Guarded by FR-011: composition is dated relationships created by the transaction, and the installation row is closed by a transaction, never edited to "not current". |
| **II — append-only history** | Recovery closes an installation with an end date; it never deletes or rewrites one. A component swap (US4) creates two transactions, not an edit. | US4's "change orientation" is tempting to implement as an update. It must be a dated configuration-change transaction (FR-025, FR-026). |
| **III — Asset ID is a tag** | Untouched. Deployment references assets by tag; it mints nothing. | None. |
| **IV — reference data is picked** | Location type, orientation, power source and kit role are all choice values. Site *position* is free text by explicit spec decision — `POR-403`, `Pier 3`, `M South West lobe` are real values with no curatable form. | Do not let free-text position leak into location *type*. |
| **V — refuse at both layers** | Screens disable invalid actions with a reason; `api/mock/deployment.ts` re-checks independently, including the already-deployed and not-held refusals (FR-007, FR-008). | Easy to implement the refusal only in the screen. Both are required. |
| **VI — maintainable by a successor** | Reuses the existing transaction mechanism rather than adding a parallel one. `domain/installation.ts` is pure and tested. Flow F1's README gains the Deploy/Undeploy mapping. | Adding a second write path for installations would be the failure mode. |
| **VII — no credentials** | The SIM is a permanent Component (Q7) and leaves the deployment form entirely, so ICCID never appears on it. | None. |

**Result: PASS.** One recorded exception: FR-006 site coordinates proceed on hand entry with
optional device capture, marked `// ASSUMPTION`, because a browser test has no reliable GPS and
much of this fleet deploys underground and indoors where capture fails anyway.

## Project Structure

### Documentation (this feature)

```text
specs/005-deployment-and-kits/
├── spec.md                              # written
├── plan.md                              # this file
├── data-model.md                        # entity shapes, to write in Phase 1
├── contracts/
│   └── ams-backend-deployment.md        # the AmsBackend additions
└── tasks.md                             # written
```

### Source Code (repository root)

New files this feature owns exclusively. Everything else it may read but must not edit — see
`AGENT-BRIEF.md` §5.

```text
app/src/
├── domain/
│   └── installation.ts          NEW  pure: composition-at-date, orphan detection, swap pairing
├── api/mock/
│   └── deployment.ts            NEW  the six new AmsBackend methods, owned by WS-A
└── features/
    ├── deploy/
    │   ├── DeployPage.tsx       NEW  US1 — the station form
    │   ├── ComponentPicker.tsx  NEW  role + orientation + power per component
    │   ├── SiteFields.tsx       NEW  type, name, position, coordinates
    │   └── DraftStore.ts        NEW  FR-028 partial-form survival
    ├── recover/
    │   └── RecoverPage.tsx      NEW  US2 — full and partial recovery
    └── site/
        ├── SiteListPage.tsx     NEW  US3 — sites with current installations
        ├── SiteDetailPage.tsx   NEW  US3 — installations, current and historical
        └── SwapDialog.tsx       NEW  US4 — in-service component swap

app/tests/
├── domain/installation.test.ts  NEW
└── features/deploy.test.ts      NEW  backend-level behaviour for A's methods
```

Touched in **Phase 0 by the orchestrator only**, then frozen for this feature:
`api/AmsBackend.ts`, `api/types.ts`, `api/mock/index.ts`, `i18n/en.json`, `App.tsx`.

**Structure Decision**: Single project, matching the existing app. This feature adds one domain
module, one mock module and two feature directories. It introduces no new layer, no new dependency
and no second write path — the point of the design is that deployment is a *kind of transaction*,
not a parallel subsystem.

## Phase 0 — research

Three things needed checking before design. All three are settled:

1. **Does the state machine already support Deploy and Undeploy?** Yes.
   `data/reference/state_machine.json` allows `Deploy` from `Available` and `CheckedOut` → `Deployed`,
   and `Undeploy` from `Deployed` → `CheckedOut`, plus `Return` from `Deployed` → `Available`. No
   change to the JSON is needed, which means no regeneration risk and no divergence from flow F1.
2. **Does `deriveState` handle them?** Yes — `deriveState.ts` covers both transaction types and
   emits the relationship operations that open and close kit links. `tests/domain/deriveState.test.ts`
   already exercises kit relationships. What is missing is the *installation* record, which is
   feature-005 data, not derivation.
3. **Is there deployment history to migrate?** No. `Location Type`, `Location` and `Deployment Date`
   are empty in 1,050 of 1,053 source rows. Site history begins at go-live. This is stated in the
   spec's assumptions and means no migration script changes.

**Consequence**: this feature is additive. It touches no existing domain logic, no migration script
and no generated file — which is why it is safe to run as a parallel workstream.

## Phase 1 — design

- `data-model.md` defines `Installation`, `InstallationComponent` and the `ConfigurationChange`
  transaction subtype, mapped onto `docs/01-data-model.md`'s `eng_*` tables plus the two new ones
  this feature requires.
- `contracts/ams-backend-deployment.md` fixes the six new `AmsBackend` signatures so Phase 0 can
  add them and WS-A can implement against them without further negotiation.
- Screens follow existing patterns: `CheckoutPage.tsx` is the closest model for the cart-and-submit
  flow, `AssetDetailPage.tsx` for the tabbed read view.

**Post-design constitution re-check: PASS.** The one thing worth restating — a configuration change
must produce a transaction, not an update. If a reviewer finds `installation.orientation = x`
anywhere outside the creating transaction, that is a Principle II violation.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two new tables (`eng_installation`, `eng_installationcomponent`) beyond `docs/01-data-model.md`'s nine | Acceptance question 7 asks what was installed where *on a past date*. A current-only deployment record cannot answer it, and the source spreadsheet's current-only design is exactly why no site history exists today. | Reusing `eng_transaction` alone was considered: site detail would live on the Deploy transaction and composition on the relationships. Rejected because "what was at this site in October" then requires reconstructing installations by scanning every transaction, and a partial recovery leaves no single row that says what remains on site. Per `CLAUDE.md`, adding a table needs Jay's agreement — **this is a request, not a decision.** |
