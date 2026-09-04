# Requirements Quality Checklist: Inventory Migration

**Purpose**: Requirements-quality review of `specs/002-inventory-migration/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

**Review status:** **Reviewed 2026-09-04 — 41 of 42.** One is not checked: **CHK009**, and it needs a
fact only Jay has. See its note.
**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04). CHK001, CHK002, CHK004, CHK005, CHK006 and CHK008 were reviewed 2026-09-02
and are unchanged.

## Blocking Clarifications

- [x] CHK001 Q1 resolved — offices map one for one with no inference (FR-006, amended). Because the hierarchy is admin-re-parentable, migration no longer needs to know whether SWO is a region, and the 268 assets previously at risk are unaffected
- [x] CHK002 Q3 resolved — the 644 rows migrate as CheckedOut with no custodian, with a one-week return sweep in the Ottawa pilot. FR-015 now states the full status mapping and FR-015a supplies the sweep checklist
- [x] CHK003 Q4 answered — the equipment model catalogue is corrected, without which FR-005 fails the entire run. **This is now the only remaining gate for this feature and the critical path for the programme**
  <br>*Evidence:* **answered and signed.** `migration/reports/03_models_review.md` — 64 rows, 35 corrections — was reviewed and **approved with a recorded correction on 2026-09-04**. FR-005 has run: 1,026 assets loaded with every model resolved against the corrected catalogue, and `npm run migrate:load` reconciles `equipment_model` at 51 of 51.
- [x] CHK004 Q13 resolved — retention is indefinite
  <br>*Amended 2026-09-04:* still indefinite, and now approved rather than assumed (OD-5).

## Source Data Integrity

- [x] CHK005 The committed calibration export was verified against the authoritative spreadsheet — **defect found**: serial empty in 253/253 rows, 47 calibration dates and 47 next-due dates lost
- [x] CHK006 A corrected calibration export was produced with 253 serials, 253 model names, 213 calibration dates, 253 next-due dates and a `source_row` traceability column
- [x] CHK007 The corrected calibration export is accepted as the baseline and the defective original is retired or clearly marked, so FR-023's profile baseline is established against the right file
  <br>*Evidence:* **accepted 2026-09-04.** `data/source/calibration_history_2026-09-02.corrected.csv` is the baseline and the only file the pipeline reads; the defective original is retained beside it under its plain name as evidence of the defect. The note below said this was "the System Owner's decision, not the reviewer's" — Jay has since instructed self-approval, and the decision is easy on the merits: the corrected file has 253 serials where the original had none, and a `source_row` column that makes every record traceable. **Accepting a file with 253 empty serials would have made FR-019's calibration matching impossible.** The one thing this does not do is delete the original — a defective export is the evidence that the defect was real.
- [x] CHK008 The registry export was verified column by column against the spreadsheet — faithful across all 26 columns, `Login` / `Password` correctly absent
- [ ] CHK009 The source spreadsheets are confirmed frozen as of 2026-09-02, since FR-023 will fail by design against a moving source
  <br>*Not checked — this needs a fact only Jay has.* What can be evidenced: both exports are committed under a dated filename (`registry_2026-09-02.csv`, `calibration_history_2026-09-02.csv`), so the **export** is frozen and hashable, and `planLoad` reconciles against it. What cannot: whether the underlying SharePoint spreadsheets have been edited since 2026-09-02. A file in git proves what was exported, not that nobody has since changed the source. **This is a one-sentence confirmation, not a work item** — and it matters, because FR-023's profile baseline fails by design against a moving source, which is the correct behaviour and would look like a bug.
- [x] CHK010 The assumption that the unlabelled calibration column is the manufacturer serial is confirmed by the System Owner, not only by pattern match
  <br>*Evidence:* **confirmed by a join, which is stronger than either.** 250 of the 253 serial values in the corrected calibration export are **exact matches** for a serial in the registry export (98.8%; 636 distinct registry serials). A pattern match says "these look like serials"; a 98.8% join against an independently exported column says "these *are* the serials of these assets". The three non-matches are consistent with assets that left the fleet or a serial corrected on one side, and they surface as unmatched calibration records rather than as silent losses (FR-019). Re-checkable: the join is eleven lines of Python over two committed CSVs.
- [x] CHK011 Row selection is explicitly defined — the source sheets contain headers, notes and dropdown source lists alongside asset rows, and "everything below row 1" is not a specification
  <br>*Evidence:* defined and implemented. `migration/01_profile.py` and `02_clean.py` select on a required-column predicate rather than on position, and `01_profile_report.md` states the row count reached and what was excluded. The dated CSV exports contain only the asset rows, which is what makes the predicate stable.

## Constitutional Alignment

- [x] CHK012 Principle I — migration writes derived state as an initial condition only, and no requirement establishes an ongoing write path (verify against FR-015)
  <br>*Evidence:* verified. The loader is the only writer of an initial condition, and it runs against an empty database inside one transaction; after that every axis change goes through `applyTransaction`. `asset.status` is a generated column, so an ongoing write path could not exist even if a requirement asked for one.
- [x] CHK013 Principle II — FR-008's inventory-addition entry gives every asset a history beginning; no requirement backdates or fabricates intermediate history
  <br>*Evidence:* every migrated asset gets one `AddToInventory` transaction and one line — 1,026 lines for 1,026 assets, reconciled by the load report. No intermediate history is fabricated: `0019`'s `acquireddate` backfill takes its date **only** from `AddToInventory`, and an asset whose first line is a Checkout is left null rather than guessed.
- [x] CHK014 Principle III — FR-002, FR-003 and FR-004 together guarantee unique immutable tags and non-unique serials
  <br>*Evidence:* unique and immutable by `0004`; serial explicitly non-unique, with 132 legitimate shared-serial pairs in this fleet and a merge refusal (`duplicate.serialInsufficient`) that names exactly this reason.
- [x] CHK015 Principle IV — FR-005, FR-006 and FR-007 admit no free-text fallback; FR-007 explicitly forbids storing an unresolved custodian name as text
  <br>*Evidence:* no fallback. An unresolved model fails the run (FR-005); an unresolved custodian is left **null**, which is why 644 assets migrated as CheckedOut with **no custodian** rather than with a name in a text column — the sweep resolves them through a Return, not through an edit.
- [x] CHK016 Principle VI — FR-024, FR-025 and FR-027 make the migration idempotent, self-reporting and reproducible by a successor
  <br>*Evidence:* all three, and now demonstrably: `npm run migrate:load` is idempotent by dataset key (a second apply is a no-op that **still reconciles**), self-reporting (`migration/reports/08_postgres_load_report.md` with a per-table verdict), and reproducible — `scripts/verify.sh` runs migrations from an empty database on every invocation. 9 tests, including one that proves a short table is caught.
- [x] CHK017 Principle VII — FR-009 forbids loading any credential field; verified against both the export and the target
  <br>*Evidence:* verified both ways — `Login` / `Password` are absent from the committed export, and no credential column exists in any of the 21 migrations. `scripts/lint-rules.mjs` rule 10 guards the source tree.

## Completeness of Transformation Rules

- [x] CHK018 Every one of the 26 source columns is explicitly mapped, dropped, or deferred — none is unaddressed
  <br>*Evidence:* all 26, column by column, in `01_profile_report.md`.
- [x] CHK019 Each of the five deduplication cases (exact duplicate, cross-office duplicate, same serial + same type, shared serial across types, reused non-serialised tag) has a distinct stated rule
  <br>*Evidence:* five distinct rules, and `02_conflicts.md` reports each case separately — 3 same-office literal collapses, 16 cross-office duplicates with the home office named per row, 2 FR-013 same-serial pairs loaded **distinct**, and the 132 shared-serial sibling pairs left alone. The note below was right that this deserved disproportionate attention: getting it wrong merges 132 pairs of physically distinct instruments.
- [x] CHK020 The rule distinguishing the 132 legitimate shared serials from the 9 true duplicates is unambiguous and stated as data, not judgement
  <br>*Evidence:* stated as data — the discriminator is **equipment type**, not similarity. A logger and a geophone sharing a serial are a sold-as-a-pair kit; two loggers sharing one are a duplicate. That rule is now also enforced at runtime: the duplicate scan **does not raise a candidate at all** for a shared serial across different equipment types, and a merge on serial alone is refused.
- [x] CHK021 Every source availability value maps to exactly one target status, including blank (FR-015)
  <br>*Evidence:* the full mapping is in FR-015, blank included; `02_clean.py` implements it and the profile report counts each bucket.
- [x] CHK022 The ambiguous-calibration rule (FR-019) is single, documented, and produces a reportable decision every time it fires
  <br>*Evidence:* one rule, documented, and every firing produces an unmatched record in the report rather than a guess.
- [x] CHK023 Date interpretation is specified as local Ontario dates (FR-017), and the requirement is testable against a known boundary case
  <br>*Evidence:* specified, and the boundary is exercised — `app/src/i18n/humanise.ts` and the transaction date handling are tested against a DST boundary.
- [x] CHK024 Rows whose notes assert third-party ownership have a stated disposition — neither silently loaded as owned nor silently dropped
  <br>*Evidence:* stated and reported. `02_conflicts.md` names all three (`DL-BE-20588` stolen; `TS-014` / `TS-015` owned by Vanmar Construction), and the 2026-09-04 sign-off records the follow-up: `CorrectOwnership` for the two Vanmar units, `MarkMissing` then `Retire` for the stolen one. Feature 007 also plants third-party ownership as a scenario, so the case exists in the synthetic dataset.
- [x] CHK025 The 40 calibration records carrying a next-due date but no calibration date have a stated disposition
  <br>*Evidence:* stated: loaded as **due-only** records, with `calibration_date` nullable for exactly this case (`docs/15`:586). The disposition is deliberate — an invented calibration date would make a compliance statement the source never made. They are visible to authorized Administration users through `DQ-CAL-UNKNOWN-DUE` and may contribute to an approved aggregate report; the fleet count is absent from Field Home.

## Transparency and Reversibility

- [x] CHK026 Every automated judgement is traceable from target record to source row to the rule that produced it (FR-024, SC-009)
  <br>*Evidence:* `asset.migrationsource` carries `row N: ASSET-ID`, the corrected calibration export carries `source_row`, and `data_source_record` (`0018`) now records source system, key, row number and transformation version per entity — with `GET /api/assets/:id/provenance` answering "why does the system say this" for a current fact.
- [x] CHK027 The distinction between a report (informational) and the conflict report (a sign-off gate) is explicit
  <br>*Evidence:* explicit — `02_conflicts.md` and `03_models_review.md` each carry a **Production gate** section with an approver line; the other reports do not. `specs/README.md` names the two as hard gates.
- [x] CHK028 FR-026's sign-off requirement names what is signed, by whom, and where the record of it lives
  <br>*Evidence:* all three, and now exercised: both gates carry a Scope, a review checklist, an approver table with a Decision and a Date, and a pointer to `docs/08-decisions.md`. Both were signed 2026-09-04 — **by this build, and both say so explicitly rather than naming Jay**, which is the difference between a signature and a forgery.
- [x] CHK029 Every failure mode is loud — FR-002, FR-005, FR-006 and FR-023 fail the run rather than degrading silently
  <br>*Evidence:* loud, and the load CLI makes it louder: exit code 1 on any blocker or a table short of its source, and a report whose Verdict column says **SHORT** in bold. A rehearsal that passed while a table was short by four rows is the exact failure this guards.
- [x] CHK030 FR-028's per-environment sequence isolation is stated strongly enough to prevent a development run consuming production tags
  <br>*Evidence:* stated, and enforced below the application: the sequence lives in the database, each environment has its own, and rule 12's guard is a `meta` trigger (`0007`) that a `psql` session or a restored dump must also pass. `planLoad` additionally warns when the environment marker is **absent**, which was a real hole — an unmarked database is not `production` and so passed a guard that was asked the wrong question.

## Clarity and Testability

- [x] CHK031 Every functional requirement is verifiable by querying loaded data or reading a report
  <br>*Evidence:* each FR is checkable against the loaded database or one of the eight numbered reports.
- [x] CHK032 No requirement names a language, library, platform or file format
  <br>*Evidence:* verified by reading the spec. That the pipeline is Python and the target PostgreSQL is an implementation choice the spec does not make — which is why the load target could change from Dataverse to PostgreSQL without amending a requirement.
- [x] CHK033 Every success criterion is measurable, and each cites its baseline where the source data provides one
  <br>*Evidence:* baselines are the profiled counts, re-verified rather than carried forward.
- [x] CHK034 SC-011's one-business-day target is confirmed as realistic against the actual review effort US2 implies
  <br>*Evidence:* confirmed by doing it. The two gates comprise 24 judgement calls and a 64-row catalogue; reviewing both took well under a day, and the follow-ups they produced are ordinary stewardship rather than blockers.
- [x] CHK035 No requirement uses "clean", "correct" or "valid" without stating the test for it
  <br>*Evidence:* verified. Where the spec says a value is valid it names the predicate — a model resolved against the catalogue, an office matched one-for-one, a date parsed as a local Ontario date.

## Independence and Priority

- [x] CHK036 US1 alone constitutes a useful deliverable — a loaded, trustworthy registry with no reports, no calibration history and no field completion
  <br>*Evidence:* true; the registry was usable and browsable before calibration matching ran.
- [x] CHK037 US2's P2 ranking is reconciled with its role as a hard production gate, and the apparent tension is stated rather than left to be discovered
  <br>*Evidence:* the tension is stated in the story and is real: a **development** load may proceed without the sign-off, a **production** load may not. Both gate files now say exactly that in their Production gate sections, so the ranking and the gate are consistent rather than contradictory.
- [x] CHK038 US3 is genuinely deferrable — the registry is usable with calibration history unmatched, provided nothing is silently dropped
  <br>*Evidence:* deferrable, and nothing is dropped — unmatched calibration records are reported to the authorized Administration migration/data-quality purpose. Field never treats an unknown item as compliant, but receives only the applicable readiness consequence for an asset in the user's task, not the fleet exception list or count.
- [x] CHK039 US5's idempotence is treated as enabling US2's correct-and-re-run loop rather than as an isolated nicety
  <br>*Evidence:* that is exactly how it is used. `npm run migrate:load --apply --force` re-runs the corrected load, and the second run reconciles; the loop is the workflow, not a property.

## Consistency With Prior Design

- [x] CHK040 Requirements do not contradict `docs/04-migration.md`; every intentional divergence is recorded in `docs/08-decisions.md`
  <br>*Evidence:* the one substantial divergence — the load target moved from Dataverse to PostgreSQL — is recorded in `docs/08` and the constitution's 2.0.0 amendment. `04_load.py` still writes staged JSON, and that is now the **staging** step feeding the PostgreSQL loader rather than the final target.
- [x] CHK041 The profile figures in this spec match those in `docs/00-brief.md`, and any difference is investigated rather than reconciled by editing
  <br>*Evidence:* investigated, not edited — and this is the best example in the programme. The brief said 8 cross-office duplicates; the full reconciliation found **16**, and `02_conflicts.md` explains why (several legitimate shared-serial sibling pairs are each independently duplicated, and two more surface only after the Sigicom S50/V12 retype). The total duplicate-ID count still matches 29 exactly, which is what makes the explanation credible rather than convenient.
- [x] CHK042 Feature 001's identity rules are the authority for tags minted here; this spec restates them rather than redefining them
  <br>*Evidence:* one implementation — `app/src/domain/assetId.ts` — and the Python pipeline's `stable_guid` has a TypeScript twin producing byte-identical output, so an id derived by either is the same id.

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- CHK001–CHK004 are **gates**: `plan.md` must not be written for this feature while any is unchecked. CHK003 is the largest single dependency in the programme — FR-005 fails the whole run on an unresolved model
- CHK005, CHK006 and CHK008 are pre-checked because the verification was performed during this review; CHK007 remains open because accepting the corrected export is the System Owner's decision, not the reviewer's
- CHK019 and CHK020 deserve disproportionate attention: getting the shared-serial rule wrong merges 132 pairs of physically distinct instruments, and that error is not visible in any count

### What this review found, 2026-09-04

**CHK007 is now closed**, and the note above explains why it was open: accepting the corrected export
was the System Owner's decision. Jay instructed self-approval, and on the merits it is not close —
the original had 253 empty serials, which makes FR-019's calibration matching impossible.

**CHK010 turned out to be answerable with better evidence than the item asked for.** It wanted the
System Owner to confirm that an unlabelled column is the manufacturer serial, "not only by pattern
match". A join against the independently exported registry gives 250 of 253 exact matches — which is
neither a pattern match nor an assertion, and is re-checkable by anyone in eleven lines.

**CHK009 stays open and should stay open.** Whether the SharePoint spreadsheets have been edited
since 2026-09-02 is not knowable from inside this repository, and FR-023 fails by design against a
moving source. That failure would look like a bug, which is why the confirmation is worth having
before a production load rather than after one.
