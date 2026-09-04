# Contract: Reference & Master Data Commands

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: reference-data module; Console reference screens  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for writes; named data owners; decided OD-2
Data Steward bundle and R5 scope ceiling
**Rule**: Create / edit / deactivate / reactivate — **never ordinary hard-delete** (FR-018–FR-024)

**D18 boundary:** Administration → Data governance only. Reads require `reference.read`; commands
require `reference.manage` plus the exact domain/action, purpose, row scope, and field projection.
OfficeAdmin/SystemOwner role alone is insufficient; Work and general Reports receive no reference
management route or payload.

---

## Supported domains (initial)

```ts
export type ReferenceDomain =
  | "EquipmentModel"
  | "EquipmentCategory"   // hierarchical curated rows — ASSUMPTION from REMAINING-WORK G0.1
  | "Location"
  | "CalibrationLab"
  | "Project"             // when AMS authoritative; else ExternalAuthoritative
  | "OwnershipType"
  | "Carrier"
  | "RetirementReason"
  | "ControlledReasonList";
```

People are **not** a reference table — Entra + `app_user` / role / office scope (REMAINING-WORK G0.1).

---

## Command types

```ts
export type ReferenceCommandType =
  | "CreateReference"
  | "EditReference"
  | "DeactivateReference"
  | "ReactivateReference"
  | "ReparentLocation"
  | "AddReferenceAlias"
  | "MergeReference"
  | "PreviewReferenceImpact";
```

---

## Shared input envelope

```ts
export interface ReferenceCommandBase {
  domain: ReferenceDomain;
  clientSubmissionId: string;
  reason: string;
  evidence?: Record<string, unknown> | null;
  expectedRowVersion?: number;
}

export interface CreateReferenceInput extends ReferenceCommandBase {
  attributes: Record<string, unknown>; // validated against domain schema + dictionary
}

export interface EditReferenceInput extends ReferenceCommandBase {
  id: string;
  attributes: Record<string, unknown>;
}

export interface DeactivateReferenceInput extends ReferenceCommandBase {
  id: string;
}

export interface ReparentLocationInput extends ReferenceCommandBase {
  id: string;
  newParentId: string | null;
}

export interface MergeReferenceInput extends ReferenceCommandBase {
  survivorId: string;
  mergedAwayId: string;
  /** Required when OD-3 threshold met */
  approvalSubmissionId?: string;
}

export interface ReferenceImpactPreview {
  affectedAssetCount: number;
  affectedRules: string[];
  affectedReports: string[];
  authorizationScopeImpacts: string[];
  unresolvedConflicts: string[];
  reversibleClass: "Reversible" | "Compensatable" | "Irreversible";
}
```

---

## HTTP

```http
POST /api/data-management/reference/commands/create
POST /api/data-management/reference/commands/edit
POST /api/data-management/reference/commands/deactivate
POST /api/data-management/reference/commands/reactivate
POST /api/data-management/reference/commands/reparent-location
POST /api/data-management/reference/commands/add-alias
POST /api/data-management/reference/commands/preview-impact
POST /api/data-management/reference/commands/merge
GET  /api/data-management/reference/{domain}
GET  /api/data-management/reference/{domain}/{id}
```

High-impact reclassification / re-parent / merge: **preview required before apply** (FR-022).

---

## Behaviors

| Action | Required behavior |
|---|---|
| Create | Required structured fields; duplicate business keys refused |
| Edit | Only AMSManaged (or approved override) attributes |
| Delete | **Refused** — offer deactivate or merge |
| Deactivate | Hidden from new selection; historical display retained |
| Reparent | Cycle detection refused |
| Alias | Resolves search/import to canonical without creating duplicate spelling record |
| Merge | Permanent redirect; impact preview; audit; quality re-eval |
| ExternalAuthoritative | Local edit refused or override command with reconciliation consequence |

OD-7 is decided: OfficeAdmin may act only on permitted asset data in assigned offices; curated
global references require SystemOwner scope **and** the exact capability. Named domain ownership
remains an approval gate. Global scope alone never authorizes a reference command.

---

## Refusal codes

| Code | When |
|---|---|
| `reference.duplicateKey` | |
| `reference.cycle` | Location hierarchy |
| `reference.deleteForbidden` | Hard delete attempted |
| `reference.inactiveNotSelectable` | Client tried to assign deactivated ref on new op |
| `reference.externalAuthoritative` | Silent local edit |
| `reference.impactPreviewRequired` | |
| `reference.forbidden` | Workspace, purpose, capability, domain, row scope, or field policy |
| `reference.selfApprovalForbidden` | |
| `BlockedOn010Foundations` | Documented dependency marker until W3/W4 ready |

---

## Invariants

1. No `DELETE /api/data-management/reference/{domain}/{id}` for ordinary use.
2. No free-text substitute columns for manufacturer/model/type/location/project/user.
3. Applied changes emit `audit_event` and may enqueue quality re-run via outbox.
4. Categories remain hierarchical curated rows — not fixed enums that cannot be extended in-app.
