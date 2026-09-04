# Feature Specification: Data Management & Stewardship

**Feature Branch**: `011-data-management`  
**Created**: 2026-09-03  
**Status**: Draft — partial capabilities existed across features 001, 002, 006, 009 and 010; this feature defines the missing end-to-end data-management capability.  
**Input**: `docs/00-brief.md`, `docs/04-migration.md`, `docs/13-production-readiness-review.md`, `docs/16-data-management.md`, and feature specifications 001, 002, 006, 009 and 010.

**Access amendment (D18, 2026-09-04):** Data Management belongs only to the Administration
workspace and exact data-governance capabilities. General Report Readers receive neither its routes
nor its issue/dictionary/job payloads; approved report metrics and audit evidence use separate
purpose-sized projections. See
[`docs/25-need-to-know-access-ux.md`](../../docs/25-need-to-know-access-ux.md).

---

## Purpose

The operational application records what happens to equipment. Data management keeps the information trustworthy as the fleet, offices, projects, people, integrations and history grow.

This feature gives authorized users a controlled way to manage reference data, correct static facts, validate bulk changes before applying them, monitor and resolve data-quality issues, review duplicate candidates, preserve lineage, create governed exports, and apply retention or legal-hold rules.

It does **not** create a direct table editor. It must not provide a shortcut around immutable history, server-derived asset state, office scope, field security, or the event-based operating model.

---

## Users

| Persona | Needs |
|---|---|
| Office Admin | Resolve office-scoped incomplete records, correct approved static facts, manage permitted local reference data and run approved exports |
| Data Steward responsibility | Capability bundle assigned within the decided OfficeAdmin/SystemOwner scope; maintain permitted reference/master data, quality rules/issues, bulk jobs, duplicate candidates and lineage |
| Data Owner | Approve definitions, quality thresholds, authoritative sources, high-impact operations and retention rules |
| System Owner | Configure permissions and exceptional controls; approve or perform tightly controlled cross-office operations |
| Platform Operator | Run and monitor jobs, backups and recovery without deciding business meaning |
| Auditor | Read only the case-scoped quality, lineage, change, export, retention and reconciliation evidence approved for an engagement |
| Report Reader | Uses the separate Reports workspace only; receives approved aggregate metrics/exports, not Data Management routes or records |

`Data Steward` is a responsibility/capability bundle, not a fifth application role (OD-2). It is
bounded by R5: assigned-office scope for OfficeAdmin and a global ceiling for SystemOwner. Every
route/action still requires its exact purpose and capability; neither role receives the whole bundle
automatically.

---

## User Scenarios & Testing

### User Story 1 — See whether the data is trustworthy and own every issue (Priority: P1)

A Data Steward opens one page and sees what is wrong: duplicate candidates, temporary tags, missing models, unknown custodians, invalid relationships, missing calibration evidence, stale reference records and failed reconciliations. Each issue names the affected record, severity, responsible person, age and next action.

**Why this priority**: A dashboard that only counts bad data does not improve it. The programme needs a working queue that assigns, resolves and verifies issues so trust can be measured rather than assumed.

**Independent Test**: Seed one example of every critical rule, run the rules, assign issues to two offices, resolve some, waive one with an expiry, and confirm the dashboard and issue history reflect every state correctly.

**Acceptance Scenarios**:

1. **Given** active quality rules, **When** they run, **Then** each failing record creates or updates one identifiable issue rather than creating duplicate issues every run.
2. **Given** a quality issue, **When** it is opened, **Then** the rule, evidence, affected record, severity, first/last detection, age, office, owner and required action are visible.
3. **Given** an open issue, **When** an authorized steward assigns it, **Then** the assignee and due date are recorded and visible.
4. **Given** a user claims an issue is resolved, **When** the rule is run again, **Then** the issue closes only if the record now passes or an approved manual verification is recorded.
5. **Given** a temporary exception, **When** a steward waives an issue, **Then** a reason, approver and expiry are required, and the issue reopens after expiry if it still fails.
6. **Given** a false positive, **When** it is marked as such, **Then** the evidence and rule version are retained so the rule can be improved without erasing history.
7. **Given** multiple offices, **When** the overview is filtered by office, domain or severity, **Then** every count and issue list respects the same filter.
8. **Given** a dashboard count, **When** it is displayed, **Then** its rule version and data currency are available.
9. **Given** a critical integrity or restricted-data issue, **When** it is detected, **Then** the named owner is alerted according to the approved service level.

---

### User Story 2 — Maintain reference and master data without creating new inconsistency (Priority: P1)

A steward adds a new equipment model, corrects a model classification, deactivates an obsolete location, re-parents an office, and merges two duplicate project records. Before saving a high-impact change, the system shows what assets, reports, rules and workflows will be affected.

**Why this priority**: Every operational record depends on curated models, locations, projects and people. Without governed maintenance, the new system will accumulate the same spelling and classification problems as the spreadsheet.

**Independent Test**: Create, edit, deactivate, re-parent and merge representative reference records, including attempted duplicate keys and cyclic locations. Verify authorized changes, blocked invalid changes, impact previews and audit history.

**Acceptance Scenarios**:

1. **Given** an authorized steward, **When** they create reference data, **Then** every required structured field is supplied and duplicate business keys are refused.
2. **Given** a reference record already in use, **When** deletion is attempted, **Then** deletion is refused and deactivation or approved merge is offered.
3. **Given** a deactivated record, **When** users create a new operational record, **Then** the deactivated value is not offered, while historical records continue to display it.
4. **Given** a location re-parenting, **When** a cycle would be created, **Then** the change is refused.
5. **Given** a model reclassification or reference merge, **When** the steward previews it, **Then** affected records, validations, reports and unresolved conflicts are shown before application.
6. **Given** a change to an externally authoritative value, **When** a steward tries to edit it locally, **Then** the system directs them to the source or requires a documented approved override.
7. **Given** an office-scoped administrator, **When** they access reference management, **Then** they can change only the data types and offices explicitly permitted to them.
8. **Given** any reference change, **When** it is applied, **Then** before/after values, requester, approver where required, evidence, reason and time are retained.
9. **Given** a reference alias such as a legacy spelling, **When** it is searched or imported, **Then** it resolves to the canonical record without reintroducing the spelling as a new record.

---

### User Story 3 — Correct an asset fact safely without editing history or current state (Priority: P1)

An Office Admin discovers that an asset’s serial number or model was recorded incorrectly. They submit a correction with evidence. The correct static fact becomes visible, but the system does not directly alter current custody, location, project, lifecycle, serviceability or past transaction lines.

**Why this priority**: Real data will contain mistakes after go-live. If the only correction route is a database edit, the application’s integrity rules will be bypassed as soon as the first urgent problem appears.

**Independent Test**: Correct a serial, model, ownership type and note; attempt to change a canonical Asset ID and current location through the correction route; perform a rehome through its business event; verify audit, quality and history results.

**Acceptance Scenarios**:

1. **Given** an approved static field, **When** a correction is requested, **Then** old value, proposed value, reason and evidence are required.
2. **Given** a high-impact field such as equipment model, **When** it is changed, **Then** an impact preview includes calibration, identifier, reporting and validation consequences.
3. **Given** a field that is server-derived from events, **When** a direct correction is attempted, **Then** it is refused and the appropriate business event or compensating event is offered.
4. **Given** a canonical Asset ID already assigned, **When** a user attempts to change it, **Then** the change is refused; an old/temporary value can only be retained or added as an alias under approved rules.
5. **Given** an immutable transaction line, **When** a user attempts to edit or delete it, **Then** the operation is refused; corrections create a new linked event.
6. **Given** a home-office change, **When** it is approved, **Then** it is recorded through the dedicated rehome workflow rather than a silent field update.
7. **Given** a correction within an Office Admin’s scope, **When** it is applied, **Then** the associated quality issue is re-evaluated.
8. **Given** a correction requiring approval, **When** the requester is also the approver, **Then** it is refused where separation of duties applies.
9. **Given** any applied correction, **When** an auditor opens the record, **Then** they can see what changed, why, by whom, who approved it, and which source or evidence supported it.

---

### User Story 4 — Validate and apply a bulk import or update without guessing (Priority: P2)

A steward receives a file containing newly purchased assets or corrected ownership details. They upload it, choose the versioned import type, and run a dry run. The system explains every valid row, warning, error, duplicate candidate, unresolved reference and unauthorized change before anything is written.

**Why this priority**: Bulk work is unavoidable at this fleet size, but a generic spreadsheet import would recreate direct state edits and silent failures. Validation and traceability must be part of the product.

**Independent Test**: Upload a mixed file containing valid rows, invalid references, duplicate identifiers, cross-office records, a direct-state field, and an unchanged retry. Review the dry run, apply the approved subset, and confirm row-level outcomes and idempotency.

**Acceptance Scenarios**:

1. **Given** an import type, **When** a user begins, **Then** a versioned template and field dictionary are available.
2. **Given** an uploaded file, **When** validation runs, **Then** file hash, schema version, row count and requester are recorded.
3. **Given** a dry run, **When** it completes, **Then** it makes no business-data changes.
4. **Given** validation results, **When** the user reviews them, **Then** every row has a status, messages and before/after preview where applicable.
5. **Given** a row attempting to write current state or immutable history, **When** it is validated, **Then** it is refused rather than translated into a hidden direct edit.
6. **Given** unresolved or duplicate reference text, **When** validation runs, **Then** the row is held for mapping or correction; no new free-text reference is invented.
7. **Given** an approved dry run, **When** apply begins, **Then** it refuses if the source file changed, approval expired, permissions changed, or material target rows changed since preview.
8. **Given** a large job, **When** it applies in batches, **Then** every logical group that must remain atomic does so and every row receives a final outcome.
9. **Given** the same approved source and idempotency identity, **When** the job is retried, **Then** it does not create duplicate effects.
10. **Given** a failed job, **When** it is inspected, **Then** applied, unapplied and uncertain items are distinguishable and a documented retry or compensation path exists.
11. **Given** a bulk cross-office or restricted operation, **When** apply is requested, **Then** the required second approval is enforced.

---

### User Story 5 — Resolve duplicate records without merging legitimate shared serials or rewriting history (Priority: P2)

A quality rule identifies two asset records as possible duplicates. A steward compares the records, histories, documents and current states. They may decide the records are separate physical assets, request a physical audit, retire an erroneous record, or merge the records through a permanent redirect while preserving both original histories.

**Why this priority**: Duplicate records are inevitable over time. Serial alone cannot decide them because this fleet deliberately contains valid shared-serial pairs.

**Independent Test**: Review a valid logger/geophone shared-serial pair, a clear duplicate before use, and a duplicate with post-go-live histories. Confirm no automatic merge, correct resolution choices, permanent redirect and consolidated read behavior.

**Acceptance Scenarios**:

1. **Given** two records sharing a serial, **When** a duplicate rule runs, **Then** they are candidates only; neither is automatically merged.
2. **Given** a candidate, **When** a steward reviews it, **Then** the base comparison shows only the
   identity and current conflict facts needed for the decision; history, calibration, document, and
   lineage sections appear only through their separately approved purpose/capability/projection.
3. **Given** two legitimate related physical assets, **When** marked Not Duplicate or Related Physical Assets, **Then** future detection respects that reviewed decision unless material evidence changes.
4. **Given** uncertain evidence, **When** Needs Physical Audit is selected, **Then** an assigned issue and due date are created.
5. **Given** an approved merge, **When** it applies, **Then** one survivor is selected, old identifiers remain searchable, the merged-away record cannot receive new operational events, and no immutable transaction line is rewritten.
6. **Given** histories on both records, **When** the survivor timeline is opened, **Then** a consolidated view preserves the source identity of every historical event.
7. **Given** incompatible current states, **When** a merge is attempted, **Then** it is refused until an explicit reconciliation decision is approved.
8. **Given** a merge, **When** it completes, **Then** requester, approver, evidence, impact, redirect and resulting quality checks are recorded.
9. **Given** an old link or old Asset ID for the merged-away record, **When** an authorized user opens or searches it, **Then** they are redirected to the survivor with a visible merge explanation.

---

### User Story 6 — Reconcile data with an authoritative external source (Priority: P3)

The project master or directory changes. A steward sees what is new, changed, inactive or conflicting before synchronized data updates the application. The system knows which source owns which field and does not overwrite locally authoritative information by accident.

**Why this priority**: Projects and people will eventually come from other systems. Without an explicit authority and reconciliation model, integration becomes another uncontrolled bulk edit.

**Independent Test**: Reconcile an external snapshot containing new, changed, inactive, missing and conflicting records. Verify source authority, stable keys, dry-run results, approved updates and unresolved conflicts.

**Acceptance Scenarios**:

1. **Given** an integration, **When** it is configured, **Then** authority, direction, stable key, frequency, field mapping, deletion/deactivation behavior and conflict policy are documented.
2. **Given** a source snapshot or checkpoint, **When** reconciliation runs, **Then** new, changed, unchanged, missing and conflicting records are counted and listed.
3. **Given** a source-owned field, **When** a local user attempts an ordinary edit, **Then** it is refused or recorded as an approved override according to policy.
4. **Given** a locally owned field, **When** the source differs, **Then** the source does not overwrite it silently.
5. **Given** a person or project becomes inactive at the source, **When** synchronization applies, **Then** historical references remain and new assignment behavior follows the approved rule.
6. **Given** a synchronization retry, **When** the same checkpoint is processed again, **Then** it produces no duplicate effect.
7. **Given** a stale or failing integration, **When** its service level is exceeded, **Then** the responsible owner is alerted and the age of source data is visible.
8. **Given** a synchronization operation, **When** completed, **Then** a reconciliation report links each changed record to its source and transformation version.

---

### User Story 7 — Export only the data the requester is authorized to take (Priority: P3)

A manager needs an office inventory export, or a Data Steward needs a controlled reconciliation file. They choose an approved export template and filters. The system applies row and field permissions, records the purpose and content, stores the output privately for a limited time, and expires it automatically.

**Why this priority**: Export is a likely path for sensitive data to escape normal application controls. It must be designed as a governed operation rather than a generic Download All button.

**Independent Test**: Generate the same export as a Field User, an OfficeAdmin with and without the
required stewardship/export capabilities, a SystemOwner with and without them, and a ReportReader.
Verify allowed templates, field projection, row scope, audit, private download and expiry.

**Acceptance Scenarios**:

1. **Given** a user in an eligible Reports or Administration purpose, **When** they open export
   options, **Then** only templates permitted by workspace, purpose, capability, row/field scope, and
   projection are available; role alone lists nothing.
2. **Given** an export request, **When** it runs, **Then** office scope, row filters and field-level restrictions are enforced server-side.
3. **Given** a general manager export, **When** generated, **Then** certificate links/metadata,
   free-text notes, performer identity, maintenance cost, and secured network identifiers are absent
   rather than merely hidden in the interface, regardless of the actor's other roles.
4. **Given** an export, **When** it is created, **Then** requester, purpose, template/version, filters, columns, row count, classification and expiry are recorded.
5. **Given** an export artifact, **When** downloaded, **Then** access requires authentication and is audited where policy requires.
6. **Given** an expired export, **When** a download is attempted, **Then** access is refused and the artifact is deleted according to policy unless an approved hold applies.
7. **Given** a large restricted export, **When** requested, **Then** required approval and separation of duties are enforced.
8. **Given** a format that supports it, **When** the export opens, **Then** its classification, creation time and export ID are visible.
9. **Given** a Field User, **When** they request a fleet-wide raw export, **Then** it is unavailable.

---

### User Story 8 — Apply retention and legal hold without a general-purpose delete path (Priority: P4)

A Data Owner reviews the retention register, previews records eligible for an approved action, confirms that no legal hold applies, and authorizes the controlled job. The system records exactly what was retained, archived or purged and reconciles associated documents.

**Why this priority**: Retention may not affect the first pilot, but it determines whether the system can be operated responsibly over years. It cannot be left to ad-hoc database cleanup.

**Independent Test**: Create a short-lived test retention class, place some records under hold, run preview and apply, and verify approvals, held exclusions, database/document reconciliation and audit evidence.

**Acceptance Scenarios**:

1. **Given** a managed data class, **When** it is inspected, **Then** its approved retention rule, owner, action and policy version are visible.
2. **Given** a retention preview, **When** it runs, **Then** no record or document is changed and eligible/held/blocked counts are shown.
3. **Given** a legal hold matching an eligible record, **When** retention apply runs, **Then** the record and associated document are excluded.
4. **Given** a high-impact purge, **When** requested, **Then** owner approval, separation of duties and the required recovery point are verified.
5. **Given** an immutable operational-history class retained indefinitely, **When** a purge attempts to include it without an approved policy change, **Then** the operation is refused.
6. **Given** an approved retention job, **When** it completes, **Then** exact database and document outcomes are recorded and reconciled.
7. **Given** a hold release, **When** performed, **Then** release authority, reason and time are retained; the creator cannot self-release where policy prohibits it.
8. **Given** an ordinary application user, **When** they seek a general delete action for production business history, **Then** none exists.

---

## Edge Cases

- A model correction changes the expected calibration interval for hundreds of assets.
- A location re-parenting affects office-based security scope and reminders.
- A reference record is deactivated while an offline device still has it cached.
- A dry run is approved, but target records change before application.
- Two stewards review the same duplicate candidate simultaneously.
- Both duplicate asset records have valid but conflicting post-go-live histories.
- An import contains a valid Asset ID that belongs to another office outside the requester’s scope.
- A job worker fails after committing a batch but before recording its response.
- A source file is uploaded twice under a different file name.
- An export contains formula-like spreadsheet values that could execute when opened.
- A retention job selects database metadata whose document is already missing.
- A document exists without metadata.
- An issue is waived, the rule changes, and the old waiver no longer fits the new rule.
- An external project source is stale but continues to mark a closed project active.
- A user’s role is removed while their bulk job awaits approval.
- A source record changes identity key.
- A quality rule scans synthetic and production environments differently.
- A merged-away Asset ID appears in an offline command queued before the merge.

---

## Functional Requirements

### Governance and authority

- **FR-001**: System MUST identify a business owner and steward responsibility for every managed data domain.
- **FR-002**: System MUST maintain a field-level data dictionary containing definition, type, allowed
  values, authority, classification, coarse responsibility roles, allowed purposes,
  read/write/export capabilities, projection IDs, presentation tier, masking/offline policy,
  retention class, lineage, and quality rules. Role alone never authorizes a field.
- **FR-003**: System MUST designate every managed attribute as SystemDerived, AMSManaged, ExternalAuthoritative, ImportedOnce or ReferenceOnly.
- **FR-004**: System MUST prevent ordinary local edits to SystemDerived attributes and MUST control overrides to ExternalAuthoritative attributes.
- **FR-005**: System MUST enforce active Administration workspace, approved purpose, exact
  capability, decided R5 row/office ceiling, field policy, and versioned projection for all
  data-management reads and operations.
- **FR-006**: System MUST support separation of duties for configurable high-impact operations.
- **FR-007**: System MUST record requester, approver where required, reason, evidence, before/after values, effective time and applied time for managed changes.
- **FR-008**: System MUST prevent a generic data-management endpoint from bypassing domain-specific validation.

### Quality rules and issues

- **FR-009**: System MUST support versioned data-quality rules with domain, severity, owner, schedule and implementation identity.
- **FR-010**: System MUST create or update one issue per failing rule/record/scope rather than duplicating the issue every run.
- **FR-011**: System MUST track issue state, owner, office, first and last detection, due date, evidence, resolution and verification.
- **FR-012**: System MUST close a resolved issue only after successful re-evaluation or approved manual verification.
- **FR-013**: System MUST require reason, approver and expiry for a temporary waiver and MUST re-evaluate it after expiry.
- **FR-014**: System MUST preserve false-positive and prior-rule-version history.
- **FR-015**: System MUST provide quality counts and trends by domain, office, rule, severity, owner
  and age, with data currency, visible scope label, and projection version. Issue/rule/owner detail
  remains absent from any separate general Reports aggregate.
- **FR-016**: System MUST alert the named owner when an issue crosses its approved criticality or age threshold.
- **FR-017**: System MUST include rules for identity, reference integrity, operational replay, relationships/installations, calibration/documents, authorization/export and environment contamination.

### Reference and master data

- **FR-018**: Authorized users MUST be able to create, edit permitted fields, deactivate, reactivate, alias, re-parent and merge supported reference records.
- **FR-019**: System MUST refuse duplicate business keys and cyclic hierarchies.
- **FR-020**: System MUST refuse ordinary deletion of a referenced record and MUST preserve historical display of deactivated values.
- **FR-021**: System MUST prevent deactivated reference values from being selected for new records unless an explicit exception permits it.
- **FR-022**: System MUST show an impact preview before a high-impact reclassification, re-parenting or merge.
- **FR-023**: System MUST resolve approved legacy aliases to canonical reference records without creating new duplicates.
- **FR-024**: System MUST re-evaluate affected quality rules and derived summaries after an approved reference change.

### Controlled corrections

- **FR-025**: System MUST provide named correction operations for approved static asset facts.
- **FR-026**: System MUST refuse direct correction of event-derived state, immutable history and canonical Asset ID.
- **FR-027**: System MUST route custody, location, project, lifecycle, serviceability, home-office and relationship changes through their approved business event or correction mechanism.
- **FR-028**: System MUST retain temporary and legacy identifiers as aliases when an asset is completed or corrected.
- **FR-029**: System MUST show downstream impact before correcting a model, identifier, ownership or other configured high-impact field.
- **FR-030**: System MUST re-evaluate related data-quality issues after a correction.
- **FR-031**: System MUST support approval and separation of duties for configured correction types and scopes.

### Jobs, imports and bulk updates

- **FR-032**: System MUST represent import, bulk update, export, reconciliation, duplicate resolution, reference merge, quality run, retention preview and purge as identifiable jobs.
- **FR-033**: Every job MUST record type, schema/template version, environment, requester, approver where required, source identity/hash, code/transformation version, times, counts, outcome, artifacts and correlation IDs.
- **FR-034**: System MUST provide a dry-run mode that writes no business changes.
- **FR-035**: A dry run MUST provide row/item-level validation, warnings, errors, before/after preview, unresolved references, duplicate candidates, authorization failures and impact summary.
- **FR-036**: System MUST refuse apply when the source changed, approval expired, requester lost authorization, target state changed materially, or a new critical validation fails.
- **FR-037**: System MUST make every row/item outcome explicit; no row may disappear from a job result.
- **FR-038**: System MUST preserve atomicity for logical groups that must change together even when a large job uses multiple batches.
- **FR-039**: System MUST make job retries idempotent and distinguish applied, unapplied and uncertain work after failure.
- **FR-040**: Every write job MUST declare whether it is Reversible, Compensatable or Irreversible before approval.
- **FR-041**: Irreversible jobs MUST require the configured highest approval and recovery prerequisites.
- **FR-042**: Import templates and contracts MUST be versioned and available with their field definitions.
- **FR-043**: System MUST protect spreadsheet exports/import results against formula injection according to the approved format policy.

### Duplicate resolution

- **FR-044**: System MUST treat duplicate detection as candidate generation and MUST NOT auto-merge assets based only on serial, model, tag similarity or other configurable evidence.
- **FR-045**: Duplicate review MUST show the minimum identity and conflict comparison needed for the
  governed case. Histories, calibration, documents, people, and lineage require their separate
  approved purpose/capabilities/projections and MUST NOT be bundled automatically into every review.
- **FR-046**: System MUST support NotDuplicate, RelatedPhysicalAssets, MergeRecords, RetireErroneousRecord and NeedsPhysicalAudit outcomes.
- **FR-047**: An approved merge MUST select a survivor, retain old identifiers, preserve both source UUIDs/histories, create a permanent redirect and prevent new operations against the merged-away record.
- **FR-048**: System MUST NOT rewrite immutable transaction lines as part of a post-go-live merge.
- **FR-049**: System MUST present consolidated history while preserving the source identity of each event.
- **FR-050**: System MUST refuse a merge with incompatible unresolved current state or relationship obligations.
- **FR-051**: Duplicate decisions and merges MUST be auditable and re-evaluated when material evidence changes.

### External reconciliation and lineage

- **FR-052**: Every external integration MUST declare authority, direction, stable key, field mapping, frequency/checkpoint, create/update/deactivate behavior, overrides, conflicts, retry and reconciliation.
- **FR-053**: System MUST report new, changed, unchanged, missing and conflicting records for every reconciliation run.
- **FR-054**: System MUST NOT silently overwrite a locally authoritative field from an external source or a source-authoritative field through ordinary local edit.
- **FR-055**: Synchronization MUST be idempotent and preserve historical references after source deactivation.
- **FR-056**: System MUST alert when authoritative-source data is stale or reconciliation repeatedly fails.
- **FR-057**: Every imported, synchronized, manually corrected, derived, migrated or synthetic record MUST retain its applicable source and transformation provenance.
- **FR-058**: Authorized users MUST be able to see the origin of important current facts and the
  event/correction that last established them only through a purpose/capability/row/field projection
  that requires that lineage; Work and general Reports do not inherit it.
- **FR-059**: Rule, mapping and transformation versions MUST be retained so a prior result can be explained.

### Exports

- **FR-060**: System MUST provide only export templates matching the active Reports/Administration
  workspace, approved purpose, named capability, row/field scope, and projection; role is only a
  coarse assignment ceiling.
- **FR-061**: System MUST enforce workspace, approved purpose, named capability, row/office scope,
  field policy, template version, and data projection server-side for exports.
- **FR-062**: General report/export products MUST always exclude certificate links/metadata,
  free-text notes, performer identity, maintenance cost, and secured network identifiers regardless
  of the actor's other roles. A richer evidential/administrative product is a separate governed template.
- **FR-063**: Every export MUST record requester, purpose, template/version, filters, columns, row count, classification, creation and expiry.
- **FR-064**: Export artifacts MUST be private, authenticated and short-lived unless an approved exception or hold applies.
- **FR-065**: System MUST delete or make inaccessible an expired export according to policy and MUST record download access where required.
- **FR-066**: System MUST enforce approval for configured large or restricted exports.
- **FR-067**: Field Work MUST have no export surface, template, artifact metadata, or general
  fleet-wide raw-data export. A user with another eligible workspace must enter it explicitly.

### Retention and legal hold

- **FR-068**: System MUST maintain a versioned retention register covering business data, documents, audit, quality issues, jobs, exports, operational events, logs, offline caches and backups.
- **FR-069**: System MUST NOT invent a retention period where no approved policy exists.
- **FR-070**: Existing indefinite retention for retired assets and operational history MUST remain until superseded by an approved policy change.
- **FR-071**: System MUST support legal hold with scope, authority, reason, owner, start, release and audit.
- **FR-072**: Retention preview MUST write no data and MUST identify eligible, held and blocked records/documents.
- **FR-073**: A legal hold MUST exclude matching data and documents from automated purge.
- **FR-074**: Purge MUST require approved policy version, dependency checks, configured approval, recovery prerequisites, exact counts and post-action reconciliation.
- **FR-075**: Ordinary application users MUST have no general-purpose delete path for production business history.
- **FR-076**: Database and document retention outcomes MUST be reconciled.

### Operations, security and performance

- **FR-077**: Long-running data jobs MUST expose progress, checkpoints and a retry-safe operational state.
- **FR-078**: Job workers MUST be idempotent and MUST alert a named owner when stuck or terminally failed.
- **FR-079**: Sensitive values MUST be redacted from logs, validation messages and unauthorized job artifacts.
- **FR-080**: Data-management queries MUST use versioned server-side projection allowlists,
  filtering, and paging and MUST NOT load a universal record or the full fleet into the browser/cache.
- **FR-081**: Data-management jobs MUST avoid holding locks that disrupt ordinary field operations beyond an approved budget.
- **FR-082**: System MUST preserve environment isolation and MUST structurally refuse production/synthetic contamination.
- **FR-083**: Every data-management operation MUST emit audit and correlation evidence sufficient to reconstruct what was requested, approved, validated and applied.

---

## Key Entities

- **Data Domain**: A governed group of related information with an owner, steward, authority and quality expectations.
- **Data Dictionary Entry**: Field-level definition, classification, authority, access, retention, lineage and quality metadata.
- **Data Job**: One governed import, update, export, reconciliation, quality, merge, retention or purge execution.
- **Data Job Item**: One row/record-level validation and application outcome within a job.
- **Data Quality Rule**: Versioned test defining what trustworthy data means for a field, entity or relationship.
- **Data Quality Issue**: Managed instance of a rule failure, with ownership, dates, status and resolution evidence.
- **Data Change Request**: Proposed static correction or high-impact operation carrying evidence, review and approval.
- **Record Redirect**: Permanent mapping from a merged-away identity to its surviving canonical record while preserving original history.
- **Source Record / Lineage Link**: Connection between a managed record and its source system, source row, import job and transformation version.
- **Retention Policy**: Approved, versioned rule for retaining, archiving or purging a data class.
- **Legal Hold**: Authority that suspends retention action for a defined scope.
- **Export Artifact**: Private, expiring result of an approved, audited export template.

---

## Success Criteria

- **SC-001**: 100% of production fields have a data-dictionary entry naming definition, authority,
  classification, responsibility, allowed purposes, read/write/export capabilities, projection IDs,
  presentation tier, masking/offline policy, retention, and quality ownership before production acceptance.
- **SC-002**: Every critical/high quality issue has an owner and due date; zero critical issues are silently hidden or represented only as an aggregate count.
- **SC-003**: Re-running quality rules creates zero duplicate open issues for the same rule/record/scope.
- **SC-004**: 100% of claimed resolutions are rule-verified or carry approved manual verification.
- **SC-005**: A steward creates or corrects a reference record with impact preview and complete audit evidence in under five minutes for a normal case.
- **SC-006**: Zero direct data-management edits to derived asset state or immutable transaction lines occur during pilot, verified by audit/database controls.
- **SC-007**: A 5,000-row import dry run reports every row as valid, warning or invalid with no business-data changes and completes within the approved performance budget.
- **SC-008**: Retrying an approved import after a lost response creates zero duplicate records or effects.
- **SC-009**: Every applied bulk job reconciles requested, approved, applied, skipped and failed item counts exactly.
- **SC-010**: 100% of duplicate candidates are human-reviewed; zero valid shared-serial asset pairs are automatically merged.
- **SC-011**: A post-go-live duplicate merge preserves both original histories, redirects the old identifier, prevents new operations on the merged-away record and rewrites zero immutable transaction lines.
- **SC-012**: Every synchronized source run reports new, changed, missing and conflicting records and can explain every applied field by source and mapping version.
- **SC-013**: A Field User, Office Admin with/without export capability, SystemOwner with/without
  export capability, and Report Reader each receive only workspace/purpose/capability-approved
  templates and fields in direct authorization tests. Field Work and a general Report Reader receive
  no Administration export templates.
- **SC-014**: 100% of exports are privately stored, audited and inaccessible after expiry unless an approved hold/exception applies.
- **SC-015**: A retention preview identifies held records and changes zero records; an apply run changes only approved eligible records and reconciles database/document outcomes exactly.
- **SC-016**: Zero production business-history records are deleted through ordinary application screens or generic APIs.
- **SC-017**: Data-management overview and issue searches remain usable at 5,000 active assets and at least 100,000 transaction lines without downloading the full dataset to the browser.
- **SC-018**: Every import, correction, merge, reconciliation, export and retention operation can be reconstructed from audit, job, approval and lineage evidence.
- **SC-019**: Before Ottawa pilot entry, all critical migration/reference-data issues are resolved or explicitly approved with evidence, and both existing migration sign-offs remain complete.

---

## Assumptions

- Data management is part of the web application, not a separate unrestricted database administration tool.
- Existing operational events remain the authority for current asset state.
- The existing migration pipeline remains the first implementation of profiling, mapping, row-level outcomes and sign-off discipline.
- The data dictionary is committed in a machine-readable form and rendered for users; the precise file format is a planning decision.
- Data Steward is an OD-2 capability bundle within OfficeAdmin/SystemOwner scope, not a separate app
  role; stewardship powers remain explicit and auditable.
- Retention periods other than already approved indefinite asset/history retention require business/legal policy input.
- Post-go-live record merge uses redirect/canonical mapping rather than rewriting immutable event history.
- External project and directory synchronization is added only after field authority and conflict behavior are approved.
- Data-management jobs may process asynchronously, but their validation, approval, item outcomes and idempotency are durable.
- Feature 011 depends on feature 010 identity, authorization, jobs, audit and storage foundations and on feature 009 production-readiness controls.

---

## Open Decisions

1. Named Data Owner and steward for each domain and office.
2. Any legal/statutory retention obligation that supersedes or narrows OD-5's approved defaults.
3. Project-master authority and synchronization contract.
4. Quality issue service levels by severity.
5. Whether data-dictionary changes require Data Owner approval for every field or only
   classified/high-impact fields.
6. Final Entra/group-to-capability mapping inside R5/D18.

OD-2 through OD-9 and OD-11 are decided in `docs/08-decisions.md`; they are no longer open feature
questions. Their implementation and conformance evidence remain separate work.
