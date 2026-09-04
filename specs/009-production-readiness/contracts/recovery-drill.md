# Contract: Recovery drill (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: 010 health, document-upload, deployment/runbook artifacts; Azure Postgres + private Blob
(consumes 010 contracts for document metadata; infra from WS-W10)  
**Workstream**: WS-W12 recovery  
**Spec mapping**: US6; FR-040; SC-013  
**Gate**: **R6** — Azure enterprise prerequisites; does **not** block local five-asset proof

## Purpose

Evidence record for **three separate** procedures. A previous front-end bundle is not a restore for
corrupted business data. Names updated from parked Power Platform language:

| Procedure | Means (Azure web app) | Must not be confused with |
|---|---|---|
| **1. App revision rollback** | Redeploy prior immutable Container Apps revision / image | Database or Blob restore |
| **2. Platform / schema recovery** | Forward-compatible schema handling, controlled migration repair, environment rebuild from IaC | Silent data rewrite |
| **3. Business data + document recovery** | PostgreSQL PITR/restore **and** private Blob object restore with metadata/hash reconciliation | App-only rollback |

## Drill A — App revision rollback

| Field | Content |
|---|---|
| `drill` | `app-revision-rollback` |
| `from_revision` / `to_revision` | Image/commit ids |
| `owner` / `started_at` / `finished_at` | Required |
| `business_data_changed` | Must be **no** |
| `smoke_result` | Health + critical read path |
| `result` | pass \| fail |
| `rto_observed` | Duration |

**Pass**: Prior app serves; API compatible per rollback policy; **no** business data mutation from the rollback itself.

## Drill B — PostgreSQL restore

| Field | Content |
|---|---|
| `drill` | `postgres-restore` |
| `backup_identity` | PITR timestamp or backup id |
| `environment` | Non-prod preferred for rehearsal |
| `rpo_claimed` / `rpo_observed` | Per policy |
| `rto_observed` | Duration |
| `row_spot_checks` | Assets / transactions sampled |
| `owner` / `result` | Required |

**Pass**: Restored DB consistent; application points at restored instance per runbook; measured against approved RTO/RPO.

## Drill C — Document (Blob) restore + reconciliation

| Field | Content |
|---|---|
| `drill` | `document-restore` |
| `object_sample` | Calibration certificates including retired-asset case |
| `metadata_db_match` | Pass/fail per object |
| `content_hash_match` | Pass/fail |
| `unauthorized_access_attempt` | Still denied after restore |
| `owner` / `result` | Required |

**Pass**: Documents recoverable; DB metadata and Blob hashes reconcile; mismatch report if any object missing (FR-040 / WS-W7).

## Drill D — Alert escalation (optional but recommended for pilot)

| Field | Content |
|---|---|
| `drill` | `alert-escalation` |
| `trigger` | Forced health/outbox failure |
| `notified` | Named owner/channel reached |
| `result` | pass \| fail |

## Aggregate pack

| Field | Content |
|---|---|
| `contract` | `recovery-drill` |
| `procedures_evidenced` | A, B, C (, D) |
| `named_owners` | Per procedure |
| `r6_prerequisites` | Subscription/region/Entra/RTO-RPO refs |
| `result` | pass only if A–C pass |
| `sc013` | Explicit mapping to SC-013 |

## Non-claims

- Local developer DB dump without Blob reconciliation does not satisfy Drill C.
- Passing Drill A alone must not be reported as “recovery complete.”
- R6-open does not excuse skipping local atomic proofs; it only defers these drills.
