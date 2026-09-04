# Contract: Quality Rules & Issues

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: quality module, overview dashboard, issue queue UI, scheduled worker  
**Depends on**: dictionary; WS-W2 views; WS-W3 for assign/resolve writes  
**First proof**: read-only rules + issues + overview (CLAUDE sequence step 6)

---

## Issue states

```ts
export type QualityIssueStatus =
  | "Open"
  | "Assigned"
  | "InProgress"
  | "Blocked"
  | "Resolved"
  | "Waived"
  | "FalsePositive"
  | "Reopened";
```

---

## Types

```ts
export interface DataQualityRule {
  id: string;
  ruleKey: string;
  version: number;
  domain: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  ownerUserId?: string | null;
  schedule?: string | null;
  isActive: boolean;
  implementationRef: string;
}

export interface DataQualityIssue {
  id: string;
  ruleId: string;
  ruleVersion: number;
  entityType: string;
  entityId: string;
  scopeKey: string;
  severity: DataQualityRule["severity"];
  status: QualityIssueStatus;
  officeLocationId?: string | null;
  ownerUserId?: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  dueAt?: string | null;
  evidence: Record<string, unknown>;
  resolutionNote?: string | null;
  waiverReason?: string | null;
  waiverApproverUserId?: string | null;
  waiverExpiresAt?: string | null;
  verificationType?: "RuleReevaluation" | "ManualApproved" | null;
  relatedJobId?: string | null;
  rowVersion: number;
}

export interface QualityOverviewCounts {
  bySeverity: Record<string, number>;
  byDomain: Record<string, number>;
  byOffice: Record<string, number>;
  byAgeBucket: Record<string, number>;
  temporaryTags: number;
  unknownCustodians: number;
  calibrationUnknownOrOverdue: number;
  duplicateCandidates: number;
  failedJobs: number;
  missingOrQuarantinedDocuments: number;
  reconciliationFailures: number;
  ruleVersion: string;
  dataCurrency: string;
}
```

---

## Read APIs (US1 first)

```http
GET /api/data-management/quality/overview
GET /api/data-management/quality/rules
GET /api/data-management/quality/issues
GET /api/data-management/quality/issues/{id}
```

Query filters: `officeId`, `domain`, `severity`, `status`, `ownerUserId`, `page`, `pageSize`.  
Every overview count MUST link to the filtered issue list and governing `ruleKey` (FR-015).

Authorization: steward capability / System Owner / Office Admin (office-scoped) / Report Reader. Field User denied.

Server-side paging only — no full-fleet download (FR-080).

---

## Commands (writes — gated)

**Blocked on 010 WS-W3/W4 foundations** for mutating issue workflow. Quality **rule run** may be System Owner / worker after auth exists.

```http
POST /api/data-management/quality/commands/run-rules
POST /api/data-management/quality/commands/assign-issue
POST /api/data-management/quality/commands/set-issue-status
POST /api/data-management/quality/commands/waive-issue
POST /api/data-management/quality/commands/mark-false-positive
POST /api/data-management/quality/commands/verify-resolution
```

### Idempotency

Every command: `clientSubmissionId` + canonical `requestHash` per 010 idempotency contract.

### Assign

```ts
export interface AssignIssueInput {
  issueId: string;
  ownerUserId: string;
  dueAt?: string | null;
  clientSubmissionId: string;
  expectedRowVersion: number;
}
```

### Waive

Requires `reason`, `approverUserId` (≠ requester where OD-3 applies), `waiverExpiresAt` (FR-013).  
After expiry, re-evaluation reopens if still failing.

### Resolve / verify

Issue reaches `Resolved` only after:

1. successful rule re-evaluation, or  
2. `ManualApproved` verification with approver (FR-012).

Claimed “fixed” without verification is refused.

### Run rules

Creates or **updates** one issue per `(ruleId, entityType, entityId, scopeKey)` — zero duplicate open issues per re-run (FR-010, SC-003).  
Emits a `QualityRuleRun` `data_job` with item-level outcomes optional for large runs.

---

## Alerts

Critical/age threshold alerts name the owner (FR-016).  
**STOP**: OD-12 service levels — until decided, implement detection + owner field; do not invent SLA hours in production config.

---

## Refusal codes

| Code | When |
|---|---|
| `quality.issueNotFound` | |
| `quality.forbidden` | Office/role scope |
| `quality.staleRowVersion` | |
| `quality.verificationRequired` | Resolve without re-eval/manual verify |
| `quality.waiverIncomplete` | Missing reason/approver/expiry |
| `quality.selfApprovalForbidden` | Separation of duties |
| `quality.duplicateOpenSuppressed` | Internal — update path used |

---

## Invariants

1. Rule version on the issue is retained; rule edits do not rewrite history.
2. FalsePositive retains evidence and rule version (FR-014).
3. Overview `dataCurrency` and rule version always present (FR-015).
4. No endpoint closes issues by deleting rows.
