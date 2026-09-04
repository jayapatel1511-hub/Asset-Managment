/**
 * WS-W8's proof: the transactional outbox, its worker, and the scheduled jobs.
 *
 * The five WS-W8 rules and the definition of done are each asserted below against the
 * REQUIREMENT rather than against the implementation, in the style `concurrency.test.ts`
 * established for WS-W4:
 *
 *   "business event and outbox commit together" ......... § A1, A2, A3
 *   "consumer is idempotent" ............................ § B4, B5
 *   "failed delivery does not change asset truth" ....... § B6
 *   "backlog age alerts a named owner" .................. § C1, C2
 *   "office recipients derive from live office/admin data" § D2
 *   "messages are bounded" .............................. § D3
 *   DoD: "worker failure/retry produces no duplicate business effect and reaches an owned alert
 *        destination" ................................... § B4, B5, C2
 *
 * § A ASSERTS THE REAL WIRING, NOT A STAND-IN. `runCommand` (transactionService.ts, the
 * integrator's file) calls `emitAcceptedEvent` on the command's own `tx` after the body succeeds
 * and before the idempotency outcome is stored. A1–A1d therefore submit ordinary HTTP commands
 * and assert the event that the production path itself produced. A2 and A3 go the other way and
 * enqueue explicitly on a doomed transaction, because "the row rolls back" is only proved by a
 * row that existed to be rolled back.
 *
 * TIME. The retry tests set `retryBaseMs: 0` so backoff is zero and a retry is immediately due.
 * That is not "disabling the backoff to make the test pass" — § B7 asserts the backoff CURVE
 * directly, arithmetically, and the delivery tests then remove the wait so the state machine can
 * be exercised without sleeping through minutes of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, newSubmissionId, put, submit, type TestApp } from "./helpers";
import {
  checkOutboxBacklog,
  createOutboxWorker,
  enqueue,
  ensureOutboxSchema,
  FailingNotificationAdapter,
  getEvent,
  LogNotificationAdapter,
  listOpenAlerts,
  OutboxWorker,
  raiseBacklogAlertIfBreached,
  RecordingAlertSink,
  boundMessage,
  NOTIFICATION_LIMITS,
  resolveOfficeRecipients,
  type OutboxHandler,
} from "../src/outbox";
import { CADENCE, claimNotificationSlot, readSuppression } from "../src/outbox/suppression";
import { findOverdueReturns, runOverdueReturnJob } from "../src/outbox/jobs";
import { JobScheduler } from "../src/outbox/scheduler";
import { applyTransaction, runCommand } from "../src/services/transactionService";
import { DEMO_USERS } from "../src/auth/devAuth";

let t: TestApp;
let available: string[] = [];
let cursor = 0;

const ACTIVE_PROJECT = "01937805"; // Vale M-Dam Vibration Monitoring — Active in the staged data
const ADMIN = DEMO_USERS.admin;

/** Assets no other test in this file has touched, drawn from the real migrated dataset. */
function take(n: number): string[] {
  const slice = available.slice(cursor, cursor + n);
  if (slice.length < n) throw new Error(`Test pool exhausted: wanted ${n}, ${available.length - cursor} left.`);
  cursor += n;
  return slice;
}

beforeAll(async () => {
  t = await createTestApp();
  // Idempotent, and already applied by routes/documents.ts's onReady hook — asserted here as a
  // fact rather than assumed, because every test below depends on it.
  await ensureOutboxSchema(t.db);
  const res = await t.db.query<{ assetid: string }>(
    `SELECT a.assetid FROM asset a
      WHERE a.status = 'Available' AND a.lifecycle = 'Active'
        AND NOT EXISTS (SELECT 1 FROM asset_relationship r
                         WHERE r.childasset = a.assetid AND r.end_at IS NULL AND r.relationshiptype = 'Component')
      ORDER BY a.assetid`
  );
  available = res.rows.map((r) => r.assetid);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function outboxRowsFor(correlationId: string) {
  const res = await t.db.query<{ event_id: string; event_type: string; payload: Record<string, unknown> }>(
    "SELECT event_id, event_type, payload FROM outbox_event WHERE correlation_id = $1",
    [correlationId]
  );
  return res.rows;
}

async function headersFor(clientSubmissionId: string) {
  const res = await t.db.query<{ id: string; name: string }>(
    "SELECT id, name FROM asset_transaction WHERE client_submission_id = $1",
    [clientSubmissionId]
  );
  return res.rows;
}

/**
 * Runs the worker until the queue is empty.
 *
 * A fixed number of ticks would be a test that passes by luck: `runCertificateGapJob` sweeps the
 * 164 migrated calibration records with no certificate, so a scheduler tick can legitimately
 * enqueue far more events than one batch delivers. Draining asserts what the requirement
 * actually says — the event is delivered — rather than "delivered within N batches".
 */
async function drain(worker: OutboxWorker, maxTicks = 200): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    const tick = await worker.runOnce();
    if (tick.claimed === 0) return;
  }
  throw new Error(`The outbox did not drain in ${maxTicks} ticks.`);
}

async function statusOf(assetId: string): Promise<string> {
  const res = await t.db.query<{ status: string }>("SELECT status FROM asset WHERE assetid = $1", [assetId]);
  return res.rows[0].status;
}

// ============================================================================
// § A — one business event is one atomic commit, INCLUDING its outbox events
//        (CLAUDE.md rule 2; contracts/outbox-envelope.md § Rule)
// ============================================================================

describe("A — the business event and its outbox row commit together", () => {
  it("A1 — an accepted command writes the transaction and its outbox row in one commit", async () => {
    const [assetId] = take(1);
    const clientSubmissionId = newSubmissionId("outbox-a1");

    // A plain HTTP command. Nothing in this test enqueues anything: `runCommand`'s
    // `emitAcceptedEvent` does it, on the command's own `tx`, which is what makes the row atomic
    // with the header and the lines.
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      clientSubmissionId,
    });
    expect(outcome.ok).toBe(true);

    const headers = await headersFor(clientSubmissionId);
    expect(headers).toHaveLength(1);

    const rows = await outboxRowsFor(clientSubmissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe("transaction.accepted");
    expect(rows[0].payload).toMatchObject({ schemaVersion: 1, transactionType: "Checkout", assetIds: [assetId] });
    expect((rows[0].payload as { transactionId: string }).transactionId).toBe(headers[0].id);
  });

  it("A1b — a replayed submission returns the stored outcome and does NOT enqueue a second event", async () => {
    const [assetId] = take(1);
    const clientSubmissionId = newSubmissionId("outbox-a1b");
    const body = { lines: [{ assetId }], project: ACTIVE_PROJECT, clientSubmissionId };

    const first = await submit(t.app, "/api/commands/Checkout", body);
    const replay = await submit(t.app, "/api/commands/Checkout", body);
    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);

    // CLAUDE.md rule 3 and rule 2 together: one business event, one commit, ONE event. An
    // idempotent replay that re-emitted would notify twice about something that happened once.
    expect(await outboxRowsFor(clientSubmissionId)).toHaveLength(1);
  });

  it("A1c — a command that writes no transaction header emits no event", async () => {
    const clientSubmissionId = newSubmissionId("outbox-a1c");
    const res = await put(
      t.app,
      "/api/office-admins/Ottawa",
      { adminUpns: ["admin@englobecorp.com"], clientSubmissionId },
      "owner"
    );
    expect(res.statusCode).toBe(200);
    // `SetOfficeAdmins` is an administrative assignment, not a business event about an asset.
    expect(await outboxRowsFor(clientSubmissionId)).toHaveLength(0);
  });

  it("A1d — every asset in a multi-asset command appears in the one event", async () => {
    const assets = take(3);
    const clientSubmissionId = newSubmissionId("outbox-a1d");
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: assets.map((assetId, i) => ({ assetId, kitRole: i === 0 ? undefined : `Sensor${i}` })),
      primaryAssetId: assets[0],
      project: ACTIVE_PROJECT,
      clientSubmissionId,
    });
    expect(outcome.ok).toBe(true);

    const rows = await outboxRowsFor(clientSubmissionId);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { assetIds: string[] }).assetIds.sort()).toEqual([...assets].sort());
  });

  it("A1e — a composite command writes several headers and emits an event for EACH", async () => {
    const [assetId] = take(1);
    await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("outbox-a1e-setup"),
    });

    // A Return of a damaged asset is TWO transactions in one command (commandService.returnAssets:
    // the Return, then a ReportFault under `${id}-fault`), committed together.
    const clientSubmissionId = newSubmissionId("outbox-a1e");
    const outcome = await submit(t.app, "/api/commands/Return", {
      lines: [{ assetId, condition: "Damaged" }],
      clientSubmissionId,
    });
    expect(outcome.ok).toBe(true);

    const headers = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM asset_transaction WHERE client_submission_id IN ($1, $2)",
      [clientSubmissionId, `${clientSubmissionId}-fault`]
    );
    expect(headers.rows[0].c).toBe(2);

    /**
     * FIXED 2026-09-03, and this is the assertion that holds it.
     *
     * `emitAcceptedEvent` used to look up ONE header by `outcome.transactionId`, so a composite
     * command emitted an event for the transaction it returned and none for the others — a fault
     * reported on return reached no consumer at all, silently. `contracts/outbox-envelope.md`
     * § Rule asks for "every background side effect from an accepted business event", and a fault
     * is a distinct business event.
     *
     * It now selects every header written under this command's submission id (the composites
     * suffix it: `-fault`, `-return-from-cal`, `-missing`, `-deploy`) and enqueues one event per
     * row, all inside the command's own transaction.
     */
    const rows = await outboxRowsFor(clientSubmissionId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.payload as { transactionType: string }).transactionType).sort()).toEqual([
      "ReportFault",
      "Return",
    ]);
  });

  it("A2 — a refusal rolls the outbox row back with the business event", async () => {
    const [assetId] = take(1);
    // Check it out first so the second Checkout is refused by the state machine.
    const first = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("outbox-a2-setup"),
    });
    expect(first.ok).toBe(true);

    const clientSubmissionId = newSubmissionId("outbox-a2");
    const outcome = await runCommand(
      t.db,
      { clientSubmissionId, command: "Checkout", user: ADMIN, request: { assetId } },
      async (tx) => {
        // Enqueue FIRST, so the refusal has something committed-looking to discard. If the
        // rollback were not real, this row would survive.
        await enqueue(tx, {
          eventType: "transaction.accepted",
          aggregateType: "Transaction",
          aggregateId: "would-not-exist",
          correlationId: clientSubmissionId,
          payload: { schemaVersion: 1 },
        });
        return applyTransaction(tx, {
          clientSubmissionId,
          transactiontype: "Checkout",
          performedby: ADMIN.upn,
          date: new Date().toISOString(),
          touser: ADMIN.upn,
          toproject: ACTIVE_PROJECT,
          lines: [{ assetId }],
        });
      }
    );

    expect(outcome.ok).toBe(false);
    expect(await headersFor(clientSubmissionId)).toHaveLength(0);
    expect(await outboxRowsFor(clientSubmissionId)).toHaveLength(0);
  });

  it("A3 — a fault after the outbox insert discards both, and the asset is untouched", async () => {
    const [assetId] = take(1);
    const before = await statusOf(assetId);
    const clientSubmissionId = newSubmissionId("outbox-a3");

    await expect(
      runCommand(t.db, { clientSubmissionId, command: "Checkout", user: ADMIN, request: { assetId } }, async (tx) => {
        const result = await applyTransaction(tx, {
          clientSubmissionId,
          transactiontype: "Checkout",
          performedby: ADMIN.upn,
          date: new Date().toISOString(),
          touser: ADMIN.upn,
          toproject: ACTIVE_PROJECT,
          lines: [{ assetId }],
        });
        await enqueue(tx, {
          eventType: "transaction.accepted",
          aggregateType: "Transaction",
          aggregateId: result.ok ? result.transactionId : "x",
          correlationId: clientSubmissionId,
          payload: { schemaVersion: 1 },
        });
        throw new Error("AMS_TEST_FAULT after the outbox insert");
      })
    ).rejects.toThrow("AMS_TEST_FAULT");

    expect(await headersFor(clientSubmissionId)).toHaveLength(0);
    expect(await outboxRowsFor(clientSubmissionId)).toHaveLength(0);
    expect(await statusOf(assetId)).toBe(before);
  });

  it("A4 — an unversioned payload is refused at the call site, not at delivery time", async () => {
    await expect(
      enqueue(t.db, {
        eventType: "transaction.accepted",
        aggregateType: "Transaction",
        aggregateId: "x",
        payload: {} as never,
      })
    ).rejects.toThrow(/schemaVersion/);
  });
});

// ============================================================================
// § B — the worker: claim, lease, idempotent delivery, retry, dead letter
// ============================================================================

/** A worker wired to recording adapters, with retry delays removed — see this file's header. */
function testWorker(options: {
  handlers?: Record<string, OutboxHandler>;
  maxAttempts?: number;
  name?: string;
  alerts?: RecordingAlertSink;
  email?: LogNotificationAdapter | FailingNotificationAdapter;
}): OutboxWorker {
  return createOutboxWorker(t.db, {
    name: options.name,
    retryBaseMs: 0,
    retryMaxMs: 0,
    maxAttempts: options.maxAttempts ?? 5,
    visibilityTimeoutMs: 60_000,
    alerts: options.alerts,
    email: options.email,
    handlers: options.handlers,
  });
}

describe("B — the worker", () => {
  it("B1 — claims a due event, delivers it, and records both the event and the delivery", async () => {
    const delivered: string[] = [];
    const worker = testWorker({
      handlers: { "test.b1": async (ctx) => void delivered.push(ctx.envelope.eventId) },
    });
    const eventId = await enqueue(t.db, {
      eventType: "test.b1",
      aggregateType: "Asset",
      aggregateId: "B1",
      payload: { schemaVersion: 1 },
    });

    const tick = await worker.runOnce();
    expect(tick.processed).toBeGreaterThanOrEqual(1);
    expect(delivered).toContain(eventId);

    const settled = await getEvent(t.db, eventId);
    expect(settled?.processedAt).not.toBeNull();
    expect(settled?.lockedAt).toBeNull();

    const delivery = await t.db.query<{ outcome: string }>(
      "SELECT outcome FROM outbox_delivery WHERE event_id = $1 AND consumer = 'test.b1'",
      [eventId]
    );
    expect(delivery.rows[0]?.outcome).toBe("Delivered");
  });

  it("B2 — two workers claiming at the same instant never take the same row (FOR UPDATE SKIP LOCKED)", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      ids.add(
        await enqueue(t.db, {
          eventType: "test.b2",
          aggregateType: "Asset",
          aggregateId: `B2-${i}`,
          payload: { schemaVersion: 1 },
        })
      );
    }
    const a = testWorker({ name: "worker-a", handlers: { "test.b2": async () => {} } });
    const b = testWorker({ name: "worker-b", handlers: { "test.b2": async () => {} } });

    const [claimedA, claimedB] = await Promise.all([a.claim(20), b.claim(20)]);
    const setA = new Set(claimedA.filter((e) => ids.has(e.eventId)).map((e) => e.eventId));
    const setB = new Set(claimedB.filter((e) => ids.has(e.eventId)).map((e) => e.eventId));

    // Disjoint: not one event id appears in both claims.
    for (const id of setA) expect(setB.has(id)).toBe(false);
    expect(setA.size + setB.size).toBe(ids.size);
    for (const id of setA) expect(claimedA.find((e) => e.eventId === id)!.lockedBy).toBe("worker-a");
  });

  it("B3 — a leased row is invisible to another worker until the visibility timeout expires", async () => {
    const eventId = await enqueue(t.db, {
      eventType: "test.b3",
      aggregateType: "Asset",
      aggregateId: "B3",
      payload: { schemaVersion: 1 },
    });
    const holder = createOutboxWorker(t.db, { name: "holder", visibilityTimeoutMs: 60_000, handlers: {} });
    const other = createOutboxWorker(t.db, { name: "other", visibilityTimeoutMs: 60_000, handlers: {} });

    expect((await holder.claim(50)).map((e) => e.eventId)).toContain(eventId);
    expect((await other.claim(50)).map((e) => e.eventId)).not.toContain(eventId);

    // Age the lease past the timeout — the crashed-worker recovery path, without a crash.
    await t.db.query("UPDATE outbox_event SET locked_at = now() - interval '10 minutes' WHERE event_id = $1", [eventId]);
    expect((await other.claim(50)).map((e) => e.eventId)).toContain(eventId);

    await t.db.query("UPDATE outbox_event SET processed_at = now() WHERE event_id = $1", [eventId]);
  });

  it("B4 — retry after a failing delivery produces NO duplicate business effect (consumer idempotency)", async () => {
    const email = new LogNotificationAdapter();
    let attempts = 0;
    const worker = testWorker({
      email,
      maxAttempts: 5,
      handlers: {
        "test.b4": async (ctx) => {
          attempts += 1;
          // The side effect happens, and THEN the delivery fails — the classic at-least-once
          // hazard. Without an idempotency key the retry would send a second copy.
          await email.send({
            channel: "email",
            to: ["someone@englobecorp.com"],
            subject: "B4",
            body: "b4",
            idempotencyKey: ctx.envelope.eventId,
          });
          if (attempts === 1) throw new Error("transport dropped the connection after sending");
        },
      },
    });

    const eventId = await enqueue(t.db, {
      eventType: "test.b4",
      aggregateType: "Asset",
      aggregateId: "B4",
      payload: { schemaVersion: 1 },
    });

    await worker.runOnce(); // fails after the side effect
    let row = await getEvent(t.db, eventId);
    expect(row?.attemptCount).toBe(1);
    expect(row?.processedAt).toBeNull();
    expect(row?.lastError).toContain("transport dropped");

    await worker.runOnce(); // retries and succeeds
    row = await getEvent(t.db, eventId);
    expect(row?.processedAt).not.toBeNull();

    expect(attempts).toBe(2);
    // TWO handler runs, ONE notification. This is the definition-of-done clause.
    expect(email.sent.filter((m) => m.idempotencyKey === eventId)).toHaveLength(1);
  });

  it("B5 — a worker that died after delivering does not cause a second delivery", async () => {
    let handlerRuns = 0;
    const worker = testWorker({ handlers: { "test.b5": async () => void (handlerRuns += 1) } });
    const eventId = await enqueue(t.db, {
      eventType: "test.b5",
      aggregateType: "Asset",
      aggregateId: "B5",
      payload: { schemaVersion: 1 },
    });

    // Simulate the crash window exactly: the delivery claim was taken and the side effect ran,
    // then the process died before `processed_at` was written and before the lease expired.
    await t.db.query(
      "INSERT INTO outbox_delivery (event_id, consumer, outcome, delivered_at) VALUES ($1, 'test.b5', 'Delivered', now())",
      [eventId]
    );

    const tick = await worker.runOnce();
    expect(tick.skippedAsDuplicate).toBeGreaterThanOrEqual(1);
    expect(handlerRuns).toBe(0); // the side effect was NOT repeated
    expect((await getEvent(t.db, eventId))?.processedAt).not.toBeNull();
  });

  it("B5b — an event another worker is STILL delivering is left alone, not closed", async () => {
    let handlerRuns = 0;
    const worker = testWorker({ name: "late-worker", handlers: { "test.b5b": async () => void (handlerRuns += 1) } });
    const eventId = await enqueue(t.db, {
      eventType: "test.b5b",
      aggregateType: "Asset",
      aggregateId: "B5b",
      payload: { schemaVersion: 1 },
    });

    // Another worker holds an IN-PROGRESS delivery claim: it is inside the side effect right now
    // and its lease has expired. Closing the event here would lose it if that worker then fails.
    await t.db.query("INSERT INTO outbox_delivery (event_id, consumer, outcome) VALUES ($1, 'test.b5b', 'InProgress')", [
      eventId,
    ]);

    await worker.runOnce();
    expect(handlerRuns).toBe(0); // not re-run
    const row = await getEvent(t.db, eventId);
    expect(row?.processedAt).toBeNull(); // and NOT closed behind the other worker's back
    expect(row?.lockedAt).toBeNull(); // our own lease released, so it can be claimed again

    // When that worker finishes, the event settles normally.
    await t.db.query("UPDATE outbox_delivery SET outcome = 'Delivered', delivered_at = now() WHERE event_id = $1", [eventId]);
    await worker.runOnce();
    expect((await getEvent(t.db, eventId))?.processedAt).not.toBeNull();
    expect(handlerRuns).toBe(0);
  });

  it("B6 — a failing consumer never mutates asset truth", async () => {
    const [assetId] = take(1);
    const snapshot = await t.db.query<Record<string, unknown>>("SELECT * FROM asset WHERE assetid = $1", [assetId]);
    const linesBefore = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM asset_transaction_line WHERE asset = $1",
      [assetId]
    );

    const alerts = new RecordingAlertSink();
    const worker = testWorker({
      alerts,
      maxAttempts: 2,
      email: new FailingNotificationAdapter(),
      handlers: {
        "test.b6": async () => {
          throw new Error("the notification transport is down");
        },
      },
    });
    await enqueue(t.db, {
      eventType: "test.b6",
      aggregateType: "Asset",
      aggregateId: assetId,
      payload: { schemaVersion: 1, assetId },
    });

    await worker.runOnce();
    await worker.runOnce();

    const after = await t.db.query<Record<string, unknown>>("SELECT * FROM asset WHERE assetid = $1", [assetId]);
    expect(after.rows[0]).toEqual(snapshot.rows[0]);
    const linesAfter = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM asset_transaction_line WHERE asset = $1",
      [assetId]
    );
    expect(linesAfter.rows[0].c).toBe(linesBefore.rows[0].c);
  });

  it("B7 — retry is bounded: the backoff curve doubles and caps", () => {
    const worker = createOutboxWorker(t.db, { retryBaseMs: 1_000, retryMaxMs: 30_000, handlers: {} });
    expect(worker.backoffFor(1)).toBe(1_000);
    expect(worker.backoffFor(2)).toBe(2_000);
    expect(worker.backoffFor(3)).toBe(4_000);
    expect(worker.backoffFor(10)).toBe(30_000); // capped, not 512 seconds
  });

  it("B8 — a permanently failing event dead-letters, alerts an owner, and is never claimed again", async () => {
    const alerts = new RecordingAlertSink();
    const worker = testWorker({
      alerts,
      maxAttempts: 2,
      handlers: {
        "test.b8": async () => {
          throw new Error("this consumer will never succeed");
        },
      },
    });
    const eventId = await enqueue(t.db, {
      eventType: "test.b8",
      aggregateType: "Asset",
      aggregateId: "B8",
      payload: { schemaVersion: 1 },
    });

    await worker.runOnce();
    await worker.runOnce();

    const dead = await getEvent(t.db, eventId);
    expect(dead?.deadLetteredAt).not.toBeNull();
    expect(dead?.deadLetterReason).toContain("never succeed");
    expect(dead?.attemptCount).toBe(2);

    // Never claimed again — the dead-letter state is a real column, not a derived threshold.
    expect((await worker.claim(100)).map((e) => e.eventId)).not.toContain(eventId);

    const alert = alerts.raised.find((a) => a.detail?.eventId === eventId);
    expect(alert?.kind).toBe("outbox.dead_letter");
    expect(alert?.severity).toBe("Critical");
    expect(alert?.owner).toBe("SystemOwner"); // R6 default — see outbox/alerts.ts

    // ...and redrive puts it back deliberately, never automatically.
    expect(await worker.redrive(eventId)).toBe(true);
    const revived = await getEvent(t.db, eventId);
    expect(revived?.deadLetteredAt).toBeNull();
    expect(revived?.attemptCount).toBe(0);
    await t.db.query("UPDATE outbox_event SET processed_at = now() WHERE event_id = $1", [eventId]);
  });

  it("B9 — an event with no registered consumer fails loudly rather than being dropped", async () => {
    const alerts = new RecordingAlertSink();
    const worker = testWorker({ alerts, maxAttempts: 1, handlers: {} });
    const eventId = await enqueue(t.db, {
      eventType: "test.b9.nobody-consumes-this",
      aggregateType: "Asset",
      aggregateId: "B9",
      payload: { schemaVersion: 1 },
    });

    await worker.runOnce();
    const row = await getEvent(t.db, eventId);
    expect(row?.processedAt).toBeNull();
    expect(row?.deadLetteredAt).not.toBeNull();
    expect(row?.lastError).toContain("No handler registered");
  });
});

// ============================================================================
// § C — backlog age reaches a named, durable owner (WS-W8 § rules + DoD)
// ============================================================================

describe("C — operational alerts", () => {
  it("C1 — backlog age is measured from the oldest DUE event, and a future event is not backlog", async () => {
    const future = await enqueue(t.db, {
      eventType: "test.c1",
      aggregateType: "Asset",
      aggregateId: "C1",
      availableAt: new Date(Date.now() + 60 * 60_000),
      payload: { schemaVersion: 1 },
    });
    const before = await checkOutboxBacklog(t.db, { thresholdMs: 60_000 });

    const due = await enqueue(t.db, {
      eventType: "test.c1",
      aggregateType: "Asset",
      aggregateId: "C1-due",
      availableAt: new Date(Date.now() - 10 * 60_000),
      payload: { schemaVersion: 1 },
    });
    const after = await checkOutboxBacklog(t.db, { thresholdMs: 60_000 });

    expect(after.pending).toBe(before.pending + 1); // the future row is not counted
    expect(after.oldestPendingAgeMs).toBeGreaterThan(9 * 60_000);
    expect(after.breached).toBe(true);

    await t.db.query("UPDATE outbox_event SET processed_at = now() WHERE event_id = ANY($1)", [[future, due]]);
  });

  it("C2 — a breached backlog raises a durable alert row addressed to the named owner", async () => {
    const eventId = await enqueue(t.db, {
      eventType: "test.c2",
      aggregateType: "Asset",
      aggregateId: "C2",
      availableAt: new Date(Date.now() - 30 * 60_000),
      payload: { schemaVersion: 1 },
    });

    const worker = createOutboxWorker(t.db, { backlogThresholdMs: 60_000, handlers: {} });
    await worker.checkBacklog();

    const open = await listOpenAlerts(t.db);
    const backlog = open.find((a) => a.alert_kind === "outbox.backlog_age" || a.alert_kind === "outbox.dead_letter");
    expect(backlog).toBeDefined();
    expect(backlog!.owner).toBe("SystemOwner");
    expect(backlog!.summary.length).toBeGreaterThan(0);

    await t.db.query("UPDATE outbox_event SET processed_at = now() WHERE event_id = $1", [eventId]);
  });

  it("C3 — a healthy backlog raises nothing", async () => {
    await t.db.query("UPDATE outbox_event SET processed_at = now() WHERE processed_at IS NULL AND dead_lettered_at IS NULL");
    await t.db.query("UPDATE operational_alert SET acknowledged_at = now(), acknowledged_by = 'test'");
    await t.db.query("UPDATE outbox_event SET dead_lettered_at = NULL WHERE dead_lettered_at IS NOT NULL");

    const sink = new RecordingAlertSink();
    const status = await raiseBacklogAlertIfBreached(t.db, sink, { thresholdMs: 60_000 });
    expect(status.breached).toBe(false);
    expect(sink.raised).toHaveLength(0);
  });
});

// ============================================================================
// § D — scheduled jobs, cadence and adapters
// ============================================================================

describe("D — reminders, cadence and notification adapters", () => {
  it("D1 — the overdue-return job schedules once and then suppresses, rather than reminding on every tick", async () => {
    const [assetId] = take(1);
    const clientSubmissionId = newSubmissionId("overdue");
    const checkedOut = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      expectedReturn: "2020-01-15",
      clientSubmissionId,
    });
    expect(checkedOut.ok).toBe(true);

    const overdue = await findOverdueReturns(t.db);
    expect(overdue.map((r) => r.assetid)).toContain(assetId);

    const first = await runOverdueReturnJob(t.db);
    expect(first.scheduled).toBeGreaterThanOrEqual(1);

    // The same sweep a minute later must tell nobody anything (the "not hourly" rule).
    const second = await runOverdueReturnJob(t.db);
    expect(second.scheduled).toBe(0);
    expect(second.suppressed).toBe(second.candidates);

    const events = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM outbox_event WHERE event_type = 'return.overdue_check' AND aggregate_id = $1",
      [assetId]
    );
    expect(events.rows[0].c).toBe(1);

    const state = await readSuppression(t.db, `overdue-return:${assetId}`, "return.overdue_check");
    expect(state?.sendCount).toBe(1);
    expect(new Date(state!.nextEligibleAt).getTime() - new Date(state!.lastSentAt).getTime()).toBe(CADENCE.overdueReturnMs);
  });

  it("D2 — the reminder's recipients are read from live office/admin data at delivery time", async () => {
    const [assetId] = take(1);
    const office = (
      await t.db.query<{ homeoffice: string }>("SELECT homeoffice FROM asset WHERE assetid = $1", [assetId])
    ).rows[0].homeoffice;

    await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      expectedReturn: "2020-02-15",
      clientSubmissionId: newSubmissionId("overdue-d2"),
    });

    // The admin list is set AFTER the reminder is scheduled — so if recipients were snapshotted
    // at enqueue time rather than resolved at delivery time, this address could not appear.
    await runOverdueReturnJob(t.db);
    await t.db.query(
      `INSERT INTO office_admin_assignment (office, admin_upns) VALUES ($1, $2::jsonb)
       ON CONFLICT (office) DO UPDATE SET admin_upns = EXCLUDED.admin_upns`,
      [office, JSON.stringify(["late.admin@englobecorp.com"])]
    );
    expect(await resolveOfficeRecipients(t.db, office)).toContain("late.admin@englobecorp.com");

    const email = new LogNotificationAdapter();
    const worker = createOutboxWorker(t.db, { email, retryBaseMs: 0 });
    await drain(worker);

    const sent = email.sentOn("email").find((m) => m.subject.includes(assetId));
    expect(sent).toBeDefined();
    expect(sent!.to).toContain("late.admin@englobecorp.com");
    expect(sent!.to).toContain("tech@englobecorp.com"); // the live custodian
  });

  it("D3 — messages are bounded: recipients, subject and body are all capped, visibly", () => {
    const bounded = boundMessage({
      channel: "email",
      to: Array.from({ length: 120 }, (_, i) => `person${i}@englobecorp.com`),
      subject: "S".repeat(500),
      body: "B".repeat(9_000),
      idempotencyKey: "bound",
    });
    expect(bounded.to).toHaveLength(NOTIFICATION_LIMITS.maxRecipients);
    expect(bounded.subject.length).toBeLessThanOrEqual(NOTIFICATION_LIMITS.maxSubjectChars);
    expect(bounded.body.length).toBeLessThanOrEqual(NOTIFICATION_LIMITS.maxBodyChars);
    expect(bounded.subject).toContain("truncated");
    expect(bounded.body).toContain("truncated");
  });

  it("D4 — the cadence slot is claimed atomically: one of two simultaneous claimers wins", async () => {
    const subject = `race:${newSubmissionId("cadence")}`;
    const results = await Promise.all([
      t.db.transaction((tx) => claimNotificationSlot(tx, subject, "return.overdue_check", 60_000)),
      t.db.transaction((tx) => claimNotificationSlot(tx, subject, "return.overdue_check", 60_000)),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("D5 — a reminder for an asset that has since come back is dropped rather than sent late", async () => {
    const [assetId] = take(1);
    await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      expectedReturn: "2020-03-15",
      clientSubmissionId: newSubmissionId("overdue-d5"),
    });
    await runOverdueReturnJob(t.db);

    const returned = await submit(t.app, "/api/commands/Return", {
      lines: [{ assetId }],
      clientSubmissionId: newSubmissionId("return-d5"),
    });
    expect(returned.ok).toBe(true);

    const email = new LogNotificationAdapter();
    const worker = createOutboxWorker(t.db, { email, retryBaseMs: 0 });
    await drain(worker);

    expect(email.sentOn("email").some((m) => m.subject.includes(assetId))).toBe(false);
    // Dropped, not failed: the event is settled, not left to retry forever.
    const row = await t.db.query<{ processed_at: Date | null }>(
      "SELECT processed_at FROM outbox_event WHERE event_type = 'return.overdue_check' AND aggregate_id = $1",
      [assetId]
    );
    expect(row.rows[0].processed_at).not.toBeNull();
  });
});

// ============================================================================
// § E — the scheduler: one tick, every sweep, safe to run at any frequency
// ============================================================================

describe("E — the scheduled-job tick", () => {
  it("E1 — one tick runs every sweep and reports what it did", async () => {
    const [assetId] = take(1);
    await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId }],
      project: ACTIVE_PROJECT,
      expectedReturn: "2019-11-01",
      clientSubmissionId: newSubmissionId("sched-e1"),
    });

    const scheduler = new JobScheduler(t.db, {
      reconcile: async () => ({
        metadataWithoutObject: 2,
        objectWithoutMetadata: 1,
        hashMismatch: 0,
        checkedAt: new Date().toISOString(),
      }),
    });

    const first = await scheduler.runOnce();
    expect(first.overdueReturns.scheduled).toBeGreaterThanOrEqual(1);
    expect(first.reconciliation).toMatchObject({ ran: true, clean: false, scheduled: true });

    // The whole point of the cadence gate: running it again immediately tells nobody anything
    // new, so the tick interval is an efficiency choice rather than a correctness one.
    const second = await scheduler.runOnce();
    expect(second.overdueReturns.scheduled).toBe(0);
    expect(second.reconciliation).toMatchObject({ ran: true, scheduled: false, suppressed: true });
  });

  it("E2 — a clean reconciliation enqueues nothing, because there is nobody to tell", async () => {
    const before = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM outbox_event WHERE event_type = 'reconciliation.requested'"
    );
    const scheduler = new JobScheduler(t.db, {
      reconcile: async () => ({
        metadataWithoutObject: 0,
        objectWithoutMetadata: 0,
        hashMismatch: 0,
        checkedAt: new Date().toISOString(),
      }),
    });
    const tick = await scheduler.runOnce();
    expect(tick.reconciliation).toMatchObject({ ran: true, clean: true, scheduled: false });

    const after = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM outbox_event WHERE event_type = 'reconciliation.requested'"
    );
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it("E3 — a reconciliation mismatch reaches the named alert owner through the worker", async () => {
    await t.db.query("DELETE FROM notification_suppression WHERE subject_key = 'reconciliation:documents'");
    const scheduler = new JobScheduler(t.db, {
      reconcile: async () => ({
        metadataWithoutObject: 3,
        objectWithoutMetadata: 0,
        hashMismatch: 1,
        checkedAt: new Date().toISOString(),
      }),
    });
    await scheduler.runOnce();

    const alerts = new RecordingAlertSink();
    const worker = createOutboxWorker(t.db, { alerts, retryBaseMs: 0 });
    await drain(worker);

    // Matched on THIS sweep's own counts: an earlier test's reconciliation event may still have
    // been in the queue, and asserting on "the first alert of that kind" would silently pass on
    // somebody else's finding.
    const alert = alerts.raised.find(
      (a) => a.kind === "documents.reconciliation_mismatch" && a.detail?.metadataWithoutObject === 3
    );
    expect(alert).toBeDefined();
    expect(alert!.owner).toBe("SystemOwner");
    expect(alert!.severity).toBe("Warning");
    expect(alert!.summary).toContain("3 metadata row(s) with no object");
    expect(alert!.detail).toMatchObject({ hashMismatch: 1, scope: "documents" });
  });
});
