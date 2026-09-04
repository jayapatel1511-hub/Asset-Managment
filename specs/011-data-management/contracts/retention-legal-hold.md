# Contract: Retention & Legal Hold

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: retention module; purge worker; document reconciliation (WS-W7)  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for hold/purge apply; OD-5 periods; OD-6 hold authority  
**Rule**: Versioned policy. Legal hold suspends purge. Preview writes nothing. **No general-purpose delete** for production business history.

**D18 boundary:** Administration → Data governance/assurance only. Register, preview/apply, and hold
operations require the corresponding `retention.*` or `legalhold.*` capability, approved purpose,
case/row scope, field policy, and projection. Legal-hold reasons are Restricted and never enter Work,
general Reports, offline storage, or a role-wide SystemOwner response.

---

## Types

```ts
export interface RetentionPolicy {
  id: string;
  dataClass: string;
  version: number;
  action: "Retain" | "Archive" | "PurgeEligible";
  /** null = indefinite OR unspecified — FR-069 forbids inventing periods */
  periodDays: number | null;
  approvedBy: string;
  activatedAt: string;
  supersededAt?: string | null;
}

/** Persistence/service shape. Browser responses are case-scoped allowlists. */
export interface InternalLegalHold {
  id: string;
  scope: Record<string, unknown>;
  reason: string;
  authority: string;
  ownerUserId: string;
  startedAt: string;
  releasedAt?: string | null;
  releasedBy?: string | null;
  releaseReason?: string | null;
}

/** Persistence/service shape. Browser preview omits raw item IDs/reasons unless case-approved. */
export interface InternalRetentionPreviewResult {
  jobId: string;
  policyId: string;
  policyVersion: number;
  eligibleCount: number;
  heldCount: number;
  blockedCount: number;
  documentEligibleCount: number;
  documentHeldCount: number;
  documentMissingCount: number;
  itemsSample: Array<{ entityType: string; entityId: string; reason: string }>;
  wroteChanges: false;
}

export interface PurgeApplyInput {
  previewJobId: string;
  policyId: string;
  policyVersion: number;
  clientSubmissionId: string;
  approvalSubmissionId: string;
  recoveryPointVerified: boolean;
}
```

---

## HTTP

```http
GET  /api/data-management/retention/register
POST /api/data-management/retention/commands/preview
POST /api/data-management/retention/commands/purge-apply
POST /api/data-management/legal-holds/commands/create
POST /api/data-management/legal-holds/commands/release
GET  /api/data-management/legal-holds
GET  /api/data-management/legal-holds/{id}
```

Register covers at least: active/retired assets, transactions/relationships, calibration + certificates, installations, audit, quality issues, data jobs + sources, exports, outbox, app/security logs, idempotency payloads, offline caches, DB backups and Blob versions (FR-068).

---

## Behaviors

### Policy

- Policies versioned; immutable after activation.
- Retired assets + operational history: **indefinite** until approved supersession (FR-070).
- OD-5 is decided: Retain indefinitely by default, with `export.artifact` and `data.job.source`
  exceptions as recorded in `docs/08-decisions.md`. External legal obligations may supersede those
  defaults through a new approved version; implementations never invent a period.

### Preview

- Job type `RetentionPreview`.
- Writes **zero** business/document changes.
- Counts eligible / held / blocked for DB and documents.

### Legal hold

- Suspends automated purge for matching records/documents.
- Visible in preview.
- OD-6 is decided: SystemOwner is the scope ceiling for placement/release, the placer cannot release,
  and exact `legalhold.place` / `legalhold.release` capabilities are still required.

### Purge apply

- Requires: approved policy version, dependency checks, owner approval, recovery prerequisites where configured, exact counts, immutable audit, post-purge DB/document reconciliation (FR-074, FR-076).
- Attempt to purge indefinitely retained history without policy change → refused.
- Ordinary users: **no** general delete UI or API for production business history (FR-075, SC-016).

---

## Refusal codes

| Code | When |
|---|---|
| `retention.periodUnapproved` | Invented period |
| `retention.indefiniteProtected` | |
| `retention.held` | Item under legal hold |
| `retention.previewRequired` | |
| `retention.recoveryRequired` | |
| `retention.policyStale` | Version mismatch |
| `retention.selfApprovalForbidden` | |
| `retention.reconcileFailed` | DB/doc mismatch |
| `legalHold.selfReleaseForbidden` | |
| `legalHold.forbidden` | |
| `delete.notAvailable` | Generic delete attempted |

---

## Invariants

1. Preview never mutates.
2. Hold beats purge.
3. Purge is a job, not a button on asset detail.
4. A Platform Operator may run jobs only with an approved service/operations capability and cannot
   decide business meaning; approvals stay with the authorized Data Owner/SystemOwner purpose.
