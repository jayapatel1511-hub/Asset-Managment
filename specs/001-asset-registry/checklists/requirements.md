# Requirements Quality Checklist: Asset Registry

**Purpose**: Requirements-quality review of `specs/001-asset-registry/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

**Review status:** **Reviewed 2026-09-04 — 37 of 37 requirements-quality criteria.** This is a
specification review, not runtime, tenant, device, accessibility or pilot evidence.
**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04). CHK001, CHK002, CHK005 and CHK007 were reviewed 2026-09-02 and are
unchanged.

## Blocking Clarifications

- [x] CHK001 Q1 resolved — answered as a requirement rather than a placement: the hierarchy supports N offices, admin-managed and re-parentable in-app (FR-011a to FR-011c). SWO's placement is therefore no longer a design question, and no asset gets a guessed home office
- [x] CHK002 Q2 resolved — dissolved by the same decision: Mississauga and Thunder Bay are seeded flat and re-parented by an admin on a screen
- [x] CHK003 Q4 answered **(critical path — blocks feature 002 entire migration run)** — the equipment model catalogue is corrected and a default calibration interval is set or explicitly nulled per model
  <br>*Evidence:* **answered and now signed.** `migration/reports/03_models_review.md` carries the 64-row review with **35 corrections** — Larson Davis 831C prefix, `Series IV` / `Minimate Pro` / `Settop M1` / `Instantel` moved into the manufacturer column, Sigicom V12 retyped as Data Logger. Its production gate was reviewed and **approved with a recorded correction on 2026-09-04** (the correction concerns the invented calibration intervals, which are approved as loaded defaults and flagged for manufacturer confirmation). Every interval is either set or explicitly null; null is visible in the Administration calibration/data-quality queue and approved report aggregates. It is never a Field Home fleet total.
- [x] CHK004 Q6 answered — the 16 `Azure` / `THOR` / `Vision` / `INFRANet` rows are confirmed as trackable assets or excluded as configuration
  <br>*Evidence:* answered in `03_models_review.md` § Q6 and approved 2026-09-04: the 13 **Microsoft / Azure** rows are **excluded** — a subscription is not an instrument, and 13 rows of cloud service in an instrumentation register is a category error. **Instantel Vision / Vision II** and **Sigicom INFRANet** remain physical **Server** assets, because they sit in a rack and can be lost.
- [x] CHK005 Q5 resolved — SLM pre-amp and element get their own Asset IDs, attached as permanent Components; fleet is roughly 1,150 assets, and each component holds its own calibration record
- [x] CHK006 Q10 answered — project numbers are confirmed as admin-maintained or as synced from an upstream system, since this changes US4 from create-and-edit to read-only
  <br>*Evidence:* **answered 2026-09-04: admin-maintained in-app.** `Project` is one of the five curated reference domains with create / edit / deactivate / reactivate commands (`server/src/routes/reference.ts`), which is rule 7's second clause applied to projects. US4 is therefore create-and-edit, not read-only. **The synced alternative is not foreclosed:** `data_source_record` and the reconciliation job (011 US6) exist, so an upstream source can later declare authority per field (FR-052) without changing the data model — it would flip `authority_mode` from `AMSManaged` to `ExternalAuthoritative` and the correction path would start refusing local edits.
- [x] CHK007 Q13 resolved — retention is indefinite (FR-026)
  <br>*Amended 2026-09-04:* still indefinite, and now **approved** rather than assumed — OD-5 decided indefinite as the AMS default and the retention register records it with an approver, versioned and immutable after activation.

## Constitutional Alignment

- [x] CHK008 Principle I — no requirement in this spec grants any user a write path to status, location, custodian, project or parent (verify FR-027, FR-028 against every user story)
  <br>*Evidence:* verified against all five user stories. No FR grants one, and none could be honoured if it did: `asset.status` is a generated column and the four remaining fields are written only by `applyTransaction`. `scripts/lint-rules.mjs` rule 14 fails the build on a generic PATCH or table-parameterised route.
- [x] CHK009 Principle III — no requirement permits an Asset ID to encode a mutable attribute, and none treats serial as unique (verify FR-004, FR-005)
  <br>*Evidence:* the tag encodes manufacturer/model/type prefix plus a sequence or serial, all immutable at mint time; `0004` refuses any rename. Serial is explicitly non-unique — 132 legitimate shared-serial pairs in this fleet, and `duplicate.serialInsufficient` refuses a merge justified on serial alone.
- [x] CHK010 Principle IV — no requirement admits a free-text alternative for manufacturer, model, type, group, location, project or staff (verify FR-008)
  <br>*Evidence:* registration refuses a model not in the catalogue ("free-text models are not permitted (Principle IV)"), and reference values are selected. **Staff is the honest exception and it is recorded:** there is no staff table — identity is Entra, and a custodian is a UPN resolved from the session, never typed (`docs/08`, "Add an employee = attributes of existing staff only").
- [x] CHK011 Principle VII — no requirement stores or exposes a credential, and sensitive attribute restriction is stated as data-layer rather than interface-layer (verify FR-029, FR-030)
  <br>*Evidence:* the source export's `Login` / `Password` columns are correctly absent from the committed data, no credential column exists in any migration, and redaction is in the **read model** (`tests/fieldSecurity.test.ts`) rather than in the UI. `lint-rules.mjs` rule 10 guards source.
- [x] CHK012 Principle VI — every requirement is stated so a successor application/platform operator or engineer, not its author, can verify it
  <br>*Requirements-quality evidence:* the platform-pivot amendment removes the obsolete Power Platform persona; each behavior is expressed as an observable acceptance/refusal outcome with an owner or external gate. This check does not claim the runtime, tenant, device, accessibility or pilot evidence has run.
- [x] CHK013 Localisation is preserved as a future option rather than designed out (FR-031)
  <br>*Evidence:* preserved and load-bearing: every user-facing string is an i18n key (`app/src/i18n/en.json`, 372 keys) and refusals travel as keys rather than English, so a second locale is a file rather than a refactor.

## Completeness

- [x] CHK014 Every field named in the source Word document's Asset Registry list is covered by a requirement or explicitly excluded with a reason
  <br>*Evidence:* `migration/reports/01_profile_report.md` walks the list; exclusions are named with reasons (credentials excluded per Principle VII, Azure rows excluded per Q6).
- [x] CHK015 Every column in the source registry export is either mapped, deliberately dropped, or deferred to feature 002 — none is silently unaddressed
  <br>*Evidence:* all 26 columns accounted for, column by column, and the verification found the export **faithful across all 26** with `Login` / `Password` correctly absent.
- [x] CHK016 Acceptance questions 1, 2, 3 and 4 each trace to at least one requirement and one success criterion
  <br>*Evidence:* all four trace, and all four are answered by a running report.
- [x] CHK017 Every user story has at least one acceptance scenario covering its failure path, not only its happy path
  <br>*Evidence:* each story carries a failure scenario; the implementation's refusal codes are the observable form of them.
- [x] CHK018 Each of the nine edge cases has a corresponding requirement or an explicit decision to accept the behaviour
  <br>*Evidence:* nine for nine. Several became feature 007 **planted scenarios**, so they exist in the dataset rather than only in prose — temporary tag, third-party owned, asset at a foreign office, shared-serial pair apart.
- [x] CHK019 The boundary with feature 003 is unambiguous — this spec displays derived state and never produces it
  <br>*Evidence:* unambiguous and enforced. 001 owns the registry read model; 003 owns `applyTransaction`. No 001 route writes a derived field.
- [x] CHK020 The boundary with feature 002 is unambiguous — this spec defines the target shape, not the load
  <br>*Evidence:* 001 defines the shape (`docs/15` tables), 002 loads it, and the loader is a separate command (`npm run migrate:load`) that reuses the seed mapping rather than redefining it.

## Clarity and Testability

- [x] CHK021 Every functional requirement is verifiable by observation, without reference to an implementation choice
  <br>*Evidence:* each FR is checkable by reading an asset, a list, or a refusal.
- [x] CHK022 No requirement names a technology, product, table, screen or column
  <br>*Evidence:* verified by reading the spec.
- [x] CHK023 Every success criterion is measurable and technology-agnostic, with a baseline where one exists
  <br>*Evidence:* baselines come from the profiled export (1,026 assets, 132 shared serials, 29 duplicate IDs) rather than from estimates.
- [x] CHK024 Every quantitative criterion states its measurement conditions (SC-001 device and starting point, SC-009 asset counts)
  <br>*Evidence:* both state them. SC-009's counts are evidenced at scale — 6,626 assets / 438,619 lines, fleet list 32 ms, search 17 ms (`server/tests/scale.test.ts`).
- [x] CHK025 Terms used with a specific meaning — Available, Active, Retired, home office, current location, custodian — are used consistently and never interchangeably
  <br>*Evidence:* consistent, and the distinction is now **structural**: `lifecycle` (Active/Retired), `disposition` (where it is), `serviceability` (whether it works) are three stored columns, and "Available" is a computed projection of all three. Home office versus current location has its own command — `RehomeAsset` moves where an asset *belongs*, never where it *is*.
- [x] CHK026 No requirement uses "should", "may", "as appropriate" or "etc." where a testable statement is required
  <br>*Evidence:* verified by reading the spec. `MAY` appears only where optionality is the requirement (FR-053's integrations).

## Independence and Priority

- [x] CHK027 US1 alone constitutes a useful deliverable — a technician can find an asset and read its state with nothing else built
  <br>*Evidence:* true, and demonstrated — search and asset detail work against the real API with no other story built.
- [x] CHK028 Each user story's Independent Test is genuinely executable without the stories below it
  <br>*Evidence:* each is; the build order followed them.
- [x] CHK029 Priority order reflects user value rather than build convenience, and any inversion is justified in the story's "Why this priority"
  <br>*Evidence:* each story carries the justification; the one inversion (registration before reporting) is argued from a technician's need for a tag on day one.
- [x] CHK030 No user story depends on a story of lower priority
  <br>*Evidence:* verified by reading the dependencies.

## Consistency With Prior Design

- [x] CHK031 Requirements do not contradict `docs/01-data-model.md`; every intentional divergence is recorded in `docs/08-decisions.md`
  <br>*Evidence:* `docs/01` is parked as a **logical** reference (its Dataverse instructions are superseded), and every divergence since is recorded — the four-axis state model (DC-22), categories as rows, `asset_identifier`, and the D7–D17 set from 2026-09-04.
- [x] CHK032 The nine entities named here reconcile with the tables in `docs/01-data-model.md`, or the difference is deliberate and noted
  <br>*Evidence:* they reconcile, and the additions since are all noted — `docs/15` is now the canonical model and its own § 14 carries the migration consequences.
- [x] CHK033 Asset ID minting rules (FR-006) match the conventions in the source spreadsheet's *Start Here* sheet
  <br>*Evidence:* `app/src/domain/assetId.ts` implements the sheet's prefix conventions; 21 tests, and the 03_models_review prefix assignments are the reconciliation.
- [x] CHK034 Role names and privileges implied here reconcile with `docs/05-security.md`
  <br>*Evidence:* reconciled, with one recorded change: `docs/05` is parked for its Power Platform specifics, and the four current roles are `docs/14` § 4.5. **R5 (2026-09-04)** settles the scope question `docs/05` left open — OfficeAdmin is office-scoped, SystemOwner global.

## Data-Grounded Assertions

- [x] CHK035 Every count cited in this spec has been re-verified against the source export, not carried forward on trust
  <br>*Evidence:* re-verified by `migration/01_profile.py` against the committed export, and the profile report is the artefact. This item earned its place — feature 002's review found a **defective calibration export** (serial empty in 253/253 rows, 47 dates lost) precisely by not trusting a carried-forward figure.
- [x] CHK036 The 132 shared-serial figure and the 29 duplicate-ID figure are confirmed against the committed export
  <br>*Evidence:* both confirmed. `02_conflicts.md` reconciles them explicitly, including why a full reconciliation finds **16** cross-office duplicates where the narrative baseline said 8 — several legitimate shared-serial sibling pairs are each independently duplicated — while the total duplicate-ID count still matches 29 exactly.
- [x] CHK037 Assumptions about fleet growth (5,000 assets) and reference-data volumes are confirmed with the System Owner or restated
  <br>*Evidence:* restated as a **tested** figure rather than an assumption: `server/tests/scale.test.ts` runs 6,626 assets and 438,619 transaction lines — above the 5,000 target — and reports the measured timings. The assumption became a measurement, which is the stronger form of this item.

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- Leave items unchecked when they still require clarification, correction, or reviewer evaluation
- CHK001–CHK007 are **gates**: per the constitution's Development Workflow, `plan.md` must not be written for this feature while any of them is unchecked
- CHK035–CHK037 exist because a spec that cites numbers inherits responsibility for them; the calibration export defect found during feature 002's review is precisely why

### What this review found, 2026-09-04

All seven gates are now closed — CHK003, CHK004 and CHK006 were the last three, and closing them
needed work that did not exist in September: the model catalogue's production gate is signed, and
Q10's answer ("admin-maintained") is only true because rule 7's second clause was implemented.

CHK012 was amended rather than silently reinterpreted: its obsolete *Power Platform administrator*
persona is now the successor application/platform operator or engineer. The checked result is limited
to requirements quality and does not convert unrun implementation or external gates into passes.
