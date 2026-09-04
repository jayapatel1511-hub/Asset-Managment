/**
 * Scheduled jobs — WS-W8 § owns "reminder scheduling", "overdue-return jobs" and
 * "reconciliation jobs".
 *
 * Every job in this file follows the same three-step shape, and the shape is the point:
 *
 *   1. READ business facts. Read-only. A job never derives, corrects or repairs asset state —
 *      CLAUDE.md rule 4 reserves that for accepted events, and rule 1 keeps authority off every
 *      surface that is not the atomic command.
 *   2. CLAIM the cadence slot AND enqueue the outbox event IN ONE TRANSACTION. Not for the
 *      business event's sake — there is no business write here — but because the suppression
 *      row and the event it authorises are two halves of one decision. A crash between them
 *      either sends nothing forever (slot claimed, no event) or sends hourly (event queued, no
 *      slot). Committing them together makes both impossible.
 *   3. RETURN a summary. A job that only logs cannot be tested, scheduled against, or trusted.
 *
 * Nothing here sends anything. The job decides *that* somebody should be told; the worker and
 * its adapters decide *how*, later, best-effort, and off the business path entirely.
 */
import type { Database } from "../db/database";
import { enqueue } from "./enqueue";
import { CADENCE, claimNotificationSlot } from "./suppression";
import type {
  CalibrationCertificateMissingPayload,
  ReconciliationRequestedPayload,
  ReturnOverduePayload,
} from "./types";

export interface JobResult {
  /** Business facts the sweep found in total. */
  candidates: number;
  /** Facts it actually examined before its budget ran out (see `limit`). */
  examined: number;
  /** Facts that cleared the cadence gate and produced an outbox event. */
  scheduled: number;
  /** Facts that were real but whose cadence window had not elapsed. */
  suppressed: number;
  /** True when the budget stopped the sweep early — the rest are picked up next tick. */
  truncated: boolean;
  ranAt: string;
}

/**
 * How many NEW notifications one sweep may schedule.
 *
 * The budget counts SCHEDULED events, not candidates examined, and that distinction is the whole
 * point. Capping candidates would mean the sweep looked at the same first N rows every tick,
 * found them all suppressed, and never reached row N+1 — a queue that appears to be working
 * while silently ignoring its own tail. Counting schedules means an already-notified row costs
 * nothing and the sweep walks forward until it has spent its budget or run out of work.
 *
 * The bound itself exists because a FIRST run against migrated history is not a trickle: the
 * staged dataset carries 164 calibration records with no certificate, and a 5,000-asset fleet
 * will carry more. Enqueuing all of them in one tick is a flood, and WS-W8's "messages are
 * bounded" rule is about exactly that kind of surprise.
 */
export const DEFAULT_JOB_BUDGET = 100;

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- overdue returns

export interface OverdueRow {
  assetid: string;
  custodian: string | null;
  homeoffice: string | null;
  expectedreturn: string;
  txn_name: string | null;
}

/**
 * Assets still checked out past the expected-return date on their most recent Checkout.
 *
 * Read through a `LATERAL` join to the LATEST Checkout header per asset, not to any Checkout:
 * an asset checked out, returned, and checked out again has an old header with an old expected
 * return, and reminding on that would be reminding about a return that already happened.
 *
 * The comparison is a DATE-only cutoff (`< today`), so an asset due back today is not yet
 * overdue. `expectedreturn` is ISO text in this schema, so lexicographic and chronological
 * ordering coincide — but only when both sides have the same shape, which is why the cutoff is
 * trimmed to `YYYY-MM-DD` rather than passed as a full timestamp.
 */
export async function findOverdueReturns(db: Database, now: Date = new Date()): Promise<OverdueRow[]> {
  const res = await db.query<OverdueRow>(
    `SELECT a.assetid, a.custodian, a.homeoffice, h.expectedreturn, h.name AS txn_name
       FROM asset a
       JOIN LATERAL (
         SELECT t.expectedreturn, t.name
           FROM asset_transaction_line l
           JOIN asset_transaction t ON t.id = l.transaction_id
          WHERE l.asset = a.assetid AND t.transactiontype = 'Checkout'
          ORDER BY t.transactiondate DESC, t.recorded_at DESC
          LIMIT 1
       ) h ON true
      WHERE a.status = 'CheckedOut'
        AND a.lifecycle = 'Active'
        AND h.expectedreturn IS NOT NULL
        AND h.expectedreturn < $1
      ORDER BY h.expectedreturn, a.assetid`,
    [todayIso(now)]
  );
  return res.rows;
}

/**
 * The overdue-return sweep. Safe to run every minute: the cadence gate, not the schedule, is
 * what decides whether anybody is told.
 */
export async function runOverdueReturnJob(
  db: Database,
  opts: { now?: Date; cadenceMs?: number; limit?: number } = {}
): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const cadenceMs = opts.cadenceMs ?? CADENCE.overdueReturnMs;
  const budget = opts.limit ?? DEFAULT_JOB_BUDGET;
  const overdue = await findOverdueReturns(db, now);

  let scheduled = 0;
  let suppressed = 0;
  let examined = 0;
  for (const row of overdue) {
    if (scheduled >= budget) break;
    examined += 1;
    const subjectKey = `overdue-return:${row.assetid}`;
    // Step 2 — the slot and the event commit together. See this file's header.
    const claimed = await db.transaction(async (tx) => {
      const slot = await claimNotificationSlot(tx, subjectKey, "return.overdue_check", cadenceMs, now);
      if (!slot) return false;
      const payload: ReturnOverduePayload = {
        schemaVersion: 1,
        assetId: row.assetid,
        custodian: row.custodian,
        homeoffice: row.homeoffice,
        expectedReturn: row.expectedreturn,
        transactionName: row.txn_name,
        reminderNumber: slot.sendCount,
      };
      await enqueue(tx, {
        eventType: "return.overdue_check",
        aggregateType: "Asset",
        aggregateId: row.assetid,
        payload,
      });
      return true;
    });
    if (claimed) scheduled += 1;
    else suppressed += 1;
  }

  return {
    candidates: overdue.length,
    examined,
    scheduled,
    suppressed,
    truncated: examined < overdue.length,
    ranAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------- missing certificates

export interface CertificateGapRow {
  calibration_id: string;
  asset: string;
  calibrationdate: string | null;
  nextduedate: string;
  reason: CalibrationCertificateMissingPayload["reason"];
}

/**
 * Calibration records whose certificate is absent, failed, quarantined or voided.
 *
 * This is FR-033 read back as a report. The calibration FACT is true and stored; the file may
 * be missing for four distinct reasons, and the reason is the difference between "chase the
 * lab" and "chase the upload". `certificateurl` is the POC schema's one certificate column, and
 * `documents/service.ts` maintains it as an internal `ams-document:<id>` reference — never a
 * browser-usable URL (CLAUDE.md rule 11).
 */
export async function findCertificateGaps(db: Database): Promise<CertificateGapRow[]> {
  const res = await db.query<CertificateGapRow>(
    `SELECT c.id AS calibration_id, c.asset, c.calibrationdate, c.nextduedate,
            CASE
              WHEN d.id IS NULL                      THEN 'NeverAttached'
              WHEN d.scan_status = 'Quarantined'     THEN 'Quarantined'
              WHEN d.upload_state = 'Failed'         THEN 'UploadFailed'
              WHEN d.voided_at IS NOT NULL           THEN 'Voided'
              ELSE 'Superseded'
            END AS reason
       FROM calibration_record c
       LEFT JOIN calibration_document cd
              ON cd.calibration_record_id = c.id AND cd.is_current AND cd.relationship_type = 'Certificate'
       LEFT JOIN document d ON d.id = cd.document_id AND d.is_current
      WHERE c.certificateurl IS NULL
      ORDER BY c.nextduedate, c.asset`
  );
  return res.rows;
}

export async function runCertificateGapJob(
  db: Database,
  opts: { now?: Date; cadenceMs?: number; limit?: number } = {}
): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const cadenceMs = opts.cadenceMs ?? CADENCE.certificateMissingMs;
  const budget = opts.limit ?? DEFAULT_JOB_BUDGET;
  const gaps = await findCertificateGaps(db);

  let scheduled = 0;
  let suppressed = 0;
  let examined = 0;
  for (const row of gaps) {
    if (scheduled >= budget) break;
    examined += 1;
    const subjectKey = `certificate-missing:${row.calibration_id}`;
    const claimed = await db.transaction(async (tx) => {
      const slot = await claimNotificationSlot(tx, subjectKey, "calibration.certificate_missing", cadenceMs, now);
      if (!slot) return false;
      const payload: CalibrationCertificateMissingPayload = {
        schemaVersion: 1,
        assetId: row.asset,
        calibrationRecordId: row.calibration_id,
        calibrationDate: row.calibrationdate,
        nextDueDate: row.nextduedate,
        reason: row.reason,
      };
      await enqueue(tx, {
        eventType: "calibration.certificate_missing",
        aggregateType: "Calibration",
        aggregateId: row.calibration_id,
        payload,
      });
      return true;
    });
    if (claimed) scheduled += 1;
    else suppressed += 1;
  }

  return {
    candidates: gaps.length,
    examined,
    scheduled,
    suppressed,
    truncated: examined < gaps.length,
    ranAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------- reconciliation

export interface ReconciliationCounts {
  metadataWithoutObject: number;
  objectWithoutMetadata: number;
  hashMismatch: number;
  checkedAt: string;
}

/**
 * Publishes the result of a database ↔ object-store reconciliation as an outbox event so it
 * reaches the alert/notification path through the same queue as everything else.
 *
 * Takes the counts rather than running the comparison itself: the comparison belongs to
 * `documents/reconcile.ts`, which owns the store handle. Keeping the two apart means the
 * scheduler can reconcile any store — local now, Blob later — without this file knowing.
 * A clean report enqueues nothing; there is nobody to tell.
 */
export async function publishReconciliationResult(
  db: Database,
  counts: ReconciliationCounts,
  opts: { now?: Date; cadenceMs?: number } = {}
): Promise<{ scheduled: boolean; suppressed: boolean; clean: boolean }> {
  const now = opts.now ?? new Date();
  const mismatches = counts.metadataWithoutObject + counts.objectWithoutMetadata + counts.hashMismatch;
  if (mismatches === 0) return { scheduled: false, suppressed: false, clean: true };

  const claimed = await db.transaction(async (tx) => {
    const slot = await claimNotificationSlot(
      tx,
      "reconciliation:documents",
      "reconciliation.requested",
      opts.cadenceMs ?? CADENCE.reconciliationMs,
      now
    );
    if (!slot) return false;
    const payload: ReconciliationRequestedPayload = {
      schemaVersion: 1,
      scope: "documents",
      metadataWithoutObject: counts.metadataWithoutObject,
      objectWithoutMetadata: counts.objectWithoutMetadata,
      hashMismatch: counts.hashMismatch,
      checkedAt: counts.checkedAt,
    };
    await enqueue(tx, {
      eventType: "reconciliation.requested",
      aggregateType: "Document",
      aggregateId: "documents",
      payload,
    });
    return true;
  });

  return { scheduled: claimed, suppressed: !claimed, clean: false };
}
