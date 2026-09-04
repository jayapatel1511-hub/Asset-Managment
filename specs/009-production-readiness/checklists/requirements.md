# Production Readiness Requirements Checklist

**Feature:** `009-production-readiness`
**Purpose:** Review gate before a plan, tenant implementation or pilot approval is accepted.

**Review status:** **Reviewed 2026-09-04 — 38 of 55.** Seventeen are not checked: CHK025, CHK027,
CHK031, CHK033–CHK041, CHK043, CHK044, CHK050, CHK051 and CHK055. They include D18
implementation/evidence gaps, external device/tenant/approval gates, one cutover-specification gap,
and one open product decision. Each says which; none is silently treated as passed.

**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04).

**Bar applied:** this is a *readiness* checklist, so its items assert states of the world rather
than the well-formedness of a requirement. An item is checked only when the thing it describes is
**true and evidenced**, not merely specified. That is a stricter bar than feature 010's checklist
uses, and it is the right one here — a readiness gate that passes on intent is not a gate.

**Evidence runs:** `scripts/verify.sh` — 555 server tests against PostgreSQL 17, 543 against PGlite,
545 client tests, plus lint and a client build, all green at review time.

## Transaction integrity

- [x] CHK001 One authoritative synchronous operation owns each state-changing business event.
  <br>*Evidence:* `POST /api/commands/:type` and the five dedicated command routes. `tests/contract.test.ts` now asserts **every** type in the transition table is reachable, and proves that assertion is not vacuous.
- [x] CHK002 Multi-asset header, lines, derived fields and relationships commit together or not at all.
  <br>*Evidence:* one `db.transaction` per command; a refusal after a partial write rolls back through the `Refusal` class. `tests/concurrency.test.ts` S2: 100 deliberate multi-asset failures leave zero partial writes.
- [x] CHK003 The server reloads every affected asset and open relationship at submission time.
  <br>*Evidence:* `lockAssets` re-reads under `FOR UPDATE`; the cart's own view is never trusted (FR-023).
- [x] CHK004 One invalid asset refuses the complete multi-asset request.
  <br>*Evidence:* pass 1 of `applyTransaction` validates every line before writing anything, naming the offending asset.
- [x] CHK005 Before/after snapshots and side effects are server-computed.
  <br>*Evidence:* `deriveState` is the only producer; zod strips client-supplied state at the boundary, and `scripts/lint-rules.mjs` rule 1 fails the build if a schema ever accepts one.
- [x] CHK006 Concurrent incompatible requests are arbitrated at the server.
  <br>*Evidence:* 100 simultaneous commands for an overlapping asset produce exactly one winner, against real PostgreSQL. The opposite-lock-order control deadlocks (40P01), which is what shows the ordering is load-bearing.
- [x] CHK007 A unique client submission identifier is enforced.
  <br>*Evidence:* primary key on `command_idempotency`; the insert **is** the claim, so two copies of one submission can never both run.
- [x] CHK008 Same identifier/same payload returns the original result; changed payload is refused.
  <br>*Evidence:* `answerFromStore`; `command.error.idempotencyPayloadMismatch`. Applies to jobs and governed exports too, both across a restart.
- [x] CHK009 Accepted transaction headers and lines are immutable.
  <br>*Evidence:* `0003` refuses UPDATE, DELETE **and TRUNCATE** — the statement-level trigger closes the hole a row trigger structurally cannot see. Asserted by attempting an UPDATE in `tests/stateCommands.test.ts`.
- [x] CHK010 Corrections are compensating events that reference the original.
  <br>*Evidence:* R-25 implemented 2026-09-04; `correctionoftransaction` is NOT NULL on a Correction and NULL on everything else, both as CHECK constraints (`0017`). A Correction row with no link is refused by the database.
- [x] CHK011 Asynchronous flows are reconciliation/alerting paths, not normal partial application.
  <br>*Evidence:* the outbox row commits **inside** the business event's transaction; handlers are best-effort and a failing handler does not fail the command (`tests/outbox.test.ts`).

## State and identity

- [x] CHK012 Lifecycle, disposition, serviceability and calibration currency are independently representable.
  <br>*Evidence:* three stored axes (`0016`), calibration currency derived; six axis columns per transaction line. **And now on the wire** — the DTO carried only the collapsed pill until `docs/08` **D9**, which is exactly the failure this item exists to catch.
- [x] CHK013 Fault/repair actions preserve valid custody, project and location facts.
  <br>*Evidence:* R-12/R-13 leave the other axes untouched; T035 in `tests/stateCommands.test.ts` faults a **deployed** component and asserts disposition, location, custodian and project are unchanged.
- [x] CHK014 Availability uses all required dimensions rather than one catch-all status.
  <br>*Evidence:* the reporting views compute availability from the axes; `v_calibration_currency` is separate from disposition.
- [x] CHK015 Every disposition, including transit and missing/found, has complete entry and exit paths.
  <br>*Evidence:* the transition table's 27 variants cover all six dispositions in both directions; `InTransit` enters by R-04 and leaves by R-05, `Missing` by R-16 and R-17a/b/c. `isReachableState` computes the closure and the correction guard uses it.
- [x] CHK016 Asset ID sequence allocation and asset creation occur in one server operation.
  <br>*Evidence:* `consumeSequence` runs inside `registerAsset`'s transaction; a 100-way burst mints 100 unique IDs.
- [x] CHK017 No browser path uses elevated service identity to update the sequence.
  <br>*Evidence:* there is no browser-reachable sequence endpoint at all — `GET /api/assets/next-id` is a **preview** that consumes nothing. The `svc-ams` high-privilege flow account is parked with the Power Platform.
- [x] CHK018 Temporary and legacy tags are searchable aliases.
  <br>*Evidence:* `asset_identifier` (`0014`); `lockAssets` and `loadAsset` both resolve through it, so a scan of an old tag finds the asset.
- [x] CHK019 Canonical Asset ID is immutable after assignment.
  <br>*Evidence:* `0004` refuses any rename, with one named exception (a TMP tag whose alias already exists) which is the sanctioned completion path.

## Calibration and components

- [x] CHK020 Current calibration dates use the latest qualifying record by calibration date.
  <br>*Evidence:* the summary recomputation orders by `calibrationdate`, not by entry time (FR-036).
- [x] CHK021 Failed calibration does not advance due date or return equipment to service.
  <br>*Evidence:* R-11 is the `calibrationFail` variant and sets `serviceability = NeedsRepair`; FR-037 states it.
- [x] CHK022 Correction, reassociation, replacement and voiding recalculate current dates.
  <br>*Evidence:* FR-036 names all four; document replacement and voiding both trigger recomputation (`documents/service.ts`).
- [x] CHK023 Legacy due-only records are represented without an invented calibration date.
  <br>*Evidence:* `docs/15`:586 — `calibration_date` is "nullable for legacy due-only record". The migration keeps them unmatched rather than inventing a date. Authorized Administration queues surface the exception and an approved Reports projection may aggregate it; Field Home never receives the fleet count.
- [x] CHK024 Physical receipt from the lab is distinguished from recording evidence unless one action confirms both.
  <br>*Evidence:* `ReturnFromCalibration` (R-10/R-11) is its own transaction type, separate from `RecordCalibration`; FR-038 requires it.
- [ ] CHK025 Q18 permanent-component calibration behavior is approved and reflected consistently.
  <br>*Not checked.* Q18 is implemented on the **no-lines** reading and that reading is *assumed*, not approved — `docs/08`:45 records it as "ASSUMED, pending Jay's confirmation". It is reflected consistently (enforced structurally in `Ledger.apply` and mirrored by `mirrorComponentChildren`), so the second half holds; the first does not. **This is a product confirmation, and unlike R5 it was not in the set Jay asked this build to close** — it changes what the generator produces, so it is left for an explicit answer.
- [x] CHK026 Damage, missing, retirement, replacement and overdue behavior are defined for permanent components.
  <br>*Evidence:* a permanent component mirrors its parent for status, location, custodian and project (F1 step 5, `mirrorComponentChildren`); it carries no line of its own; `AttachComponent`/`DetachComponent` (R-20/R-21, implemented 2026-09-04) are the only ways in and out, and R-19 refuses retirement with an open parent relationship.

## Security, cache and reporting

- [ ] CHK027 The full D18 identity × tenant/environment × workspace × purpose × capability × row-scope ×
  projection matrix passes direct API, document, export and report tests independent of the app.
  <br>*Not checked.* The existing `tests/authorization.test.ts` (57) and
  `tests/fieldSecurity.test.ts` (9) prove a legacy role/office subset through `app.inject`; they do not yet
  prove workspace eligibility, purpose/capability intersection, exact projection keys, evidence-document
  ACLs, zero-fetch direct-route behavior or cache revocation.
- [x] CHK028 Administrator scope is explicitly global or enforced by office at the data/server layer.
  <br>*Evidence:* **R5 decided 2026-09-04** — OfficeAdmin office-scoped, SystemOwner global (`docs/08` § R5). Enforced server-side by `scopeCovers`, and the one hole this decision exposed — registration accepting any `homeoffice` from the body — is closed and tested.
- [x] CHK029 Relationship cycles, self-parenting, second open parent and historical edits are refused server-side.
  <br>*Evidence:* `0005` (acyclicity), `rel_one_open_parent`, `0003` (historical edits); `attachComponent` also refuses self-parenting with a readable message before the database has to.
- [x] CHK030 Routine automation uses a least-privilege role.
  <br>*Evidence:* the outbox worker and scheduler run in-process under no user identity and write only outbox/alert rows; the `svc-ams` high-privilege account is parked. Audit rows from jobs carry `actor_type: 'Job'`, distinct from `'User'`.
- [ ] CHK031 Cache and queues are partitioned by environment, tenant, signed-in user, workspace and
  projection version, and become inaccessible after identity, workspace, row-scope or capability change.
  <br>*Partially evidenced.* Tenant + environment + user object ID are covered by `resolvePartition`
  (11 tests). Workspace/projection partitioning and scope/capability-revocation purge are not evidenced.
- [x] CHK032 Identity change prevents access to and replay of the prior user's data.
  <br>*Evidence:* the previous user's queue is quarantined and filed into **their own** partition as held rows; replay refuses per command under a different `objectId`.
- [ ] CHK033 Field Work responses and local storage match the exact D18 allowlist and contain none of the
  forbidden calibration/evidence, maintenance, cost, performer, data-quality, audit, secured-network,
  free-text or internal-identifier fields.
  <br>*Partially evidenced.* Secured SIM/network fields are redacted before the response and marked
  `offlineCacheAllowed: false`; the broader Field Work projection has not been proved.
- [ ] CHK034 General Reports responses and exports match their exact allowlist and contain no secured or
  evidential fields outside an approved reporting purpose.
  <br>*Partially evidenced.* Existing report views exclude secured SIM/network columns and export templates
  declare `excludesRestrictedIdentifiers: true`; D18 cost, performer, free-text, evidence-link, audit and
  internal-identifier exclusions have not been proved.
- [ ] CHK035 Reporting works as a separate read-only Reports workspace without the Power Apps runtime;
  ReportReader-only accounts receive no Work, Scan or Administration navigation or data requests.
  <br>*Partially evidenced.* Seven in-app reports exist and Power BI is optional, but the current local UI
  still composes ReportReader inside the Field shell. Workspace isolation is not passed.
- [ ] CHK036 Report identity, authorization, recipients and licensing are approved and tested.
  <br>*Not checked.* Identity and legacy role authorization are tested (ReportReader is 403 on every command endpoint). **Recipients and licensing are not approved** — who receives which report remains Q11/D18 policy, while real Entra/Azure licensing and assignment remain R6. Q17's former Power Apps licensing question is closed and no longer blocks the web target.

## Hosted device verification

*All seven of these need published builds on real devices. The **logic** each depends on is now
testable — `app/src/offline/capabilities.ts` decides what a browser combination means, and
`OfflineBar` says it — but a recorded behaviour needs a recording. This is T053 and it is a pilot
gate, unchanged.*

- [ ] CHK037 Published iOS online-to-offline behavior is recorded. — needs an iOS device.
- [ ] CHK038 Published Android online-to-offline behavior is recorded. — needs an Android device.
- [ ] CHK039 Cold reopen and device restart behavior are recorded. — needs a device restart.
- [ ] CHK040 Authentication expiry and identity-change cases pass.
  <br>*Not checked, and closer than the rest:* identity change is implemented and unit-tested; **authentication expiry** needs a real token lifetime, which is R6.
- [ ] CHK041 Camera permission denied/granted/interrupted cases pass. — needs a camera.
- [x] CHK042 Conflict replay remains visible and is never silently discarded.
  <br>*Evidence:* this one is **not** device-dependent — `recordConflict` writes a row for every conflict, Needs attention shows them, and `offline.discardNotAllowed` refuses discarding a rejected submission. 10 service-worker-update tests assert an update never applies itself over a non-empty queue.
- [ ] CHK043 Any unsupported behavior and ineligible destination is absent from Field navigation and pilot acceptance criteria.
  <br>*Not checked.* The current mock still puts Reservations and Settings placeholders in Field More and mixes other ineligible destinations into the Field shell. D18 requires unsupported or unauthorized destinations to be absent, not disabled or labelled "Coming soon"; the target is specified but the current composition is nonconforming.

## Migration, release and recovery

- [ ] CHK044 Rehearsal snapshot, final delta, freeze time and legacy read-only transition are documented.
  <br>*Not checked.* FR-057 names all four as requirements and `docs/04-migration.md` describes the sequence, but the **cutover runbook** — actual freeze time, who sets the legacy export read-only, in what order — is not written. **This is the one real specification gap in this section**, and it needs a cutover date to be written against.
- [x] CHK045 Every post-rehearsal source change is loaded or reported.
  <br>*Evidence:* `npm run migrate:load` reconciles per table and reports a **delta with a verdict**, distinguishing expected append-only growth from a table that is SHORT. A short table fails with exit code 1.
- [x] CHK046 Ambiguous calibration evidence remains unmatched until confirmed.
  <br>*Evidence:* `migration/05_calibrations.py` leaves them unmatched and reports them; FR-059 requires it.
- [x] CHK047 Model-review and conflict-report sign-offs block production load when absent.
  <br>*Evidence:* both files carry a Production gate section, `specs/README.md` names them as hard gates, and **both are now reviewed and signed 2026-09-04** — see the sign-off sections in `migration/reports/02_conflicts.md` and `03_models_review.md`.
- [x] CHK048 Final source/staged/target reconciliation accounts for every difference.
  <br>*Evidence:* the load report's Verdict column accounts for every table: `ok`, `ok — n rows added since the load` (append-only growth, explained), or `SHORT`. No difference is left unlabelled.
- [x] CHK049 App rollback, platform recovery and data recovery are separate procedures.
  <br>*Evidence:* FR-049 requires the separation. Two of the three are written where they belong: every migration header states its application-rollback consequence, and `server/README.md` § Refusals carries the command-path semantics. Platform recovery is assigned to `infra/` runbooks (R6).
- [ ] CHK050 Recovery objectives, backup ownership and restore tests are approved.
  <br>*Not checked.* All three are R6: RTO/RPO is a budget decision, backup ownership is an Englobe IT assignment, and a restore test needs something to restore.
- [ ] CHK051 Calibration certificate retention and restore pass a rehearsal.
  <br>*Not checked.* **Retention is now decided** — `calibration.certificate` is Retain/indefinite/approved under OD-5 — and the reconciliation half is built (`documents/reconcile.ts` reports both directions of mismatch). The **restore rehearsal** needs a store to restore into (R6).

## Status and evidence

- [x] CHK052 Feature status uses the approved maturity vocabulary.
  <br>*Evidence:* `specs/REMAINING-WORK.md` § Progress labels defines it, and the status tables use it — including the negative claims ("None of the above is *Azure Integrated*, *Security Verified*, *Device Verified*, *Migration Rehearsed* or *Pilot Accepted*").
- [x] CHK053 No feature is called production-built while tenant or verification work is stubbed.
  <br>*Evidence:* the status entries say *API Implemented*, *implemented — unprovisioned*, *implemented behind an interface*, *not started*. `docs/24` § 0 and § 4 restate what is not claimed, and this build added *"cannot be self-approved, and this is why"* to `docs/08` for R6 rather than quietly marking it done.
- [x] CHK054 Every gate has a named owner, date, evidence link and pass/fail result.
  <br>*Evidence:* the two migration gates now carry all four (see CHK047). This checklist and feature 010's carry a reviewer, a date, per-item evidence, and an explicit owner for every unchecked item. `docs/24` § 4 tabulates owners.
- [ ] CHK055 All seven programme acceptance questions are answered from tenant data before Production Accepted.
  <br>*Not checked, and correctly so.* All seven are answered — from **migrated real data** in a local PostgreSQL (`tests/reports.test.ts`, 65). "From tenant data" means from the production tenant, which does not exist. This item is a Production Accepted gate and Production Accepted is not claimed.

---

## Summary of the seventeen unchecked items

| Item | Why | Owner |
|---|---|---|
| CHK025 Q18 component calibration | implemented on an **assumed** reading; changes the generator if answered the other way | Jay — a product confirmation |
| CHK027, CHK031, CHK033–CHK035 D18 enforcement | workspace/purpose/capability/row/projection, response allowlists, zero-fetch denial and cache revocation are specified but not fully implemented or proved | Product/API/QA |
| CHK036 report recipients and licensing | recipients remain Q11/D18 policy; real Entra/Azure licensing remains R6 | Jay + Englobe IT |
| CHK037–CHK039, CHK041 device behaviour | needs iOS, Android, a restart, a camera | pilot (T053) |
| CHK040 authentication expiry | needs a real token lifetime | Englobe IT (R6) |
| CHK043 Field destination removal | current mock still shows unsupported/ineligible placeholders and mixed-workspace navigation | Product/UI/QA |
| CHK044 cutover runbook | **specification gap** — needs a cutover date | Jay + Englobe IT |
| CHK050 recovery objectives and backup ownership | budget and assignment | Englobe IT (R6) |
| CHK051 certificate restore rehearsal | retention decided; restore needs a store | Englobe IT (R6) |
| CHK055 seven questions from tenant data | answered from migrated real data locally; the tenant does not exist | Englobe IT (R6) |

**One cutover-specification gap** (CHK044), **one product confirmation** (CHK025), six D18
implementation/conformance gaps, and the remaining external device, tenant, budget, licensing or
pilot gates. Not Run is not Passed.
