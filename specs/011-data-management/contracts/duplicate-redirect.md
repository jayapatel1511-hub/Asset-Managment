# Contract: Duplicate Candidates & Redirect Merge

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: duplicates module; quality rules that emit candidates  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for resolution apply  
**Rule**: Detection produces **candidates only**. **Never auto-merge on serial** (or model/tag similarity alone). Preserve both UUIDs and histories; permanent redirect.

---

## Resolution outcomes

```ts
export type DuplicateResolutionOutcome =
  | "NotDuplicate"
  | "RelatedPhysicalAssets"
  | "MergeRecords"
  | "RetireErroneousRecord"
  | "NeedsPhysicalAudit";
```

---

## Types

```ts
export interface DuplicateCandidate {
  id: string;
  entityType: "Asset" | "EquipmentModel" | "Location" | "Project";
  leftId: string;
  rightId: string;
  evidence: {
    sharedSerial?: boolean;
    modelSimilarity?: number;
    sourceLineageOverlap?: boolean;
    other: Record<string, unknown>;
  };
  status: "Open" | "UnderReview" | "Resolved";
  qualityIssueId?: string | null;
}

export interface DuplicateReviewBundle {
  candidate: DuplicateCandidate;
  left: DuplicateRecordSnapshot;
  right: DuplicateRecordSnapshot;
  conflicts: string[];
  survivorImpactIfLeft: string[];
  survivorImpactIfRight: string[];
  autoMergeEligible: false; // always false — structural
}

export interface DuplicateRecordSnapshot {
  id: string;
  canonicalKey?: string | null;
  aliases: string[];
  model?: string | null;
  serial?: string | null;
  sourceLineage: unknown;
  currentState: {
    lifecycle: string;
    disposition: string;
    serviceability: string;
    // R1 APPROVED 2026-09-03 three-axis (+ calibration currency derived)
    calibrationCurrency?: string;
    locationId?: string | null;
    custodianUserId?: string | null;
    projectId?: string | null;
  };
  counts: {
    transactions: number;
    calibrations: number;
    documents: number;
    relationships: number;
    installations: number;
  };
}

export interface ResolveDuplicateInput {
  candidateId: string;
  outcome: DuplicateResolutionOutcome;
  survivorId?: string; // required for MergeRecords
  mergedAwayId?: string;
  reason: string;
  evidence: Record<string, unknown>;
  clientSubmissionId: string;
  /** Physical audit */
  assigneeUserId?: string;
  dueAt?: string;
}

export interface RecordRedirect {
  id: string;
  entityType: string;
  fromId: string;
  toId: string;
  fromCanonicalKey?: string | null;
  mergedAt: string;
  requestedBy: string;
  approvedBy: string;
  evidence: Record<string, unknown>;
  jobId?: string | null;
}
```

---

## HTTP

```http
GET  /api/data-management/duplicates/candidates
GET  /api/data-management/duplicates/candidates/{id}
POST /api/data-management/duplicates/commands/resolve
POST /api/data-management/duplicates/commands/preview-merge
GET  /api/data-management/redirects/{entityType}/{fromId}
```

Shared serial between logger and geophone → candidate only; `autoMergeEligible` is always `false`.

---

## Merge behavior (post-go-live)

On approved `MergeRecords`:

1. Select survivor.
2. Mark merged-away non-operational for new commands.
3. Insert permanent `record_redirect`.
4. Retain former canonical key as searchable alias.
5. Preserve **both** original UUIDs, source lineage and histories.
6. Consolidated timeline read preserves source identity per event.
7. Reconcile current state explicitly — refuse incompatible unresolved states.
8. Move/associate permissible static facts/documents under approved rules.
9. Record requester, approver, evidence, impact.
10. **Do not rewrite** immutable transaction lines.

**STOP**: OD-11 — conflicting post-go-live operational histories; until decided, merge with unresolved incompatible state is refused (`duplicate.incompatibleState`).

Concurrency: two stewards resolving the same candidate — row_version / job lock; one winner.

---

## Other outcomes

| Outcome | Effect |
|---|---|
| NotDuplicate / RelatedPhysicalAssets | Suppress repeat noise until material evidence changes |
| NeedsPhysicalAudit | Create owned quality issue + due date |
| RetireErroneousRecord | Via approved retirement/event path — not silent delete |

---

## Refusal codes

| Code | When |
|---|---|
| `duplicate.autoMergeForbidden` | Any attempt to skip human review |
| `duplicate.serialInsufficient` | Serial-only merge justification |
| `duplicate.incompatibleState` | Unresolved conflicting current state/history |
| `duplicate.historyRewriteForbidden` | |
| `duplicate.selfApprovalForbidden` | |
| `duplicate.forbidden` | |
| `duplicate.staleCandidate` | |

---

## Invariants

1. Zero automatic merges based only on serial/model/similarity (SC-010).
2. Merged-away UUID remains addressable via redirect with visible explanation.
3. Offline queued commands against merged-away id surface Needs attention (010 offline) — do not silently apply to survivor without conflict rules.
4. Reference-record merges follow the same redirect/alias pattern.
