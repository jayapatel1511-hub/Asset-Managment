/**
 * Notification suppression / cadence state — WS-W8 § owns "notification suppression/cadence
 * state", and the brief for this lane states the requirement plainly: *a device does not get the
 * same reminder hourly*.
 *
 * THE MECHANISM. `claimNotificationSlot` is a single `INSERT … ON CONFLICT DO UPDATE … WHERE …
 * RETURNING` statement. Winning the RETURNING is permission to notify; getting no row back means
 * the cadence window has not elapsed and the notification is suppressed. Doing it in one
 * statement rather than read-then-write is the same discipline `commandService.consumeSequence`
 * applies to the ID sequence and for the same reason: two jobs (or two worker replicas) running
 * the overdue sweep at the same instant must not both decide they are the first.
 *
 * NOTE THE `WHERE` ON THE `DO UPDATE`. PostgreSQL evaluates it against the EXISTING row, so the
 * update — and therefore the RETURNING — happens only when `next_eligible_at` has already
 * passed. A conflicting insert that fails the predicate updates nothing and returns nothing,
 * which is exactly "suppressed" with no second query and no race.
 *
 * WHAT A SUBJECT KEY IS. `<kind>:<stable business identity>` — e.g. `overdue-return:DL-UM-16984`.
 * It must not contain the reminder's content, or a reworded message would look like a new
 * subject and defeat the cadence.
 */
import type { Queryable } from "../db/database";

export const CADENCE = {
  /** One reminder per asset per day, not per worker tick. */
  overdueReturnMs: 24 * 60 * 60_000,
  /** A missing certificate is chased weekly; it is a paperwork gap, not an incident. */
  certificateMissingMs: 7 * 24 * 60 * 60_000,
  /** Reconciliation mismatches are reported once per day at most. */
  reconciliationMs: 24 * 60 * 60_000,
} as const;

export interface SuppressionState {
  subjectKey: string;
  notificationKind: string;
  lastSentAt: string;
  nextEligibleAt: string;
  sendCount: number;
}

/**
 * Atomically claims the right to notify about `subjectKey` for `notificationKind`.
 *
 * Returns the new state when the slot is claimed, or `null` when the cadence window has not
 * elapsed. Takes a `Queryable`, so a caller inside a transaction claims the slot and enqueues
 * the event in ONE commit — which is what stops a crash between the two from either double-
 * notifying or silently suppressing forever.
 */
export async function claimNotificationSlot(
  tx: Queryable,
  subjectKey: string,
  notificationKind: string,
  cadenceMs: number,
  now: Date = new Date()
): Promise<SuppressionState | null> {
  const sentAt = now.toISOString();
  const nextEligible = new Date(now.getTime() + cadenceMs).toISOString();
  const res = await tx.query<{
    subject_key: string;
    notification_kind: string;
    last_sent_at: Date | string;
    next_eligible_at: Date | string;
    send_count: number;
  }>(
    `INSERT INTO notification_suppression (subject_key, notification_kind, last_sent_at, next_eligible_at, send_count)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, 1)
     ON CONFLICT (subject_key, notification_kind) DO UPDATE
        SET last_sent_at = EXCLUDED.last_sent_at,
            next_eligible_at = EXCLUDED.next_eligible_at,
            send_count = notification_suppression.send_count + 1
      WHERE notification_suppression.next_eligible_at <= EXCLUDED.last_sent_at
     RETURNING subject_key, notification_kind, last_sent_at, next_eligible_at, send_count`,
    [subjectKey, notificationKind, sentAt, nextEligible]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    subjectKey: row.subject_key,
    notificationKind: row.notification_kind,
    lastSentAt: toIso(row.last_sent_at),
    nextEligibleAt: toIso(row.next_eligible_at),
    sendCount: row.send_count,
  };
}

/** Reads the state without claiming — for an operator answering "why did this not go out?". */
export async function readSuppression(
  db: Queryable,
  subjectKey: string,
  notificationKind: string
): Promise<SuppressionState | null> {
  const res = await db.query<{
    subject_key: string;
    notification_kind: string;
    last_sent_at: Date | string;
    next_eligible_at: Date | string;
    send_count: number;
  }>("SELECT * FROM notification_suppression WHERE subject_key = $1 AND notification_kind = $2", [
    subjectKey,
    notificationKind,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    subjectKey: row.subject_key,
    notificationKind: row.notification_kind,
    lastSentAt: toIso(row.last_sent_at),
    nextEligibleAt: toIso(row.next_eligible_at),
    sendCount: row.send_count,
  };
}

/** Clears the cadence for one subject — the "resend now" lever, used deliberately and never in
 * a loop. */
export async function clearSuppression(db: Queryable, subjectKey: string, notificationKind: string): Promise<void> {
  await db.query("DELETE FROM notification_suppression WHERE subject_key = $1 AND notification_kind = $2", [
    subjectKey,
    notificationKind,
  ]);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
