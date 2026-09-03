# Requirements Checklist — Feature 011 Data Management & Stewardship

**Feature:** `011-data-management`  
**Review status:** Open  
**Rule:** A checked item means the requirement is explicit, internally consistent, testable, and assigned. It does not mean implementation exists.

---

## Scope and governance

- [ ] CHK001 Data management is explicitly defined as an application capability, not unrestricted database administration.
- [ ] CHK002 The capability covers reference/master data, corrections, quality, bulk jobs, duplicates, lineage, exports, retention and reconciliation.
- [ ] CHK003 Data Owner, Data Steward, Office Admin, System Owner, Platform Operator and read-only audit responsibilities are defined.
- [ ] CHK004 Whether Data Steward is a distinct role is decided before authorization implementation.
- [ ] CHK005 Every data domain has a named business owner and stewardship responsibility before production acceptance.
- [ ] CHK006 Separation-of-duty operations and configurable approval thresholds are listed.
- [ ] CHK007 Requesters cannot self-approve configured high-impact operations.
- [ ] CHK008 Office-scoped and global stewardship powers are distinguished.
- [ ] CHK009 Platform Operators can execute/recover jobs without receiving authority to decide business meaning.
- [ ] CHK010 Feature 011 cannot bypass features 009/010 identity, authorization, audit, idempotency or transaction rules.

## Data dictionary and classification

- [ ] CHK011 A machine-readable data dictionary is required.
- [ ] CHK012 Every production field has a business definition and data type.
- [ ] CHK013 Every production field has an owner/steward.
- [ ] CHK014 Every production field declares authority mode.
- [ ] CHK015 Every production field maps to the approved corporate classification taxonomy.
- [ ] CHK016 Every production field declares roles permitted to read, write and export it.
- [ ] CHK017 Every production field declares whether it may be cached offline.
- [ ] CHK018 Every production field declares its retention class.
- [ ] CHK019 Every production field links to applicable quality rules and lineage source.
- [ ] CHK020 Dictionary/schema/API contract checks identify missing or contradictory entries.
- [ ] CHK021 Dictionary entries retain deprecation and replacement history.
- [ ] CHK022 Exact classification labels are treated as an open corporate-policy decision, not invented.

## Data authority

- [ ] CHK023 SystemDerived, AMSManaged, ExternalAuthoritative, ImportedOnce and ReferenceOnly modes are defined.
- [ ] CHK024 Ordinary edits to SystemDerived fields are refused.
- [ ] CHK025 Ordinary edits to ExternalAuthoritative fields are refused or follow an approved override route.
- [ ] CHK026 Field-level source authority is explicit for projects, people, asset identity, calibration and locations.
- [ ] CHK027 Current asset state remains derived from accepted business events.
- [ ] CHK028 Static master-data corrections do not silently mutate history.
- [ ] CHK029 Source overrides record reason, approver, duration and reconciliation consequence.

## Data Management Centre

- [ ] CHK030 A protected Data Management navigation area is specified.
- [ ] CHK031 Overview shows issues by severity, domain, office, owner and age.
- [ ] CHK032 Temporary tags, unknown custodians, calibration unknown/overdue, duplicate candidates and failed jobs appear on the overview.
- [ ] CHK033 Missing/quarantined documents and external reconciliation failures appear on the overview.
- [ ] CHK034 Every aggregate count links to records and the governing rule.
- [ ] CHK035 Dashboard data currency and rule version are visible.
- [ ] CHK036 High-impact recent changes and upcoming retention actions are visible to permitted roles.
- [ ] CHK037 Server-side filtering/paging is required; the full fleet is not downloaded into the browser.

## Quality rules

- [ ] CHK038 Quality rules are versioned.
- [ ] CHK039 Each rule has domain, severity, owner, schedule and implementation identity.
- [ ] CHK040 Re-running a rule updates one issue rather than creating duplicate open issues.
- [ ] CHK041 Issue identity includes enough scope to distinguish rule/record/relationship failures.
- [ ] CHK042 Issue first detected, last detected and age are stored.
- [ ] CHK043 Issue owner, office, due date and service level are stored.
- [ ] CHK044 Issue evidence and affected record links are stored.
- [ ] CHK045 Issue states include Open, Assigned, InProgress, Blocked, Resolved, Waived, FalsePositive and Reopened.
- [ ] CHK046 Claimed resolution is rule-verified or manually verified with approval.
- [ ] CHK047 Waiver requires reason, approver and expiry.
- [ ] CHK048 Expired waiver reopens/re-evaluates the issue.
- [ ] CHK049 False-positive history and prior rule versions are preserved.
- [ ] CHK050 Criticality/age thresholds alert a named owner.

## Initial rule coverage

- [ ] CHK051 Blank/malformed/duplicate canonical Asset ID rules exist.
- [ ] CHK052 Temporary-tag age and incomplete-identity rules exist.
- [ ] CHK053 Missing model/home office/required serial rules exist.
- [ ] CHK054 Prefix/model/identifier inconsistency rules exist.
- [ ] CHK055 Alias-collision rules exist.
- [ ] CHK056 Duplicate model-key and invalid/cyclic location rules exist.
- [ ] CHK057 Office-without-steward/admin rule exists.
- [ ] CHK058 Current-state versus event-replay reconciliation rule exists.
- [ ] CHK059 Multiple-open-parent and multiple-open-installation rules exist.
- [ ] CHK060 Overlapping relationship/installation span rules exist.
- [ ] CHK061 Retired-with-open-obligation rule exists.
- [ ] CHK062 Unknown custodian and stale checkout rules exist.
- [ ] CHK063 Calibration unknown/overdue/failed-summary rules exist.
- [ ] CHK064 Missing/orphan/hash-mismatch/scan-stale document rules exist.
- [ ] CHK065 Restricted-field-in-report/export/offline-cache rules exist.
- [ ] CHK066 Inactive-user-with-role/scope rule exists.
- [ ] CHK067 Production/synthetic contamination rule exists.
- [ ] CHK068 Retention-overrun-without-hold/exception rule exists.

## Reference and master data

- [ ] CHK069 Supported reference domains are listed.
- [ ] CHK070 Authorized create/edit/deactivate/reactivate operations are defined.
- [ ] CHK071 Referenced records cannot be ordinarily hard-deleted.
- [ ] CHK072 Historical records keep displaying deactivated references.
- [ ] CHK073 Deactivated references are excluded from new selections.
- [ ] CHK074 Duplicate business keys are refused.
- [ ] CHK075 Cyclic location hierarchy is refused.
- [ ] CHK076 Reference aliases resolve to canonical records.
- [ ] CHK077 Re-parenting impact includes authorization, reporting and notification consequences.
- [ ] CHK078 Reclassification/merge has an impact preview.
- [ ] CHK079 External-authoritative fields cannot be silently edited locally.
- [ ] CHK080 Applied reference changes trigger affected quality/summary recalculation.
- [ ] CHK081 Office Admin reference permissions are explicitly bounded.

## Static corrections

- [ ] CHK082 Permitted static asset correction types are listed.
- [ ] CHK083 Correction requires old value, proposed value, reason and evidence.
- [ ] CHK084 High-impact fields require impact preview.
- [ ] CHK085 Derived current-state fields cannot be corrected generically.
- [ ] CHK086 Canonical Asset ID cannot be changed after assignment.
- [ ] CHK087 Temporary/legacy identifiers remain aliases.
- [ ] CHK088 Transaction headers/lines cannot be edited or deleted through correction.
- [ ] CHK089 Home-office change uses the dedicated rehome workflow.
- [ ] CHK090 Relationship changes use recorded attach/detach operations.
- [ ] CHK091 Model correction considers calibration, identifier and reporting impact.
- [ ] CHK092 Applied correction re-runs related quality rules.
- [ ] CHK093 Approval and self-approval rules are defined per correction type/scope.
- [ ] CHK094 Correction audit includes requester, approver, evidence, effective time and applied time.

## Data jobs

- [ ] CHK095 Import, BulkUpdate, Export, Reconciliation, DuplicateResolution, ReferenceMerge, RetentionPreview, Purge and QualityRuleRun job types are defined.
- [ ] CHK096 Every job has immutable ID, type, environment and status.
- [ ] CHK097 Every job records schema/template version.
- [ ] CHK098 Every source-based job records file/source hash or checkpoint.
- [ ] CHK099 Every job records requester and approver where required.
- [ ] CHK100 Every job records transformation/code version.
- [ ] CHK101 Every job records total, valid, warning, invalid, applied, skipped and failed counts.
- [ ] CHK102 Every job has row/item-level outcomes.
- [ ] CHK103 Every job links to audit/correlation evidence.
- [ ] CHK104 Job artifact retention/expiry is defined.
- [ ] CHK105 Every write job declares Reversible, Compensatable or Irreversible.
- [ ] CHK106 Irreversible jobs require highest approval and recovery prerequisites.
- [ ] CHK107 Long-running jobs expose progress/checkpoint/retry-safe state.
- [ ] CHK108 Stuck/terminal jobs alert a named owner.

## Import and bulk update

- [ ] CHK109 Every import type has a versioned downloadable template.
- [ ] CHK110 File type, size, headers and schema version are validated.
- [ ] CHK111 Required fields, formats and reference resolution are validated.
- [ ] CHK112 Duplicate keys/candidates are reported.
- [ ] CHK113 Authorization and office scope are validated at row level.
- [ ] CHK114 Sensitive-field permission is validated at row level.
- [ ] CHK115 Direct writes to state/history are refused.
- [ ] CHK116 Dry run writes no business changes.
- [ ] CHK117 Dry run includes before/after preview and impact.
- [ ] CHK118 Apply refuses a changed source file.
- [ ] CHK119 Apply refuses expired approval or lost permission.
- [ ] CHK120 Apply refuses material target drift or new critical validation.
- [ ] CHK121 Logical atomic groups remain atomic within a batched job.
- [ ] CHK122 Every row gets a final outcome; none silently disappear.
- [ ] CHK123 Retry is idempotent.
- [ ] CHK124 Applied/unapplied/uncertain outcomes are distinguishable after failure.
- [ ] CHK125 Spreadsheet formula-injection controls are defined.

## Duplicate resolution

- [ ] CHK126 Detection produces candidates, not automatic merges.
- [ ] CHK127 Serial alone can never authorize merge.
- [ ] CHK128 Review shows identities, aliases, model, source lineage and current state.
- [ ] CHK129 Review shows transactions, calibrations, documents, relationships and installations.
- [ ] CHK130 Outcomes include NotDuplicate, RelatedPhysicalAssets, MergeRecords, RetireErroneousRecord and NeedsPhysicalAudit.
- [ ] CHK131 Reviewed non-duplicate decisions suppress repeat noise until evidence changes.
- [ ] CHK132 Physical-audit outcome creates an owned due issue.
- [ ] CHK133 Merge selects a survivor and creates permanent redirect/canonical mapping.
- [ ] CHK134 Former canonical ID remains searchable as alias.
- [ ] CHK135 Both original UUIDs and histories are preserved.
- [ ] CHK136 Immutable transaction lines are not rewritten.
- [ ] CHK137 Merged-away record cannot receive new operational events.
- [ ] CHK138 Consolidated timeline preserves source identity of each event.
- [ ] CHK139 Incompatible current states/ref obligations block merge until reconciled.
- [ ] CHK140 Merge requires evidence, requester, approver and impact audit.
- [ ] CHK141 Old links redirect with a visible explanation.

## External reconciliation

- [ ] CHK142 Each integration states field authority and direction.
- [ ] CHK143 Stable source key is defined.
- [ ] CHK144 Frequency/checkpoint and retry identity are defined.
- [ ] CHK145 Create/update/deactivate/delete behavior is defined.
- [ ] CHK146 Manual override and conflict behavior are defined.
- [ ] CHK147 Reconciliation reports new/changed/unchanged/missing/conflicting records.
- [ ] CHK148 Locally authoritative values are not silently overwritten.
- [ ] CHK149 Source-authoritative values are not ordinarily edited locally.
- [ ] CHK150 Historical references survive source deactivation.
- [ ] CHK151 Reprocessing a checkpoint is idempotent.
- [ ] CHK152 Stale/failed source alerts a named owner and data age is visible.
- [ ] CHK153 Applied fields link to source and mapping version.

## Lineage

- [ ] CHK154 Manual, migration, import, external sync, system-derived and synthetic provenance are distinguishable.
- [ ] CHK155 Source system and source record identifiers are retained where applicable.
- [ ] CHK156 Import/data-job ID is retained.
- [ ] CHK157 Original source-row reference is retained.
- [ ] CHK158 Transformation/mapping version is retained.
- [ ] CHK159 Merge/redirect chain is retained.
- [ ] CHK160 Important current facts expose a Why does the system say this view.
- [ ] CHK161 Derived state can identify the event that established each dimension or derive it deterministically.

## Exports

- [ ] CHK162 Export templates are approved and versioned.
- [ ] CHK163 Users see only templates permitted to their role.
- [ ] CHK164 Row, office and field restrictions are enforced server-side.
- [ ] CHK165 Restricted identifiers are absent from general exports.
- [ ] CHK166 Export records requester and purpose.
- [ ] CHK167 Export records filters, columns, row count, classification, template/version and expiry.
- [ ] CHK168 Export artifacts are private and authenticated.
- [ ] CHK169 Download access is audited where required.
- [ ] CHK170 Expired exports become inaccessible and are deleted according to policy.
- [ ] CHK171 Hold/approved exception behavior is defined.
- [ ] CHK172 Large/restricted exports require configured approval.
- [ ] CHK173 Field Users cannot request a raw fleet-wide export.
- [ ] CHK174 Export includes visible classification/export ID where the format supports it.

## Retention and legal hold

- [ ] CHK175 Retention register covers business records, documents, audit, quality, jobs, exports, outbox, logs, offline caches and backups.
- [ ] CHK176 Retention rules are versioned and approved.
- [ ] CHK177 No unapproved retention period is invented.
- [ ] CHK178 Existing indefinite asset/history retention is preserved unless formally superseded.
- [ ] CHK179 Legal hold records scope, authority, reason, owner and start.
- [ ] CHK180 Hold release authority and separation of duties are defined.
- [ ] CHK181 Retention preview writes no changes.
- [ ] CHK182 Preview identifies eligible, held and blocked records/documents.
- [ ] CHK183 Holds exclude matching items from purge.
- [ ] CHK184 Purge verifies policy version, dependencies, approval and recovery prerequisites.
- [ ] CHK185 Purge records exact database/document counts and post-action reconciliation.
- [ ] CHK186 Ordinary users have no general-purpose delete path for production history.
- [ ] CHK187 Database and document retention outcomes reconcile.

## Physical data model

- [ ] CHK188 `data_job` or equivalent is included in the canonical schema.
- [ ] CHK189 `data_job_item` or equivalent is included.
- [ ] CHK190 `data_quality_rule` is included.
- [ ] CHK191 `data_quality_issue` is included.
- [ ] CHK192 `data_change_request` is included.
- [ ] CHK193 `record_redirect` is included.
- [ ] CHK194 `retention_policy` is included.
- [ ] CHK195 `legal_hold` is included.
- [ ] CHK196 source/lineage link structure is included.
- [ ] CHK197 Existing audit/document/alias/outbox entities are reused rather than duplicated.
- [ ] CHK198 Keys, indexes, constraints, retention and authorization are specified for each addition.

## Security, performance and recovery

- [ ] CHK199 Sensitive values are redacted from logs and unauthorized validation results.
- [ ] CHK200 Job source files and artifacts are private and time-limited.
- [ ] CHK201 Data-management APIs have direct cross-role/cross-office tests.
- [ ] CHK202 High-impact approvals cannot be bypassed with direct API calls.
- [ ] CHK203 Data-management pages are usable at 5,000 active assets and 100,000 transaction lines.
- [ ] CHK204 A 5,000-row dry run meets the approved performance budget.
- [ ] CHK205 Data jobs do not hold disruptive locks beyond the approved budget.
- [ ] CHK206 Worker restart after partial progress produces no duplicate effects.
- [ ] CHK207 Database restore retains/reconciles data-job, quality, redirect, retention and lineage evidence.
- [ ] CHK208 Blob/document reconciliation is part of restore verification.
- [ ] CHK209 Synthetic production contamination is structurally refused.

## Pilot gates

- [ ] CHK210 All critical migration/reference-data issues are resolved or explicitly approved before pilot.
- [ ] CHK211 Model-review and duplicate-conflict sign-offs remain mandatory.
- [ ] CHK212 Data dictionary coverage reaches 100% of production fields.
- [ ] CHK213 No direct derived-state/history corrections occur during pilot.
- [ ] CHK214 Every bulk job reconciles requested/applied/skipped/failed counts exactly.
- [ ] CHK215 No valid shared-serial pair is auto-merged.
- [ ] CHK216 Every export is authorized, private, audited and expired according to policy.
- [ ] CHK217 Retention/hold behavior is tested in non-production before activation.
- [ ] CHK218 A successor can explain a sampled import, correction, merge and current fact from lineage/audit evidence.
