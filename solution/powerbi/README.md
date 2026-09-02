# EnglobeAMS Power BI project (feature 006, WS-B)

## What this is, and what it is not

**This is the licence-free deliverable feature 006's User Story 1 actually requires (FR-001,
FR-004, SC-004).** The four in-app screens at `app/src/features/reports/` are the interim for
people who already have an app licence — they exist because the point-in-time derivation
(`app/src/domain/pointInTime.ts`) and the aggregate queries (`app/src/api/mock/reporting.ts`) had
to be built and proven correct before this file could be written honestly, and because building
them validated the exact numbers this model's measures reproduce. **Do not read the in-app Reports
tab as closing User Story 1.** A manager without a Power Apps licence cannot open it. This project,
published to the Power BI service, is what they open instead.

This is a **PBIP** (Power BI Project) — every file here is text (JSON + TMDL), not a `.pbix`
binary, specifically so it is reviewable in a diff and a successor can read the whole semantic
model without opening Power BI Desktop (Constitution Principle VI). See plan.md's Structure
Decision for why this format was chosen over `.pbix`.

**Nothing in this project has been opened in Power BI Desktop, connected to a Dataverse
environment, or published this session — there was no tenant (`specs/AGENT-BRIEF.md` §1, `pac
auth` never run).** Every claim below about what a measure computes has been verified logically
against `docs/01-data-model.md` and cross-checked against the SAME rules
`app/src/api/mock/reporting.ts` and `app/src/domain/utilisation.ts` implement (which ARE tested,
against 1,026 real migrated assets — see `docs/09-build-report.md`). Nothing about DirectQuery
actually connecting, row-level security, object-level (field) security, or the TMDL files loading
without a Desktop-side adjustment has been verified. Treat this as a precise, reviewable
specification for the model a report author builds from — not as a tested artifact.

## Structure

```
EnglobeAMS.pbip                        top-level pointer (JSON) — double-click this in Desktop
EnglobeAMS.Report/                     thin report shell — three pages, no visuals authored yet
  definition.pbir                        points at ../EnglobeAMS.SemanticModel
  definition/report.json                 report-level settings (theme, empty visual list)
  definition/pages/                      Fleet, Compliance, Utilisation page shells (see below)
EnglobeAMS.SemanticModel/               the actual deliverable — read this, not the report
  definition/database.tmdl, model.tmdl    top-level model settings
  definition/expressions.tmdl             the ONE parameter every table's DirectQuery binds through
  definition/relationships.tmdl           every relationship, with role-playing notes
  definition/tables/*.tmdl                one file per table — Asset, EquipmentModel, Location,
                                           Project, Transaction, TransactionLine,
                                           AssetRelationship, CalibrationRecord, DimDate, _Measures
  definition/cultures/en-US.tmdl
```

## How to open it

1. Install Power BI Desktop (current version — TMDL is the default `.pbip` save format as of late
   2024; an older Desktop may prompt to convert).
2. File > Open > browse to `EnglobeAMS.pbip` (the file, not a folder) and open it directly. Desktop
   reads the sibling `EnglobeAMS.Report/` and `EnglobeAMS.SemanticModel/` folders automatically.
3. Desktop will very likely want to **resave** the project on first open (regenerating exact
   `lineageTag` GUIDs and normalizing whitespace/property order this hand-authored text does not
   attempt to match byte-for-byte). That is expected and safe — resave once you have confirmed the
   nine tables, the relationships, and the measures below all came through; commit the resaved
   version.

## Binding to `Englobe-AMS-Dev`

Every table's partition is `mode: directQuery` against `CommonDataService.Database(EnvironmentUrl)`
— one M query per table, navigating to one Dataverse table (`eng_asset`, `eng_location`, …) and
renaming/expanding lookup columns to the plain names `app/src/api/types.ts` and
`migration/staged/*.json` already use, so a reviewer comparing this model to the app's own types
is comparing like for like.

`EnvironmentUrl` (`definition/expressions.tmdl`) is the single binding point. In Desktop:
**Transform data > Manage Parameters > EnvironmentUrl**, set it to
`https://englobe-ams-dev.crm3.dynamics.com` (already the placeholder value) or
`https://englobe-ams-prod.crm3.dynamics.com` for Prod — never hand-edit the eight table queries
individually. Desktop will prompt for a Dataverse connection and the signed-in account's own
permissions (Read on every table per `docs/05-security.md`) govern what comes back — there is no
separate service-account credential embedded anywhere in this project (Constitution Principle VII:
no credentials in Dataverse, and none here either).

`DimDate` is the one **Import**-mode (calculated) table in an otherwise DirectQuery model — a
deliberate composite model, the standard way to add a real date dimension to a DirectQuery source
that has none of its own. After first open: **Modeling > Mark as Date Table > `Date`** on `DimDate`
— a five-second Desktop action not attempted as hand-written TMDL/XMLA here (see that table's own
comment).

## Publishing

`pac auth create` / a Power BI workspace bound to the `Englobe-AMS-Dev` (then `-Prod`) environment
is Step 0/6 of `docs/06-delivery-plan.md`, not part of this session. Once available: **Publish**
from Desktop to the workspace, then **File > Options and settings > Data source settings** (or the
service's dataset settings) to bind the `EnvironmentUrl` parameter per environment, exactly as
above. FR-004's distribution question (**Q11**, still open in `specs/clarifications.md`) determines
who gets workspace access from there — this project does not presuppose an answer to Q11, it is
usable under any of them.

## Which measure answers which acceptance question

All measures live in `_Measures.tmdl` (a disconnected, hidden-partition measures table — standard
Tabular practice, so a report author finds every measure in one place instead of hunting across
fact tables).

| Acceptance question / FR | Measure(s) |
|---|---|
| Q1 — what do we own, by office/group/type (FR-005) | `Total Assets`, sliced by `Location[LocationName]` (via the active HomeOffice relationship), `EquipmentModel[AssetGroup]`, `EquipmentModel[EquipmentType]` |
| Q1's honesty caveats (FR-010, FR-011, FR-012) | `Unknown Custodian`, `Temporary Tags`, `Third-Party Owned` — each a count **within** `Total Assets`, never subtracted from it (see `Asset.tmdl`'s column comments for why marking, not excluding, is what keeps this reconciled with `Total Assets`) |
| Q3 — one asset's status/location/custodian/project (FR-006) | A table visual on `Asset` filtered to one `AssetId`; no measure needed, these are plain columns |
| Q4 — what's available, by office/type (FR-007) | `Available Assets`, same slicers as Q1 |
| Q2/Q5 — assets on a project, calibration status (FR-008, FR-014) | `Total Assets` filtered by `Asset[CurrentProject]`, joined to `CalibrationRecord` for status detail |
| Q5 — calibration compliance pack (FR-013, FR-015, FR-016, FR-017) | `Calibration Overdue`, `Calibration Due Soon (30d)`, `Calibration In Progress`, `Calibration Unknown`, `Days Overdue` (row-context, for a table visual); `CalibrationRecord[CertificateUrl]` set to a Web URL data category for a clickable link (FR-016) |
| Q6 — utilisation, idle stock, lowest availability (FR-023–FR-026) | `Idle Assets (90d)`; a proportion visual (100% stacked bar) grouping `TransactionLine`/`Asset` status spans by `EquipmentModel[EquipmentType]` and `Location[LocationName]` — this needs the same status-span logic `app/src/domain/utilisation.ts`'s `statusSpans` computes, which is genuinely easier to express as a DAX time-intelligence pattern over `DimDate` than to fully specify here without a live model to test it against; a report author should treat `statusSpans`/`categorize` as the reference implementation when building this visual |
| Q7 — an asset's timeline (FR-018–FR-022) | No measure — a table visual on `TransactionLine` joined to `Transaction` and (for attach/detach naming) `AssetRelationship`, filtered to one `AssetId`, sorted by `Transaction[TransactionDate]`. `app/src/domain/pointInTime.ts`'s `buildTimeline` is the reference implementation for exactly which rows to join and how to label attach/detach events |
| FR-002/SC-008 — data currency stated everywhere | `Data As Of` — put this measure in a text box or card on every page |
| FR-027/FR-028 — migration-boundary honesty guard | `Has Sufficient History (90d)` — see the measure's own comment for why this is the one guarantee this file format cannot enforce structurally the way `domain/utilisation.ts`'s return-type trick does in the app: **every visual built against a period measure must be wired to check this first**, by hand, because DAX has no equivalent of a TypeScript discriminated-union return type forcing the check. Flag this explicitly in any report-authoring review. |

## What is verified, and what is not

**Verified this session** (against real logic, not this file directly, since there is nothing to
run it against): the schema mirrors `docs/01-data-model.md` including the
`eng_equipmentmodel` alternate-key correction from `docs/08-decisions.md`
(`manufacturer+model+equipmenttype`, not `manufacturer+model` alone); every measure's business rule
(what counts as "available", "third-party owned", "temporary tag", "calibration tracked", etc.) is
written to agree with `app/src/api/mock/reporting.ts` and `app/src/domain/utilisation.ts`, which
**are** tested against 1,026 real migrated assets (`app/tests/api/reporting.test.ts`,
`app/tests/domain/utilisation.test.ts` — see `docs/09-build-report.md` for exact counts, e.g. 107
overdue at a 30-day horizon, 592 unknown-custodian, 2 third-party-owned, 35 temporary tags).

**Not verified, and must not be reported as verified** (plan.md's own Constitution Check carries
this forward explicitly):

- That `CommonDataService.Database(EnvironmentUrl)` actually connects and every `eng_*` table name,
  lookup column name, and expansion in each table's M query is byte-correct against the real
  Dataverse schema once it exists — table/column *names* here are taken directly from
  `docs/01-data-model.md`, but Dataverse's actual generated internal names for some lookup-column
  navigation properties can differ in ways only a live connection surfaces.
- **Row-level security / object-level (field) security** (FR-003/SC-005). `IdentifierValue`,
  `PhoneNumber`, and `StaticIp` are marked `isHidden` in `Asset.tmdl` as the simplest available
  mitigation, but a hidden column is not a security boundary — anyone with model-edit rights (or
  Analyze in Excel) can unhide it. Real enforcement needs **Object-Level Security** bound to the
  same Entra security groups as Dataverse's `AMS Sensitive` field security profile
  (`docs/05-security.md`), which is a Premium/PPU capability requiring the tenant to configure.
  This is this feature's FR-003/SC-005 exactly, and it is exactly as unverified here as it is in
  the in-app surface (`app/src/api/mock/reporting.ts`'s own header comment) — do not let this
  artifact's existence read as "field security is handled" when it is designed for, not tested.
- Whether the hand-authored TMDL loads into Desktop without any adjustment at all, versus needing
  the one-time resave this README already tells you to expect.
- The report pages are empty shells (page name/size only, no visuals) — building the actual
  Fleet/Compliance/Utilisation visuals against the measures above is real remaining work for
  whoever has Desktop and the Dev connection; this session could author the model as text but
  could not authored-and-verify visuals with no engine to render them against.
