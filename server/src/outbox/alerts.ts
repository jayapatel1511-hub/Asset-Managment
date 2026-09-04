/**
 * Operational alerts, and the backlog-age check that raises one.
 *
 * WS-W8 § rules: "backlog age alerts a named owner", and its definition of done: "worker
 * failure/retry produces no duplicate business effect **and reaches an owned alert
 * destination**". Two words there do the work:
 *
 *   *reaches*  — so the alert is a row in `operational_alert`, not a log line. A log line is
 *                not evidence that anyone was told, and it cannot be queried, acknowledged or
 *                shown to an auditor.
 *   *owned*    — so every alert carries an `owner`. The actual owner is an OPEN enterprise
 *                decision (R6 in specs/REMAINING-WORK.md § 1 — "alert/support owner", owned by
 *                Englobe IT, not Jay alone), so the default here is the ROLE `SystemOwner`
 *                rather than a person or an address invented by this lane. Set `AMS_ALERT_OWNER`
 *                when R6 closes.
 *
 * WHY BACKLOG *AGE* AND NOT BACKLOG *DEPTH*. A thousand events queued and draining in two
 * seconds is a healthy system under load. One event stuck for six hours is an outage. Depth
 * alerts on success; age alerts on failure. The contract agrees — § Worker claim semantics item
 * 5 says "alert when backlog **age** exceeds threshold".
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/database";

export type AlertSeverity = "Warning" | "Critical";

export interface OperationalAlert {
  kind: string;
  severity: AlertSeverity;
  /** The named owner. See this file's header on R6. */
  owner: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface AlertSink {
  readonly name: string;
  raise(alert: OperationalAlert): Promise<void>;
}

/** R6 is open; the role is the honest placeholder for a destination nobody has yet agreed. */
export function alertOwner(): string {
  return process.env.AMS_ALERT_OWNER ?? "SystemOwner";
}

/** The durable destination: a row an operator can query, acknowledge and be held to. */
export class DatabaseAlertSink implements AlertSink {
  readonly name = "database";

  constructor(private readonly db: Queryable) {}

  async raise(alert: OperationalAlert): Promise<void> {
    await this.db.query(
      `INSERT INTO operational_alert (id, alert_kind, severity, owner, summary, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), alert.kind, alert.severity, alert.owner, alert.summary, JSON.stringify(alert.detail ?? {})]
    );
  }
}

/** Console/pino companion — useful, never sufficient on its own. */
export class LoggingAlertSink implements AlertSink {
  readonly name = "log";

  constructor(private readonly log: (payload: Record<string, unknown>, message: string) => void) {}

  async raise(alert: OperationalAlert): Promise<void> {
    this.log({ kind: alert.kind, severity: alert.severity, owner: alert.owner, detail: alert.detail }, alert.summary);
  }
}

/** Every sink gets every alert; one sink failing never suppresses another. An alert path that
 * can itself fail silently is worse than no alert path. */
export class CompositeAlertSink implements AlertSink {
  readonly name = "composite";

  constructor(private readonly sinks: AlertSink[]) {}

  async raise(alert: OperationalAlert): Promise<void> {
    const results = await Promise.allSettled(this.sinks.map((s) => s.raise(alert)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === this.sinks.length && this.sinks.length > 0) {
      throw new Error(`Every alert sink failed raising "${alert.kind}".`);
    }
  }
}

/** Collects alerts in memory — for tests, and for a dry run that must not write. */
export class RecordingAlertSink implements AlertSink {
  readonly name = "recording";
  readonly raised: OperationalAlert[] = [];

  async raise(alert: OperationalAlert): Promise<void> {
    this.raised.push(alert);
  }
}

// ---------------------------------------------------------------- backlog age

export const DEFAULT_BACKLOG_THRESHOLD_MS = 15 * 60_000;

export interface BacklogStatus {
  /** Rows waiting: unprocessed, not dead-lettered, and already due. */
  pending: number;
  /** Age of the OLDEST due-and-unprocessed row, in ms. Null when the backlog is empty. */
  oldestPendingAgeMs: number | null;
  deadLettered: number;
  thresholdMs: number;
  breached: boolean;
  owner: string;
  checkedAt: string;
}

export async function checkOutboxBacklog(
  db: Queryable,
  opts: { thresholdMs?: number; owner?: string } = {}
): Promise<BacklogStatus> {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_BACKLOG_THRESHOLD_MS;
  const res = await db.query<{ pending: number; oldest_age_ms: string | number | null; dead: number }>(
    `SELECT
       count(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND available_at <= now())::int AS pending,
       (EXTRACT(EPOCH FROM (now() - min(available_at) FILTER (
          WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND available_at <= now()))) * 1000) AS oldest_age_ms,
       count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead
     FROM outbox_event`
  );
  const row = res.rows[0];
  const oldestPendingAgeMs = row?.oldest_age_ms === null || row?.oldest_age_ms === undefined ? null : Number(row.oldest_age_ms);
  const deadLettered = Number(row?.dead ?? 0);
  return {
    pending: Number(row?.pending ?? 0),
    oldestPendingAgeMs,
    deadLettered,
    thresholdMs,
    breached: (oldestPendingAgeMs !== null && oldestPendingAgeMs >= thresholdMs) || deadLettered > 0,
    owner: opts.owner ?? alertOwner(),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Checks the backlog and raises exactly one alert if it is breached. Returns the status either
 * way, so a caller that wants the numbers without the alert can have them.
 *
 * A dead-lettered row breaches on its own regardless of age: an event nobody will ever retry is
 * a permanently lost side effect, which is the most serious thing this subsystem can report.
 */
export async function raiseBacklogAlertIfBreached(
  db: Queryable,
  sink: AlertSink,
  opts: { thresholdMs?: number; owner?: string } = {}
): Promise<BacklogStatus> {
  const status = await checkOutboxBacklog(db, opts);
  if (!status.breached) return status;
  await sink.raise({
    kind: status.deadLettered > 0 ? "outbox.dead_letter" : "outbox.backlog_age",
    severity: status.deadLettered > 0 ? "Critical" : "Warning",
    owner: status.owner,
    summary:
      status.deadLettered > 0
        ? `${status.deadLettered} outbox event(s) are dead-lettered and will never be retried.`
        : `Outbox backlog age ${Math.round((status.oldestPendingAgeMs ?? 0) / 1000)}s exceeds the ${Math.round(
            status.thresholdMs / 1000
          )}s threshold (${status.pending} event(s) waiting).`,
    detail: { ...status },
  });
  return status;
}

export interface AlertRow {
  id: string;
  alert_kind: string;
  severity: string;
  owner: string;
  summary: string;
  detail: Record<string, unknown> | null;
  raised_at: Date | string;
  acknowledged_at: Date | string | null;
}

export async function listOpenAlerts(db: Queryable, kind?: string): Promise<AlertRow[]> {
  const res = kind
    ? await db.query<AlertRow>(
        "SELECT * FROM operational_alert WHERE acknowledged_at IS NULL AND alert_kind = $1 ORDER BY raised_at DESC",
        [kind]
      )
    : await db.query<AlertRow>("SELECT * FROM operational_alert WHERE acknowledged_at IS NULL ORDER BY raised_at DESC");
  return res.rows;
}
