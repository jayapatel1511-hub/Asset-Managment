/**
 * Teams / email adapters, and the local implementation that sends nothing.
 *
 * CLAUDE.md's stack table: "Microsoft 365 is an integration surface, not the runtime boundary.
 * Teams, email, SharePoint and Power BI may be used, but core asset and data-management
 * operation cannot depend on them." WS-W8 restates it as a rule: "notification delivery is
 * best-effort". So the adapter is an INTERFACE with a log-only implementation, and the whole
 * server runs, commits and passes its tests with no M365 anything configured. A Graph or SMTP
 * adapter is a second implementation of `NotificationAdapter` and changes nothing else — the
 * same shape `documents/store.ts` uses for Blob Storage, for the same reason.
 *
 * BOUNDED MESSAGES (WS-W8 § rules). A notification derived from data — an overdue list, a
 * reconciliation report — grows with the data. Unbounded, that is a message that fails to send,
 * a log line that costs money, or a Teams card that is rejected at the far end after the event
 * has already been marked delivered. `boundMessage` truncates recipients, subject and body to
 * stated limits and says so in the text, so a truncated message is visibly truncated rather
 * than quietly wrong.
 *
 * OFFICE RECIPIENTS (WS-W8 § rules: "office recipients derive from live office/admin data").
 * `resolveOfficeRecipients` reads `office_admin_assignment` at DELIVERY time, not at enqueue
 * time. An administrator who left the office between the business event and the reminder does
 * not receive it, and one who arrived does — which is the point of deriving rather than
 * snapshotting.
 */
import type { Queryable } from "../db/database";

export type NotificationChannel = "teams" | "email";

export interface NotificationMessage {
  channel: NotificationChannel;
  /** Resolved recipients. Never a raw address from a browser-supplied payload. */
  to: string[];
  subject: string;
  body: string;
  /**
   * The outbox `eventId`. At-least-once delivery means the adapter WILL be handed the same
   * message twice under fault; every real provider supports an idempotency key and every
   * implementation of this interface must pass it through (contract § Worker claim semantics
   * item 2).
   */
  idempotencyKey: string;
}

export interface NotificationAdapter {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}

// ---------------------------------------------------------------- bounds

export const NOTIFICATION_LIMITS = {
  maxRecipients: 50,
  maxSubjectChars: 200,
  maxBodyChars: 2_000,
} as const;

export function boundMessage(message: NotificationMessage): NotificationMessage {
  const { maxRecipients, maxSubjectChars, maxBodyChars } = NOTIFICATION_LIMITS;
  const to = message.to.slice(0, maxRecipients);
  const droppedRecipients = message.to.length - to.length;
  const subject = truncate(message.subject, maxSubjectChars);
  let body = truncate(message.body, maxBodyChars);
  if (droppedRecipients > 0) {
    body = truncate(`${body}\n(+${droppedRecipients} further recipients omitted)`, maxBodyChars);
  }
  return { ...message, to, subject, body };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = ` …[truncated, ${text.length} chars]`;
  return `${text.slice(0, Math.max(0, max - marker.length))}${marker}`;
}

// ---------------------------------------------------------------- local implementation

export interface SentNotification extends NotificationMessage {
  sentAt: string;
}

/**
 * The local adapter: it logs and remembers, and sends nothing anywhere.
 *
 * `sent` is kept so tests and the operator can see exactly what WOULD have gone out, and so
 * "the same reminder did not go twice" is an assertion rather than an inspection of logs. The
 * in-memory duplicate guard on `idempotencyKey` is the adapter's own half of the idempotency
 * contract — the worker's `outbox_delivery` claim is the durable half; a real Graph/SMTP
 * adapter would hand the key to the provider instead.
 */
export class LogNotificationAdapter implements NotificationAdapter {
  readonly name = "log";
  readonly sent: SentNotification[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly log?: (payload: Record<string, unknown>, message: string) => void) {}

  async send(message: NotificationMessage): Promise<void> {
    const key = `${message.channel}:${message.idempotencyKey}`;
    if (this.seen.has(key)) {
      this.log?.({ idempotencyKey: message.idempotencyKey, channel: message.channel }, "notification suppressed as a duplicate");
      return;
    }
    this.seen.add(key);
    this.sent.push({ ...message, sentAt: new Date().toISOString() });
    this.log?.(
      { channel: message.channel, to: message.to.length, subject: message.subject, idempotencyKey: message.idempotencyKey },
      "notification (local adapter — nothing was sent)"
    );
  }

  /** Everything sent on a channel, for assertions and for the operator's "what would have gone
   * out?" question. */
  sentOn(channel: NotificationChannel): SentNotification[] {
    return this.sent.filter((m) => m.channel === channel);
  }
}

/**
 * An adapter that always fails. Not a test fixture bolted on afterwards — it is how the
 * "failed delivery does not change asset truth" rule (WS-W8 § rules) is exercised, and having
 * it beside the real adapter keeps the failure path in the same review as the success path.
 */
export class FailingNotificationAdapter implements NotificationAdapter {
  readonly name = "failing";
  attempts = 0;

  constructor(private readonly reason = "notification transport unavailable") {}

  async send(_message: NotificationMessage): Promise<void> {
    this.attempts += 1;
    throw new Error(this.reason);
  }
}

// ---------------------------------------------------------------- recipients

/**
 * The administrators of an office, read live from `office_admin_assignment` (feature 004 US4's
 * table, written by `deploymentService.setOfficeAdmins`).
 *
 * Returns `[]` rather than throwing for an unknown office: a reminder with no recipient is a
 * reminder that is not sent, which is a suppression, not a fault. The caller decides whether
 * that deserves an alert.
 */
export async function resolveOfficeRecipients(db: Queryable, office: string | null | undefined): Promise<string[]> {
  if (!office) return [];
  const res = await db.query<{ admin_upns: string[] | string }>(
    "SELECT admin_upns FROM office_admin_assignment WHERE office = $1",
    [office]
  );
  const raw = res.rows[0]?.admin_upns;
  if (!raw) return [];
  const list = typeof raw === "string" ? (JSON.parse(raw) as string[]) : raw;
  return Array.isArray(list) ? list.filter((u) => typeof u === "string" && u.length > 0) : [];
}
