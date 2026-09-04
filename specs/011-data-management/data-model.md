# Data Model: Feature 011 Additions

**Date**: 2026-09-03  
**Status**: Draft for schema approval. Logical source: `docs/16-data-management.md` §14. Physical conventions: `docs/15-postgres-data-model.md` §1–2.  
**ASSUMPTION: R3** — these tables (or equivalents) must be accepted into the canonical schema before migrations ship.

Reuse existing `audit_event`, `document`, asset aliases, `outbox_event`, `app_user`, roles and office scope. Do not duplicate them.

---

## Authority modes (dictionary)

```text
SystemDerived | AMSManaged | ExternalAuthoritative | ImportedOnce | ReferenceOnly
```

---

## `data_dictionary_entry`

Committed machine-readable dictionary also loaded/synced for API checks.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `entity_name` | text | yes | e.g. `asset`, `equipment_model` |
| `field_name` | text | yes | snake_case logical name |
| `display_name` | text | yes | |
| `definition` | text | yes | |
| `data_type` | text | yes | |
| `allowed_values` | jsonb | no | |
| `owner_role` | text | yes | Data Owner concept |
| `steward_role` | text | yes | |
| `authority_mode` | text | yes | enum above |
| `classification` | text | yes | **OD-4** — placeholder until taxonomy approved; refuse inventing labels in prod |
| `read_roles` | text[] | yes | |
| `write_roles` | text[] | yes | |
| `export_roles` | text[] | yes | |
| `offline_cache_allowed` | boolean | yes | |
| `retention_class` | text | yes | |
| `quality_rule_ids` | text[] | no | |
| `lineage_source` | text | no | |
| `deprecated_at` | timestamptz | no | |
| `replaced_by_field` | text | no | |
| audit + row_version | | | |

Unique: `(entity_name, field_name)` current.

---

## `data_quality_rule`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | stable rule identity |
| `rule_key` | text | yes | implementation key |
| `version` | integer | yes | immutable history via new version rows or version table |
| `domain` | text | yes | |
| `severity` | text | yes | Critical / High / Medium / Low |
| `owner_user_id` | uuid | no | default owner |
| `schedule` | text | no | cron or event trigger |
| `is_active` | boolean | yes | |
| `implementation_ref` | text | yes | code module id |
| audit columns | | | |

Rule changes do not rewrite old issue history (FR-014).

---

## `data_quality_issue`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `rule_id` | uuid | yes | |
| `rule_version` | integer | yes | |
| `entity_type` | text | yes | |
| `entity_id` | uuid | yes | |
| `scope_key` | text | yes | distinguishes rule/record/relationship failures |
| `severity` | text | yes | |
| `status` | text | yes | Open / Assigned / InProgress / Blocked / Resolved / Waived / FalsePositive / Reopened |
| `office_location_id` | uuid | no | |
| `owner_user_id` | uuid | no | |
| `first_detected_at` | timestamptz | yes | |
| `last_detected_at` | timestamptz | yes | |
| `due_at` | timestamptz | no | |
| `evidence` | jsonb | yes | |
| `resolution_note` | text | no | |
| `waiver_reason` | text | no | |
| `waiver_approver_user_id` | uuid | no | |
| `waiver_expires_at` | timestamptz | no | |
| `verification_type` | text | no | RuleReevaluation / ManualApproved |
| `related_job_id` | uuid | no | |
| audit + row_version | | | |

Unique open issue: `(rule_id, entity_type, entity_id, scope_key)` where status not terminal — implement so re-runs update rather than duplicate (FR-010).

---

## `data_job`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | immutable job id |
| `job_type` | text | yes | Import / BulkUpdate / Export / Reconciliation / DuplicateResolution / ReferenceMerge / RetentionPreview / Purge / QualityRuleRun |
| `status` | text | yes | |
| `schema_version` | text | yes | |
| `environment` | text | yes | |
| `requested_by` | uuid | yes | |
| `approved_by` | uuid | no | |
| `idempotency_key` | text | yes | |
| `request_hash` | text | yes | |
| `source_name` | text | no | |
| `source_hash` | text | no | |
| `request_parameters` | jsonb | yes | |
| `code_version` | text | yes | |
| `reversibility_class` | text | yes | Reversible / Compensatable / Irreversible |
| `dry_run_summary` | jsonb | no | |
| `result_summary` | jsonb | no | |
| `started_at` | timestamptz | no | |
| `completed_at` | timestamptz | no | |
| `artifact_path` | text | no | private blob path |
| `artifact_expires_at` | timestamptz | no | |
| `correlation_id` | uuid | yes | |
| audit columns | | | |

Unique: `(requested_by, idempotency_key)` or global idempotency table per 010 contract — **consume 010**, do not fork.

---

## `data_job_item`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `job_id` | uuid | yes | |
| `item_number` | integer | yes | |
| `source_reference` | text | no | |
| `entity_type` | text | no | |
| `entity_id` | uuid | no | |
| `operation` | text | yes | |
| `status` | text | yes | Valid / Warning / Invalid / Applied / Skipped / Failed / Uncertain |
| `severity` | text | no | |
| `messages` | jsonb | yes | redacted |
| `before_data` | jsonb | no | |
| `after_data` | jsonb | no | |
| `applied_at` | timestamptz | no | |

Unique: `(job_id, item_number)`. No silent disappearance of rows (FR-037).

---

## `data_change_request`

Controlled static correction, reference change, or high-impact operation.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `command_type` | text | yes | named command |
| `entity_type` | text | yes | |
| `entity_id` | uuid | yes | |
| `before_data` | jsonb | yes | |
| `after_data` | jsonb | yes | |
| `reason` | text | yes | |
| `evidence` | jsonb | no | |
| `requested_by` | uuid | yes | |
| `approved_by` | uuid | no | |
| `status` | text | yes | |
| `effective_at` | timestamptz | no | |
| `applied_at` | timestamptz | no | |
| `impact_preview` | jsonb | no | |
| `correlation_id` | uuid | yes | |
| audit columns | | | |

---

## `record_redirect`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `entity_type` | text | yes | Asset / EquipmentModel / Location / Project / … |
| `from_id` | uuid | yes | merged-away UUID — **preserved forever** |
| `to_id` | uuid | yes | survivor UUID |
| `from_canonical_key` | text | no | e.g. former Asset ID retained as alias separately |
| `merged_at` | timestamptz | yes | |
| `requested_by` | uuid | yes | |
| `approved_by` | uuid | yes | |
| `evidence` | jsonb | yes | |
| `job_id` | uuid | no | |

Unique: `(entity_type, from_id)`. Merged-away record must refuse new operational commands.

---

## `retention_policy`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `data_class` | text | yes | |
| `version` | integer | yes | immutable after activation |
| `action` | text | yes | Retain / Archive / PurgeEligible |
| `period_days` | integer | no | null = indefinite or **unspecified** (FR-069 — do not invent) |
| `approved_by` | uuid | yes | |
| `activated_at` | timestamptz | yes | |
| `superseded_at` | timestamptz | no | |

Retired assets + operational history: indefinite until approved supersession (FR-070).

---

## `legal_hold`

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `scope` | jsonb | yes | |
| `reason` | text | yes | |
| `authority` | text | yes | **OD-6** |
| `owner_user_id` | uuid | yes | |
| `started_at` | timestamptz | yes | |
| `released_at` | timestamptz | no | |
| `released_by` | uuid | no | separation of duties vs creator |
| `release_reason` | text | no | |

---

## `data_source_record` (lineage link)

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | |
| `entity_type` | text | yes | |
| `entity_id` | uuid | yes | |
| `source_type` | text | yes | manual / migration / import / external_sync / system_derived / synthetic |
| `source_system` | text | no | |
| `source_record_id` | text | no | |
| `job_id` | uuid | no | |
| `source_row_ref` | text | no | |
| `transformation_version` | text | no | |
| `created_at` | timestamptz | yes | |

---

## Indexes and constraints (minimum)

- Quality issue uniqueness for open scope (FR-010).
- Redirect uniqueness on `from_id`.
- Job idempotency uniqueness per 010.
- No FK that would cascade-delete immutable history.
- Grants: only `ams_api` / `ams_worker` paths; no application principal with ad-hoc DELETE on transaction tables.

---

## Prohibited shapes

- Generic `PATCH` payload that accepts arbitrary column maps.
- Mutable current-state columns writable from data-management commands.
- Delete APIs for production business history outside retention purge job.
