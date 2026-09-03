# 16 — Data Management and Stewardship

**Decision date:** 2026-09-03  
**Status:** Required capability added after review of the web-application specifications. Detailed implementation remains a draft until roles, retention periods, and approval thresholds are confirmed.  
**Owning feature:** `specs/011-data-management/spec.md`  
**Related:** `docs/15-postgres-data-model.md`, features 001, 002, 006, 009 and 010.

---

## 1. Finding

The programme already contained several parts of data management:

- reference tables for equipment models, locations and projects;
- migration profiling, cleaning, deduplication and row-level reports;
- immutable operational history;
- audit metadata;
- security and office scope;
- backup and restore requirements;
- retention of retired assets and calibration evidence;
- reporting and data-quality findings from the legacy source.

Those parts were distributed across feature specifications and architecture documents. They did **not** yet form one complete, user-facing and governable data-management capability.

Missing or incomplete areas included:

- named data ownership and stewardship;
- an administration centre for managing reference and master data;
- controlled static-data corrections;
- bulk import, bulk update and export workflows;
- reusable data-quality rules and an issue-resolution queue;
- post-go-live duplicate resolution without rewriting history;
- lineage from source/import/transformation to the current record;
- a data dictionary and classification register;
- retention, legal hold and approved purge workflows;
- reconciliation of authoritative external sources;
- auditable export controls and short-lived export artifacts;
- measurable data-management service levels.

Feature 011 closes that gap.

---

## 2. Objectives

The data-management capability must let authorized people answer:

1. Who owns each category of data?
2. Which system or person is authoritative for each field?
3. What data is incomplete, invalid, duplicated, stale or inconsistent?
4. Who is responsible for correcting each issue, and by when?
5. What changed, why, by whom, through which source or import?
6. Can a large set of records be validated before it changes production?
7. Can duplicate records be resolved without deleting or rewriting history?
8. What data is retained, held, archived or deleted, under which approved rule?
9. Who exported data, what did the export contain, and when did it expire?
10. Can every import, correction, merge, purge and reconciliation be reproduced and audited?

Data management is not a direct database editor. It is a set of controlled, validated business operations over the same API and audit boundaries as the operational application.

---

## 3. Roles and accountability

The following are responsibility concepts. Exact Entra role/group mapping must be approved before implementation.

| Responsibility | Accountable for |
|---|---|
| **Data Owner** | Business meaning, acceptable quality, retention approval, authoritative-source decisions, high-impact merge/purge approval |
| **Data Steward** | Reference data, quality rules, issue triage, controlled corrections, imports, duplicate resolution and lineage review |
| **Office Admin** | Office-scoped asset completion, local corrections, local quality issues and approved local exports |
| **System Owner** | Application policy, emergency controls, role assignment, cross-office operations and exceptional repair approval |
| **Platform Operator** | Database/storage operations, backup/restore, job execution, monitoring and infrastructure—not business meaning |
| **Report Reader / Auditor** | Read-only quality, lineage, change and reconciliation evidence |

A Data Steward may be implemented as a distinct application role or as a constrained permission set assigned to selected System Owners. That mapping is an explicit decision; the application must not silently give every Office Admin global stewardship powers.

### Separation of duties

At minimum, a user must not approve their own high-impact operation when the operation:

- merges asset records with operational history;
- changes the canonical model classification for many assets;
- performs a bulk cross-office correction;
- changes a retention policy;
- releases data from legal hold;
- permanently purges retained data;
- exports restricted data at scale.

The exact thresholds are configurable and approved by the Data Owner.

---

## 4. Data domains and authority

A committed data dictionary identifies the owner, steward, classification, authority and quality rules for every managed field.

Initial domains:

| Domain | Examples | Default authority |
|---|---|---|
| Asset identity | UUID, canonical Asset ID, aliases, serial, secondary identifiers | AMS registration/migration under server rules |
| Asset classification | Manufacturer, model, equipment type, asset group | AMS curated equipment catalogue |
| Asset ownership | Owned, rented, leased, client-owned, owner organization | AMS Data Steward / approved source |
| Asset operating state | Lifecycle, disposition, serviceability, current location, custodian, project, parent | Derived exclusively from accepted AMS events |
| Locations | Regions, offices, sites, vehicles, labs, hierarchy | AMS location catalogue; office hierarchy stewarded in app |
| Projects | Number, name, client, status, PM | Project master when approved; otherwise AMS curated records |
| People and access | Entra identity, role, office scope, active state | Entra plus AMS authorization assignments |
| Calibration | Records, dates, outcomes, due dates, certificates | AMS records supported by laboratory evidence |
| Installations | Site, project, components, roles, orientation, dates | Accepted AMS deployment/recovery events |
| Documents | Certificate metadata, hash, scan state, retention | AMS metadata + private object storage |
| Audit and lineage | Actor, source, import, transformation, approval | Generated by AMS and immutable/audited |

For each attribute, the dictionary must state one authority mode:

```text
SystemDerived
AMSManaged
ExternalAuthoritative
ImportedOnce
ReferenceOnly
```

An `ExternalAuthoritative` field is not freely edited in AMS. A correction is made at the source or through a documented exception that records the override and reconciliation consequence.

---

## 5. Data Management Centre

The web application includes a Data Management area available only to authorized roles.

### 5.1 Overview

Shows:

- critical/high/medium data-quality issues;
- unresolved issue age and ownership;
- temporary tags and incomplete assets;
- unknown custodians and stale checkouts;
- calibration unknown/overdue counts;
- duplicate candidates awaiting review;
- failed or incomplete data jobs;
- missing or quarantined documents;
- reference records needing attention;
- reconciliation failures with external sources;
- recent high-impact data changes;
- upcoming retention/purge actions;
- quality trends by office and domain.

Every count links to the underlying records and applied rule.

### 5.2 Reference data

Authorized users can manage:

- equipment models;
- asset groups and equipment types where policy permits extension;
- locations and hierarchy;
- calibration laboratories;
- projects when AMS is authoritative;
- ownership types and controlled reason lists where designed as configurable;
- office stewardship assignments.

Supported operations:

- create;
- edit permitted static attributes;
- deactivate/reactivate;
- re-parent locations;
- merge duplicate reference records;
- add searchable aliases;
- view usage/impact before change;
- view full audit and lineage.

Referenced records are not hard-deleted from ordinary screens. Deactivation is preferred. A merge or reclassification previews every affected asset, report and validation rule before application.

### 5.3 Asset data correction

Authorized users may correct static facts through named operations, not arbitrary row editing.

Examples:

- correct serial number;
- add/remove a non-canonical alias;
- correct equipment model after evidence review;
- correct ownership type/organization;
- correct acquired date;
- add or correct notes;
- complete a temporary-tagged asset;
- rehome an asset through the `RehomeAsset` event;
- attach or detach a permanent component through a recorded event.

Not permitted through a generic correction form:

- direct lifecycle, disposition or serviceability edits;
- direct current location, custodian, project or parent edits;
- editing or deleting transaction lines;
- changing the canonical Asset ID after assignment;
- silently changing historical effective dates;
- replacing a failed calibration result with a pass without a correction/supersession trail.

Every correction records the old value, new value, evidence/reference, reason, requester, approver where required, effective time, applied time and resulting validations.

### 5.4 Data jobs

One job framework covers:

```text
Import
BulkUpdate
Export
Reconciliation
DuplicateResolution
ReferenceMerge
RetentionPreview
Purge
QualityRuleRun
```

Every job has:

- immutable job ID;
- job type and schema/template version;
- environment and mode;
- requester and approver where required;
- source file hash or source-system checkpoint;
- dry-run result;
- total, valid, warning, invalid, applied, skipped and failed counts;
- row/item-level outcomes;
- start/completion times;
- code/transformation version;
- reversible/compensating plan;
- artifact retention and expiry;
- correlation to audit events and affected records.

No bulk write applies before a successful dry run and explicit review. Re-running the same approved input with the same idempotency identity does not create duplicate effects.

### 5.5 Quality issues

Data-quality rules create managed issues rather than only dashboard counts.

Each issue includes:

- rule ID/version;
- domain and entity;
- affected record(s);
- severity;
- first detected, last detected and age;
- office and steward;
- evidence/details;
- status;
- due date/service level;
- resolution, waiver or false-positive reason;
- waiver expiry;
- related correction, import or merge job;
- verification result after resolution.

Issue states:

```text
Open
Assigned
InProgress
Blocked
Resolved
Waived
FalsePositive
Reopened
```

A resolved issue closes only after the rule re-runs successfully or an approved manual verification is recorded.

---

## 6. Initial data-quality rule catalogue

### Asset identity and completeness

- blank or malformed canonical Asset ID;
- duplicate canonical Asset ID;
- temporary tag older than threshold;
- missing equipment model;
- missing required home office;
- serial absent where model requires one;
- model/serial prefix inconsistency;
- duplicate candidate based on configurable evidence;
- alias collision;
- synthetic marker in a non-synthetic environment.

### Reference integrity

- inactive reference used for a new assignment;
- cyclic or invalid location hierarchy;
- office without an assigned steward/admin;
- duplicate equipment-model key;
- project missing authoritative status;
- external-authoritative record diverged from source;
- orphaned or unreferenced reference alias.

### Operational integrity

- current-state projection disagrees with event replay;
- asset in two open installations;
- child with two open parents;
- relationship or installation spans overlap;
- retired asset with unresolved open custody/installation;
- stale checkout beyond policy;
- unknown custodian;
- missing physical location where a transition requires one;
- transaction/outbox reconciliation failure.

### Calibration and documents

- calibrated model with unknown due date;
- overdue calibration;
- failed calibration incorrectly advancing successful summary;
- duplicate calibration candidate;
- record with missing certificate where certificate is required;
- metadata points to missing Blob object;
- object exists without database metadata;
- hash mismatch;
- malware scan pending/failed beyond threshold;
- expired or invalid laboratory/reference record.

### Privacy and security

- restricted field included in a general report/export projection;
- Field User offline store contains restricted data;
- expired export artifact still accessible;
- inactive user retains application role/scope;
- production value present in a synthetic/demo dataset;
- data retained beyond policy without legal hold or exception.

The rule catalogue is versioned. Rule changes do not rewrite old issue history.

---

## 7. Duplicate resolution

Duplicate detection produces **candidates**, never automatic merges based only on serial, model or similar text. Shared serials are an established valid pattern.

### 7.1 Review

A duplicate review shows:

- both identities and aliases;
- model and serial evidence;
- source/migration lineage;
- current state;
- transaction, calibration, document, relationship and installation counts;
- conflicting fields;
- effect of choosing either survivor;
- records that cannot be safely consolidated automatically.

### 7.2 Resolution outcomes

```text
NotDuplicate
RelatedPhysicalAssets
MergeRecords
RetireErroneousRecord
NeedsPhysicalAudit
```

### 7.3 Merge behavior

A post-go-live merge must not rewrite immutable transaction lines merely to make history appear cleaner.

The operation:

1. selects a surviving canonical asset record;
2. marks the duplicate record as merged/non-operational;
3. creates a permanent redirect/canonical mapping;
4. retains the former canonical Asset ID as a searchable alias;
5. preserves both original UUIDs, source lineage and histories;
6. presents a consolidated timeline through the canonical mapping;
7. reconciles current state explicitly and refuses incompatible unresolved states;
8. moves or associates permissible static facts/documents under approved rules;
9. records requester, approver, evidence and full impact;
10. prevents further operational commands against the merged-away record.

Reference-record merges follow equivalent redirect/alias behavior and show impact before application.

---

## 8. Imports and bulk updates

### 8.1 Templates and contracts

Every import type has a versioned schema, downloadable template and data dictionary.

The system validates:

- file type and size;
- headers/schema version;
- required fields;
- value types and formats;
- reference resolution;
- duplicate keys;
- authorization and office scope;
- sensitive-field permissions;
- operation-specific business rules;
- row dependencies;
- environment restrictions;
- source file hash and prior processing.

### 8.2 Dry run

A dry run writes no business changes. It provides:

- summary counts;
- row-level errors/warnings;
- before/after preview;
- new references that would be required;
- duplicate candidates;
- authorization failures;
- quality issues expected to open/close;
- irreversible or high-impact operations;
- estimated duration and affected offices.

### 8.3 Apply

After authorized approval, the apply step uses the validated snapshot and refuses if:

- the source file changed;
- the schema version is no longer supported;
- relevant target rows changed materially since dry run;
- approval expired;
- requester no longer has permission;
- a new critical validation fails.

The job may apply in transactionally safe batches for scale, but every row has a final outcome and no failure is silently lost. Logical groups that must remain atomic are committed together.

### 8.4 Rollback and compensation

A job declares before application whether it is:

```text
Reversible
Compensatable
Irreversible
```

Irreversible jobs require the highest approval threshold and a verified backup/recovery point. Operational history is compensated, not deleted.

---

## 9. Exports

Exports are controlled data products, not unrestricted database downloads.

Every export:

- uses an approved named view/template;
- enforces role, office scope and field classification;
- excludes restricted fields unless specifically authorized;
- records requester, purpose, filters, row count, columns, classification and time;
- receives a unique export ID;
- is generated server-side;
- is stored privately with a short expiry;
- is protected by authenticated download;
- records download events where required;
- is deleted automatically after expiry unless held under approved exception;
- carries a visible classification/footer where the format supports it;
- never packages database credentials or internal storage paths.

Field Users do not receive unrestricted fleet exports. Data Steward/System Owner export powers are still bounded by approved templates and auditing.

---

## 10. Lineage and provenance

Every managed record must be traceable to its origin and transformations.

Minimum provenance:

- `source_type`: manual, migration, import, external sync, system-derived, synthetic;
- source system and source record identifier where applicable;
- import/data-job ID;
- original source-row reference;
- transformation/mapping version;
- first-created actor and time;
- last-approved static correction and time;
- synthetic seed where applicable;
- merge/redirect chain where applicable.

Derived current state also records the transaction line/event that last established each state dimension or can produce it through a deterministic query.

The user interface offers a **Why does the system say this?** view for important facts such as current custodian, location, project, model, calibration due date and merged identity.

---

## 11. Data dictionary and classification

The data dictionary is committed in a machine-readable format and rendered in the application or documentation.

For each field:

- entity and logical name;
- display name and definition;
- business owner and steward;
- data type and allowed values;
- required/optional rule;
- authority mode;
- sensitivity/classification mapped to the approved corporate taxonomy;
- roles allowed to read/write/export;
- offline-cache permission;
- retention class;
- quality rules;
- lineage source;
- report usage;
- deprecation/replacement history.

Schema and API contract checks fail when a production field lacks a dictionary entry or conflicts with its declared sensitivity/offline/export rule.

---

## 12. Retention, legal hold and deletion

### 12.1 Retention register

A reviewed register covers at least:

- active and retired assets;
- immutable transactions and relationships;
- calibration records and certificates;
- installation history;
- audit events;
- data-quality issues;
- data jobs and source files;
- generated exports;
- outbox events;
- application/security logs;
- idempotency response payloads;
- offline caches;
- database backups and Blob versions/snapshots.

Existing programme decision: retired assets and their operational history are retained indefinitely unless a later approved corporate/legal policy supersedes it. Exact periods for other classes remain decisions; the system must not invent them.

### 12.2 Legal hold

A legal hold:

- identifies scope and authority;
- records start, reason and owner;
- suspends automated purge for matching records/documents;
- is visible during purge preview;
- cannot be released by the same user who created it when separation of duties applies;
- records release authority and time.

### 12.3 Purge

Purge is a controlled job with:

- dry-run preview;
- retention-rule version;
- legal-hold check;
- dependency/relationship check;
- owner approval;
- verified recovery point where required;
- exact record/object counts;
- immutable audit result;
- post-purge reconciliation.

The application provides no general-purpose delete button for production business history.

---

## 13. External-source synchronization

Before synchronizing Entra users, projects or another master source, the integration contract states:

- source and target authority per field;
- direction: inbound, outbound or bidirectional;
- stable source key;
- synchronization frequency/checkpoint;
- create/update/deactivate behavior;
- manual override policy;
- conflict policy;
- deletion behavior;
- retry/idempotency;
- reconciliation report;
- stale-source alert;
- privacy/security scope;
- backfill and cutover plan.

A sync does not directly overwrite system-derived asset state or immutable event history.

---

## 14. Proposed physical additions

The exact physical schema is finalized with `docs/15-postgres-data-model.md`. Feature 011 requires these entities or equivalent structures:

### `data_job`

Header for import, export, bulk update, reconciliation, quality, merge, retention and purge operations.

Key fields:

```text
id
job_type
status
schema_version
environment
requested_by
approved_by
source_name
source_hash
request_parameters
code_version
dry_run_summary
result_summary
started_at
completed_at
artifact_path
artifact_expires_at
correlation_id
```

### `data_job_item`

Row/entity-level validation and application result.

```text
job_id
item_number
source_reference
entity_type
entity_id
operation
status
severity
messages
before_data
after_data
applied_at
```

### `data_quality_rule`

Versioned rule metadata, severity, owner, schedule and implementation key.

### `data_quality_issue`

Issue instance, affected record, owner, dates, state, resolution/waiver and verification.

### `data_change_request`

Controlled static correction, reference change, merge or high-impact operation with evidence and approval.

### `record_redirect`

Permanent source-to-survivor mapping for merged assets/reference records without rewriting immutable history.

### `legal_hold`

Hold scope, authority, period and release record.

### `retention_policy`

Versioned retention class and action. Policy versions are approved and immutable after activation.

### `data_source_record`

Optional normalized link from a managed entity to source system/row, import job and transformation version.

The existing `audit_event`, `document`, asset aliases and outbox entities are reused rather than duplicated.

---

## 15. API modules

Suggested modules:

```text
server/src/modules/data-management/
  overview/
  reference-data/
  corrections/
  jobs/
  imports/
  exports/
  quality/
  duplicates/
  lineage/
  retention/
  reconciliation/
```

All modules use the normal identity, authorization, audit, idempotency, transaction and outbox infrastructure.

High-impact data operations use dedicated commands. A generic endpoint such as `PATCH /table/{id}` that can bypass domain rules is prohibited.

---

## 16. Non-functional requirements

- Data-management pages support at least 5,000 active assets and 100,000 transaction lines without requiring a full client-side dataset.
- Large job processing is asynchronous after validation/approval, with visible progress and resumable/retry-safe workers.
- Quality rules are incremental where practical and report their last successful run/data checkpoint.
- Dashboard counts state data currency.
- Every job and issue is searchable and exportable through an approved audit view.
- Sensitive values are redacted in logs and validation messages.
- Source files and generated exports are private and time-limited.
- Job workers are idempotent and recoverable after process failure.
- No data-management job blocks ordinary checkout/return longer than the approved database-lock budget.

---

## 17. Delivery order

1. Approve ownership, stewardship roles and separation-of-duty thresholds.
2. Approve data dictionary/classification format.
3. Add physical data-job, quality, correction, redirect, retention and lineage structures.
4. Build read-only Data Management overview and quality rules.
5. Build reference-data management with impact preview and audit.
6. Build controlled single-record corrections.
7. Build import dry run and row-level results.
8. Build approved bulk apply and reconciliation.
9. Build duplicate candidate review and merge/redirect.
10. Build controlled exports and expiry.
11. Build retention register, legal hold and purge preview.
12. Verify security, scale, recovery and audit evidence before pilot.

Feature 011 work begins after the canonical schema/authorization model and atomic command infrastructure are stable. The read-only quality dashboard may begin earlier using approved views.

---

## 18. Open decisions

1. Whether `DataSteward` is a distinct Entra/application role.
2. Named Data Owner and steward for each domain/office.
3. Two-person approval thresholds.
4. Corporate data-classification labels to map into the dictionary.
5. Exact retention periods beyond the existing indefinite asset/history decision.
6. Legal-hold authority and release process.
7. Which bulk operations Office Admins may perform within an office.
8. Which export templates and maximum row/field scopes are initially approved.
9. Whether source files are retained after successful import and for how long.
10. Project-master authority and synchronization behavior.
11. Duplicate-merge policy when two records contain conflicting post-go-live operational histories.
12. Whether data-quality service levels differ by severity or office.

These are approval gates, not implementation guesses.
