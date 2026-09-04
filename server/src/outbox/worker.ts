/**
 * The outbox worker: claim, lease, deliver, retry, dead-letter.
 *
 * Implements `specs/010-web-application-platform/contracts/outbox-envelope.md` § Worker claim
 * semantics, and the WS-W8 rules in `specs/REMAINING-WORK.md`. Five properties are load-bearing,
 * and each one is a specific piece of SQL rather than a convention:
 *
 * 1. TWO WORKERS NEVER DELIVER THE SAME ROW.
 *    The claim is `… FOR UPDATE SKIP LOCKED` inside a CTE whose outer `UPDATE` stamps the lease.
 *    `SKIP LOCKED` means a second worker running the identical statement at the identical
 *    instant does not block and does not wait — it simply cannot see the rows the first is
 *    claiming, and takes the next ones. This is the one mechanism in the file that has no
 *    application-level equivalent: a read-then-update would hand both workers the same row.
 *
 * 2. A CRASHED WORKER'S ROWS COME BACK — THE VISIBILITY TIMEOUT.
 *    The lease is `locked_at`, and the claim predicate treats a lease older than
 *    `visibilityTimeoutMs` as expired. A worker that dies mid-delivery therefore releases its
 *    rows after the timeout instead of stranding them forever. The cost of that recovery is a
 *    possible SECOND delivery attempt of something that may already have been sent — which is
 *    exactly why point 3 exists and why the contract's § Non-goals names "at-least-once delivery
 *    without consumer idempotency".
 *
 * 3. THE CONSUMER IS IDEMPOTENT — THE DELIVERY CLAIM.
 *    Before the side effect, the worker inserts `(event_id, consumer)` into `outbox_delivery`
 *    with `ON CONFLICT DO NOTHING RETURNING`. Winning the insert is permission to act; losing it
 *    means somebody already did, so the event is marked processed and the side effect is NOT
 *    repeated. On failure the claim row is deleted so a legitimate retry can re-attempt. This is
 *    the same claim-then-process shape `transactionService.runCommand` uses on
 *    `command_idempotency`, for the same reason and with the same primary key doing the work.
 *
 * 4. FAILED DELIVERY NEVER CHANGES ASSET TRUTH (WS-W8 § rules; CLAUDE.md rules 1 and 4).
 *    Nothing in this file writes `asset`, `asset_transaction`, `asset_transaction_line`,
 *    `asset_relationship` or `calibration_record`. A handler receives a read-only `Database`
 *    handle and an envelope; the only tables the worker itself touches are `outbox_event`,
 *    `outbox_delivery`, `notification_suppression` and `operational_alert`. A notification that
 *    cannot be sent is a notification that was not sent — never a state change, never a rollback
 *    of the business event, which committed long before this file saw it.
 *
 * 5. RETRY IS BOUNDED AND ENDS SOMEWHERE VISIBLE.
 *    `available_at` is pushed out by `base * 2^(attempt-1)`, capped. At `maxAttempts` the row is
 *    dead-lettered — a real column, never claimed again — and an alert is raised to the named
 *    owner. Infinite retry is not resilience; it is an outage that never gets reported.
 *
 * WHAT A HANDLER MAY ASSUME. That the business fact in its payload committed — `enqueue.ts`'s
 * header explains why that is free. What it may NOT assume is that it runs exactly once, or that
 * it runs promptly, or that it runs at all before a later event for the same aggregate.
 */
import type { Database } from "../db/database";
import { envelopeFromRow, OUTBOX_COLUMNS, type OutboxRow } from "./enqueue";
import { alertOwner, DatabaseAlertSink, raiseBacklogAlertIfBreached, type AlertSink } from "./alerts";
import type { OutboxEnvelope } from "./types";

export type WorkerLog = (payload: Record<string, unknown>, message: string) => void;

export interface OutboxHandlerContext {
  /** Read-only by convention: see this file's header, point 4. */
  db: Database;
  envelope: OutboxEnvelope;
  log: WorkerLog;
}

export type OutboxHandler = (ctx: OutboxHandlerContext) => Promise<void>;

export interface OutboxWorkerOptions {
  /** Distinguishes this worker in `locked_by` and in logs. Defaults to pid + a random suffix. */
  name?: string;
  /** Rows claimed per tick. */
  batchSize?: number;
  /** How long a claimed row stays invisible to other workers. */
  visibilityTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Poll interval for `start()`. Irrelevant to `runOnce()`. */
  pollIntervalMs?: number;
  /** Backlog-age threshold, checked once per tick by `start()`. */
  backlogThresholdMs?: number;
  handlers?: Record<string, OutboxHandler>;
  alerts?: AlertSink;
  log?: WorkerLog;
  /** Injectable clock. The retry/lease tests need to move time without sleeping through it. */
  now?: () => Date;
}

export interface TickResult {
  claimed: number;
  processed: number;
  /** Delivered by someone else already — claimed, found settled, closed without re-sending. */
  skippedAsDuplicate: number;
  failed: number;
  deadLettered: number;
}

const DEFAULTS = {
  batchSize: 20,
  visibilityTimeoutMs: 60_000,
  maxAttempts: 5,
  retryBaseMs: 1_000,
  retryMaxMs: 5 * 60_000,
  pollIntervalMs: 1_000,
} as const;

export class OutboxWorker {
  readonly name: string;
  private readonly opts: Required<Omit<OutboxWorkerOptions, "handlers" | "alerts" | "log" | "name" | "now">>;
  private readonly handlers: Map<string, OutboxHandler>;
  private readonly alerts: AlertSink;
  private readonly log: WorkerLog;
  private readonly now: () => Date;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    options: OutboxWorkerOptions = {}
  ) {
    this.name = options.name ?? `outbox-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.opts = {
      batchSize: options.batchSize ?? DEFAULTS.batchSize,
      visibilityTimeoutMs: options.visibilityTimeoutMs ?? DEFAULTS.visibilityTimeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      retryBaseMs: options.retryBaseMs ?? DEFAULTS.retryBaseMs,
      retryMaxMs: options.retryMaxMs ?? DEFAULTS.retryMaxMs,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      backlogThresholdMs: options.backlogThresholdMs ?? 15 * 60_000,
    };
    this.handlers = new Map(Object.entries(options.handlers ?? {}));
    this.alerts = options.alerts ?? new DatabaseAlertSink(db);
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => new Date());
  }

  register(eventType: string, handler: OutboxHandler): this {
    this.handlers.set(eventType, handler);
    return this;
  }

  // ---------------------------------------------------------------- claim

  /**
   * Claims up to `batchSize` due rows and stamps the lease, in ONE statement.
   *
   * One statement matters: the `SELECT … FOR UPDATE SKIP LOCKED` and the `UPDATE … SET
   * locked_at` are the same transaction whether or not the caller opened one, so there is no
   * window in which a row is selected but not yet leased. Run on the pool (autocommit), the
   * lease is visible to every other worker the instant the statement returns.
   */
  async claim(limit = this.opts.batchSize): Promise<OutboxEnvelope[]> {
    const res = await this.db.query<OutboxRow>(
      `WITH due AS (
         SELECT id FROM outbox_event
          WHERE processed_at IS NULL
            AND dead_lettered_at IS NULL
            AND available_at <= now()
            AND (locked_at IS NULL OR locked_at < now() - ($1::int * interval '1 millisecond'))
          ORDER BY available_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_event o
          SET locked_at = now(), locked_by = $3
         FROM due
        WHERE o.id = due.id
       RETURNING ${OUTBOX_COLUMNS.split(",").map((c) => `o.${c.trim()}`).join(", ")}`,
      [this.opts.visibilityTimeoutMs, limit, this.name]
    );
    return res.rows.map((r) => envelopeFromRow(r));
  }

  // ---------------------------------------------------------------- deliver

  /**
   * Delivers one claimed envelope. Returns what happened, so `runOnce` can count it without
   * re-reading the row.
   *
   * The consumer name is the handler's event type. Two different consumers of one event type
   * would each need their own `outbox_delivery` row, which the composite primary key already
   * allows; this worker registers one handler per type, so the type IS the consumer.
   */
  async deliver(envelope: OutboxEnvelope): Promise<"processed" | "duplicate" | "failed" | "dead"> {
    const handler = this.handlers.get(envelope.eventType);
    if (!handler) {
      // Not silently dropped. An event nobody consumes is either a deployment skew or a bug,
      // and both deserve the retry/dead-letter/alert path rather than a shrug.
      return this.recordFailure(envelope, `No handler registered for event type "${envelope.eventType}".`);
    }

    const claim = await this.claimDelivery(envelope.eventId, envelope.eventType);
    if (claim === "delivered") {
      // Someone already did this and finished. Close the event without repeating the side effect
      // — the guard that survives an expired lease, a duplicated worker and a crash-and-recover.
      await this.markProcessed(envelope.eventId);
      this.log({ eventId: envelope.eventId, eventType: envelope.eventType }, "outbox event already delivered — not re-sent");
      return "duplicate";
    }
    if (claim === "inProgress") {
      // Another worker is INSIDE the side effect right now — its lease expired while it was
      // still running (a hung provider call). Marking the event processed here would be a
      // silent loss: if that worker then fails, it releases its delivery claim and records a
      // retry against an event this one has already closed, and nobody ever delivers it. So
      // release our own lease and leave the row alone; whoever finishes first settles it.
      await this.releaseLease(envelope.eventId);
      this.log(
        { eventId: envelope.eventId, eventType: envelope.eventType },
        "outbox event is being delivered elsewhere — leaving it to that worker"
      );
      return "duplicate";
    }

    try {
      await handler({ db: this.db, envelope, log: this.log });
    } catch (err) {
      // Release the delivery claim so a legitimate retry may act; the side effect did not
      // complete, so no dedup record should survive to suppress it.
      await this.releaseDelivery(envelope.eventId, envelope.eventType);
      return this.recordFailure(envelope, err instanceof Error ? err.message : String(err));
    }

    await this.settleDelivery(envelope.eventId, envelope.eventType);
    await this.markProcessed(envelope.eventId);
    return "processed";
  }

  async runOnce(): Promise<TickResult> {
    const batch = await this.claim();
    const result: TickResult = { claimed: batch.length, processed: 0, skippedAsDuplicate: 0, failed: 0, deadLettered: 0 };
    for (const envelope of batch) {
      const outcome = await this.deliver(envelope);
      if (outcome === "processed") result.processed += 1;
      else if (outcome === "duplicate") result.skippedAsDuplicate += 1;
      else if (outcome === "dead") {
        result.failed += 1;
        result.deadLettered += 1;
      } else result.failed += 1;
    }
    return result;
  }

  // ---------------------------------------------------------------- run loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          await this.runOnce();
          await this.checkBacklog();
        } catch (err) {
          // The loop is the last line of defence: it never exits on an error, because a worker
          // that stops on the first transport blip is an outage nobody notices.
          this.log({ err: err instanceof Error ? err.message : String(err), worker: this.name }, "outbox tick failed");
        }
        await sleep(this.opts.pollIntervalMs);
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.loop = null;
  }

  /** Exposed so a caller with its own scheduler can run the alert check without the loop. */
  async checkBacklog(): Promise<void> {
    await raiseBacklogAlertIfBreached(this.db, this.alerts, {
      thresholdMs: this.opts.backlogThresholdMs,
      owner: alertOwner(),
    });
  }

  // ---------------------------------------------------------------- state transitions

  /**
   * Claims the right to run the side effect once.
   *
   * Three answers, not two. "Somebody else has a row" is not one fact: a `Delivered` row means
   * the work is done and this event can be closed, while an `InProgress` row means another
   * worker is mid-flight and closing the event would lose it. See `deliver`.
   */
  private async claimDelivery(eventId: string, consumer: string): Promise<"claimed" | "delivered" | "inProgress"> {
    const res = await this.db.query<{ event_id: string }>(
      `INSERT INTO outbox_delivery (event_id, consumer, outcome, claimed_at)
       VALUES ($1, $2, 'InProgress', now())
       ON CONFLICT (event_id, consumer) DO NOTHING
       RETURNING event_id`,
      [eventId, consumer]
    );
    if (res.rows.length > 0) return "claimed";
    const existing = await this.db.query<{ outcome: string }>(
      "SELECT outcome FROM outbox_delivery WHERE event_id = $1 AND consumer = $2",
      [eventId, consumer]
    );
    return existing.rows[0]?.outcome === "Delivered" ? "delivered" : "inProgress";
  }

  /** Drops this worker's lease without settling the event. */
  private async releaseLease(eventId: string): Promise<void> {
    await this.db.query("UPDATE outbox_event SET locked_at = NULL, locked_by = NULL WHERE event_id = $1 AND locked_by = $2", [
      eventId,
      this.name,
    ]);
  }

  private async releaseDelivery(eventId: string, consumer: string): Promise<void> {
    await this.db.query("DELETE FROM outbox_delivery WHERE event_id = $1 AND consumer = $2 AND outcome = 'InProgress'", [
      eventId,
      consumer,
    ]);
  }

  private async settleDelivery(eventId: string, consumer: string): Promise<void> {
    await this.db.query(
      "UPDATE outbox_delivery SET outcome = 'Delivered', delivered_at = now() WHERE event_id = $1 AND consumer = $2",
      [eventId, consumer]
    );
  }

  private async markProcessed(eventId: string): Promise<void> {
    await this.db.query(
      "UPDATE outbox_event SET processed_at = now(), locked_at = NULL, locked_by = NULL WHERE event_id = $1",
      [eventId]
    );
  }

  /**
   * Records a failed attempt: increment, store the message, release the lease, and push
   * `available_at` out by the backoff — or dead-letter and alert if the bound is reached.
   */
  private async recordFailure(envelope: OutboxEnvelope, message: string): Promise<"failed" | "dead"> {
    const attempt = envelope.attemptCount + 1;
    const dead = attempt >= this.opts.maxAttempts;
    const backoffMs = this.backoffFor(attempt);
    const nextAvailable = new Date(this.now().getTime() + backoffMs).toISOString();

    await this.db.query(
      `UPDATE outbox_event
          SET attempt_count = $2,
              last_error = $3,
              locked_at = NULL,
              locked_by = NULL,
              available_at = CASE WHEN $4::boolean THEN available_at ELSE $5::timestamptz END,
              dead_lettered_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
              dead_letter_reason = CASE WHEN $4::boolean THEN $3 ELSE NULL END
        WHERE event_id = $1 AND processed_at IS NULL`,
      [envelope.eventId, attempt, truncateError(message), dead, nextAvailable]
    );

    this.log(
      { eventId: envelope.eventId, eventType: envelope.eventType, attempt, dead, backoffMs },
      dead ? "outbox event dead-lettered" : "outbox delivery failed — scheduled for retry"
    );

    if (dead) {
      await this.alerts.raise({
        kind: "outbox.dead_letter",
        severity: "Critical",
        owner: alertOwner(),
        summary: `Outbox event ${envelope.eventId} (${envelope.eventType}) was dead-lettered after ${attempt} attempts.`,
        detail: {
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          aggregateType: envelope.aggregateType,
          aggregateId: envelope.aggregateId,
          attempts: attempt,
          lastError: truncateError(message),
        },
      });
    }
    return dead ? "dead" : "failed";
  }

  /** `base * 2^(attempt-1)`, capped. Deterministic on purpose: a jitter term would make the
   * retry tests non-reproducible, and the local worker count is one. */
  backoffFor(attempt: number): number {
    const raw = this.opts.retryBaseMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(raw, this.opts.retryMaxMs);
  }

  /**
   * Puts a dead-lettered event back in the queue after the underlying fault is fixed.
   * Deliberately manual: automatic resurrection is how a poison message becomes an infinite
   * loop. Clears the delivery claim too, since the side effect never completed.
   */
  async redrive(eventId: string): Promise<boolean> {
    await this.db.query("DELETE FROM outbox_delivery WHERE event_id = $1 AND outcome = 'InProgress'", [eventId]);
    const res = await this.db.query<{ event_id: string }>(
      `UPDATE outbox_event
          SET dead_lettered_at = NULL, dead_letter_reason = NULL, attempt_count = 0,
              available_at = now(), locked_at = NULL, locked_by = NULL
        WHERE event_id = $1 AND dead_lettered_at IS NOT NULL
       RETURNING event_id`,
      [eventId]
    );
    return res.rows.length > 0;
  }
}

function truncateError(message: string, max = 2_000): string {
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
