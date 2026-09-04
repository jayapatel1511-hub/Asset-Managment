/**
 * The transactional-outbox envelope, verbatim from the frozen contract
 * `specs/010-web-application-platform/contracts/outbox-envelope.md` and the table catalogue in
 * `docs/15-postgres-data-model.md` § 11.
 *
 * WHY AN ENVELOPE TYPE AT ALL, rather than passing rows around. CLAUDE.md rule 2 says one
 * business event is one atomic commit *including its outbox events*. The only way that stays
 * true is if enqueuing is a one-line call on the transaction handle the command already holds,
 * and the only way THAT stays safe is if the payload shape is checked at the call site rather
 * than at delivery time — a malformed payload discovered by a worker three minutes later is a
 * dead letter, not an error anyone can act on.
 *
 * `schemaVersion` is mandatory on every payload for the same reason the contract insists on it:
 * a worker is a separate deployment unit from the command that wrote the row, so the two are
 * never at the same version at the same time. Extend by adding an event type and bumping the
 * payload version through a migration — never by silently reusing an existing type with a new
 * shape (contract § Row / envelope).
 *
 * Owned by the outbox/documents lane (specs/_planning/BUILD-FREEZE.md, Agent 5).
 */

/** Contract § Row / envelope. */
export type OutboxAggregateType = "Asset" | "Transaction" | "Calibration" | "Installation" | "Document" | "User";

/**
 * Contract § Row / envelope. Declared as a union *plus* `string` at the boundary (see
 * `OutboxEventInput`) so an unrecognised type from a newer writer reaches the worker as an
 * unhandled event — which dead-letters and alerts — rather than failing to compile in a version
 * skew that only exists at runtime.
 */
export type OutboxEventType =
  | "transaction.accepted"
  | "checkout.reminder_schedule"
  | "return.overdue_check"
  | "calibration.certificate_missing"
  | "notification.teams"
  | "notification.email"
  | "reconciliation.requested";

export interface OutboxPayload {
  schemaVersion: number;
}

export interface OutboxEnvelope<TPayload extends OutboxPayload = OutboxPayload> {
  /** Database identity (bigint). Internal ordering key; never leaves the server. */
  id: number;
  /** Public unique id, generated at insert. Workers are idempotent on THIS, not on `id`. */
  eventId: string;
  eventType: OutboxEventType | string;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  payload: TPayload;
  /** ISO. May be in the future: that is how a reminder is scheduled without a scheduler. */
  availableAt: string;
  attemptCount: number;
  /** ISO. The worker lease — see worker.ts § visibility timeout. */
  lockedAt: string | null;
  lockedBy: string | null;
  processedAt: string | null;
  /** ISO. Set once `attemptCount` reaches the bound; the row is never claimed again. */
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
  lastError: string | null;
  createdAt: string;
  /** The command that produced the event, where one exists — for tracing a delivery back to a
   * business fact without joining through the payload. */
  correlationId: string | null;
}

/** What a caller inside an open transaction hands `enqueue`. */
export interface OutboxEventInput<TPayload extends OutboxPayload = OutboxPayload> {
  eventType: OutboxEventType | string;
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  payload: TPayload;
  /** Defaults to a fresh UUID. Supplied only when the caller needs a deterministic key. */
  eventId?: string;
  /** ISO or Date. Defaults to now — i.e. deliver as soon as a worker picks it up. */
  availableAt?: string | Date;
  correlationId?: string | null;
}

// ---------------------------------------------------------------- payloads

/** Contract § Example payload — transaction accepted. Emitted by the atomic command. */
export interface TransactionAcceptedPayload extends OutboxPayload {
  schemaVersion: 1;
  transactionId: string;
  transactionType: string;
  assetIds: string[];
  performedByUserId: string;
  recordedAt: string;
}

/** Scheduled by the overdue-return job (WS-W8 § reminder scheduling). */
export interface ReturnOverduePayload extends OutboxPayload {
  schemaVersion: 1;
  assetId: string;
  custodian: string | null;
  homeoffice: string | null;
  expectedReturn: string;
  transactionName: string | null;
  /** How many reminders this asset has already had — bounded messages, WS-W8 § rules. */
  reminderNumber: number;
}

/**
 * Emitted when an accepted calibration record has no current, readable certificate — the
 * FR-033 case the whole documents lane exists for: the fact is true and stored, the file is
 * missing, and the two are separable.
 */
export interface CalibrationCertificateMissingPayload extends OutboxPayload {
  schemaVersion: 1;
  assetId: string;
  calibrationRecordId: string;
  calibrationDate: string | null;
  nextDueDate: string | null;
  /** Why there is no certificate: never uploaded, upload failed, quarantined, voided. */
  reason: "NeverAttached" | "UploadFailed" | "Quarantined" | "Voided" | "Superseded";
}

/** Raised by the database ↔ object-store reconciliation job (WS-W7 § database/object
 * reconciliation). */
export interface ReconciliationRequestedPayload extends OutboxPayload {
  schemaVersion: 1;
  scope: "documents";
  metadataWithoutObject: number;
  objectWithoutMetadata: number;
  hashMismatch: number;
  checkedAt: string;
}

/** A directly-addressed notification. `notification.teams` and `notification.email` share it. */
export interface NotificationPayload extends OutboxPayload {
  schemaVersion: 1;
  channel: "teams" | "email";
  /** Recipients are resolved at DELIVERY time from live office/admin data where the payload
   * names an office; an explicit list is used verbatim (WS-W8 § office recipients). */
  office?: string | null;
  to?: string[];
  subject: string;
  body: string;
}
