# Implementation Plan: Fleet Reporting

> **PRE-PIVOT EXECUTION RECORD — NOT CURRENT IMPLEMENTATION GUIDANCE.** The feature spec plus
> `docs/23-canonical-product-ux-contract.md` and `docs/25-need-to-know-access-ux.md` govern now.
> In-app Reports is primary; Power BI is optional. ReportReader-only users receive no Field/Work
> shell, and general Reports receive no maintenance evidence, certificate links, free text, performer
> identity, costs, secured attributes or Administration detail.

**Branch**: `006-fleet-reporting` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-fleet-reporting/spec.md`

## Summary

Answer the seven acceptance questions for people who do not have an app licence — and answer
question 7, the historical one, which nobody can currently answer in aggregate.

The important scoping call: **Power BI needs the tenant, but two thirds of this feature does not.**
The hard part of question 7 is not the report, it is reconstructing an asset's state at an
arbitrary past timestamp by replaying its transaction lines. That is pure domain logic, it is
testable today against 1,026 real assets and their history, and once it exists the Power BI page
is a thin presentation over it. So this plan builds the derivation first, an in-app reports
surface second, and the Power BI semantic model as authored text files third — deferring only the
publish.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18, Node 22.14 (portable — `AGENT-BRIEF.md` §1)

**Primary Dependencies**: `@fluentui/react-components` v9. No charting library is added — see Structure Decision.

**Storage**: Read-only over `api/mock/` (and later `api/dataverse/`). This feature stores nothing; FR-030 forbids a separate reporting copy that could disagree with the operational data.

**Testing**: vitest. Domain reconstruction is the bulk of the test surface and is deterministic against the staged data.

**Target Platform**: Power BI (DirectQuery to Dataverse) for the licence-free audience; the in-app surface is the interim and the fallback.

**Project Type**: Single app plus a PBIP (Power BI project) folder of text files.

**Performance Goals**: FR/SC-010 — under 10 seconds at 5,000 assets and 100,000 transaction lines. Point-in-time replay must therefore be linear in an asset's own lines, not in the whole table.

**Constraints**: No tenant, so nothing is published and DirectQuery cannot be tested. Field security (FR-003) cannot be verified without real roles — it must be designed in and reviewed, not claimed as tested.

**Scale/Scope**: 1,026 assets, 1,026 migration lines plus pilot transactions today; 4 user stories; 2 new domain modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature complies | Risk |
|---|---|---|
| **I — state is derived** | This feature only reads. It adds no write path at all. | None. |
| **II — append-only history** | Point-in-time reconstruction is only *possible* because history is complete and immutable; this feature is the payoff for Principle II, not a threat to it. | If reconstruction disagrees with the derived columns, the bug is real and must be investigated, not papered over with a reconciliation step. |
| **III — Asset ID is a tag** | Reports key on the GUID and display the tag. | Do not join reporting rows on serial — 132 serials are shared. |
| **IV — reference data is picked** | Groupings use the curated lookups, so office and equipment-type breakdowns are meaningful. | None. |
| **V — refuse at both layers** | No writes, so no transitions to refuse. | None. |
| **VI — maintainable by a successor** | No separate reporting store to keep in sync (FR-030). The semantic model ships as text in the repo, not as a binary someone has to open. | A `.pbix` binary would violate this in spirit — hence PBIP. |
| **VII — no credentials, minimum sensitive data** | **This is the live risk.** A report is the most likely route around the app's field security: FR-003 requires the same restriction on ICCID, phone number and static IP. | Must be designed in and reviewed. It cannot be verified this session, and must not be reported as verified. |

**Result: PASS**, with one explicit carry-forward: FR-003 and SC-005 (field security in reporting)
are **unverifiable without a tenant**. They are designed for and must be tested the day roles
exist. Record this in the build report rather than checking it off.

## Project Structure

### Documentation (this feature)

```text
specs/006-fleet-reporting/
├── spec.md       # written
├── plan.md       # this file
└── tasks.md      # written
```

No `contracts/` directory: the additions to `AmsBackend` are few and are specified inline in
`tasks.md` T003–T004, because unlike feature 005 there is no second implementer to negotiate with —
reporting reads through methods that already exist plus two aggregate queries.

### Source Code (repository root)

```text
app/src/
├── domain/
│   ├── pointInTime.ts        NEW  replay lines → state at a timestamp (acceptance question 7)
│   └── utilisation.ts        NEW  status spans, idle detection, the migration-boundary guard
├── api/mock/
│   └── reporting.ts          NEW  aggregate queries, owned by WS-B
└── features/reports/
    ├── ReportsHomePage.tsx   NEW  US1 — fleet, availability, by-project
    ├── CompliancePage.tsx    NEW  US2 — calibration status, exportable
    ├── TimelinePage.tsx      NEW  US3 — one asset's full history, exportable
    └── UtilisationPage.tsx   NEW  US4 — with the insufficient-history guard

app/tests/domain/
├── pointInTime.test.ts       NEW
└── utilisation.test.ts       NEW

solution/powerbi/EnglobeAMS.pbip/   NEW  TMDL semantic model + report definition, text only
└── README.md                       NEW  how to open, bind to Dev, and publish
```

**Structure Decision**: Single project, matching the existing app. Two deliberate choices:

- **No charting library.** The four views are counts, groupings, a timeline and a proportion table.
  Fluent UI primitives cover all of it, and adding a chart dependency to a 690 KB bundle for a
  surface that Power BI will eventually own is a cost with no return. If a chart is genuinely
  needed later, that is a decision to record.
- **PBIP, not PBIX.** Power BI project format is TMDL and JSON text, so the semantic model is
  reviewable in a diff and authorable without opening Power BI Desktop. A binary `.pbix` cannot be
  authored in this session at all and cannot be reviewed by a successor.

## Phase 0 — research

1. **Can point-in-time state be reconstructed from what exists?** Yes. `HistoryEntry` joins each
   line to its header and carries `statusbefore`, `statusafter`, `transactiondate`, and the
   from/to values for location, custodian and project. Replaying an asset's lines in date order
   reproduces every derived field. `getAssetHistory(assetId)` already returns exactly this.
2. **Is there enough history for utilisation?** No — and that is the finding. Every asset has one
   `AddToInventory` line dated the migration date, plus pilot transactions. Utilisation over a
   period that begins before go-live would read as universal idleness. FR-027 and FR-028 exist
   because of this, and the honesty guard is the feature, not a caveat on it.
3. **Does anything need a new backend read?** Two aggregates: fleet counts grouped by
   office/group/type, and calibration-status counts by office. Everything else composes from the
   existing `listAssets`, `getAssetHistory` and `getCalibrationHistory`.

**Consequence**: additive, no change to existing domain logic or migration scripts — safe as a
parallel workstream.

## Phase 1 — design

- `pointInTime.ts` exposes `stateAsOf(history, asOf)` returning the same shape as `AssetSnapshot`
  from `deriveState.ts`, so the two are directly comparable. That comparability is what makes
  SC-003 and the spec's own "reconstruction agrees with the derived values" claim testable rather
  than aspirational.
- `utilisation.ts` exposes `statusSpans(history, from, to)` and
  `hasSufficientHistory(history, from)`, the second returning false when `from` precedes the
  asset's first line — FR-028's guard, enforced in the domain rather than remembered in the UI.
- The in-app surface is read-only and admin-visible; it is the interim for people who *do* have
  app access, not a replacement for the licence-free requirement, which only Power BI satisfies.

**Post-design constitution re-check: PASS**, with FR-003/SC-005 carried forward as unverifiable
this session.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| An in-app reports surface, when the spec's US1 explicitly requires access *without* an app licence | Power BI cannot be built or published without the tenant. The in-app surface delivers the same figures to admins now, and validates the aggregate queries the Power BI model will use. | Waiting for the tenant was considered. Rejected because it leaves the point-in-time derivation untested until the day it matters, and because the aggregates are the part most likely to be wrong. The in-app surface is explicitly **not** the deliverable for US1 — Power BI is — and the build report must say so rather than implying the story is done. |
