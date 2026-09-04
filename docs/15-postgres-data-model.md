# 15 — Canonical PostgreSQL Data Model

**Decision date:** 2026-09-03  
**Status:** **§3 State model APPROVED** (Jay, 2026-09-03 — R1). **First-proof table subset** in `specs/010-web-application-platform/data-model.md` is approved for migration (R3). Remaining tables in this document are the target catalogue and still require table-by-table review before full WS-W2 parallel work.  
**Supersedes physically:** Dataverse-specific types, keys, privileges, and flow-owned state fields in `docs/01-data-model.md`.  
**Retains logically:** Asset identity, curated reference data, immutable event history, dated relationships, calibration records, installations, and the seven acceptance questions.

---

## 1. Design rules

1. PostgreSQL is the authoritative system of record.
2. The browser never writes current asset state directly.
3. A complete multi-asset business event is validated and committed in one database transaction.
4. Transaction lines are append-only.
5. The canonical Asset ID is immutable.
6. Temporary and legacy tags are aliases, not replacement canonical IDs.
7. Serial number is searchable and deliberately non-unique.
8. Reference data is selected from curated records.
9. Physical disposition, serviceability, calibration currency, and lifecycle are separate concepts.
10. Every table uses UTC timestamps. Date-only fields remain date-only.
11. Every externally submitted command carries an idempotency key.
12. Every background side effect is emitted through a transactional outbox.
13. Production schema changes are committed migrations; no hand-edited production schema.

---

## 2. PostgreSQL conventions

### Identifiers

- Internal primary keys: UUID.
- Human transaction number: database sequence rendered as `TXN-000123`.
- Column names: `snake_case`.
- Timestamps: `timestamptz` stored in UTC.
- Calendar dates: `date`.
- Money: `numeric(14,2)` plus ISO currency code.
- Flexible metadata: `jsonb` only where the contents are supplemental rather than relationally authoritative.

### Common audit columns

Most mutable reference and business tables carry:

```sql
created_at       timestamptz not null default now()
created_by       uuid
updated_at       timestamptz not null default now()
updated_by       uuid
row_version      bigint not null default 1
```

`row_version` increments on an accepted update and is returned to clients for optimistic read conflict detection. It is not the primary protection for asset transactions; those use database row locks.

### Controlled values

PostgreSQL enums or constrained reference tables may be used. Reference tables are preferred for values that administrators may extend. Fixed system-state values should be enums or checked text values committed through migrations.

---

## 3. State model

**Approved 2026-09-03 (R1).** Recorded in `docs/08-decisions.md`.

The original single `asset_status` field combined physical location, custody, repair condition, calibration process, loss, and retirement. The web application separates these dimensions. The local mock and `server/` POC may keep a compatibility single `status` until the HTTP cutover; production schema and new transaction derivation use the axes below.

### 3.1 Lifecycle

```text
Active
Retired
```

### 3.2 Disposition

```text
AtOffice
CheckedOut
Deployed
InTransit
AtCalibrationLab
Missing
```

Disposition answers where the system believes the asset is in its operating journey.

### 3.3 Serviceability

```text
Serviceable
NeedsRepair
OutOfService
```

A checked-out or deployed asset can also need repair. Reporting can distinguish productive use from downtime without losing custody or location.

### 3.4 Calibration currency

Calibration currency is derived, not stored as an exclusive status:

```text
NotRequired
Unknown
Current
DueSoon
Overdue
InCalibration
Failed
```

It is derived from model/asset requirements, calibration records, due dates, and current disposition.

### 3.5 Compatibility display status

A view may provide the familiar UI status pill:

```text
Retired
Missing
In calibration
Needs repair
Deployed
Checked out
In transit
Available
```

The view is presentation logic. It is not the authoritative state model.

---

## 4. Identity and authorization

## `app_user`

One workforce identity known to the application.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `entra_object_id` | uuid | yes | unique, immutable directory object ID |
| `tenant_id` | uuid | yes | guards against cross-tenant identity confusion |
| `upn` | text | yes | current sign-in name; not the identity key |
| `display_name` | text | yes | refreshed from identity claims/directory |
| `is_active` | boolean | yes | default true |
| `last_sign_in_at` | timestamptz | no | operational metadata |
| audit columns | | | |

Unique key: `(tenant_id, entra_object_id)`.

A renamed UPN does not create a new user.

## `user_role`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `user_id` | uuid | yes | FK → `app_user` |
| `role` | text/enum | yes | `FieldUser`, `OfficeAdmin`, `SystemOwner`, `ReportReader` |
| `source` | text | yes | `EntraAppRole`, `EntraGroup`, `ManualEmergency` |
| `valid_from` | timestamptz | yes | |
| `valid_to` | timestamptz | no | null = current |
| audit columns | | | |

Only current rows participate in authorization.

## `user_office_scope`

Defines which offices an administrator may manage or a field user is associated with.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `user_id` | uuid | yes | FK → `app_user` |
| `office_location_id` | uuid | yes | FK → `location`, must be Office |
| `scope_type` | text/enum | yes | `Member`, `Administer`, `Report` |
| `valid_from` | timestamptz | yes | |
| `valid_to` | timestamptz | no | |
| audit columns | | | |

Unique open assignment: `(user_id, office_location_id, scope_type)` where `valid_to is null`.

The API enforces these rows. Interface filtering alone is not authorization.

---

## 5. Reference data

## `equipment_model`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `name` | text | yes | display name |
| `manufacturer` | text | yes | curated |
| `model` | text | yes | curated |
| `equipment_type` | text | yes | fixed or curated reference |
| `asset_group` | text | yes | fixed or curated reference |
| `id_prefix` | text | yes | e.g. `DL-UM`, `GEO-V12` |
| `is_serialised` | boolean | yes | |
| `identifier_type` | text | yes | Serial / ICCID / IMEI / None |
| `default_calibration_interval_months` | integer | no | null = calibration not required |
| `manual_url` | text | no | validated URL |
| `purchase_available_from` | date | no | used by synthetic data and catalogue governance |
| `purchase_available_to` | date | no | |
| `is_active` | boolean | yes | default true |
| audit columns | | | |

Unique key: normalized `(manufacturer, model, equipment_type)`.

Check: calibration interval is null or greater than zero.

## `location`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `name` | text | yes | |
| `location_type` | text/enum | yes | Region / Office / Site / Vehicle / CalibrationLab / Client / Storage |
| `parent_location_id` | uuid | no | self-reference |
| `address` | text | no | |
| `latitude` | numeric(9,6) | no | |
| `longitude` | numeric(9,6) | no | |
| `coordinate_system` | text | no | default WGS84 where applicable |
| `is_active` | boolean | yes | |
| audit columns | | | |

Rules:

- No location may be its own ancestor.
- A referenced location is deactivated, not deleted.
- Offices are unlimited and may be re-parented.
- Sites may be created through deployment workflows.
- Names need only be unique within an agreed parent/type context, not globally.

Cycle prevention is enforced by a deferred constraint trigger using a recursive ancestor check.

## `project`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `project_number` | text | yes | alternate business key |
| `name` | text | yes | may begin as number-only during migration |
| `client` | text | no | |
| `status` | text/enum | yes | Active / Closed / OnHold |
| `office_location_id` | uuid | no | FK → Office |
| `project_manager_user_id` | uuid | no | FK → `app_user` |
| `source_system` | text | no | future project-master integration |
| `source_id` | text | no | |
| `is_synthetic` | boolean | yes | default false |
| `synthetic_seed` | text | no | |
| audit columns | | | |

Unique key: normalized `project_number`.

---

## 6. Assets and identifiers

## `asset`

One physical, individually trackable item.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `asset_id` | text | yes | canonical human-readable tag; unique and immutable |
| `equipment_model_id` | uuid | yes | FK → `equipment_model` |
| `serial_number` | text | no | non-unique searchable attribute |
| `home_office_location_id` | uuid | yes | FK → Office |
| `lifecycle` | text/enum | yes | Active / Retired |
| `disposition` | text/enum | yes | derived by transaction service |
| `serviceability` | text/enum | yes | derived by transaction service |
| `current_location_id` | uuid | no | derived |
| `custodian_user_id` | uuid | no | derived |
| `current_project_id` | uuid | no | derived |
| `current_parent_asset_id` | uuid | no | derived mirror of open relationship |
| `last_successful_calibration_date` | date | no | derived from qualifying calibration records |
| `next_calibration_due_date` | date | no | derived |
| `calibration_interval_override_months` | integer | no | explicit asset-level override |
| `calibration_override_reason` | text | no | required when override set |
| `ownership_type` | text/enum | yes | Owned / Leased / Rented / ClientOwned / SubcontractorOwned |
| `owner_organization` | text | no | required for non-Owned where known |
| `acquired_date` | date | no | |
| `retired_at` | timestamptz | no | derived from retirement transaction |
| `retirement_reason` | text/enum | no | Sold / Lost / Damaged / Obsolete |
| `notes` | text | no | not used as structured state |
| `migration_source` | text | no | source-row traceability |
| `is_synthetic` | boolean | yes | default false |
| `synthetic_seed` | text | no | required when synthetic |
| audit + row-version columns | | | |

Indexes:

- unique normalized `asset_id`;
- normalized `serial_number` non-unique;
- `equipment_model_id`;
- `home_office_location_id`;
- `(lifecycle, disposition, serviceability)`;
- `current_location_id`;
- `custodian_user_id`;
- `current_project_id`;
- `next_calibration_due_date`;
- `current_parent_asset_id`.

Rules:

- `asset_id` cannot change after insertion.
- `lifecycle`, `disposition`, `serviceability`, current-state fields, retirement fields, and calibration summary fields are not accepted by ordinary asset-edit endpoints.
- Retired assets remain searchable by exact Asset ID and remain in history indefinitely.
- `serial_number` is never used as an identity key.

## `asset_identifier`

Searchable aliases and secondary identifiers.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `asset_id` | uuid | yes | FK → `asset` |
| `identifier_type` | text/enum | yes | CanonicalAssetId / TemporaryTag / LegacyTag / Serial / ICCID / IMEI / Other |
| `identifier_value` | text | yes | original display form |
| `normalized_value` | text | yes | search and uniqueness form |
| `is_current` | boolean | yes | |
| `valid_from` | timestamptz | yes | |
| `valid_to` | timestamptz | no | |
| `is_sensitive` | boolean | yes | ICCID/IMEI typically true |
| `source` | text | no | registration, migration, audit completion |
| audit columns | | | |

Rules:

- Canonical Asset ID and temporary/legacy physical tag aliases are unique while current.
- Serial, ICCID, and IMEI uniqueness follows their business rule; serial is explicitly non-unique.
- Completing a temporary tag inserts or activates the canonical identifier and retains the temporary alias forever.
- Sensitive identifiers are excluded from field-user API projections and offline storage.

## `asset_id_sequence`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `prefix` | text | yes | primary key |
| `next_value` | bigint | yes | value to allocate next |
| `padding_width` | integer | yes | default 4 |
| `updated_at` | timestamptz | yes | |

Allocation occurs inside the server-side registration transaction by locking the prefix row, incrementing it, and relying on the final unique `asset.asset_id` constraint.

The browser may preview a pattern, not reserve a number.

---

## 7. Immutable business events

## `asset_transaction`

One accepted business event affecting one or more assets.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `transaction_number` | bigint | yes | unique sequence, rendered `TXN-{number}` |
| `client_submission_id` | uuid | yes | unique idempotency key |
| `request_hash` | text | yes | detects key reuse with different payload |
| `transaction_type` | text/enum | yes | see transaction catalogue |
| `recorded_at` | timestamptz | yes | server acceptance time |
| `effective_at` | timestamptz | yes | business-effective time |
| `performed_by_user_id` | uuid | yes | who submitted/authorized it |
| `primary_asset_id` | uuid | no | kit/installation primary |
| `from_location_id` | uuid | no | header context where common |
| `to_location_id` | uuid | no | |
| `from_user_id` | uuid | no | |
| `to_user_id` | uuid | no | |
| `from_project_id` | uuid | no | |
| `to_project_id` | uuid | no | |
| `expected_return_date` | date | no | checkout |
| `reason_code` | text | no | typed reason where applicable |
| `notes` | text | no | |
| `correction_of_transaction_id` | uuid | no | compensating/correction link |
| `is_migration` | boolean | yes | default false |
| `is_synthetic` | boolean | yes | default false |
| `synthetic_seed` | text | no | |
| `metadata` | jsonb | no | supplemental non-authoritative values |
| `created_at` | timestamptz | yes | same as recorded_at in normal use |

Rules:

- Accepted transaction rows are immutable.
- Backdating changes `effective_at`, never `recorded_at`.
- Corrections create a new transaction linked to the original.
- One `client_submission_id` maps to one request hash and one stable result.

## `asset_transaction_line`

One asset’s immutable participation in a transaction.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `transaction_id` | uuid | yes | FK → `asset_transaction` |
| `line_number` | integer | yes | deterministic order |
| `asset_id` | uuid | yes | FK → `asset` |
| `lifecycle_before` / `lifecycle_after` | text | yes | |
| `disposition_before` / `disposition_after` | text | yes | |
| `serviceability_before` / `serviceability_after` | text | yes | |
| `location_before_id` / `location_after_id` | uuid | no | |
| `custodian_before_id` / `custodian_after_id` | uuid | no | |
| `project_before_id` / `project_after_id` | uuid | no | |
| `parent_before_id` / `parent_after_id` | uuid | no | |
| `kit_role` | text | no | Primary / Sensor1… |
| `orientation` | text | no | H / V / BH / N / E / S / W |
| `power_source` | text | no | Battery / Solar / AC / External |
| `condition` | text | no | Good / Damaged / NeedsService |
| `notes` | text | no | |
| `created_at` | timestamptz | yes | |

Unique keys:

- `(transaction_id, line_number)`;
- `(transaction_id, asset_id)` unless a specifically approved transaction type requires repeated participation.

Transaction lines cannot be updated or deleted through the application role. A database trigger rejects update/delete outside an explicitly named migration/repair procedure, and every exceptional repair is audited.

### Transaction catalogue

```text
AddToInventory
Checkout
Return
Transfer
Deploy
Undeploy
SendToCalibration
ReturnFromCalibration
ReportFault
RepairComplete
MarkOutOfService
ReturnToService
MarkMissing
Found
RehomeAsset
AttachComponent
DetachComponent
SwapComponent
ChangeInstallationConfiguration
Retire
Audit
Correction
```

### State effects

Key corrections to the former single-status model:

- `ReportFault` changes serviceability and does not erase custody, project, deployment, or location.
- `RepairComplete` changes serviceability and does not invent a physical return.
- `Found` requires a destination/custodian decision rather than always claiming the asset is Available at its home office.
- `SendToCalibration` changes disposition to `AtCalibrationLab`; serviceability and calibration result remain distinct.
- `ReturnFromCalibration` is a physical receipt event, not merely the presence of a certificate.
- `RehomeAsset` changes permanent home office through a recorded administrative event.
- `Retire` changes lifecycle and explicitly resolves any open custody, installation, and relationship obligations.

The canonical transition contract is stored as reviewed data and consumed by server tests. The API remains authoritative.

---

## 8. Idempotency and command outcomes

## `command_idempotency`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `client_submission_id` | uuid | yes | primary key |
| `user_id` | uuid | yes | originating identity |
| `request_hash` | text | yes | canonical payload hash |
| `command_type` | text | yes | |
| `state` | text/enum | yes | Processing / Applied / Rejected |
| `transaction_id` | uuid | no | populated for accepted transaction commands |
| `http_status` | integer | no | stable replay response |
| `response_body` | jsonb | no | stable replay response |
| `created_at` | timestamptz | yes | |
| `completed_at` | timestamptz | no | |
| `expires_at` | timestamptz | no | retention policy; accepted transaction link remains durable elsewhere |

Rules:

- Same key + same hash returns the original outcome.
- Same key + different hash is refused.
- A command cannot remain `Processing` beyond the operational threshold without alerting.

---

## 9. Relationships and installations

## `asset_relationship`

Standing or dated relationship between assets.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `parent_asset_id` | uuid | yes | |
| `child_asset_id` | uuid | yes | |
| `relationship_type` | text/enum | yes | Component / Kit |
| `role` | text | no | sensor/modem/etc. |
| `valid_from` | timestamptz | yes | |
| `valid_to` | timestamptz | no | null = open |
| `opened_by_line_id` | uuid | no | |
| `closed_by_line_id` | uuid | no | |
| audit columns | | | |

Rules:

- Parent cannot equal child.
- Relationship graph cannot contain a cycle.
- Child has at most one open parent relationship.
- Historical spans cannot overlap for the same child.
- Kit rows are opened and closed only by transaction service logic.
- Component attach/detach is a recorded administrative transaction, not a silent edit.

A partial unique index protects one open relationship per child. A deferred trigger checks cycles and historical overlap.

## `installation`

One station at one site and project over one span.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `installation_number` | bigint | yes | human reference |
| `site_location_id` | uuid | yes | FK → Site |
| `project_id` | uuid | yes | |
| `primary_asset_id` | uuid | yes | exactly one logger/approved primary |
| `position_detail` | text | no | |
| `latitude` / `longitude` | numeric(9,6) | no | |
| `coordinate_system` | text | no | |
| `power_source` | text | no | station default |
| `started_at` | timestamptz | yes | |
| `ended_at` | timestamptz | no | |
| `opened_by_transaction_id` | uuid | yes | |
| `closed_by_transaction_id` | uuid | no | |
| `is_synthetic` | boolean | yes | |
| `synthetic_seed` | text | no | |
| audit columns | | | |

## `installation_component`

Dated membership/configuration span within an installation.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `installation_id` | uuid | yes | |
| `asset_id` | uuid | yes | |
| `role` | text | yes | |
| `orientation` | text | no | required for roles that need it |
| `power_source` | text | no | component override |
| `position_detail` | text | no | |
| `valid_from` | timestamptz | yes | |
| `valid_to` | timestamptz | no | |
| `opened_by_line_id` | uuid | yes | |
| `closed_by_line_id` | uuid | no | |

Rules:

- Exactly one open primary component per open installation.
- An asset cannot be in two open installations.
- Swaps close one span and open another at the same effective time.
- Partial recovery closes only the selected component spans.

---

## 10. Calibration and documents

## `calibration_record`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `asset_id` | uuid | yes | |
| `record_type` | text/enum | yes | CompletedCalibration / LegacyDueDateOnly / Inspection / Other approved type |
| `calibration_date` | date | no | required for completed calibration; nullable for legacy due-only record |
| `next_due_date` | date | yes | |
| `lab_location_id` | uuid | no | CalibrationLab |
| `certificate_number` | text | no | |
| `cost` | numeric(14,2) | no | |
| `currency_code` | char(3) | no | |
| `result` | text/enum | no | Pass / Adjusted / Fail |
| `notes` | text | no | |
| `supersedes_calibration_record_id` | uuid | no | correction chain |
| `is_void` | boolean | yes | false by default |
| `void_reason` | text | no | required if void |
| `is_synthetic` | boolean | yes | |
| `synthetic_seed` | text | no | |
| audit + row-version columns | | | |

Rules:

- Future calibration date refused.
- `Pass` and accepted `Adjusted` may advance last-successful and next-due summaries.
- `Fail` does not advance successful calibration summaries and does not return an asset to service.
- Summary fields on `asset` are recalculated from the latest qualifying, non-void record by calibration date.
- Create, correction, supersession, and voiding all trigger recalculation in the same transaction.
- Duplicate same-asset/same-date records are warned or refused according to the approved rule.

## `document`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | primary key |
| `document_type` | text/enum | yes | CalibrationCertificate / Photo / Other approved type |
| `blob_path` | text | yes | unique private-storage path |
| `original_file_name` | text | yes | |
| `stored_file_name` | text | yes | collision-safe |
| `media_type` | text | yes | allowlisted |
| `size_bytes` | bigint | yes | bounded |
| `sha256` | text | yes | integrity and duplicate detection |
| `scan_status` | text/enum | yes | Pending / Clean / Rejected / Failed |
| `retention_class` | text | yes | |
| `uploaded_by_user_id` | uuid | yes | |
| `uploaded_at` | timestamptz | yes | |
| `replaced_by_document_id` | uuid | no | preserves replacement history |
| `is_synthetic` | boolean | yes | synthetic records do not point to production documents |

## `calibration_document`

Join table allowing corrected/reissued certificates without deleting history.

| Column | Type | Required |
|---|---|---:|
| `calibration_record_id` | uuid | yes |
| `document_id` | uuid | yes |
| `relationship_type` | text/enum | yes |
| `is_current` | boolean | yes |
| audit columns | | |

A calibration record survives an upload failure. The UI shows `Certificate missing` and permits later attachment.

---

## 11. Transactional outbox and operations

## `outbox_event`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | bigint | yes | generated primary key |
| `event_id` | uuid | yes | unique public event ID |
| `event_type` | text | yes | |
| `aggregate_type` | text | yes | Asset / Transaction / Calibration / Installation |
| `aggregate_id` | uuid | yes | |
| `payload` | jsonb | yes | versioned schema |
| `available_at` | timestamptz | yes | |
| `attempt_count` | integer | yes | default 0 |
| `locked_at` | timestamptz | no | worker lease |
| `processed_at` | timestamptz | no | |
| `last_error` | text | no | |
| `created_at` | timestamptz | yes | |

The business transaction and its outbox events commit together. Notification failure cannot roll back or falsify asset state.

## `audit_event`

Captures changes outside immutable asset transactions, such as reference-data edits, role/scope changes, calibration corrections, and document replacements.

| Column | Type | Required |
|---|---|---:|
| `id` | bigint | yes |
| `occurred_at` | timestamptz | yes |
| `actor_user_id` | uuid | no |
| `actor_type` | text | yes |
| `action` | text | yes |
| `entity_type` | text | yes |
| `entity_id` | uuid | no |
| `before_data` | jsonb | no |
| `after_data` | jsonb | no |
| `correlation_id` | uuid | yes |
| `ip_address` | inet | no |
| `user_agent` | text | no |

Retention follows the approved audit policy and must not be shorter than the period needed for asset history, compliance, or investigations.

---

## 12. Reporting views

The first schema release includes reviewed SQL views or materialized views for:

```text
v_asset_effective_status
v_asset_current_detail
v_available_assets_by_office
v_calibration_currency
v_calibration_due
v_assets_by_project
v_asset_timeline
v_current_installations
v_installation_timeline
v_asset_state_spans
v_utilisation
v_completion_queue
v_unknown_custodian_sweep
```

Rules:

- Reporting views do not become a second writable source of truth.
- Secured identifiers are absent from general manager views.
- Historical views include retired assets.
- Current views exclude or explicitly mark retired assets as required.
- Utilisation clips to acquisition/go-live boundaries and never invents pre-history.

---

## 13. Database authorization

Application users do not connect directly to PostgreSQL.

Recommended database principals:

| Principal | Access |
|---|---|
| `ams_migrator` | schema migrations only through approved pipeline |
| `ams_api` | CRUD required by API; no schema ownership |
| `ams_worker` | outbox claim/update, approved reads and notification state |
| `ams_report_reader` | approved read-only views only |
| `ams_restore_operator` | controlled operational use, not application runtime |

The API identity receives the narrowest practical grants. Destructive maintenance functions are separate and audited.

Where practical, state-mutating tables are updated through narrowly defined repository functions or stored procedures invoked only by the transaction service. Direct ad-hoc production writes are prohibited operationally and detected through audit/monitoring.

---

## 14. Migration consequences

The existing profiling and cleaning pipeline remains authoritative for source interpretation.

The final loader changes from Dataverse Web API output to PostgreSQL:

1. Begin with an empty reviewed schema.
2. Load users required for migration attribution.
3. Load locations.
4. Load equipment models.
5. Load projects.
6. Load assets and identifiers.
7. Load one `AddToInventory` transaction and line per asset or approved batch pattern.
8. Load calibration records.
9. Load relationships/components supported by evidence.
10. Recalculate derived summaries.
11. Run all invariants and reconciliation reports.
12. Run idempotently against Dev and UAT before production.

The production load still requires the model-review and conflict-report sign-offs.

Ambiguous calibration records remain unmatched until a person confirms the target; they are not attached to a convenient default asset.

---

## 15. Required schema tests

Before the schema is accepted, automated tests must prove:

- duplicate canonical Asset IDs are refused;
- Asset ID mutation is refused;
- shared serials across assets are allowed;
- temporary aliases remain searchable after completion;
- two open parents for one child are refused;
- relationship cycles are refused;
- transaction-line update/delete is refused;
- idempotency-key reuse returns one outcome;
- same key with a changed request is refused;
- racing checkout commands produce one winner;
- a five-asset command commits all five or none;
- failed calibration does not advance due date;
- correcting an older calibration does not replace a newer qualifying summary;
- report fault preserves custody, location, and project;
- repair complete does not invent a physical return;
- found requires an explicit resulting physical state;
- rehome changes home office through history;
- synthetic rows are refused in production mode;
- general report views expose no secured identifiers;
- migration can run twice with an empty data diff.

---

## 16. Open schema decisions

The following are deliberately not guessed:

1. Whether office authorization is global-admin or strictly office-scoped.
2. Whether application roles come from Entra app roles, Entra groups, database assignments, or a reconciled combination.
3. Required versus optional expected-return date.
4. Backdating window and conflict rule.
5. Permanent-component calibration despatch behavior.
6. Whether ICCID and IMEI may repeat in the real fleet.
7. Exact retention period for audit events and documents.
8. File malware-scanning service and quarantine workflow.
9. Whether current-state columns require a database-level context trigger in addition to API enforcement.
10. Project-master source and synchronization ownership.

These decisions must be recorded before the production migration is generated.
