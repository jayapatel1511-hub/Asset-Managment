# Requirements Quality Checklist: Asset Registry

**Purpose**: Requirements-quality review of `specs/001-asset-registry/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Blocking Clarifications

- [x] CHK001 Q1 resolved — answered as a requirement rather than a placement: the hierarchy supports N offices, admin-managed and re-parentable in-app (FR-011a to FR-011c). SWO's placement is therefore no longer a design question, and no asset gets a guessed home office
- [x] CHK002 Q2 resolved — dissolved by the same decision: Mississauga and Thunder Bay are seeded flat and re-parented by an admin on a screen
- [ ] CHK003 Q4 answered **(critical path — blocks feature 002 entire migration run)** — the equipment model catalogue is corrected (Larson Davis 831C prefix, `Series IV` / `Minimate Pro` / `Settop M1` / `Instantel` in the manufacturer column, Sigicom V12 typed as Data Logger) and a default calibration interval is set or explicitly nulled per model
- [ ] CHK004 Q6 answered — the 16 `Azure` / `THOR` / `Vision` / `INFRANet` rows are confirmed as trackable assets or excluded as configuration
- [x] CHK005 Q5 resolved — SLM pre-amp and element get their own Asset IDs, attached as permanent Components; fleet is roughly 1,150 assets, and each component holds its own calibration record
- [ ] CHK006 Q10 answered — project numbers are confirmed as admin-maintained or as synced from an upstream system, since this changes US4 from create-and-edit to read-only
- [x] CHK007 Q13 resolved — retention is indefinite (FR-026)

## Constitutional Alignment

- [ ] CHK008 Principle I — no requirement in this spec grants any user a write path to status, location, custodian, project or parent (verify FR-027, FR-028 against every user story)
- [ ] CHK009 Principle III — no requirement permits an Asset ID to encode a mutable attribute, and none treats serial as unique (verify FR-004, FR-005)
- [ ] CHK010 Principle IV — no requirement admits a free-text alternative for manufacturer, model, type, group, location, project or staff (verify FR-008)
- [ ] CHK011 Principle VII — no requirement stores or exposes a credential, and sensitive attribute restriction is stated as data-layer rather than interface-layer (verify FR-029, FR-030)
- [ ] CHK012 Principle VI — every requirement is stated so that a Power Platform administrator, not its author, could verify it
- [ ] CHK013 Localisation is preserved as a future option rather than designed out (FR-031)

## Completeness

- [ ] CHK014 Every field named in the source Word document's Asset Registry list is covered by a requirement or explicitly excluded with a reason
- [ ] CHK015 Every column in the source registry export is either mapped, deliberately dropped, or deferred to feature 002 — none is silently unaddressed
- [ ] CHK016 Acceptance questions 1, 2, 3 and 4 each trace to at least one requirement and one success criterion
- [ ] CHK017 Every user story has at least one acceptance scenario covering its failure path, not only its happy path
- [ ] CHK018 Each of the nine edge cases has a corresponding requirement or an explicit decision to accept the behaviour
- [ ] CHK019 The boundary with feature 003 is unambiguous — this spec displays derived state and never produces it
- [ ] CHK020 The boundary with feature 002 is unambiguous — this spec defines the target shape, not the load

## Clarity and Testability

- [ ] CHK021 Every functional requirement is verifiable by observation, without reference to an implementation choice
- [ ] CHK022 No requirement names a technology, product, table, screen or column
- [ ] CHK023 Every success criterion is measurable and technology-agnostic, with a baseline where one exists
- [ ] CHK024 Every quantitative criterion states its measurement conditions (SC-001 device and starting point, SC-009 asset counts)
- [ ] CHK025 Terms used with a specific meaning — Available, Active, Retired, home office, current location, custodian — are used consistently and never interchangeably
- [ ] CHK026 No requirement uses "should", "may", "as appropriate" or "etc." where a testable statement is required

## Independence and Priority

- [ ] CHK027 US1 alone constitutes a useful deliverable — a technician can find an asset and read its state with nothing else built
- [ ] CHK028 Each user story's Independent Test is genuinely executable without the stories below it
- [ ] CHK029 Priority order reflects user value rather than build convenience, and any inversion is justified in the story's "Why this priority"
- [ ] CHK030 No user story depends on a story of lower priority

## Consistency With Prior Design

- [ ] CHK031 Requirements do not contradict `docs/01-data-model.md`; every intentional divergence is recorded in `docs/08-decisions.md`
- [ ] CHK032 The nine entities named here reconcile with the tables in `docs/01-data-model.md`, or the difference is deliberate and noted
- [ ] CHK033 Asset ID minting rules (FR-006) match the conventions in the source spreadsheet's *Start Here* sheet
- [ ] CHK034 Role names and privileges implied here reconcile with `docs/05-security.md`

## Data-Grounded Assertions

- [ ] CHK035 Every count cited in this spec has been re-verified against the source export, not carried forward on trust
- [ ] CHK036 The 132 shared-serial figure and the 29 duplicate-ID figure are confirmed against the committed export
- [ ] CHK037 Assumptions about fleet growth (5,000 assets) and reference-data volumes are confirmed with the System Owner or restated

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- Leave items unchecked when they still require clarification, correction, or reviewer evaluation
- CHK001–CHK007 are **gates**: per the constitution's Development Workflow, `plan.md` must not be written for this feature while any of them is unchecked
- CHK035–CHK037 exist because a spec that cites numbers inherits responsibility for them; the calibration export defect found during feature 002's review is precisely why
