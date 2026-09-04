# Feature Specification: Inventory Migration

**Feature Branch**: `002-inventory-migration` (directory-selected; set `SPECIFY_FEATURE=002-inventory-migration`)

**Created**: 2026-09-02

**Status**: Draft — built and run 2026-09-02 (1,053 source rows → 1,026 staged assets, 9 reports, idempotent). Q4 done as data work; the two sign-offs (`migration/reports/02_conflicts.md`, `03_models_review.md`) gate the production load. Q1, Q2, Q3, Q5 and Q13 resolved; see `docs/08-decisions.md`

**Access amendment (D18, 2026-09-04):** This feature has no Work or general Reports screen.
Migration files, conflicts, row-level outcomes, model review, provenance and sign-off evidence belong
to an Administration migration/data-governance purpose and exact capability/projection. A temporary
tag may resolve through a separate minimal Work lookup when needed for an assigned task; that lookup
must not return migration lineage, conflict evidence or source-row detail.

**Input**: `Asset AMS - SharePoint.xlsx` sheets *IM Asset Registry* (1,053 data rows, 28 columns) and *Assets - Calibration History* (253 rows, no Asset ID column); `IM30 - Asset Managment via M365.docx` § Current System; `docs/00-brief.md` (profile baseline), `docs/04-migration.md`

## User Scenarios & Testing *(mandatory)*

This feature has no screens. Its users are the office admin who has to believe the result and the
System Owner who has to sign it off. Its output is data, and its acceptance test is trust.

The source is not clean. Measured on the 2026-09-02 export:

| Finding | Count |
|---|---|
| Data rows | 1,053 |
| Duplicated Asset IDs | 29 (8 are one asset listed under two offices) |
| Blank or prefix-only Asset IDs (`GEO-`, `DL-`) | 27 |
| Serials shared across different equipment types | 132 |
| Same serial + same type + two rows (true duplicates) | 9 |
| Rows with no serial | 26% |
| Rows with no manufacturer, or a model name in the manufacturer column | 22% |
| Availability status blank | 121 |
| `Deployed or NOT Available` used as a catch-all | 644 |
| Distinct office values | 10 |
| Calibration rows carrying no Asset ID | 253 |
| Populated `Next Calibration Due` values in the registry | 0 |
| `Login` / `Password` columns | present, empty — dropped at export |

**The committed calibration export is defective and blocks US3 as it stands.**
`data/source/calibration_history_2026-09-02.csv` has its serial column empty in all 253 rows, because
that column carries no header in the source spreadsheet — it sits unlabelled between `Certificate` and
`Cost` — and a header-driven export skipped it. The same export also lost 47 calibration dates
(213 in the sheet → 166 in the CSV) and 47 next-due dates (253 → 206).

The serial is the *only* attribute that can link a calibration record to an asset. Without it, US3 has
nothing to match on. A corrected export regenerated from the authoritative spreadsheet is provided as
`data/source/calibration_history_2026-09-02.corrected.csv` — 253 serials, 253 model names, 213
calibration dates, 253 next-due dates, plus a `source_row` column for traceability. `Certificate` and
`Cost` are genuinely empty in the source and remain so.

The registry export was checked column by column against the spreadsheet and is faithful: all 26
columns match on fill count, and `Login` / `Password` are correctly absent. **FR-023's profile baseline
must be established against the corrected calibration export, not the original.**

### User Story 1 - Trust the migrated fleet (Priority: P1)

An office admin opens the new registry on day one and finds their equipment: every item they own, each
with one permanent tag, a real model, a home office, and a status that is either right or honestly
marked as unknown. Nothing they own is missing, and nothing appears twice.

**Why this priority**: Nothing else in the programme can be evaluated on top of untrusted data. A
technician who finds one wrong record stops using the system, and the old spreadsheet returns. This
story is the entire feature's reason to exist.

**Independent Test**: Migrate to the development environment, sit with the Ottawa admin, and walk the
full Ottawa asset list against physical stock and their own knowledge. Testable with no app and no
automation built — the assertions are queries against loaded data.

**Acceptance Scenarios**:

1. **Given** the 1,053-row source export, **When** migration completes, **Then** every loaded asset has
   a non-blank Asset ID, exactly one equipment model, a home office, and a lifecycle state.
2. **Given** the loaded registry, **When** Asset IDs are counted, **Then** there are zero duplicates and
   zero blank or prefix-only values.
3. **Given** the 8 assets each listed under two offices, **When** migration completes, **Then** one
   asset exists per pair, its home office is a documented choice, and both source rows are named in the
   conflict report.
4. **Given** the 132 serials shared between an instrument and its sensor, **When** migration completes,
   **Then** both assets exist as separate records sharing that serial, and neither was merged or
   dropped.
5. **Given** the 9 true duplicates (same serial, same type, two rows), **When** migration completes,
   **Then** one asset exists per pair and the discarded row is reported.
6. **Given** the 27 blank or prefix-only Asset IDs, **When** migration completes, **Then** each has a
   temporary tag, retains its original source value for traceability, and appears on the list of
   records needing field completion.
7. **Given** the source's misspellings `Geohpone` and `Air Quailty Monitroing`, **When** migration
   completes, **Then** no asset carries either value and each affected asset references the corrected
   model.
8. **Given** the source's swapped columns (`Minimate Pro`, `Series IV`, `Settop M1`, `Instantel`
   appearing as manufacturers), **When** migration completes, **Then** each affected asset references a
   model whose manufacturer and model name are correctly assigned.
9. **Given** every loaded asset, **When** its history is examined, **Then** it has at least one entry
   recording its addition to inventory, dated the migration date, so day-one state is not stateless.
10. **Given** the source `Login` and `Password` columns, **When** the export and every loaded record are
    inspected, **Then** neither column nor its data exists anywhere in the target.

---

### User Story 2 - Audit and reverse every judgement call before production (Priority: P2)

The System Owner reads a report of everything the migration decided on its own — which duplicate it
kept, which office it picked, which model it inferred, which status it assumed — corrects what is
wrong, and re-runs. Nothing reaches production unreviewed.

**Why this priority**: P2 by build sequence — the loader must exist before its report means anything —
but this story is a **hard gate on the production load**, not an optional extra. An automated
migration that cannot show its work is indistinguishable from data loss.

**Independent Test**: Introduce three deliberate errors into the reference mapping, run the migration,
and confirm all three appear in the reports as decisions rather than passing silently. Then correct
them, re-run, and confirm the reports change accordingly.

**Acceptance Scenarios**:

1. **Given** a completed migration run, **When** the reports are produced, **Then** every source row
   that was dropped, merged, renamed, defaulted or inferred is listed with its source identity, the
   action taken, and the reason.
2. **Given** a source row that cannot be resolved to an equipment model, **When** migration runs,
   **Then** the run fails loudly rather than loading the asset with a guessed or null model.
3. **Given** a custodian name that does not resolve to a directory user, **When** migration runs,
   **Then** the asset loads with no custodian and the unresolved name is reported — the name is never
   stored as text.
4. **Given** the source export is replaced with a re-export whose row count or key counts differ from
   the committed baseline, **When** the profile step runs, **Then** it fails and names the differences,
   so nobody migrates a moving target.
5. **Given** corrected reference data, **When** migration is re-run, **Then** the reports reflect the
   corrections and no previously loaded asset is duplicated.
6. **Given** the conflict report, **When** the System Owner signs it off, **Then** that sign-off is
   recorded and is a precondition of the production load.

---

### User Story 3 - Reach the right asset with the calibration history (Priority: P2)

253 historical calibration records exist in a sheet with no Asset ID — only a model name, dates, and an
unlabelled column holding what appears to be the serial. Each record either reaches the asset it
belongs to or is explicitly listed as unmatched, with a reason.

**Why this priority**: Calibration currency is a compliance matter and a client-facing one. But the
registry is usable without history — the next calibration re-establishes the date — so it ranks below
US1. It must not be quietly skipped, which is why it is a story and not a task.

**Independent Test**: Pick fifteen assets with known real-world calibration dates, run the match, and
verify each landed on the right asset. Then confirm the unmatched list explains every remaining record.

**Acceptance Scenarios**:

1. **Given** a calibration row whose serial and model resolve to exactly one asset, **When** matching
   runs, **Then** a calibration record is created against that asset with its date, next due date and
   certificate reference.
2. **Given** a calibration row whose serial matches both a data logger and a geophone of the same
   manufacturer family, **When** matching runs, **Then** the ambiguity is reported and the record is
   attached according to a single documented rule rather than arbitrarily.
3. **Given** a calibration row containing `N/A`, `#VALUE!`, or a date in 1900, **When** matching runs,
   **Then** it is skipped with that reason stated.
4. **Given** a calibration row matching no asset, **When** matching completes, **Then** it appears in an
   unmatched report containing enough of the source row for a human to resolve it by hand.
5. **Given** matched calibration records, **When** migration completes, **Then** each affected asset's
   last calibration date and next due date agree with its most recent calibration record.
6. **Given** the registry's `Next Calibration Due` column is empty in all 1,053 source rows, **When**
   migration completes, **Then** every next-due date present in the target was derived from a
   calibration record or a model interval, and none was invented.

---

### User Story 4 - Complete the records the source could not (Priority: P3)

A technician finds an instrument whose tag is temporary or whose serial was never recorded. From the
app, they supply what is missing — serial, model, correct office — and the record becomes a proper
asset with a permanent tag, without an admin retyping it.

**Why this priority**: Affects a known, bounded set — the 27 untagged rows plus the 26% missing serials —
and the fleet is operable without it. But leaving it out means the temporary tags become permanent,
which is how the previous system decayed.

**Independent Test**: Take five temporarily-tagged assets, complete them in the field, and confirm each
receives a correct permanent tag, keeps its history, and no longer appears on the completion list.

**Acceptance Scenarios**:

1. **Given** an asset with a temporary tag, **When** a technician supplies the missing serial and
   confirms the model, **Then** the asset receives its permanent Asset ID and the temporary value is
   retained for traceability.
2. **Given** the permanent tag would duplicate an existing asset, **When** completion is submitted,
   **Then** it is refused and the existing asset is shown, because this is how the 9 true duplicates
   are found in the field.
3. **Given** a completed asset, **When** its history is examined, **Then** the completion is recorded as
   an entry, and prior entries are unchanged.
4. **Given** the set of incomplete records, **When** an admin asks for it, **Then** it is available as a
   working list with a count, so progress is visible.

---

### User Story 5 - Re-run the load without fear (Priority: P3)

Migration is run repeatedly — against development, after each correction, then once against production.
Running it twice produces the same result as running it once.

**Why this priority**: Operationally essential but invisible to users, and only actually exercised by
the System Owner. Its value is that it makes US2's correct-and-re-run loop cheap.

**Independent Test**: Run the full migration twice consecutively against the same environment and diff
the resulting data. The diff must be empty.

**Acceptance Scenarios**:

1. **Given** a completed migration, **When** the same migration is run again unchanged, **Then** no
   duplicate assets, projects, models, locations or calibration records are created.
2. **Given** a partially failed migration, **When** it is re-run, **Then** it completes the remaining
   work without repeating completed work.
3. **Given** each migration step, **When** it runs, **Then** it writes a report naming counts of records
   created, updated, skipped and unresolved.
4. **Given** the reference data and source exports alone, **When** migration is run against a fresh
   empty environment, **Then** the full registry is reproduced with no manual step.

### Edge Cases

- **Reused non-serialised tags.** 11 SIM identifiers (`DST220`, `DST100`, …) appear twice. The row
  carrying an ICCID is the real asset; the other needs a temporary tag and field completion.
- **An asset whose only distinguishing data is its notes field.** 95 rows carry free-text notes, some
  containing location (`1124 Perreault Garage`), ownership (`Owned by Vanmar Construction Inc.`), or
  condition (`Won't stay connected`). Notes migrate verbatim; nothing is parsed out of them
  automatically, and rows whose notes assert third-party ownership are reported for review.
- **Rows describing equipment Englobe does not own.** At least two notes say so explicitly. Migrating
  them as owned assets would be wrong; excluding them silently would also be wrong.
- **Columns that are 100% empty in the source** (`Next Calibration Due`, `Login`, `Password`,
  `Location Type`, `Location`, `Deployment Date`, `Retirement Reason`, `Firmware Version`,
  `Pre Amp Serial`, `Element Serial`). Dropped, and the drop is recorded so a later re-export is not
  mistaken for data loss.
- **Serial with an embedded manufacturer code** (`UM16984`, `BE18794`). Stored as given; the tag does
  not repeat the code.
- **Sigicom serials that are plain numbers** (`107861`) and collide across product lines. Model must
  participate in matching, not serial alone.
- **A source row that is a header, a note, or a dropdown source list** rather than an asset. The source
  sheets carry all three. Row selection must be explicit, not "everything below row 1".
- **Timezone on dates.** Source dates are date-only and locally meaningful; loading them as midnight
  UTC shifts them a day for Ontario users.
- **Production load happening while people are already using development.** The two must not share
  sequence state.

## Requirements *(mandatory)*

### Functional Requirements

**Integrity of the result**

- **FR-001**: System MUST load every source row that represents an owned, trackable asset, and MUST
  report every row it did not load, with a reason.
- **FR-002**: System MUST produce zero blank, prefix-only or duplicate Asset IDs.
- **FR-003**: System MUST assign a temporary, traceable tag to any asset whose permanent tag cannot be
  determined, and MUST retain the original source value.
- **FR-004**: System MUST preserve two distinct assets that share a serial number, and MUST NOT treat
  serial as an identity key at any point.
- **FR-005**: System MUST resolve every loaded asset to exactly one curated equipment model, and MUST
  fail the run rather than load an asset with an unresolved or invented model.
- **FR-006**: System MUST map every source office value to a curated location one for one, MUST NOT
  infer a parent, a region or a substitute office for any value, and MUST fail on an unmapped value
  rather than defaulting silently. Restructuring the resulting hierarchy is an administrative action in
  the app, not a migration behaviour.
- **FR-007**: System MUST resolve custodian names to directory users, MUST leave the custodian empty
  when resolution fails, and MUST NOT store an unresolved name as text.
- **FR-008**: System MUST create a history entry for every loaded asset recording its addition to
  inventory at the migration date.
- **FR-009**: System MUST NOT load, and MUST NOT create, any credential-bearing field.
- **FR-010**: System MUST drop empty and superseded source columns, and MUST record which columns were
  dropped.

**Deduplication**

- **FR-011**: System MUST collapse rows identical in Asset ID and office to a single asset.
- **FR-012**: System MUST collapse an Asset ID appearing under two offices to a single asset, MUST
  choose its home office by a stated rule, and MUST report the pair.
- **FR-013**: System MUST flag, and MUST NOT automatically merge, rows sharing a serial and an
  equipment type but carrying different Asset IDs.
- **FR-014**: System MUST NOT flag as duplicates rows that share a serial across different equipment
  types.

**Status and dates**

- **FR-015**: System MUST map each source availability value to a defined status, and MUST NOT leave a
  loaded asset without one. Specifically: `Available` → Available; `Deployed or NOT Available` and
  `Deployed` → CheckedOut with no custodian; `Needs Repair / Calibration` → NeedsRepair; blank →
  Available where lifecycle is Active and Retired otherwise.
- **FR-015a**: System MUST produce a list of every asset loaded as CheckedOut with no custodian, so the
  pilot return sweep has a working checklist and its progress is measurable.
- **FR-016**: System MUST derive every next-calibration-due date from a calibration record or a model
  interval, and MUST NOT invent one.
- **FR-017**: System MUST interpret source dates as local Ontario dates so that no date shifts on load.

**Calibration history**

- **FR-018**: System MUST match calibration rows to assets using serial together with model family, not
  serial alone.
- **FR-019**: System MUST apply a single documented rule when a calibration row is ambiguous between an
  instrument and its sensor, and MUST report every application of that rule.
- **FR-020**: System MUST skip calibration rows containing non-values or implausible dates, stating the
  reason for each.
- **FR-021**: System MUST list every unmatched calibration row with enough source detail for manual
  resolution.
- **FR-022**: System MUST ensure each asset's last-calibration and next-due dates agree with its most
  recent loaded calibration record.

**Transparency and repeatability**

- **FR-023**: System MUST verify the source export against a committed profile baseline before loading,
  and MUST fail on divergence.
- **FR-024**: System MUST write, per step, a report naming counts created, updated, skipped and
  unresolved, plus every individual judgement call.
- **FR-025**: System MUST be safely re-runnable, producing no duplicates on a second identical run.
- **FR-026**: System MUST require recorded sign-off on the conflict report before a production load.
- **FR-027**: System MUST reproduce the full registry into an empty environment from committed
  reference data and source exports alone.
- **FR-028**: System MUST keep sequence state per environment, so a development run cannot consume
  production tags.

**Field completion**

- **FR-029**: Users MUST be able to supply missing identity data for a temporarily-tagged asset and
  receive its permanent tag.
- **FR-030**: System MUST refuse a completion that would duplicate an existing Asset ID, showing the
  existing asset.
- **FR-031**: System MUST record each completion as a history entry without altering prior entries.
- **FR-032**: Users MUST be able to list all records still needing completion, with a count.

### Key Entities *(include if feature involves data)*

- **Source Export**: A frozen, read-only snapshot of the legacy registry and calibration sheets, with
  credential columns already removed. Frozen because FR-023 needs something stable to compare against.
- **Column Map**: The declared source-column → target-attribute translation, including per-value
  corrections. Data, reviewable by a non-programmer, not logic buried in a script.
- **Model Mapping**: Source manufacturer and model text → curated equipment model. This is where the
  swapped columns and misspellings are fixed, by a human, once.
- **Location Mapping**: Source office text → curated location. Where the SWO question is answered.
- **Migration Report**: Per step, the record of what happened and every judgement made. The artefact
  US2 is built on.
- **Conflict Report**: The subset of decisions requiring human confirmation before production —
  duplicate resolutions, office choices, ambiguous calibrations, third-party-ownership notes.
- **Unmatched Calibration List**: Calibration rows no asset could be found for, with source detail.
- **Completion Queue**: Assets carrying temporary tags or missing identity data. Not a separate table —
  a defined query over the registry, so it cannot drift out of date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of owned assets in the source export exist in the target registry, or appear in a
  report explaining their absence. Nothing is unaccounted for.
- **SC-002**: Zero duplicate Asset IDs and zero blank or prefix-only Asset IDs in the loaded registry.
  *(Baseline: 29 and 27.)*
- **SC-003**: 100% of loaded assets reference a curated equipment model; zero reference a corrected
  misspelling or a swapped-column manufacturer.
- **SC-004**: All 132 shared-serial pairs exist as two assets; zero were merged.
- **SC-005**: Every one of the 253 calibration rows is either linked to an asset or listed as unmatched
  with a stated reason. Zero silently dropped.
- **SC-006**: Running the full migration twice against the same environment produces an empty data
  diff.
- **SC-007**: The Ottawa office admin reviews the full Ottawa asset list and reports zero assets missing
  and zero assets they do not recognise.
- **SC-008**: Zero credential-bearing fields or values exist in the export files or the target,
  verified by inspection of both.
- **SC-009**: Every automated judgement call is traceable from the target record back to its source row
  and the rule that produced it.
- **SC-010**: The System Owner signs off the conflict report before the production load, and that
  sign-off is on record.
- **SC-011**: A full production load completes within one business day, including review time, so it
  fits a single change window.

## Assumptions

- The 2026-09-02 export is the authoritative snapshot and the source sheets are frozen from that point.
  If they are still being edited, US2's baseline check will fail by design.
- The unlabelled column in the calibration sheet contains the manufacturer serial. Verified, not
  assumed: its 253 values are of the form `BE18794`, `UM18425`, `UM21927`, which match the pattern and
  the population of registry serials. US3 must run against the corrected export, since the originally
  committed one dropped this column entirely.
- Model family is sufficient to disambiguate an ambiguous calibration serial in most cases, and the
  residue is small enough to resolve by hand.
- Directory display names are close enough to the source's `Staff` values to resolve most custodians;
  the initials (`JR`, `JLV`, `RC`) and partial names (`Noah M`) will not resolve and will be reported.
  Given only 87 of 1,053 rows carry a custodian at all, this is a small manual task.
- Assets currently recorded as deployed have no known site — the source's location columns are entirely
  empty — so deployment detail cannot be migrated. Site history begins at go-live.
- Migration runs against development first and repeatedly; production is loaded once per office, Ottawa
  first, with other offices remaining on the legacy sheets read-only until their turn.
- The 644 `Deployed or NOT Available` rows migrate as **CheckedOut with no custodian**. *(Q3 resolved.
  This is honest about what the source actually says — the asset is not in the office, and nothing
  more. The consequence is accepted: 61% of the fleet starts with an unknown custodian, and a one-week
  "return anything you are not holding" sweep during the Ottawa pilot converts that unknown into
  recorded fact through the normal return path. Because FR-025 in feature 003 restricts returns to the
  custodian or an administrator, and these assets have no custodian, an administrator performs the
  sweep's returns.)*
- Office values are mapped **one for one, with no inference**. *(Q1 and Q2 resolved by a better answer
  than either option offered: the location hierarchy supports N offices, admin-managed and
  re-parentable in-app. So all ten distinct source office values — including `SWO` — are seeded as
  offices under Ontario and re-parented afterwards on a screen. Migration no longer needs to know
  whether SWO is a region, no asset receives a guessed home office, and this question stops blocking
  the load. The 268 assets previously at risk are unaffected.)*
- The equipment model catalogue is corrected before this feature runs. *(Q4 done 2026-09-02: FR-005
  fails the run on an unresolved model, which is exactly why the catalogue was corrected first — 35 of
  64 rows, reviewable at `migration/reports/03_models_review.md`. The run is clean against it; Jay's
  read-through is a production-load gate.)*
- Retired assets and their history are retained indefinitely. *(Q13 resolved: indefinite.)*
- The pre-amp and element of a sound level meter are migrated as their own assets, attached to the
  meter as permanent Components. *(Q5 resolved. Only 3 source rows carry `Pre Amp Serial` or
  `Element Serial`, so most of these assets do not exist in the source at all and will be created by
  field completion under US4 rather than by the load. The load creates what the source records; it
  does not invent components it has no evidence for.)*
- Depends on 001 for the target schema, identity rules and reference tables. Depends on nothing else.
  Blocks 003, 004 and 006 in practice, because none of them can be evaluated on empty data.
