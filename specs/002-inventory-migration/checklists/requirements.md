# Requirements Quality Checklist: Inventory Migration

**Purpose**: Requirements-quality review of `specs/002-inventory-migration/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Blocking Clarifications

- [x] CHK001 Q1 resolved — offices map one for one with no inference (FR-006, amended). Because the hierarchy is admin-re-parentable, migration no longer needs to know whether SWO is a region, and the 268 assets previously at risk are unaffected
- [x] CHK002 Q3 resolved — the 644 rows migrate as CheckedOut with no custodian, with a one-week return sweep in the Ottawa pilot. FR-015 now states the full status mapping and FR-015a supplies the sweep checklist
- [ ] CHK003 Q4 answered — the equipment model catalogue is corrected, without which FR-005 fails the entire run. **This is now the only remaining gate for this feature and the critical path for the programme**
- [x] CHK004 Q13 resolved — retention is indefinite

## Source Data Integrity

- [x] CHK005 The committed calibration export was verified against the authoritative spreadsheet — **defect found**: serial empty in 253/253 rows, 47 calibration dates and 47 next-due dates lost
- [x] CHK006 A corrected calibration export was produced with 253 serials, 253 model names, 213 calibration dates, 253 next-due dates and a `source_row` traceability column
- [ ] CHK007 The corrected calibration export is accepted as the baseline and the defective original is retired or clearly marked, so FR-023's profile baseline is established against the right file
- [x] CHK008 The registry export was verified column by column against the spreadsheet — faithful across all 26 columns, `Login` / `Password` correctly absent
- [ ] CHK009 The source spreadsheets are confirmed frozen as of 2026-09-02, since FR-023 will fail by design against a moving source
- [ ] CHK010 The assumption that the unlabelled calibration column is the manufacturer serial is confirmed by the System Owner, not only by pattern match
- [ ] CHK011 Row selection is explicitly defined — the source sheets contain headers, notes and dropdown source lists alongside asset rows, and "everything below row 1" is not a specification

## Constitutional Alignment

- [ ] CHK012 Principle I — migration writes derived state as an initial condition only, and no requirement establishes an ongoing write path (verify against FR-015)
- [ ] CHK013 Principle II — FR-008's inventory-addition entry gives every asset a history beginning; no requirement backdates or fabricates intermediate history
- [ ] CHK014 Principle III — FR-002, FR-003 and FR-004 together guarantee unique immutable tags and non-unique serials
- [ ] CHK015 Principle IV — FR-005, FR-006 and FR-007 admit no free-text fallback; FR-007 explicitly forbids storing an unresolved custodian name as text
- [ ] CHK016 Principle VI — FR-024, FR-025 and FR-027 make the migration idempotent, self-reporting and reproducible by a successor
- [ ] CHK017 Principle VII — FR-009 forbids loading any credential field; verified against both the export and the target

## Completeness of Transformation Rules

- [ ] CHK018 Every one of the 26 source columns is explicitly mapped, dropped, or deferred — none is unaddressed
- [ ] CHK019 Each of the five deduplication cases (exact duplicate, cross-office duplicate, same serial + same type, shared serial across types, reused non-serialised tag) has a distinct stated rule
- [ ] CHK020 The rule distinguishing the 132 legitimate shared serials from the 9 true duplicates is unambiguous and stated as data, not judgement
- [ ] CHK021 Every source availability value maps to exactly one target status, including blank (FR-015)
- [ ] CHK022 The ambiguous-calibration rule (FR-019) is single, documented, and produces a reportable decision every time it fires
- [ ] CHK023 Date interpretation is specified as local Ontario dates (FR-017), and the requirement is testable against a known boundary case
- [ ] CHK024 Rows whose notes assert third-party ownership have a stated disposition — neither silently loaded as owned nor silently dropped
- [ ] CHK025 The 40 calibration records carrying a next-due date but no calibration date have a stated disposition

## Transparency and Reversibility

- [ ] CHK026 Every automated judgement is traceable from target record to source row to the rule that produced it (FR-024, SC-009)
- [ ] CHK027 The distinction between a report (informational) and the conflict report (a sign-off gate) is explicit
- [ ] CHK028 FR-026's sign-off requirement names what is signed, by whom, and where the record of it lives
- [ ] CHK029 Every failure mode is loud — FR-002, FR-005, FR-006 and FR-023 fail the run rather than degrading silently
- [ ] CHK030 FR-028's per-environment sequence isolation is stated strongly enough to prevent a development run consuming production tags

## Clarity and Testability

- [ ] CHK031 Every functional requirement is verifiable by querying loaded data or reading a report
- [ ] CHK032 No requirement names a language, library, platform or file format
- [ ] CHK033 Every success criterion is measurable, and each cites its baseline where the source data provides one
- [ ] CHK034 SC-011's one-business-day target is confirmed as realistic against the actual review effort US2 implies
- [ ] CHK035 No requirement uses "clean", "correct" or "valid" without stating the test for it

## Independence and Priority

- [ ] CHK036 US1 alone constitutes a useful deliverable — a loaded, trustworthy registry with no reports, no calibration history and no field completion
- [ ] CHK037 US2's P2 ranking is reconciled with its role as a hard production gate, and the apparent tension is stated rather than left to be discovered
- [ ] CHK038 US3 is genuinely deferrable — the registry is usable with calibration history unmatched, provided nothing is silently dropped
- [ ] CHK039 US5's idempotence is treated as enabling US2's correct-and-re-run loop rather than as an isolated nicety

## Consistency With Prior Design

- [ ] CHK040 Requirements do not contradict `docs/04-migration.md`; every intentional divergence is recorded in `docs/08-decisions.md`
- [ ] CHK041 The profile figures in this spec match those in `docs/00-brief.md`, and any difference is investigated rather than reconciled by editing
- [ ] CHK042 Feature 001's identity rules are the authority for tags minted here; this spec restates them rather than redefining them

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- CHK001–CHK004 are **gates**: `plan.md` must not be written for this feature while any is unchecked. CHK003 is the largest single dependency in the programme — FR-005 fails the whole run on an unresolved model
- CHK005, CHK006 and CHK008 are pre-checked because the verification was performed during this review; CHK007 remains open because accepting the corrected export is the System Owner's decision, not the reviewer's
- CHK019 and CHK020 deserve disproportionate attention: getting the shared-serial rule wrong merges 132 pairs of physically distinct instruments, and that error is not visible in any count
