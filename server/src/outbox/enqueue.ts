/**
 * `enqueue` — the whole point of a transactional outbox, in one function.
 *
 * CLAUDE.md rule 2: *one business event is one atomic database commit*, and the frozen contract
 * `specs/010-web-application-platform/contracts/outbox-envelope.md` spells out what that means
 * here — "every background side effect from an accepted business event is inserted as an
 * `outbox_event` row **inside the same PostgreSQL transaction** as the business write".
 *
 * The signature is the mechanism. `enqueue` takes a `Queryable`, which is precisely the handle
 * `transactionService.runCommand` already hands its body (`(tx: Queryable) => …`) and which
 * `applyTransaction`, `checkout`, `recordCalibration` and every other command function already
 * pass around. A caller inside the open transaction therefore gets atomicity **for free** and
 * cannot opt out of it: there is no connection, no pool, no client here to accidentally write
 * on. If the command rolls back — a refusal, a constraint violation, a fault injected after the
 * third line — the event row rolls back with it, because it was never anywhere else.
 *
 * The inverse is equally load-bearing and equally free: an event row that exists is an event
 * whose business fact committed. A worker never has to ask "did that really happen?"
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO. It does not send anything, open a connection,
 * call Teams, or await a network. The contract's § Non-goals names "synchronous Teams calls
 * inside the business transaction" explicitly, and CLAUDE.md's stack table is just as explicit
 * that Microsoft 365 "is an integration surface, not the runtime boundary". A command must
 * commit with the network unplugged.
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/database";
import type {
  OutboxEnvelope,
  OutboxEventInput,
  OutboxPayload,
  TransactionAcceptedPayload,
} from "./types";

/** Column list shared by `enqueue` and the worker's row mapper. */
export const OUTBOX_COLUMNS = `id, event_id, event_type, aggregate_type, aggregate_id, payload,
  available_at, attempt_count, locked_at, locked_by, processed_at, dead_lettered_at,
  dead_letter_reason, last_error, correlation_id, created_at`;

export interface OutboxRow {
  id: string | number;
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: OutboxPayload;
  available_at: Date | string;
  attempt_count: number;
  locked_at: Date | string | null;
  locked_by: string | null;
  processed_at: Date | string | null;
  dead_lettered_at: Date | string | null;
  dead_letter_reason: string | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: Date | string;
}

/** `pg` hands back `timestamptz` as a Date; PGlite may hand back either. The envelope is ISO
 * either way, so every consumer sees one shape. */
export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function envelopeFromRow<T extends OutboxPayload = OutboxPayload>(row: OutboxRow): OutboxEnvelope<T> {
  return {
    id: Number(row.id),
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type as OutboxEnvelope["aggregateType"],
    aggregateId: row.aggregate_id,
    payload: row.payload as T,
    availableAt: iso(row.available_at)!,
    attemptCount: row.attempt_count,
    lockedAt: iso(row.locked_at),
    lockedBy: row.locked_by,
    processedAt: iso(row.processed_at),
    deadLetteredAt: iso(row.dead_lettered_at),
    deadLetterReason: row.dead_letter_reason,
    lastError: row.last_error,
    correlationId: row.correlation_id,
    createdAt: iso(row.created_at)!,
  } as OutboxEnvelope<T>;
}

/**
 * Inserts one outbox event on the caller's transaction handle and returns its public `eventId`.
 *
 * `tx` is whatever the caller already has: the `Tx` inside `db.transaction()`, or the root
 * `Database` for a genuinely standalone event (a scheduled job's own emission). Passing the
 * root handle outside a transaction is legitimate for a job that has no business write to be
 * atomic with — it is NOT legitimate for a command, and a command has no way to reach the root
 * handle from inside `runCommand`, which is the design.
 *
 * Refuses a payload with no `schemaVersion`: a worker deployed at a different version than the
 * writer has nothing else to branch on (contract § Row / envelope).
 */
export async function enqueue<T extends OutboxPayload>(tx: Queryable, event: OutboxEventInput<T>): Promise<string> {
  if (typeof event.payload?.schemaVersion !== "number") {
    throw new Error(
      `Outbox event "${event.eventType}" has no payload.schemaVersion. A worker is a separate ` +
        `deployment from the command that wrote the row and cannot interpret an unversioned payload.`
    );
  }
  const eventId = event.eventId ?? randomUUID();
  const availableAt =
    event.availableAt instanceof Date
      ? event.availableAt.toISOString()
      : (event.availableAt ?? new Date().toISOString());

  await tx.query(
    `INSERT INTO outbox_event (event_id, event_type, aggregate_type, aggregate_id, payload,
                               available_at, correlation_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7)`,
    [
      eventId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      availableAt,
      event.correlationId ?? null,
    ]
  );
  return eventId;
}

/**
 * The envelope `transactionService.applyTransaction` emits for every accepted business event —
 * contract § Insertion from command service, "on Checkout accept, at least: one
 * `transaction.accepted` outbox row".
 *
 * Exported as a builder rather than left inline at the call site so the payload shape is owned
 * by this lane and versioned in one place, and so the integration into `transactionService.ts`
 * (which this lane does not write — BUILD-FREEZE § File ownership) is a two-line call rather
 * than a block of literal object construction that would then be this lane's shape living in
 * someone else's file.
 */
export function transactionAcceptedEvent(params: {
  transactionId: string;
  transactionName: string;
  transactionType: string;
  assetIds: string[];
  performedByUserId: string;
  recordedAt: string;
  clientSubmissionId?: string | null;
}): OutboxEventInput<TransactionAcceptedPayload> {
  return {
    eventType: "transaction.accepted",
    aggregateType: "Transaction",
    aggregateId: params.transactionId,
    correlationId: params.clientSubmissionId ?? null,
    payload: {
      schemaVersion: 1,
      transactionId: params.transactionId,
      transactionType: params.transactionType,
      assetIds: params.assetIds,
      performedByUserId: params.performedByUserId,
      recordedAt: params.recordedAt,
    },
  };
}

// ---------------------------------------------------------------- reads (operations + tests)

export async function getEvent(db: Queryable, eventId: string): Promise<OutboxEnvelope | null> {
  const res = await db.query<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM outbox_event WHERE event_id = $1`, [eventId]);
  return res.rows[0] ? envelopeFromRow(res.rows[0]) : null;
}

export async function listEventsForAggregate(
  db: Queryable,
  aggregateType: string,
  aggregateId: string
): Promise<OutboxEnvelope[]> {
  const res = await db.query<OutboxRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM outbox_event
      WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY id`,
    [aggregateType, aggregateId]
  );
  return res.rows.map((r) => envelopeFromRow(r));
}
