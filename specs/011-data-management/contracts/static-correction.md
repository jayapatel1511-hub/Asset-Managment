# Contract: Static Correction Commands

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: corrections module; Office Admin / steward Console flows  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations**; field dictionary authority modes  
**Rule**: Named commands only. **No derived-state writes.** No transaction line edit/delete.

---

## Allowed command types (initial)

```ts
export type StaticCorrectionCommandType =
  | "CorrectSerialNumber"
  | "AddAssetAlias"
  | "RemoveNonCanonicalAlias"
  | "CorrectEquipmentModel"
  | "CorrectOwnership"
  | "CorrectAcquiredDate"
  | "CorrectAssetNotes"
  | "CompleteTemporaryTag"
  | "CorrectSecondaryIdentifier"; // ICCID/IMEI only when role + dictionary permit
```

Related **business events** (not static corrections — route to 010 transaction API):

```ts
export type RoutedBusinessEvent =
  | "RehomeAsset"
  | "AttachPermanentComponent"
  | "DetachPermanentComponent"
  | "CompensatingCustodyOrLocationEvent";
```

---

## Forbidden through this module

- lifecycle, disposition, serviceability
- current location, custodian, project, parent
- canonical Asset ID change after assignment
- edit/delete of transaction headers/lines
- silent historical effective-date rewrite
- replacing failed calibration with pass without supersession trail (use calibration correction in 010/003)

---

## Input / outcome

```ts
export interface StaticCorrectionInput {
  commandType: StaticCorrectionCommandType;
  assetId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  evidence: Record<string, unknown>;
  effectiveAt?: string | null;
  clientSubmissionId: string;
  expectedRowVersion: number;
}

export interface StaticCorrectionImpactPreview {
  commandType: StaticCorrectionCommandType;
  assetId: string;
  calibrationConsequences: string[];
  identifierConsequences: string[];
  reportingConsequences: string[];
  validationConsequences: string[];
  qualityIssuesLikelyToOpenOrClose: string[];
  requiresApproval: boolean;
}

export interface StaticCorrectionResult {
  changeRequestId: string;
  assetId: string;
  appliedAt: string;
  before: unknown;
  after: unknown;
  qualityReevaluationJobId?: string | null;
  auditCorrelationId: string;
}
```

---

## HTTP

```http
POST /api/data-management/corrections/commands/preview
POST /api/data-management/corrections/commands/apply
POST /api/data-management/corrections/commands/approve
GET  /api/data-management/corrections/{changeRequestId}
```

High-impact fields (equipment model, identifiers, ownership): preview mandatory (FR-029).

Separation of duties: requester ≠ approver where configured (**STOP**: OD-3).  
Office Admin limited to office scope (FR-005).

After apply: related quality issues re-evaluated (FR-030).

---

## Refusal codes

| Code | When |
|---|---|
| `correction.derivedStateForbidden` | Attempted SystemDerived field |
| `correction.canonicalIdImmutable` | |
| `correction.historyImmutable` | Transaction line mutate |
| `correction.useBusinessEvent` | Rehome/relationship — includes suggested event type |
| `correction.evidenceRequired` | |
| `correction.previewRequired` | |
| `correction.selfApprovalForbidden` | |
| `correction.forbidden` | Role/office/sensitive field |
| `correction.staleRowVersion` | |
| `correction.externalAuthoritative` | |

---

## Invariants

1. Caller identity from session — never browser-supplied user id as authority (010 auth).
2. Old/new/reason/evidence/requester/approver/effective/applied retained (FR-007).
3. Temporary/legacy tags retained as aliases on complete/correct (FR-028).
4. No `PATCH /api/assets/{id}` generic body.
