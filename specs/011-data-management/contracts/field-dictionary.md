# Contract: Field Dictionary

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: `server/src/modules/data-management/` dictionary + quality modules; Console Data Management UI; CI `data:dictionary:check`  
**Depends on**: WS-W2 schema gate; OD-4 classification labels before production acceptance (SC-001)

Machine-readable field registry. Every production field MUST have an entry before Production Accepted. Schema/API checks fail on missing or contradictory entries (FR-002, FR-020 / CHK011–CHK021).

**No write path may invent authority that contradicts this dictionary.**

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
| `AMSManaged` | Named command if role permits | Static facts, curated references |
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
  /** OD-4: map to approved corporate taxonomy; do not invent production labels. */
  classification: string;
  readRoles: string[];
  writeRoles: string[];
  exportRoles: string[];
  offlineCacheAllowed: boolean;
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

Authorization: steward capability, System Owner, Report Reader/Auditor (read); Field User **denied**.

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
| `dictionary.forbidden` | Caller lacks read/write role |
| `dictionary.coverageIncomplete` | Gate check used by CI/release |
| `dictionary.contradiction` | Entry conflicts with schema/sensitivity/offline/export rule |
| `dictionary.classificationUnapproved` | Attempt to persist label outside approved taxonomy (OD-4) |

---

## Invariants

1. SystemDerived fields never appear in static-correction or import writable column sets.
2. `offlineCacheAllowed: false` fields never enter Field User IndexedDB projections (010 offline contract consumes this).
3. Export templates may only include fields whose `exportRoles` include the requester (see governed-export contract).
4. No generic `PATCH /api/data-management/dictionary/{id}` with arbitrary column maps.
