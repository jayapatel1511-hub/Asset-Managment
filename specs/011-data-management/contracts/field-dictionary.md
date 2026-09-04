# Contract: Field Dictionary

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: `server/src/modules/data-management/` dictionary + quality modules; Console Data Management UI; CI `data:dictionary:check`  
**Depends on**: WS-W2 schema gate; OD-4 classification labels before production acceptance (SC-001)

Machine-readable field registry. Every production field MUST have an entry before Production Accepted. Schema/API checks fail on missing or contradictory entries (FR-002, FR-020 / CHK011–CHK021).

**No write path may invent authority that contradicts this dictionary.**
Under D18, responsibility roles are not read authorization. Every field declares its allowed
purposes, capabilities, projections, presentation tier, masking, and offline policy; see
[`docs/25-need-to-know-access-ux.md`](../../../docs/25-need-to-know-access-ux.md).

---

## Authority mode

```ts
export type FieldAuthorityMode =
  | "SystemDerived"
  | "AMSManaged"
  | "ExternalAuthoritative"
  | "ImportedOnce"
  | "ReferenceOnly";
```

| Mode | Ordinary local edit | Notes |
|---|---|---|
| `SystemDerived` | **Refused** | Lifecycle, disposition, serviceability, current location, custodian, project, parent |
| `AMSManaged` | Named command if purpose/capability permits | Static facts, curated references |
| `ExternalAuthoritative` | Refused or approved override only | Source correction preferred |
| `ImportedOnce` | Correction command with lineage | Migration/import provenance retained |
| `ReferenceOnly` | Via reference commands | Selected, not typed |

---

## Types

```ts
export interface DataDictionaryEntry {
  id: string;
  entityName: string;
  fieldName: string;
  displayName: string;
  definition: string;
  dataType: string;
  allowedValues?: unknown;
  ownerRole: string;
  stewardRole: string;
  authorityMode: FieldAuthorityMode;
  /** OD-4 decided taxonomy. Classification is a handling floor, never access entitlement. */
  classification: string;
  /** Coarse assignment/accountability hints only; never sufficient authorization. */
  readRoles: string[];
  writeRoles: string[];
  exportRoles: string[];
  allowedPurposes: string[];
  readCapabilities: string[];
  writeCapabilities: string[];
  exportCapabilities: string[];
  projectionIds: string[];
  presentationTier: "Summary" | "Operational" | "Maintenance" | "Evidence" | "Governance" | "Technical";
  maskingPolicy: string;
  offlinePolicy: "Never" | "ApprovedProjectionOnly";
  retentionClass: string;
  qualityRuleIds: string[];
  lineageSource?: string | null;
  deprecatedAt?: string | null;
  replacedByField?: string | null;
  rowVersion: number;
}
```

---

## Read APIs (first delivery)

```http
GET /api/data-management/dictionary
GET /api/data-management/dictionary/{entityName}/{fieldName}
GET /api/data-management/dictionary/coverage
```

### `GET /dictionary`

Query: `entityName?`, `authorityMode?`, `classification?`, `page`, `pageSize`.

Response: paged `DataDictionaryEntry[]` plus `dataCurrency` timestamp.

Authorization: Administration workspace + `data.dictionary.read` +
allowed purpose + row/field projection. SystemOwner, OfficeAdmin, ReportReader, and Auditor labels do
not grant this route by themselves. A general Report Reader and Field User are denied. An Auditor
uses a separate case-scoped audit projection when approved rather than this Administration route.

### `GET /dictionary/coverage`

Response:

```ts
export interface DictionaryCoverageReport {
  totalProductionFields: number;
  withEntry: number;
  missing: Array<{ entityName: string; fieldName: string }>;
  contradictions: Array<{ entityName: string; fieldName: string; detail: string }>;
  asOf: string;
}
```

Coverage must reach 100% before production acceptance (SC-001). Missing entries fail CI check when the gate is enabled.

---

## Write APIs (later; gated)

Dictionary maintenance writes (if any) are **named commands**, not free-form PATCH.

```http
POST /api/data-management/dictionary/commands/upsert-entry
POST /api/data-management/dictionary/commands/deprecate-entry
```

- **Blocked on 010 WS-W3/W4 foundations**
- **STOP**: OD-13 (who approves dictionary changes)
- Self-approval refused where OD-3 applies
- Emits `audit_event`; never silently changes authority_mode of SystemDerived fields to AMSManaged

---

## Refusal codes

| Code | When |
|---|---|
| `dictionary.notFound` | Unknown entity/field |
| `dictionary.forbidden` | Caller lacks approved workspace, purpose, capability, scope, or projection |
| `dictionary.coverageIncomplete` | Gate check used by CI/release |
| `dictionary.contradiction` | Entry conflicts with schema/sensitivity/offline/export rule |
| `dictionary.classificationUnapproved` | Attempt to persist label outside approved taxonomy (OD-4) |

---

## Invariants

1. SystemDerived fields never appear in static-correction or import writable column sets.
2. Fields whose `offlinePolicy` is `Never` never enter any offline projection; `ApprovedProjectionOnly`
   still requires an allowlisted projection and identity/workspace partition.
3. Export templates may include a field only when purpose, export capability, template projection,
   classification, masking, and row scope all permit it; `exportRoles` alone is insufficient.
4. No generic `PATCH /api/data-management/dictionary/{id}` with arbitrary column maps.
