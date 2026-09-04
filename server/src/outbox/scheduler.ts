/**
 * The scheduled-job tick — WS-W8 § owns "reminder scheduling", "overdue-return jobs" and
 * "reconciliation jobs", and this is the thing that actually runs them.
 *
 * WHY A TIMER AND NOT CRON. The jobs are idempotent and cadence-gated: `jobs.ts` claims a
 * suppression slot before it enqueues anything, atomically, so running the sweep every minute
 * and running it once a day produce the same notifications. That property is what makes an
 * in-process timer acceptable here and what will make an Azure Container Apps scheduled job or a
 * cron trigger acceptable later — the schedule is an efficiency choice, not a correctness one.
 * Two replicas both ticking at the same second is likewise safe: one claims the slot, the other
 * is refused by the `WHERE next_eligible_at <= …` predicate (suppression.ts).
 *
 * WHY IT IS SEPARATE FROM THE WORKER. The worker DELIVERS events; the scheduler DECIDES that
 * events should exist. Different failure modes, different intervals, different things to alert
 * on. Folding them into one loop would mean a slow delivery backlog delays the sweep that
 * detects the next overdue return.
 *
 * EVERY TICK IS BEST-EFFORT AND NEVER THROWS OUT. A job that fails is logged and retried on the
 * next tick; a scheduler that exits on the first transient error is an outage that reports
 * itself as silence.
 */
import type { Database } from "../db/database";
import { alertOwner, DatabaseAlertSink, type AlertSink } from "./alerts";
import { publishReconciliationResult, runCertificateGapJob, runOverdueReturnJob, type JobResult } from "./jobs";
import type { WorkerLog } from "./worker";

/** Counts only — a reconciliation comparison the scheduler can run without knowing what a
 * document store is. `documents/reconcile.ts` produces exactly this via `reconciliationCounts`. */
export type ReconciliationProbe = () => Promise<{
  metadataWithoutObject: number;
  objectWithoutMetadata: number;
  hashMismatch: number;
  checkedAt: string;
}>;

export interface SchedulerOptions {
  /** How often the sweeps run. The cadence gate, not this, decides who is notified. */
  intervalMs?: number;
  /** Supplied by the composition root, which owns the document store. Omitted = no
   * reconciliation sweep, which is the correct behaviour for a process with no store handle. */
  reconcile?: ReconciliationProbe;
  alerts?: AlertSink;
  log?: WorkerLog;
  now?: () => Date;
}

export interface SchedulerTick {
  overdueReturns: JobResult;
  certificateGaps: JobResult;
  reconciliation: { ran: boolean; scheduled: boolean; suppressed: boolean; clean: boolean };
  ranAt: string;
}

export class JobScheduler {
  private readonly intervalMs: number;
  private readonly alerts: AlertSink;
  private readonly log: WorkerLog;
  private readonly now: () => Date;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly options: SchedulerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 5 * 60_000;
    this.alerts = options.alerts ?? new DatabaseAlertSink(db);
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => new Date());
  }

  /** One pass of every sweep. Directly callable, which is how it is tested and how a cron-style
   * external scheduler would drive it instead of `start()`. */
  async runOnce(): Promise<SchedulerTick> {
    const now = this.now();
    const overdueReturns = await runOverdueReturnJob(this.db, { now });
    const certificateGaps = await runCertificateGapJob(this.db, { now });

    let reconciliation = { ran: false, scheduled: false, suppressed: false, clean: true };
    if (this.options.reconcile) {
      const counts = await this.options.reconcile();
      const published = await publishReconciliationResult(this.db, counts, { now });
      reconciliation = { ran: true, ...published };
      if (!published.clean) {
        this.log({ ...counts }, "document reconciliation found mismatches");
      }
    }

    this.log(
      {
        overdueScheduled: overdueReturns.scheduled,
        overdueSuppressed: overdueReturns.suppressed,
        certificateGapsScheduled: certificateGaps.scheduled,
        reconciliationRan: reconciliation.ran,
      },
      "scheduled jobs tick"
    );
    return { overdueReturns, certificateGaps, reconciliation, ranAt: now.toISOString() };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          await this.runOnce();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log({ err: message }, "scheduled jobs tick failed");
          // A sweep that keeps failing is an operational fact somebody owns, not a log line.
          await this.alerts
            .raise({
              kind: "jobs.tick_failed",
              severity: "Warning",
              owner: alertOwner(),
              summary: `A scheduled-jobs tick failed: ${message}`,
            })
            .catch(() => {
              /* the alert path is best-effort too; never take the loop down with it */
            });
        }
        await sleep(this.intervalMs);
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.loop = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
