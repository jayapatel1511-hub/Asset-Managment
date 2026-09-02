# Requirements Quality Checklist: Asset Transactions

**Purpose**: Requirements-quality review of `specs/003-asset-transactions/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Blocking Clarifications

- [x] CHK001 Q7 resolved — a SIM is a permanent Component of its modem. FR-032 governs it, FR-032a allows a deliberate administrative swap, and FR-026 keeps it out of checkout carts. It leaves the deployment form entirely (feature 005)
- [ ] CHK002 Q8 answered — expected return on checkout is confirmed required or optional, settling FR-043 and the reliability of overdue notification
- [ ] CHK003 Q9 answered — backdating is confirmed permitted or not, with a bounded window and a rule for backdating across an existing later transaction (FR-042)
- [x] CHK004 Q3's consequence accepted — 644 assets migrate as CheckedOut with no custodian, so FR-025 means an administrator performs the sweep returns. Confirmed as intended
- [ ] CHK005 FR-027 answered — a transaction naming an inactive project is refused outright, or permitted with a warning for legitimate late charges

## Constitutional Alignment

- [ ] CHK006 Principle I — FR-014 forbids direct input of derived values, and no requirement or acceptance scenario anywhere in this spec contradicts it
- [ ] CHK007 Principle II — FR-011, FR-012 and FR-013 make lines immutable, correctable only by compensation, and permanently retained
- [ ] CHK008 Principle II — no requirement permits the System Owner a "quick fix" path that changes state without a history entry
- [ ] CHK009 Principle V — FR-020 defines the matrix once as data; FR-024 enforces it independently of the interface. Both layers are stated, not one
- [ ] CHK010 Principle V — FR-023's submission-time re-verification is specified as server-arbitrated, since a client-side check cannot resolve a race
- [ ] CHK011 Principle VI — FR-045 and FR-046 make failure visible and recoverable by an administrator rather than requiring the author
- [ ] CHK012 The stated assumption that "the interface is not a security boundary" is reflected in every validation requirement, not only asserted once

## The Transition Matrix

- [ ] CHK013 The matrix in `data/reference/state_machine.json` is complete for all 7 statuses and all 14 transaction types
- [ ] CHK014 Every allowed cell is reachable by a real business action, and every business action has a cell
- [ ] CHK015 Blank cells are confirmed as genuinely disallowed rather than merely unconsidered
- [ ] CHK016 Transfer's status-preserving behaviour (FR-018) is represented in the matrix consistently for every origin status
- [ ] CHK017 `Audit` and `AddToInventory` are confirmed as status-preserving for every status including Retired
- [ ] CHK018 Return from Deployed is confirmed to close kit relationships as well as change status
- [ ] CHK019 The matrix is the single artefact consumed by both the interface and the derivation process — no second copy exists
- [ ] CHK020 SC-005's requirement to exercise every cell, allowed and disallowed, is achievable as stated

## Atomicity, Concurrency and Idempotence

- [ ] CHK021 FR-003's all-or-nothing guarantee is stated for the whole submission, not per line
- [ ] CHK022 FR-007's duplicate-submission prevention covers both a user double-tap and a retry whose response was lost
- [ ] CHK023 FR-015's ordering and non-concurrency guarantee is stated per asset, not merely per transaction
- [ ] CHK024 FR-019's requirement that delayed processing reaches the same state is testable by deliberate delay
- [ ] CHK025 FR-016's processed marker makes unprocessed lines identifiable without inspecting logs
- [ ] CHK026 The half-updated-asset edge case has a requirement, not only an acknowledgement

## Offline Behaviour

- [ ] CHK027 FR-039 forbids silent discard in every rejection path, including replay rejection and conflict
- [ ] CHK028 FR-038's ordering guarantee is stated across application restarts, not only within a session
- [ ] CHK029 The out-of-order replay case — legal when made, illegal now — is surfaced to a human and never force-applied
- [ ] CHK030 FR-040's pending indication is visible on the asset, so a second user sees a submission in flight
- [ ] CHK031 SC-010 and SC-011 together cover exactly-once delivery and zero loss as separate claims

## Completeness

- [ ] CHK032 Every transaction type named in the source Word document (Assignment, Return, Transfer, Calibration, Retirement) maps to a requirement here or to feature 004 or 005
- [ ] CHK033 Every action in the source spreadsheet's *Assets - Action History* taxonomy is accounted for
- [ ] CHK034 Acceptance questions 2, 3, 6 and 7 each trace to at least one requirement and one success criterion
- [ ] CHK035 Each of the eleven edge cases has a corresponding requirement or an explicit decision to accept the behaviour
- [ ] CHK036 The departing-custodian case has a stated resolution that does not involve editing asset records directly
- [ ] CHK037 Retiring an asset that is currently checked out has a stated rule
- [ ] CHK038 The boundary with features 004 and 005 is explicit — this feature owns the mechanism, they own their journeys

## Clarity and Testability

- [ ] CHK039 Every functional requirement is verifiable by observation or by audit log, without reference to an implementation choice
- [ ] CHK040 No requirement names a technology, product, table, screen or column
- [ ] CHK041 SC-006's 60-second, 95th-percentile target states its measurement method
- [ ] CHK042 SC-002 and SC-008 are verifiable by audit log rather than by policy assertion, as written
- [ ] CHK043 SC-007's past-state reconstruction test states its sample size and period
- [ ] CHK044 "Available", "held", "out", "in service" and "active state" are used consistently and each has one meaning

## Independence and Priority

- [ ] CHK045 US1 alone constitutes a useful deliverable — checkout with no return built is genuinely usable for a pilot week
- [ ] CHK046 US2's prefilled return cart does not depend on any story below it
- [ ] CHK047 US3 is a pure read over US1 and US2 output and introduces no new write path
- [ ] CHK048 US4's deferral is genuinely tolerable — return-then-checkout produces a correct if clumsy history
- [ ] CHK049 US5's P5 ranking is justified by the stated reasoning that a wrong offline implementation is worse than none
- [ ] CHK050 No user story depends on a story of lower priority

## Consistency With Prior Design

- [ ] CHK051 Requirements do not contradict `docs/03-automation.md`'s flow F1; every intentional divergence is recorded in `docs/08-decisions.md`
- [ ] CHK052 The entities named here reconcile with `docs/01-data-model.md`'s transaction, line and relationship tables
- [ ] CHK053 The privilege model implied by FR-011 and FR-025 reconciles with `docs/05-security.md`
- [ ] CHK054 The kit-capture-at-checkout approach matches the source spreadsheet's own stated design rather than reinventing it

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- CHK001–CHK005 are **gates**: `plan.md` must not be written for this feature while any is unchecked
- CHK013–CHK020 deserve the most reviewer time. The matrix is the one artefact both the app and the automation depend on, and an error in it is an error in two places that will be found in production rather than in review
- CHK021–CHK026 describe the failure modes that will actually occur. Two technicians racing for one logger is not a hypothetical; it is Tuesday morning
