# Contract: Transactional Outbox Envelope

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Consumers**: WS-W4 (write), WS-W8 (workers), optional M365 adapters.

## Rule

Every background side effect from an accepted business event is inserted as an `outbox_event` row
**inside the same PostgreSQL transaction** as the business write. Notification failure never rolls
back or mutates asset truth (FR-044, FR-045).

## Row / envelope

```ts
export type OutboxAggregateType =
  | "Asset"
  | "Transaction"
  | "Calibration"
  | "Installation"
  | "Document"
  | "User";

export type OutboxEventType =
  | "transaction.accepted"
  | "checkout.reminder_schedule"
  | "return.overdue_check"
  | "calibration.certificate_missing"
  | "notification.teams"
  | "notification.email"
  | "reconciliation.requested";
  // extend via migration + versioned payload, not silent reuse

export interface OutboxEnvelope<TPayload = unknown> {
  /** DB identity (bigint) — internal */
  id?: number;
  /** Public unique id generated at insert */
  eventId: string; // UUID
  eventType: OutboxEventType | string;
  aggregateType: OutboxAggregateType;
  aggregateId: string; // UUID
  /** Versioned payload; workers must be idempotent on eventId */
  payload: TPayload & { schemaVersion: number };
  availableAt: string; // ISO; may be delayed for reminders
  attemptCount: number;
  lockedAt: string | null;
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
}
```

### Example payload — transaction accepted

```ts
export interface TransactionAcceptedPayload {
  schemaVersion: 1;
  transactionId: string;
  transactionType: string;
  assetIds: string[];
  performedByUserId: string;
  recordedAt: string;
}
```

## Worker claim semantics

1. Claim batch: `processed_at IS NULL AND available_at <= now()` with lease (`locked_at`) and
   skip locked / `FOR UPDATE SKIP LOCKED`.
2. Process idempotently keyed by `eventId` (and external provider idempotency where available).
3. On success set `processed_at`.
4. On failure increment `attempt_count`, store `last_error`, clear lease, optional backoff on
   `available_at`.
5. Alert when backlog age exceeds threshold (FR-047) — owner from R6 ops decision.

## Insertion from command service

On Checkout accept, at least:

- one `transaction.accepted` outbox row (audit/downstream);
- optional notification scheduling rows — never required for command success.

## Non-goals

- Using the outbox as a second source of truth for asset state
- Synchronous Teams calls inside the business transaction
- At-least-once delivery without consumer idempotency
