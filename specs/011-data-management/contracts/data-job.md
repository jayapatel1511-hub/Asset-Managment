# Contract: Data Job (Dry-run / Apply)

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: jobs / imports / exports / reconciliation / retention / quality run modules; workers (WS-W8)  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for write apply; Blob (WS-W7) for artifacts  
**Rule**: Dry-run writes **no** business changes. Apply has row-level outcomes. Idempotent. Declares reversibility class.

**D18 boundary:** Data-job routes are Administration-only and online-only. Read/request/apply require
`data.job.read`, `data.job.request`, or `data.job.apply` plus job-type purpose, row/field scope, and
projection. A worker uses a separate least-privilege service identity. Work/general Reports receive
no job parameters, items, artifacts, before/after data, requester identities, or internal IDs.

---

## Job types

```ts
export type DataJobType =
  | "Import"
  | "BulkUpdate"
  | "Export"
  | "Reconciliation"
  | "DuplicateResolution"
  | "ReferenceMerge"
  | "RetentionPreview"
  | "Purge"
  | "QualityRuleRun";

export type ReversibilityClass = "Reversible" | "Compensatable" | "Irreversible";

export type DataJobItemStatus =
  | "Valid"
  | "Warning"
  | "Invalid"
  | "Applied"
  | "Skipped"
  | "Failed"
  | "Uncertain";
```

---

## Types

```ts
/** Persistence/service shape. Never serialize this whole interface to the browser. */
export interface InternalDataJob {
  id: string;
  jobType: DataJobType;
  status: string;
  schemaVersion: string;
  environment: string;
  requestedBy: string;
  approvedBy?: string | null;
  idempotencyKey: string;
  requestHash: string;
  sourceName?: string | null;
  sourceHash?: string | null;
  requestParameters: Record<string, unknown>;
  codeVersion: string;
  reversibilityClass: ReversibilityClass;
  dryRunSummary?: DataJobSummary | null;
  resultSummary?: DataJobSummary | null;
  startedAt?: string | null;
  completedAt?: string | null;
  artifactPath?: string | null;
  artifactExpiresAt?: string | null;
  correlationId: string;
}

export interface DataJobSummary {
  total: number;
  valid: number;
  warning: number;
  invalid: number;
  applied: number;
  skipped: number;
  failed: number;
  uncertain: number;
}

/** Persistence/service shape; browser item projections explicitly allowlist fields. */
export interface InternalDataJobItem {
  id: string;
  jobId: string;
  itemNumber: number;
  sourceReference?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  operation: string;
  status: DataJobItemStatus;
  severity?: string | null;
  messages: Array<{ code: string; text: string }>; // sensitive values redacted
  beforeData?: unknown;
  afterData?: unknown;
  appliedAt?: string | null;
}

export interface AdminDataJobListItem {
  jobId: string;
  jobType: DataJobType;
  status: string;
  reversibilityClass: ReversibilityClass;
  startedAt?: string | null;
  completedAt?: string | null;
  resultSummary?: DataJobSummary | null;
  scopeLabel: "Office" | "Organization";
  dataProjectionId: "admin_datajob_list_v1";
}
```

Job detail/item responses use separate task projections. Raw source/request parameters,
`beforeData`, `afterData`, hashes, storage paths, requester/approver IDs, and correlation IDs appear
only when the current investigation purpose explicitly requires each field.

---

## HTTP

```http
POST /api/data-management/jobs/import/dry-run
POST /api/data-management/jobs/import/apply
POST /api/data-management/jobs/bulk-update/dry-run
POST /api/data-management/jobs/bulk-update/apply
GET  /api/data-management/jobs/{jobId}
GET  /api/data-management/jobs/{jobId}/items
POST /api/data-management/jobs/{jobId}/cancel
```

Import types expose versioned downloadable templates + dictionary subset:

```http
GET /api/data-management/imports/templates
GET /api/data-management/imports/templates/{importType}/v/{version}
```

---

## Dry-run

- Persists job + items; **zero** business table mutations.
- Validates: file type/size, headers/schema version, required fields, types, reference resolution, duplicate keys, auth/office scope, sensitive-field permission, business rules, row dependencies, environment restrictions, source hash.
- Reports before/after preview, new references required, duplicate candidates, auth failures, quality issues expected, irreversible/high-impact flags.
- Rows attempting SystemDerived / history writes → `Invalid` with `job.derivedStateForbidden` — not translated into hidden edits.

---

## Apply gates

Refuse apply when any of:

| Gate | Code |
|---|---|
| Source file/hash changed | `job.sourceChanged` |
| Schema version unsupported | `job.schemaUnsupported` |
| Material target drift since dry-run | `job.targetDrift` |
| Approval expired | `job.approvalExpired` |
| Requester lost permission | `job.permissionLost` |
| New critical validation | `job.criticalValidation` |
| Irreversible without recovery point | `job.recoveryRequired` |
| Self-approval on high-impact | `job.selfApprovalForbidden` |

OD-3 thresholds, OD-7 OfficeAdmin bulk scope, and OD-9 source-file retention are decided. Apply must
enforce them together with current D18 capability and projection policy.

---

## Batching & atomicity

Large jobs may apply in batches, but:

- every item gets a final status (FR-037);
- logical groups that must remain atomic commit together (FR-038);
- retries with same idempotency identity create no duplicate effects (FR-039);
- after worker failure, applied / unapplied / uncertain are distinguishable (FR-039).

Irreversible jobs require highest approval + verified recovery prerequisite (FR-041).

---

## Spreadsheet safety

Import results and export-related artifacts protect against formula injection per approved format policy (FR-043).

---

## Invariants

1. Same `idempotencyKey` + same `requestHash` → original result.
2. Same key + different hash → refused (`job.idempotencyConflict`) per 010.
3. Sensitive values redacted from messages/logs (FR-079).
4. No generic SQL or arbitrary table apply endpoint.
