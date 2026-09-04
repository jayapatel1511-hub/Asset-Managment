/**
 * The default consumer set: what each event type actually causes to happen.
 *
 * Every handler here obeys the same two constraints, which come straight from WS-W8's rules and
 * CLAUDE.md rules 1 and 4:
 *
 *   NO HANDLER WRITES ASSET TRUTH. Not status, not custodian, not location, not a transaction
 *   line, not a calibration record. A consumer reads business facts and produces a message. If
 *   a notification cannot be sent, the only thing that changes is the outbox row's own attempt
 *   count — which is the entire promise of "failed delivery does not change asset truth".
 *
 *   RECIPIENTS ARE RESOLVED AT DELIVERY TIME, NOT AT ENQUEUE TIME (WS-W8 § "office recipients
 *   derive from live office/admin data"). The payload names an asset and an office; the handler
 *   asks the database who holds the asset and who administers the office *now*. A reminder
 *   scheduled yesterday reaches today's custodian and today's administrators — which is what
 *   makes the reminder useful and what stops a stale snapshot from mailing someone who left.
 *
 * The `transaction.accepted` handler is deliberately a no-op that records its delivery. It
 * exists because the contract requires the event ("on Checkout accept, at least: one
 * `transaction.accepted` outbox row (audit/downstream)") and because an event type with no
 * registered handler is treated as a fault by `worker.ts` — correctly, since silently dropping
 * events is worse. Downstream consumers (a search index, an M365 export, a Power BI push) each
 * register their own handler for the same type with their own consumer name.
 */
import type { Database } from "../db/database";
import { alertOwner, type AlertSink } from "./alerts";
import {
  boundMessage,
  resolveOfficeRecipients,
  type NotificationAdapter,
  type NotificationChannel,
} from "./notifications";
import type { OutboxHandler, OutboxHandlerContext } from "./worker";
import type {
  CalibrationCertificateMissingPayload,
  NotificationPayload,
  ReconciliationRequestedPayload,
  ReturnOverduePayload,
  TransactionAcceptedPayload,
} from "./types";

export interface HandlerDependencies {
  /** Teams-shaped and mail-shaped adapters. Both default to the log adapter locally. */
  teams: NotificationAdapter;
  email: NotificationAdapter;
  alerts: AlertSink;
}

/** Live custodian and office for an asset — the "derive, do not snapshot" rule in one query. */
async function liveAssetContacts(
  db: Database,
  assetId: string
): Promise<{ custodian: string | null; homeoffice: string | null; status: string | null }> {
  const res = await db.query<{ custodian: string | null; homeoffice: string | null; status: string }>(
    "SELECT custodian, homeoffice, status FROM asset WHERE assetid = $1",
    [assetId]
  );
  const row = res.rows[0];
  return { custodian: row?.custodian ?? null, homeoffice: row?.homeoffice ?? null, status: row?.status ?? null };
}

async function send(
  deps: HandlerDependencies,
  channel: NotificationChannel,
  ctx: OutboxHandlerContext,
  to: string[],
  subject: string,
  body: string
): Promise<void> {
  if (to.length === 0) {
    // No recipient is a suppression, not a failure: retrying would not conjure an administrator.
    // Logged so "why did nobody hear about this?" has an answer.
    ctx.log(
      { eventId: ctx.envelope.eventId, eventType: ctx.envelope.eventType, channel },
      "notification has no recipients — office/admin data yielded none"
    );
    return;
  }
  const adapter = channel === "teams" ? deps.teams : deps.email;
  await adapter.send(boundMessage({ channel, to, subject, body, idempotencyKey: ctx.envelope.eventId }));
}

// ---------------------------------------------------------------- handlers

export function transactionAcceptedHandler(): OutboxHandler {
  return async (ctx) => {
    const payload = ctx.envelope.payload as TransactionAcceptedPayload;
    ctx.log(
      {
        eventId: ctx.envelope.eventId,
        transactionId: payload.transactionId,
        transactionType: payload.transactionType,
        assets: payload.assetIds?.length ?? 0,
      },
      "transaction.accepted delivered to the audit consumer"
    );
  };
}

export function overdueReturnHandler(deps: HandlerDependencies): OutboxHandler {
  return async (ctx) => {
    const payload = ctx.envelope.payload as ReturnOverduePayload;
    const live = await liveAssetContacts(ctx.db, payload.assetId);

    // The asset came back between scheduling and delivery. Nothing to chase; the reminder is
    // dropped rather than sent late and wrong. Best-effort delivery means it is legitimate for
    // a notification to become unnecessary.
    if (live.status !== "CheckedOut") {
      ctx.log({ eventId: ctx.envelope.eventId, assetId: payload.assetId, status: live.status }, "overdue reminder no longer applies");
      return;
    }

    const admins = await resolveOfficeRecipients(ctx.db, live.homeoffice ?? payload.homeoffice);
    const to = [...new Set([live.custodian, ...admins].filter((x): x is string => !!x))];
    await send(
      deps,
      "email",
      ctx,
      to,
      `Overdue equipment return — ${payload.assetId}`,
      [
        `${payload.assetId} was due back on ${payload.expectedReturn} and is still checked out.`,
        live.custodian ? `Current custodian: ${live.custodian}.` : "No custodian recorded.",
        payload.transactionName ? `Checkout: ${payload.transactionName}.` : "",
        `Reminder ${payload.reminderNumber}.`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  };
}

export function certificateMissingHandler(deps: HandlerDependencies): OutboxHandler {
  return async (ctx) => {
    const payload = ctx.envelope.payload as CalibrationCertificateMissingPayload;
    const live = await liveAssetContacts(ctx.db, payload.assetId);
    const to = await resolveOfficeRecipients(ctx.db, live.homeoffice);
    await send(
      deps,
      "email",
      ctx,
      to,
      `Calibration certificate missing — ${payload.assetId}`,
      [
        `The calibration recorded for ${payload.assetId} has no readable certificate (${payload.reason}).`,
        `Calibration date: ${payload.calibrationDate ?? "not recorded"}. Next due: ${payload.nextDueDate}.`,
        "The calibration record itself is unaffected and remains the accepted fact (FR-033);",
        "attach or replace the certificate when it is available.",
      ].join("\n")
    );
  };
}

export function reconciliationHandler(deps: HandlerDependencies): OutboxHandler {
  return async (ctx) => {
    const payload = ctx.envelope.payload as ReconciliationRequestedPayload;
    await deps.alerts.raise({
      kind: "documents.reconciliation_mismatch",
      severity: "Warning",
      owner: alertOwner(),
      summary:
        `Document reconciliation found ${payload.metadataWithoutObject} metadata row(s) with no object, ` +
        `${payload.objectWithoutMetadata} object(s) with no metadata and ${payload.hashMismatch} hash mismatch(es).`,
      detail: { ...payload, eventId: ctx.envelope.eventId },
    });
  };
}

export function directNotificationHandler(deps: HandlerDependencies, channel: NotificationChannel): OutboxHandler {
  return async (ctx) => {
    const payload = ctx.envelope.payload as NotificationPayload;
    const explicit = payload.to ?? [];
    const derived = explicit.length > 0 ? explicit : await resolveOfficeRecipients(ctx.db, payload.office);
    await send(deps, channel, ctx, derived, payload.subject, payload.body);
  };
}

/**
 * The handler map a locally-composed worker starts with. Register additional consumers on the
 * worker rather than editing this — one handler per event type per worker instance is the
 * consumer identity `outbox_delivery` records.
 */
export function defaultHandlers(deps: HandlerDependencies): Record<string, OutboxHandler> {
  return {
    "transaction.accepted": transactionAcceptedHandler(),
    "return.overdue_check": overdueReturnHandler(deps),
    "calibration.certificate_missing": certificateMissingHandler(deps),
    "reconciliation.requested": reconciliationHandler(deps),
    "notification.teams": directNotificationHandler(deps, "teams"),
    "notification.email": directNotificationHandler(deps, "email"),
  };
}
