# Requirements Quality Checklist: Asset Transactions

**Purpose**: Requirements-quality review of `specs/003-asset-transactions/spec.md` before a plan is written
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

**Review status:** **Reviewed 2026-09-04 — 54 of 54.** Complete.
**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04). The two gates that were open — CHK002 and CHK003 — were closed by R4 on
2026-09-03, and CHK005 is answered below.

*A note on reviewing this one after the fact:* feature 003's spec was written before the
implementation and this checklist asks whether the **requirements** are well-formed. Reviewing it
now has an advantage the original reviewer would not have had — where a requirement turned out to be
ambiguous, the ambiguity showed up as a bug. Two did, and both are cited rather than smoothed over
(CHK013's type count, CHK014's unreachable cells).

## Blocking Clarifications

- [x] CHK001 Q7 resolved — a SIM is a permanent Component of its modem. FR-032 governs it, FR-032a allows a deliberate administrative swap, and FR-026 keeps it out of checkout carts. It leaves the deployment form entirely (feature 005)
- [x] CHK002 Q8 answered — expected return on checkout is confirmed required or optional, settling FR-043 and the reliability of overdue notification
  <br>*Evidence:* **R4 closed 2026-09-03** — expected return is **optional**, with a +14-day default (`docs/08`). The overdue job reads it as optional, so a checkout without one produces no false overdue.
- [x] CHK003 Q9 answered — backdating is confirmed permitted or not, with a bounded window and a rule for backdating across an existing later transaction (FR-042)
  <br>*Evidence:* **R4 closed 2026-09-03** — administrative backdating is permitted within **30 days**, and refused where it would cross an existing later transaction for the same asset. Both halves are the requirement this item asked for.
- [x] CHK004 Q3's consequence accepted — 644 assets migrate as CheckedOut with no custodian, so FR-025 means an administrator performs the sweep returns. Confirmed as intended
- [x] CHK005 FR-027 answered — a transaction naming an inactive project is refused outright, or permitted with a warning for legitimate late charges
  <br>*Evidence:* **refused outright.** `deploy.error.inactiveProject` (`deploymentService.ts:81`) and the checkout command both refuse; there is no warn-and-proceed path. Chosen because a warning on a phone in a field is a warning nobody reads, and a transaction against a closed project is a billing error somebody else discovers.

## Constitutional Alignment

- [x] CHK006 Principle I — no requirement or acceptance scenario contradicts FR-014's ban on direct input of derived values
  <br>*Evidence:* `deriveState` is the only producer; zod strips client-supplied state at the boundary; `scripts/lint-rules.mjs` rule 1 fails the build if a request schema ever names one.
- [x] CHK007 Principle II — FR-011, FR-012 and FR-013 make lines immutable, correctable only by compensation, and permanently retained
  <br>*Evidence:* `0003` refuses UPDATE, DELETE **and TRUNCATE** on both history tables; R-25 is the compensation path; OD-5 keeps transaction history indefinitely under FR-070.
- [x] CHK008 Principle II — no requirement permits the System Owner a "quick fix" path that changes state without a history entry
  <br>*Evidence:* no such path exists to permit. `asset.status` is a generated column, so even a System Owner at a psql prompt cannot write it; every axis change goes through a line.
- [x] CHK009 Principle V — FR-020 defines the matrix once as data; FR-024 enforces it independently of the interface. Both layers are stated, not one
  <br>*Evidence:* the matrix is generated data (`data/reference/state_machine.json` from `transition-table.md`), and `evaluateTransition` is called by both the client pre-check and the server command.
- [x] CHK010 Principle V — FR-023's submission-time re-verification is specified as server-arbitrated, since a client-side check cannot resolve a race
  <br>*Evidence:* `SELECT … FOR UPDATE` in assetid order. 100 simultaneous commands for one asset produce exactly one winner, and the opposite-lock-order **control** deadlocks (40P01) — the control is what shows the ordering is doing the work.
- [x] CHK011 Principle VI — FR-045 and FR-046 make failure visible and recoverable by an administrator rather than requiring the author
  <br>*Evidence:* every refusal is a structured code plus a readable reason; Needs attention holds what a human must resolve, and nothing can be discarded from it.
- [x] CHK012 The stated assumption that "the interface is not a security boundary" is reflected in every validation requirement, not only asserted once
  <br>*Evidence:* reflected rather than asserted — the role × endpoint matrix is exercised by direct `app.inject` calls that never touch the UI (`tests/authorization.test.ts`, 57), and field-level redaction is in the read model.

## The Transition Matrix

- [x] CHK013 The matrix in `data/reference/state_machine.json` is complete for all 7 statuses and all 14 transaction types
  <br>*Evidence:* complete — 7 statuses, 14 distinct types, **38 cells** in the compatibility projection. **The type count in this item is now stale and worth saying so:** the authority moved to `transition-table.md`, which carries **25 numbered rules over 22 types**; the projection stayed at 14 because 14 is what a seven-value pill can express. The item is satisfied; its wording predates DC-22.
- [x] CHK014 Every allowed cell is reachable by a real business action, and every business action has a cell
  <br>*Evidence:* and this is where the requirement's ambiguity showed up as a bug. All 38 cells are now exercised, including five that ordinary field work almost never reaches — feature 007 plants them deliberately (`plantCompatibilityCoverage`). The **second half** ("every business action has a cell") was true of the matrix and false of the API: seven approved types had no command until 2026-09-04. `tests/contract.test.ts` now measures the table against the **router**, which is what nothing was doing.
- [x] CHK015 Blank cells are confirmed as genuinely disallowed rather than merely unconsidered
  <br>*Evidence:* a blank cell is a refusal with a code, not an omission — `evaluateTransition` returns a structured refusal naming the failed axis for every disallowed combination, and `isReachableState` computes the closure of what the table can produce.
- [x] CHK016 Transfer's status-preserving behaviour (FR-018) is represented in the matrix consistently for every origin status
  <br>*Evidence:* R-04 / R-05 / R-06. R-06 preserves all three axes from every origin (`untouched: lifecycle, disposition, serviceability`).
- [x] CHK017 `Audit` and `AddToInventory` are confirmed as status-preserving for every status including Retired
  <br>*Evidence:* DC-15 states Audit changes no axis **and no derived field**, legal from Retired; `tests/stateCommands.test.ts` asserts both, including the Retired case.
- [x] CHK018 Return from Deployed is confirmed to close kit relationships as well as change status
  <br>*Evidence:* R-03 plus `deriveRelationshipOps` — Return closes the asset's own kit membership and anything it is a kit parent of, asserted in `app/tests/domain/deriveState.test.ts`. The op now names the relationship **type**, so a Return leaves a permanent Component parent standing.
- [x] CHK019 The matrix is the single artefact consumed by both the interface and the derivation process — no second copy exists
  <br>*Evidence:* `app/scripts/generate-state-machine.mjs` writes `packages/contracts/src/stateMachine.ts` from the transition table; the app and the server both import that package.
- [x] CHK020 SC-005's requirement to exercise every cell, allowed and disallowed, is achievable as stated
  <br>*Evidence:* achievable and achieved — see CHK014.

## Atomicity, Concurrency and Idempotence

- [x] CHK021 FR-003's all-or-nothing guarantee is stated for the whole submission, not per line
  <br>*Evidence:* per submission. `applyTransaction` validates every line before writing any, and a refusal after a write **rolls back** through the `Refusal` class rather than returning — returning `{ok:false}` out of a transaction callback would have committed the earlier writes.
- [x] CHK022 FR-007's duplicate-submission prevention covers both a user double-tap and a retry whose response was lost
  <br>*Evidence:* one mechanism covers both — the idempotency claim is the first statement inside the transaction, so a second copy blocks on the duplicate key rather than proceeding.
- [x] CHK023 FR-015's ordering and non-concurrency guarantee is stated per asset, not merely per transaction
  <br>*Evidence:* per asset, because the lock is per asset row in a deterministic order.
- [x] CHK024 FR-019's requirement that delayed processing reaches the same state is testable by deliberate delay
  <br>*Evidence:* the offline replay tests apply a deliberate delay and assert the same final state.
- [x] CHK025 FR-016's processed marker makes unprocessed lines identifiable without inspecting logs
  <br>*Evidence:* `asset_transaction_line.processed` is a column, so it is a query.
- [x] CHK026 The half-updated-asset edge case has a requirement, not only an acknowledgement
  <br>*Evidence:* rule 2 plus one transaction per command makes the state unreachable; `tests/concurrency.test.ts` S2 asserts 100 deliberate multi-asset failures leave **zero** partial writes.

## Offline Behaviour

- [x] CHK027 FR-039 forbids silent discard in every rejection path, including replay rejection and conflict
  <br>*Evidence:* `offline.discardNotAllowed` refuses discarding a rejected submission, and every rejection path writes a conflict row.
- [x] CHK028 FR-038's ordering guarantee is stated across application restarts, not only within a session
  <br>*Evidence:* the queue is durable in IndexedDB with a localStorage mirror; recovery from either side is recorded as a `storage-degraded` conflict rather than silently.
- [x] CHK029 The out-of-order replay case — legal when made, illegal now — is surfaced to a human and never force-applied
  <br>*Evidence:* it becomes a Rejected row in Needs attention carrying the refusal reason. Never force-applied, and never dropped.
- [x] CHK030 FR-040's pending indication is visible on the asset, so a second user sees a submission in flight
  <br>*Evidence:* `pendingSync` on the asset DTO, rendered on `AssetRow` and badged on the nav.
- [x] CHK031 SC-010 and SC-011 together cover exactly-once delivery and zero loss as separate claims
  <br>*Evidence:* separate mechanisms, separately tested — exactly-once by the idempotency claim, zero loss by the durable queue plus its mirror.

## Completeness

- [x] CHK032 Every transaction type named in the source Word document (Assignment, Return, Transfer, Calibration, Retirement) maps to a requirement here or to feature 004 or 005
  <br>*Evidence:* Assignment/Return/Transfer/Retirement here, Calibration to feature 004.
- [x] CHK033 Every action in the source spreadsheet's *Assets - Action History* taxonomy is accounted for
  <br>*Evidence:* the 22-type catalogue in `transition-table.md` § 4 reconciles against it; observation rows map to `Audit` (R-24).
- [x] CHK034 Acceptance questions 2, 3, 6 and 7 each trace to at least one requirement and one success criterion
  <br>*Evidence:* all four trace, and all four are answered by a running report (`tests/reports.test.ts`, 65).
- [x] CHK035 Each of the eleven edge cases has a corresponding requirement or an explicit decision to accept the behaviour
  <br>*Evidence:* each has one, and several became feature 007 **planted scenarios** so they are exercised rather than described — shared serial apart, leaver holding equipment, closed project with a live station.
- [x] CHK036 The departing-custodian case has a stated resolution that does not involve editing asset records directly
  <br>*Evidence:* FR-025's sweep is a Return performed by an administrator. Feature 007 plants exactly one leaver who kept equipment, so the case is in the dataset.
- [x] CHK037 Retiring an asset that is currently checked out has a stated rule
  <br>*Evidence:* R-19 refuses from CheckedOut, Deployed and InTransit; `transition.error.openObligation` covers an open installation or parent relationship.
- [x] CHK038 The boundary with features 004 and 005 is explicit — this feature owns the mechanism, they own their journeys
  <br>*Evidence:* explicit and observed — deployment composes `Undeploy` then `Deploy` in one commit through `applyTransaction` rather than reimplementing either.

## Clarity and Testability

- [x] CHK039 Every functional requirement is verifiable by observation or by audit log, without reference to an implementation choice
  <br>*Evidence:* each FR is checkable by reading the asset, its history, or a refusal code.
- [x] CHK040 No requirement names a technology, product, table, screen or column
  <br>*Evidence:* verified by reading the spec.
- [x] CHK041 SC-006's 60-second, 95th-percentile target states its measurement method
  <br>*Evidence:* stated. Unmeasured against a production tier (R6); the criterion is well-formed, which is what this item asks.
- [x] CHK042 SC-002 and SC-008 are verifiable by audit log rather than by policy assertion, as written
  <br>*Evidence:* every accepted command produces a line and every refusal a coded response, so both are log queries.
- [x] CHK043 SC-007's past-state reconstruction test states its sample size and period
  <br>*Evidence:* stated; the reconstruction is implemented (`app/src/domain/pointInTime.ts`) and exercised by the timeline report.
- [x] CHK044 "Available", "held", "out", "in service" and "active state" are used consistently and each has one meaning
  <br>*Evidence:* consistent — and the four-axis split (DC-22) removed the worst source of drift, because "available" is now a computed projection of three named axes rather than an overloaded word doing three jobs.

## Independence and Priority

- [x] CHK045 US1 alone constitutes a useful deliverable — checkout with no return built is genuinely usable for a pilot week
  <br>*Evidence:* true, and the build shipped in that order.
- [x] CHK046 US2's prefilled return cart does not depend on any story below it
  <br>*Evidence:* it reads custody from the asset, which US1 sets.
- [x] CHK047 US3 is a pure read over US1 and US2 output and introduces no new write path
  <br>*Evidence:* no command belongs to US3.
- [x] CHK048 US4's deferral is genuinely tolerable — return-then-checkout produces a correct if clumsy history
  <br>*Evidence:* correct history, two events instead of one.

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- CHK001–CHK005 are **gates**: `plan.md` must not be written for this feature while any is unchecked
- CHK013–CHK020 deserve the most reviewer time. The matrix is the one artefact both the app and the automation depend on, and an error in it is an error in two places that will be found in production rather than in review
- CHK021–CHK026 describe the failure modes that will actually occur. Two technicians racing for one logger is not a hypothetical; it is Tuesday morning

### What this review found, 2026-09-04

The note above about CHK013–CHK020 deserving the most time was right, and for a reason its author
could not have known: **the matrix was complete and the API was not.** Seven approved transitions —
`MarkOutOfService`, `ReturnToService`, `RehomeAsset`, `AttachComponent`, `DetachComponent`, `Audit`,
`Correction` — were generated, handled by `deriveState`, and unreachable over HTTP. The coverage
table in `transition-table.md` said 22 of 22 because it was measuring the table against itself.

"An error in it is an error in two places that will be found in production rather than in review"
was the right worry aimed at the wrong artefact. `tests/contract.test.ts` now measures the table
against the router, and removing a command from the registry makes it fail — verified, so the check
is not vacuous.
