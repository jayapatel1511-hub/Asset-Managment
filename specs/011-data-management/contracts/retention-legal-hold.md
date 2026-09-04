# Contract: Retention & Legal Hold

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: retention module; purge worker; document reconciliation (WS-W7)  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for hold/purge apply; OD-5 periods; OD-6 hold authority  
**Rule**: Versioned policy. Legal hold suspends purge. Preview writes nothing. **No general-purpose delete** for production business history.

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

export interface LegalHold {
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

export interface RetentionPreviewResult {
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
- Until OD-5 decides other classes: `periodDays: null` with action `Retain` and note `unspecified` — do not invent years.

### Preview

- Job type `RetentionPreview`.
- Writes **zero** business/document changes.
- Counts eligible / held / blocked for DB and documents.

### Legal hold

- Suspends automated purge for matching records/documents.
- Visible in preview.
- Release: authority + reason + time; creator cannot self-release where separation of duties applies (**STOP**: OD-6).

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
4. Platform Operator may run jobs without deciding business meaning — approvals stay with Data Owner / System Owner.
