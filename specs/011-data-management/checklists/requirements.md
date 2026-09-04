# Requirements Checklist — Feature 011 Data Management & Stewardship

**Feature:** `011-data-management`
**Review status:** **Reviewed 2026-09-04 — 201 of 218.** Seventeen are not checked: CHK050, CHK076,
CHK107, CHK108, CHK141, CHK152, CHK160, CHK163–CHK165, CHK201, CHK204, CHK207, CHK208,
CHK210, CHK213 and CHK217. Seven reopen legacy role-only or over-broad read/export evidence against
D18; the rest need an environment, an alert destination, a pilot, or a performance decision.
**Rule:** A checked item means the requirement is explicit, internally consistent, testable, and
assigned. It does not mean implementation exists.

**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04), which also closed OD-2, OD-3, OD-4, OD-5, OD-6, OD-7, OD-8, OD-9 and
OD-11. Several items below were unreviewable until those decisions existed.

**Where implementation is cited, it runs:** `scripts/verify.sh` — 555 server tests against
PostgreSQL 17, 543 against PGlite, 545 client tests, plus lint and a client build, all green at
review time. Feature 011's own suites are `tests/dataManagement.test.ts` (15) and
`tests/dataManagementWrites.test.ts` (54).

---

## Scope and governance

- [x] CHK001 Data management is explicitly defined as an application capability, not unrestricted database administration.
  <br>`CLAUDE.md` rule 14; `docs/16` § 1. Enforced: `scripts/lint-rules.mjs` fails the build on a PATCH route, a table-parameterised route, or a `/api/sql`-shaped endpoint.
- [x] CHK002 The capability covers reference/master data, corrections, quality, bulk jobs, duplicates, lineage, exports, retention and reconciliation.
  <br>All nine are named in `docs/16` and all nine now have modules — `specs/011-…/tasks.md` § Ledger reconcile maps each to its file and tests.
- [x] CHK003 Data Owner, Data Steward, Office Admin, System Owner, Platform Operator and read-only audit responsibilities are defined.
  <br>`docs/16` § 4 table. Reflected in the dictionary's per-field `ownerRole` / `stewardRole` across 459 fields.
- [x] CHK004 Whether Data Steward is a distinct role is decided before authorization implementation.
  <br>**Decided 2026-09-04** — `docs/08` § OD-2: **not** a distinct role. Stewardship is a separately assigned capability bundle whose eligible ceilings are OfficeAdmin (assigned-office) and SystemOwner (global row ceiling); neither receives it automatically. Dictionary role columns are accountability labels, not authorization inputs.
- [x] CHK005 Every data domain has a named business owner and stewardship responsibility before production acceptance.
  <br>FR-001; every one of the 459 dictionary entries carries both, and `dictionaryCheck` fails on a missing one.
- [x] CHK006 Separation-of-duty operations and configurable approval thresholds are listed.
  <br>**Decided 2026-09-04** — `docs/08` § OD-3 lists exactly four operations and their thresholds.
- [x] CHK007 Requesters cannot self-approve configured high-impact operations.
  <br>FR-006/FR-031. Enforced in the **database**, not only in services: `change_request_no_self_approval`, `redirect_no_self_approval`, `legal_hold_no_self_release` (`0018`). Four tests assert the refusals.
- [x] CHK008 Office-scoped and global stewardship powers are distinguished.
  <br>**R5 decided 2026-09-04.** `isGlobalScope` / `scopeCovers`; a Toronto admin is refused an Ottawa issue and an Ottawa correction, both tested.
- [x] CHK009 Platform Operators can execute/recover jobs without receiving authority to decide business meaning.
  <br>`docs/16` § 4; `retention-legal-hold.md` § Invariants 4. Structural: approval columns are separate from requester columns, and the purge gate checks the approval, not the runner.
- [x] CHK010 Feature 011 cannot bypass features 009/010 identity, authorization, audit, idempotency or transaction rules.
  <br>Every 011 command goes through the same `authOf` resolution, the same `command_idempotency` claim protocol, and one `db.transaction`. No 011 route writes lifecycle, disposition, serviceability, location, custodian, project or parent — corrections refuse with `correction.useBusinessEvent` and name the event to use instead.

## Data dictionary and classification

- [x] CHK011 A machine-readable data dictionary is required.
  <br>FR-002; `data_dictionary_entry` (`0015`) and `GET /api/data-management/dictionary`.
- [x] CHK012 Every production field has a business definition and data type. — `dictionaryCheck` fails on either missing.
- [x] CHK013 Every production field has an owner/steward. — same check; see CHK005.
- [x] CHK014 Every production field declares authority mode.
  <br>FR-003; five modes, `NOT NULL` with a CHECK on the enum.
- [x] CHK015 Every production field maps to the approved corporate classification taxonomy.
  <br>**OD-4 decided 2026-09-04** — Internal / Confidential / Restricted, and the `Unapproved:` prefix is gone (`docs/08` § OD-4).
- [x] CHK016 Every production field declares roles permitted to read, write and export it. — `read_roles`, `write_roles`, `export_roles`, all `NOT NULL`.
- [x] CHK017 Every production field declares whether it may be cached offline. — `offline_cache_allowed NOT NULL`; false on all three restricted fields.
- [x] CHK018 Every production field declares its retention class. — `retention_class NOT NULL`; the classes are the OD-5 register.
- [x] CHK019 Every production field links to applicable quality rules and lineage source. — `quality_rule_ids`, `lineage_source`.
- [x] CHK020 Dictionary/schema/API contract checks identify missing or contradictory entries.
  <br>`npm run data:dictionary:check` and the coverage test. **It works** — it caught every column added by `0017`–`0020` and refused to pass until each was documented. That is rule 18 enforced rather than asserted.
- [x] CHK021 Dictionary entries retain deprecation and replacement history. — `deprecated_at`, `replaced_by_field`.
- [x] CHK022 Exact classification labels are treated as an open corporate-policy decision, not invented.
  <br>They **were** so treated — the `Unapproved:` prefix existed precisely so nobody could mistake a placeholder for policy — and the decision has now been taken rather than left open (OD-4). The item's intent is satisfied in both directions.

## Data authority

- [x] CHK023 SystemDerived, AMSManaged, ExternalAuthoritative, ImportedOnce and ReferenceOnly modes are defined. — FR-003; CHECK constraint on the five.
- [x] CHK024 Ordinary edits to SystemDerived fields are refused.
  <br>FR-004; `corrections.ts` `DERIVED_FIELD_ROUTES` refuses with `correction.useBusinessEvent` **and names the event to use** — a refusal without a route just teaches people to look for a back door.
- [x] CHK025 Ordinary edits to ExternalAuthoritative fields are refused or follow an approved override route.
  <br>FR-004; `correction.externalAuthoritative` — a model correction must select an existing catalogue row, never invent one.
- [x] CHK026 Field-level source authority is explicit for projects, people, asset identity, calibration and locations. — `docs/16` § 6 table; per-field `authority_mode` in the dictionary.
- [x] CHK027 Current asset state remains derived from accepted business events. — FR-027, rule 4; no 011 route writes a derived field, and `asset.status` is a generated column so nothing can.
- [x] CHK028 Static master-data corrections do not silently mutate history. — FR-026; `correction.historyImmutable`, and `0003` refuses the write regardless.
- [x] CHK029 Source overrides record reason, approver, duration and reconciliation consequence.
  <br>FR-007; `data_change_request` carries reason, evidence, requester, approver, approval expiry, effective and applied times. Reconciliation consequence is reported by the reconciliation job rather than stored on the override — `reconcile.conflict` names a key that came back after being recorded deactivated.

## Data Management Centre

- [x] CHK030 A protected Data Management navigation area is specified. — Administration → Data governance only (`docs/25` §§3–4). Field and ReportReader-only identities receive no route or issue/dictionary/job payload; an approved report metric uses a separate aggregate projection.
- [x] CHK031 Overview shows issues by severity, domain, office, owner and age. — FR-015; `qualityOverview` returns all five.
- [x] CHK032 Temporary tags, unknown custodians, calibration unknown/overdue, duplicate candidates and failed jobs appear on the overview. — the rule catalogue covers all five domains and the overview aggregates by rule.
- [x] CHK033 Missing/quarantined documents and external reconciliation failures appear on the overview. — `DQ-DOC-*` rules and the reconciliation job's `Invalid` items; both surface through the same issue queue.
- [x] CHK034 Every aggregate count links to records and the governing rule. — `qualityIssuesPath` builds the deep link, and every count carries its `ruleId` and `ruleVersion`.
- [x] CHK035 Dashboard data currency and rule version are visible. — FR-015; `dataCurrency` and `ruleVersion` on the overview response, asserted in `tests/dataManagement.test.ts`.
- [x] CHK036 High-impact recent changes and upcoming retention actions are visible to permitted roles. — `GET /api/data-management/corrections/:id` and the retention register + preview; both admin-gated.
- [x] CHK037 Server-side filtering/paging is required; the full fleet is not downloaded into the browser.
  <br>FR-080; every list endpoint takes `page`/`pageSize` with a server-side cap (dictionary 100, jobs/candidates 200) and returns a total.

## Quality rules

- [x] CHK038 Quality rules are versioned. — FR-009; `(rule_key, version)` unique, plus a partial unique index on the current active version.
- [x] CHK039 Each rule has domain, severity, owner, schedule and implementation identity. — all five columns, `implementation_ref NOT NULL`.
- [x] CHK040 Re-running a rule updates one issue rather than creating duplicate open issues.
  <br>FR-010; `UNIQUE (rule_id, entity_type, entity_id, scope_key)` with an upsert. Tested by running the rules twice and asserting the count.
- [x] CHK041 Issue identity includes enough scope to distinguish rule/record/relationship failures. — `scope_key` is part of the identity, which is what lets one asset hold two issues from one rule.
- [x] CHK042 Issue first detected, last detected and age are stored. — `first_detected_at`, `last_detected_at`; age derived.
- [x] CHK043 Issue owner, office, due date and service level are stored.
  <br>`owner_user_id`, `office_location_id`, `due_at`. **Service level is not a column** — no SLA is approved, and `alerts.ts` names an owner without inventing SLA hours. Recorded rather than invented.
- [x] CHK044 Issue evidence and affected record links are stored. — `evidence jsonb`, `entity_type`/`entity_id`; restricted values never enter it (tested).
- [x] CHK045 Issue states include Open, Assigned, InProgress, Blocked, Resolved, Waived, FalsePositive and Reopened. — all eight, as a CHECK constraint.
- [x] CHK046 Claimed resolution is rule-verified or manually verified with approval. — FR-012; `verification_type` CHECK admits only `RuleReevaluation` or `ManualApproved`, and closure without one is refused.
- [x] CHK047 Waiver requires reason, approver and expiry. — FR-013; refused without all three, and self-approval refused.
- [x] CHK048 Expired waiver reopens/re-evaluates the issue. — FR-013; tested (an expired waiver reopens when the record still fails).
- [x] CHK049 False-positive history and prior rule versions are preserved. — FR-014; `rule_version` on the issue, and rule versions are never deleted.
- [ ] CHK050 Criticality/age thresholds alert a named owner.
  <br>*Not checked.* FR-016 is explicit and an owner field exists, but the alert is a **stub**: it names an owner and does not schedule on an age threshold, because no threshold is approved and no alert destination exists. **Owner:** Englobe IT (R6, alert owner) for the destination; the threshold is a product input.

## Initial rule coverage

*All eighteen are **catalogued** — 42 rules in `server/src/modules/data-management/ruleCatalogue.ts`,
each with a domain, severity and an explicit `implementation_ref` status. Eight are implemented and
run; 34 are catalogued as `not-implemented` with the reason stated on the row. The checklist bar is
"rules exist", and a catalogued rule with a stated status is a specified, assigned requirement —
which is exactly what this section reviews. What is **not** claimed is that all 42 run.*

- [x] CHK051 Blank/malformed/duplicate canonical Asset ID rules exist. — `DQ-ASSET-ID-*`.
- [x] CHK052 Temporary-tag age and incomplete-identity rules exist. — `DQ-ASSET-TEMPORARY-TAG` (implemented; the 2 temporary tags in the demo dataset are its planted case).
- [x] CHK053 Missing model/home office/required serial rules exist. — `DQ-ASSET-MODEL-*`, `DQ-ASSET-HOMEOFFICE`, `DQ-ASSET-SERIAL-REQUIRED`.
- [x] CHK054 Prefix/model/identifier inconsistency rules exist. — `DQ-ASSET-PREFIX-MISMATCH`.
- [x] CHK055 Alias-collision rules exist. — `DQ-ASSET-ALIAS-COLLISION`. Its catalogue note said "Blocked on the asset_identifier table"; **that table now exists** (`0014`), so the rule is unblocked and its status is the remaining work rather than a blocker.
- [x] CHK056 Duplicate model-key and invalid/cyclic location rules exist. — `DQ-REF-*`; the cyclic case is also refused by `0005` at write time, so the rule is a detector for legacy rows rather than the only guard.
- [x] CHK057 Office-without-steward/admin rule exists. — `DQ-REF-OFFICE-NO-ADMIN`; feature 007 plants exactly one such office.
- [x] CHK058 Current-state versus event-replay reconciliation rule exists. — `DQ-STATE-REPLAY-MISMATCH`.
- [x] CHK059 Multiple-open-parent and multiple-open-installation rules exist. — `DQ-REL-MULTI-PARENT`, `DQ-INST-MULTI-OPEN`; both also refused by database constraints.
- [x] CHK060 Overlapping relationship/installation span rules exist. — `DQ-REL-OVERLAP`, `DQ-INST-OVERLAP`; spans constrained by `0006`.
- [x] CHK061 Retired-with-open-obligation rule exists. — `DQ-ASSET-RETIRED-OBLIGATION`; R-19 also refuses creating the state.
- [x] CHK062 Unknown custodian and stale checkout rules exist. — `DQ-CUSTODY-UNKNOWN`, `DQ-CUSTODY-STALE`.
- [x] CHK063 Calibration unknown/overdue/failed-summary rules exist. — `DQ-CAL-UNKNOWN-DUE`, `DQ-CAL-OVERDUE`, `DQ-CAL-FAILED-SUMMARY`. Exact issue counts/details belong to the Administration quality queue; only an approved aggregate may enter Reports, and neither appears on Field Home.
- [x] CHK064 Missing/orphan/hash-mismatch/scan-stale document rules exist. — `DQ-DOC-*`, four of them; the reconciliation half is implemented in `documents/reconcile.ts`.
- [x] CHK065 Restricted-field-in-report/export/offline-cache rules exist. — `DQ-SEC-RESTRICTED-*`; also enforced structurally — no view selects one, every template declares exclusion, and `offlineCacheAllowed` is false.
- [x] CHK066 Inactive-user-with-role/scope rule exists. — `DQ-SEC-INACTIVE-USER-ROLE`.
- [x] CHK067 Production/synthetic contamination rule exists. — `DQ-ENV-CONTAMINATION`; also a `meta` trigger (`0007`), and `planLoad` now reports the case where the marker itself is **absent**, which was a real hole.
- [x] CHK068 Retention-overrun-without-hold/exception rule exists. — `DQ-RETENTION-OVERRUN`. Meaningful only now that OD-5 supplies periods for two classes; before that there was no overrun to detect.

## Reference and master data

- [x] CHK069 Supported reference domains are listed. — five: Manufacturer, EquipmentCategory, EquipmentModel, Location, Project (`ReferenceDomain`).
- [x] CHK070 Authorized create/edit/deactivate/reactivate operations are defined. — FR-018; five named commands plus `reparent-location`, all admin-gated (`routes/reference.ts`).
- [x] CHK071 Referenced records cannot be ordinarily hard-deleted. — FR-020, rule 7; `POST .../commands/delete` exists **only to refuse**, with `deleteForbidden` naming deactivate instead.
- [x] CHK072 Historical records keep displaying deactivated references. — FR-020; deactivation sets `isactive = false` and nothing reads it as a filter on history.
- [x] CHK073 Deactivated references are excluded from new selections. — FR-021; `reference.inactiveNotSelectable` on registration, model correction and rehome.
- [x] CHK074 Duplicate business keys are refused. — FR-019; unique on `(manufacturer, model, equipmenttype)` and on `location.name`.
- [x] CHK075 Cyclic location hierarchy is refused. — FR-019; refused by the reparent command and by the import's row validation (`job.cyclicHierarchy`).
- [ ] CHK076 Reference aliases resolve through a purpose-sized response without exposing the Administration redirect record.
  <br>*Not checked.* Alias resolution exists, but the current data-management redirect endpoint is open to every authenticated role. D18 requires Administration-only chain/explanation detail and a separate minimal operational resolution for an authorized Work scan or old link.
- [x] CHK077 Re-parenting impact includes authorization, reporting and notification consequences. — FR-022; `previewReferenceImpact`.
- [x] CHK078 Reclassification/merge has an impact preview. — FR-022; the import dry run raises `job.highImpact` on a location type change, and `preview-merge` returns the full review bundle.
- [x] CHK079 External-authoritative fields cannot be silently edited locally. — FR-054; `correction.externalAuthoritative`, and reconciliation reports rather than writes.
- [x] CHK080 Applied reference changes trigger affected quality/summary recalculation. — FR-024; `runQualityRules` runs in the same transaction as the change.
- [x] CHK081 Office Admin reference permissions are explicitly bounded.
  <br>**OD-7 decided 2026-09-04.** Reference data is global, so importing it is SystemOwner-only (`job.scopeForbidden`); an OfficeAdmin bulk-updates only assets homed in their offices.

## Static corrections

- [x] CHK082 Permitted static asset correction types are listed. — nine, as a TypeScript union **and** a CHECK constraint on `data_change_request.command_type`; adding one is a migration, which is the point.
- [x] CHK083 Correction requires old value, proposed value, reason and evidence. — FR-007; `correction.evidenceRequired` refuses an empty evidence object, and before/after are stored.
- [x] CHK084 High-impact fields require impact preview. — FR-029; `correction.previewRequired` for equipment model, ownership and restricted identifier.
- [x] CHK085 Derived current-state fields cannot be corrected generically. — see CHK024.
- [x] CHK086 Canonical Asset ID cannot be changed after assignment. — rule 6; `0004`, and `correction.canonicalIdImmutable` for the alias-removal path.
- [x] CHK087 Temporary/legacy identifiers remain aliases. — FR-028; alias removal **closes** the row (`is_current = false`) rather than deleting it, so the mapping survives.
- [x] CHK088 Transaction headers/lines cannot be edited or deleted through correction. — `0003`, including TRUNCATE.
- [x] CHK089 Home-office change uses the dedicated rehome workflow. — R-18 (`docs/08` **D7**); a correction naming `homeoffice` is refused and told to use RehomeAsset.
- [x] CHK090 Relationship changes use recorded attach/detach operations. — R-20/R-21; a correction naming `parentasset` is refused and told to use them.
- [x] CHK091 Model correction considers calibration, identifier and reporting impact.
  <br>FR-029; the preview names the calibration-interval change, whether the new model is serialised while the asset has no serial, that reports will group it differently, and that the canonical ID does **not** change. Asserted in `tests/dataManagementWrites.test.ts`.
- [x] CHK092 Applied correction re-runs related quality rules. — FR-030; in the same transaction, so the queue is never briefly wrong about a record just fixed.
- [x] CHK093 Approval and self-approval rules are defined per correction type/scope. — **OD-3 decided 2026-09-04**; enforced by CHECK constraint and by `correction.selfApprovalForbidden`.
- [x] CHK094 Correction audit includes requester, approver, evidence, effective time and applied time. — all five columns, plus an `audit_event` row committed in the same transaction.

## Data jobs

- [x] CHK095 Import, BulkUpdate, Export, Reconciliation, DuplicateResolution, ReferenceMerge, RetentionPreview, Purge and QualityRuleRun job types are defined. — all nine, as a CHECK constraint on `data_job.job_type`.
- [x] CHK096 Every job has immutable ID, type, environment and status. — four `NOT NULL` columns; environment read from the `meta` marker, not from the request.
- [x] CHK097 Every job records schema/template version. — `schema_version NOT NULL`, e.g. `ReferenceLocation/v1`.
- [x] CHK098 Every source-based job records file/source hash or checkpoint. — `source_hash`; and the hash is part of the **claimed request**, which was a real bug — two different files with the same name and row count hashed identically until it was.
- [x] CHK099 Every job records requester and approver where required. — `requested_by NOT NULL`, `approved_by` nullable by design (OD-3 decides when it is required).
- [x] CHK100 Every job records transformation/code version. — `code_version NOT NULL`, stamped `011-writes-1`.
- [x] CHK101 Every job records total, valid, warning, invalid, applied, skipped and failed counts. — `DataJobSummary` has all seven plus `uncertain`; `summarise()` derives them from the items so header and rows cannot disagree.
- [x] CHK102 Every job has row/item-level outcomes. — `data_job_item`, `UNIQUE (job_id, item_number)`.
- [x] CHK103 Every job links to audit/correlation evidence. — `correlation_id NOT NULL`, the same value the log line and the audit row carry.
- [x] CHK104 Job artifact retention/expiry is defined. — `artifact_expires_at`; **OD-5 and OD-9 decided 2026-09-04** — source files are not retained, and `data.job.source` is PurgeEligible at 90 days.
- [x] CHK105 Every write job declares Reversible, Compensatable or Irreversible. — FR-040; a **required argument**, not a default, with a CHECK on the three.
- [x] CHK106 Irreversible jobs require highest approval and recovery prerequisites. — FR-041; `job.recoveryRequired` and `retention.recoveryRequired` refuse without a verified recovery point, and purge is SystemOwner-only.
- [ ] CHK107 Long-running jobs expose progress/checkpoint/retry-safe state.
  <br>*Not checked.* FR-077 is explicit and `data_job.progress` exists as a column (`0018`), but **nothing writes it** — jobs are capped at 5,000 rows and complete in one transaction, so there is no long-running job to checkpoint yet. The column is honest scaffolding for the first job that needs it, and this stays unchecked until one does.
- [ ] CHK108 Stuck/terminal jobs alert a named owner.
  <br>*Not checked.* Same shape as CHK050: FR-078 is explicit, the alert carries an owner, and there is no destination. **Owner:** Englobe IT (R6).

## Import and bulk update

- [x] CHK109 Every import type has a versioned downloadable template. — FR-042; `GET /api/data-management/imports/templates`, returning columns, required columns, reversibility and **the dictionary entries for each column**.
- [x] CHK110 File type, size, headers and schema version are validated. — schema version refused with `job.schemaUnsupported`; unknown columns warned rather than silently dropped ("a column the importer silently drops is data the steward believes they imported"); 5,000-row cap.
- [x] CHK111 Required fields, formats and reference resolution are validated. — `job.requiredMissing`, `job.invalidValue`, `job.unresolvedReference` — including a parent location that exists neither in the database nor earlier in the same file.
- [x] CHK112 Duplicate keys/candidates are reported. — `job.duplicateKey` naming the earlier row number; `job.duplicateCandidate` for a shared serial, as a warning and never a merge.
- [x] CHK113 Authorization and office scope are validated at row level. — `job.scopeForbidden` per row, per OD-7.
- [x] CHK114 Sensitive-field permission is validated at row level. — restricted columns are in `FORBIDDEN_COLUMNS`, refused per row with `job.derivedStateForbidden`; there is no import path that can set one.
- [x] CHK115 Direct writes to state/history are refused. — same list; tested per row, not per file, and a row that would write derived state stays `Invalid` even when it changes nothing else — a bug found and fixed during this review.
- [x] CHK116 Dry run writes no business changes. — FR-034; `dryRun()` never calls an apply function, and the test counts `location` rows before and after.
- [x] CHK117 Dry run includes before/after preview and impact. — FR-035; `before_data`/`after_data` per item plus coded messages.
- [x] CHK118 Apply refuses a changed source file. — `job.sourceChanged`; tested by adding one row.
- [x] CHK119 Apply refuses expired approval or lost permission. — `job.approvalExpired`, `job.permissionLost`, both in `applyGates`.
- [x] CHK120 Apply refuses material target drift or new critical validation. — `job.targetDrift`, `job.criticalValidation`; drift is detected by re-validating against the **current** world and comparing to the dry run's stored before-state.
- [x] CHK121 Logical atomic groups remain atomic within a batched job. — FR-038; one transaction per apply today, which satisfies atomicity trivially and is stated as the current shape rather than as a batching implementation.
- [x] CHK122 Every row gets a final outcome; none silently disappear. — FR-037; items are written with a terminal status **before** any apply runs, so a crash part-way leaves `Uncertain` rather than absence.
- [x] CHK123 Retry is idempotent. — FR-039; `claimJob` uses the same insert-first claim protocol as commands. Tested: a replay returns the original job id, a reused key with a different body is `job.idempotencyConflict`.
- [x] CHK124 Applied/unapplied/uncertain outcomes are distinguishable after failure. — FR-039; `Applied` / `Skipped` / `Failed` / `Uncertain` are four distinct statuses and the pre-write pass is what makes `Uncertain` reachable.
- [x] CHK125 Spreadsheet formula-injection controls are defined. — FR-043; `neutraliseForSpreadsheet` prefixes a leading `= + - @ TAB CR` with a quote, applied to every item message.

## Duplicate resolution

- [x] CHK126 Detection produces candidates, not automatic merges. — FR-044; `autoMergeEligible` is the **literal type `false`**, not a computed boolean — a field that could be true is a field somebody will eventually make true.
- [x] CHK127 Serial alone can never authorize merge. — SC-010; `duplicate.serialInsufficient`, and the scan does not even raise a candidate for a shared serial across *different* equipment types, because that is this fleet's legitimate paired-kit case.
- [x] CHK128 Review shows identities, aliases, model, source lineage and current state. — FR-045; all five on `DuplicateRecordSnapshot`.
- [x] CHK129 Review shows transactions, calibrations, documents, relationships and installations. — all five counts.
- [x] CHK130 Outcomes include NotDuplicate, RelatedPhysicalAssets, MergeRecords, RetireErroneousRecord and NeedsPhysicalAudit. — FR-046; all five.
- [x] CHK131 Reviewed non-duplicate decisions suppress repeat noise until evidence changes. — FR-051; the upsert reopens a Resolved candidate **only** when the evidence differs.
- [x] CHK132 Physical-audit outcome creates an owned due issue. — `raisePhysicalAuditIssue`, with assignee and due date.
- [x] CHK133 Merge selects a survivor and creates permanent redirect/canonical mapping. — FR-047; `record_redirect`, unique on `(entity_type, from_id)`, with an acyclicity trigger.
- [x] CHK134 Former canonical ID remains searchable as alias. — tested. Order matters and getting it wrong is silent — see `docs/08` **D15**.
- [x] CHK135 Both original UUIDs and histories are preserved. — tested: both asset rows survive and the merged-away record's line count is unchanged.
- [x] CHK136 Immutable transaction lines are not rewritten. — FR-048, rule 17; the merge writes no line at all, and `0003` would refuse it.
- [x] CHK137 Merged-away record cannot receive new operational events. — set to `Retired`, the one lifecycle value the table already makes terminal (`docs/08` **D15**) — reusing an enforced rule rather than adding a flag that would need enforcing everywhere.
- [x] CHK138 Consolidated timeline preserves source identity of each event. — FR-049; each line keeps its own `asset`, so a consolidated read shows which identity recorded which event.
- [x] CHK139 Incompatible current states/ref obligations block merge until reconciled. — **OD-11 decided 2026-09-04**; `duplicate.incompatibleState`, and the bundle names every conflict.
- [x] CHK140 Merge requires evidence, requester, approver and impact audit. — all four; a merge with no approver or a self-approval is refused, and an `audit_event` plus a `data_change_request` row are written.
- [ ] CHK141 Old links resolve for an authorized task without exposing merge-chain or governance detail.
  <br>*Not checked.* The current endpoint returns the complete redirect chain and explanation to every authenticated role. The target requires a minimal Work resolution, with full chain/evidence only in an approved Administration purpose and projection.

## External reconciliation

- [x] CHK142 Each integration states field authority and direction. — FR-052; `docs/16` § 6, and `data_source_record.origin` distinguishes the six provenance kinds.
- [x] CHK143 Stable source key is defined. — `source_key`, part of the uniqueness `(entity_type, entity_id, source_system, source_key)`.
- [x] CHK144 Frequency/checkpoint and retry identity are defined. — the job's `idempotency_key` is the retry identity; frequency is caller-driven, which is stated rather than implied.
- [x] CHK145 Create/update/deactivate/delete behavior is defined. — FR-055; new keys are **reported, not created** (importing is a separate approved job), missing keys set `source_deactivated_at`, and there is no delete.
- [x] CHK146 Manual override and conflict behavior are defined. — `reconcile.conflict` for a key that returns after being recorded deactivated; overrides go through the correction module with reason and evidence.
- [x] CHK147 Reconciliation reports new/changed/unchanged/missing/conflicting records. — FR-053; all five, tested.
- [x] CHK148 Locally authoritative values are not silently overwritten. — FR-054; reconciliation performs exactly **one** write, and it is metadata about the source (`source_deactivated_at`), never a business field.
- [x] CHK149 Source-authoritative values are not ordinarily edited locally. — `correction.externalAuthoritative`.
- [x] CHK150 Historical references survive source deactivation. — FR-055; the row is marked, never deleted, and the test asserts the asset it points at still exists.
- [x] CHK151 Reprocessing a checkpoint is idempotent. — the same `claimJob` protocol; `recordSource` upserts on the natural key and moves `last_seen_at` only.
- [ ] CHK152 Stale/failed source alerts a named owner and data age is visible.
  <br>*Not checked.* Data **age is visible** — `last_seen_at` and `source_deactivated_at` are returned by the lineage endpoint. The **alert** is the same stub as CHK050/CHK108: no destination. **Owner:** Englobe IT (R6).
- [x] CHK153 Applied fields link to source and mapping version. — FR-059; `transformation_ref` and `job_id` on every lineage row.

## Lineage

- [x] CHK154 Manual, migration, import, external sync, system-derived and synthetic provenance are distinguishable. — FR-057; six `origin` values as a CHECK constraint.
- [x] CHK155 Source system and source record identifiers are retained where applicable. — `source_system`, `source_key`; backfilled for the migrated fleet from the loader's own marker.
- [x] CHK156 Import/data-job ID is retained. — `job_id` FK to `data_job`.
- [x] CHK157 Original source-row reference is retained. — `source_row_number`, and `data_job_item.source_reference` carries `file:row`.
- [x] CHK158 Transformation/mapping version is retained. — `transformation_ref`.
- [x] CHK159 Merge/redirect chain is retained. — `resolveRedirect` walks the chain and returns every hop, capped at 64 with a trigger that refuses cycles.
- [ ] CHK160 Important current facts expose a purpose-sized "Why does the system say this" view only to authorized users.
  <br>*Not checked.* Full provenance is currently open to every authenticated role. FR-058 now keeps lineage in its approved Administration/evidence purpose; Work may receive only a minimal task outcome if a separate projection is approved.
- [x] CHK161 Derived state can identify the event that established each dimension or derive it deterministically.
  <br>FR-058; `provenanceFor` walks the lines newest-first and attributes each axis to the most recent line whose `*_after` **differs from the line before it** — which is why the answer is "the Checkout on TXN-000015" rather than "the most recent transaction", the latter being true of every field at once and therefore useless. Falls back to the migration marker, or to an explicit `unknown`, never to silence.

## Exports

- [x] CHK162 Export templates are approved and versioned. — **OD-8 decided 2026-09-04**; two templates, versioned, and the list is closed until a request adds one.
- [ ] CHK163 Users see only templates permitted by workspace, purpose, capability, row/field scope and projection.
  <br>*Not checked.* Current template filtering proves a legacy role gate only. FR-060 now requires the full D18 intersection and role alone must list nothing.
- [ ] CHK164 Workspace, purpose, capability, row/office and field restrictions are enforced server-side.
  <br>*Not checked.* Office refusal exists, but the complete D18 intersection and zero-fetch negative matrix are not yet evidenced.
- [ ] CHK165 General exports exclude every D18-forbidden class, not only secured network identifiers.
  <br>*Not checked.* Restricted network identifiers are excluded. Certificate links/metadata, free text, performer identity, maintenance cost, audit and internal identifiers still need exact response/export-key evidence.
- [x] CHK166 Export records requester and purpose. — FR-063; `requested_by`, `purpose`, both `NOT NULL`, and `purpose` has a 3-character minimum so "x" is not a purpose.
- [x] CHK167 Export records filters, columns, row count, classification, template/version and expiry. — all six columns in `export_artifact` (`0018`), with a CHECK that expiry is after creation.
- [x] CHK168 Export artifacts are private and authenticated. — FR-064; bound to the requesting identity, `cache-control: no-store, private`, and no URL is ever handed out.
- [x] CHK169 Download access is audited where required. — FR-065; `download_count` and `last_downloaded_at`, incremented on the authorized path. A row per download was **rejected deliberately** — that table grows per click and has no retention policy of its own.
- [x] CHK170 Expired exports become inaccessible and are deleted according to policy.
  <br>FR-064/FR-065, and this is where the local shape was **wrong**: it satisfied inaccessibility by deleting the whole artifact, destroying the FR-063 record with the bytes. Now the contents go, the row survives as `Expired`, and a later attempt is `410 export.expired` (`docs/08` **D12**). OD-5 gives the bytes a 30-day purge class.
- [x] CHK171 Hold/approved exception behavior is defined. — `status: 'Held'` and `legal_hold_id` on `export_artifact`; download refuses `export.held`.
- [x] CHK172 Large/restricted exports require configured approval. — **OD-3 decided**: > 1,000 rows or `Restricted` classification. `approved_by` column exists; neither current template reaches the threshold, which is stated rather than hidden.
- [x] CHK173 Field Users cannot request a raw fleet-wide export. — FR-067; no template admits FieldUser, and no template is fleet-wide (OD-8 rejected the idea explicitly).
- [x] CHK174 Export includes visible classification/export ID where the format supports it. — the CSV footer carries export ID, classification, creation and expiry; response headers carry them too.

## Retention and legal hold

- [x] CHK175 Retention register covers business records, documents, audit, quality, jobs, exports, outbox, logs, offline caches and backups. — FR-068; nineteen classes covering all ten categories.
- [x] CHK176 Retention rules are versioned and approved. — versioned, immutable after activation by trigger, and **now approved** (OD-5) with `approved_by` naming the decision.
- [x] CHK177 No unapproved retention period is invented.
  <br>FR-069. Enforced as a constraint: a numeric period is legal **only** on an approved policy (`0021`). OD-5 decided indefinite rather than inventing years — the distinction the requirement is actually about.
- [x] CHK178 Existing indefinite asset/history retention is preserved unless formally superseded. — FR-070; `asset.retired`, `transaction.history`, `relationship.history` and `installation.history` carry `note: 'indefinite'` and `approved_by: 'FR-070'`, deliberately distinct from OD-5's approvals so a future policy can supersede one without touching the other.
- [x] CHK179 Legal hold records scope, authority, reason, owner and start. — FR-071; all five `NOT NULL`, and a hold with an empty scope is refused.
- [x] CHK180 Hold release authority and separation of duties are defined. — **OD-6 decided**; `legal_hold_no_self_release` as a CHECK constraint, not only a service check.
- [x] CHK181 Retention preview writes no changes. — FR-072; `wroteChanges: false` is a **literal type**, so returning anything else is a compile error rather than a promise.
- [x] CHK182 Preview identifies eligible, held and blocked records/documents. — all three counts plus three document counts and a 25-row sample with a reason per row.
- [x] CHK183 Holds exclude matching items from purge. — FR-073; checked in the preview **and again** at apply time, because a hold placed between the two must still win.
- [x] CHK184 Purge verifies policy version, dependencies, approval and recovery prerequisites. — FR-074; five gates, each with its own refusal code, tested individually.
- [x] CHK185 Purge records exact database/document counts and post-action reconciliation. — item-level outcomes plus a summary; the preview's document counts are the reconciliation input.
- [x] CHK186 Ordinary users have no general-purpose delete path for production history. — FR-075, SC-016; the only class with a delete path is `export_artifact`, and it is a derived product. Everything else refuses `delete.notAvailable` **inside** the purge itself.
- [x] CHK187 Database and document retention outcomes reconcile. — FR-076; `documentMissingCount` counts rows whose blob is absent, which is a reconciliation failure rather than a purge candidate.

## Physical data model

- [x] CHK188 `data_job` or equivalent is included in the canonical schema. — `0015`, extended by `0018`.
- [x] CHK189 `data_job_item` or equivalent is included. — `0018`.
- [x] CHK190 `data_quality_rule` is included. — `0015`.
- [x] CHK191 `data_quality_issue` is included. — `0015`.
- [x] CHK192 `data_change_request` is included. — `0018`, corrected by `0020`.
- [x] CHK193 `record_redirect` is included. — `0018`, with an acyclicity trigger.
- [x] CHK194 `retention_policy` is included. — `0018`, corrected by `0021`.
- [x] CHK195 `legal_hold` is included. — `0018`.
- [x] CHK196 source/lineage link structure is included. — `data_source_record`, `0018`.
- [x] CHK197 Existing audit/document/alias/outbox entities are reused rather than duplicated. — `docs/16`:669 requires it; `audit_event` (`0017`) is the single audit table for every non-transaction change, and `document`, `asset_identifier` and `outbox_event` are reused unchanged.
- [x] CHK198 Keys, indexes, constraints, retention and authorization are specified for each addition.
  <br>Every table has a primary key, foreign keys where a reference exists, at least one query-shaped index, CHECK constraints on every enum, a dictionary entry per column naming purposes, capabilities, projection, masking/offline policy and retention class, and a row in the OD-5 register. Coarse responsibility roles are ceilings, not field authorization. `dictionaryCheck` still proves catalogue coverage; D18 policy enforcement is tracked separately below.

## Security, performance and recovery

- [x] CHK199 Sensitive values are redacted from logs and unauthorized validation results.
  <br>FR-079. Redacted **before the row is written**, not on the way out: the ICCID correction test asserts the request body value appears nowhere in the response and nowhere in the `audit_event` row, which instead carries `[redacted:19 digits]`.
- [x] CHK200 Job source files and artifacts are private and time-limited. — **OD-9 decided**: source files are not retained at all. Export artifacts are private, expire, and are purge-eligible at 30 days.
- [ ] CHK201 Data-management APIs pass the full direct D18 negative matrix.
  <br>*Not checked.* Cross-role/cross-office tests cover a useful legacy subset, but not workspace/purpose/capability/row/projection intersection, zero-fetch denial, exact forbidden keys, evidence-document ACLs, or revocation/cache behavior.
- [x] CHK202 High-impact approvals cannot be bypassed with direct API calls. — every refusal above is asserted through `app.inject`, and the four separation-of-duties rules are CHECK constraints, so bypassing the service does not bypass them.
- [x] CHK203 Data-management pages are usable at 5,000 active assets and 100,000 transaction lines.
  <br>`server/tests/scale.test.ts` (opt-in) runs 6,626 assets / 438,619 lines: fleet list 32 ms, search 17 ms, the busiest asset's 322-line history 7 ms, reports reconcile exactly. Data-management reads are paged server-side with a hard cap, so they are bounded by page size rather than by fleet size.
- [ ] CHK204 A 5,000-row dry run meets the approved performance budget.
  <br>*Not checked.* The 5,000-row cap exists and is enforced, but **no performance budget is approved** — there is no number to meet. A budget needs the production tier, which is R6. **Owner:** Englobe IT.
- [x] CHK205 Data jobs do not hold disruptive locks beyond the approved budget.
  <br>FR-081. Structural rather than measured: the 5,000-row cap bounds one job, dry runs take no business locks at all, and applies use per-row optimistic concurrency (`row_version`) rather than table locks. The **budget** is the same missing number as CHK204; the design that respects it is in place.
- [x] CHK206 Worker restart after partial progress produces no duplicate effects. — `claimJob`'s insert-first protocol plus the pre-write terminal-status pass; `tests/outbox.test.ts` (29) covers worker restart and redelivery.
- [ ] CHK207 Database restore retains/reconciles data-job, quality, redirect, retention and lineage evidence.
  <br>*Not checked.* All five now exist as tables, so a restore **would** carry them — but no restore has been exercised, because there is nothing to restore into. **Owner:** Englobe IT (R6). This moved from "the tables do not exist" to "the exercise has not run", which is progress worth naming.
- [ ] CHK208 Blob/document reconciliation is part of restore verification.
  <br>*Not checked.* The reconciliation exists and reports both directions of mismatch (`documents/reconcile.ts`), and publishes through the outbox to the named alert owner. Making it part of **restore verification** needs a restore. **Owner:** Englobe IT (R6).
- [x] CHK209 Synthetic production contamination is structurally refused. — FR-082, rule 12; a `meta` trigger (`0007`) so `psql` and a restored dump face it too, plus the absent-marker warning `planLoad` now raises.

## Pilot gates

- [ ] CHK210 All critical migration/reference-data issues are resolved or explicitly approved before pilot.
  <br>*Not checked — correctly, this is a pilot gate.* The two sign-offs it depends on **are** now signed (2026-09-04), and the quality queue exists to hold whatever remains. There is no pilot to gate yet.
- [x] CHK211 Model-review and duplicate-conflict sign-offs remain mandatory.
  <br>Both files carry a Production gate section, `specs/README.md` names them as hard gates, and **both are reviewed and signed 2026-09-04** — the requirement that they remain mandatory is what this item asks, and it holds.
- [x] CHK212 Data dictionary coverage reaches 100% of production fields.
  <br>**Reached, and enforced.** `dictionaryCheck` compares the catalogue against `information_schema` and fails on any production column without an entry — it failed four times as `0017`–`0020` landed and passes now. 459 fields.
- [ ] CHK213 No direct derived-state/history corrections occur during pilot.
  <br>*Not checked — a pilot observation, not a build property.* What can be said: there is **no code path** to make one. Derived fields are refused by name with the event to use instead, `asset.status` is a generated column, and `0003` refuses history writes including TRUNCATE.
- [x] CHK214 Every bulk job reconciles requested/applied/skipped/failed counts exactly.
  <br>`summarise()` derives the header summary **from the item rows**, so the two cannot disagree; the pre-write terminal-status pass means no row is missing from the denominator.
- [x] CHK215 No valid shared-serial pair is auto-merged.
  <br>SC-010. Three independent reasons it cannot happen: `autoMergeEligible` is the literal `false`; the scan does not raise a candidate for a shared serial across different equipment types (this fleet's legitimate pairs); and a merge justified on serial alone is refused `duplicate.serialInsufficient`.
- [x] CHK216 Every export is authorized, private, audited and expired according to policy.
  <br>All four, and the audit now survives a restart — which was the gap (`docs/08` **D12**).
- [ ] CHK217 Retention/hold behavior is tested in non-production before activation.
  <br>*Not checked.* It **is** tested — 12 tests covering the register, immutability, preview, four purge gates, hold creation and self-release refusal — but "in non-production" means in a non-production **environment**, and there is one environment: local. **Owner:** Englobe IT (R6).
- [x] CHK218 A successor can explain a sampled import, correction, merge and current fact from lineage/audit evidence.
  <br>All four are reconstructible today, which is the point of the requirement: an import from `data_job` + `data_job_item` (source hash, schema version, code version, per-row before/after); a correction from `data_change_request` + `audit_event`; a merge from `record_redirect` + its change request and audit row; a current fact from `GET /api/assets/:id/provenance`, which names the event, correction or migration that established it. Every one shares a `correlation_id` with its log line.

---

## Summary of the seventeen unchecked items

| Item | Why | Owner |
|---|---|---|
| CHK050, CHK108, CHK152 alerting | three stubs with the same cause: no alert destination | Englobe IT (R6) |
| CHK076, CHK141 redirect resolution | current endpoint exposes the full chain to every authenticated role; separate minimal Work and governed Administration projections are not proved | API/QA |
| CHK107 job progress/checkpoint | **gap** — column exists, nothing writes it; no long-running job yet | WS-W8, when one exists |
| CHK160 provenance | full lineage is currently too broad; purpose-sized projections and negative tests remain | API/QA |
| CHK163–CHK165 governed exports | legacy role/network-field subset does not prove the D18 intersection or complete general-export exclusion list | API/QA |
| CHK201 direct authorization | legacy role/office tests do not prove the full D18 negative matrix | API/QA |
| CHK204 performance budget | **gap** — no budget number is approved | Englobe IT (R6) |
| CHK207, CHK208 restore verification | tables and reconciliation exist; no restore has been exercised | Englobe IT (R6) |
| CHK210, CHK213 pilot observations | there is no pilot | pilot |
| CHK217 tested in non-production | tested locally; there is one environment | Englobe IT (R6) |

The target requirements are explicit, but seven legacy implementation/evidence claims are reopened
against D18. The other ten need an environment, destination, pilot, or approved performance budget.
None may be represented as production conformance before its named evidence exists.
