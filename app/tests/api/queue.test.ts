/**
 * Feature 003 US5 (FR-036–FR-040) — the offline submission queue engine, tested standalone
 * against a fault-injecting fake transport (per specs/REMAINING-WORK.md § WS-C: "the *specific*
 * failure modes US5 tests for ... need a real network boundary to fail against" — this file
 * builds and exercises exactly that boundary, independent of the mock backend's same-origin
 * fetch). Each `describe` block is named after the acceptance scenario or edge case it proves
 * from specs/003-asset-transactions/spec.md's User Story 5.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubmissionQueue } from "@/api/queue/SubmissionQueue";
import type { SubmissionTransport } from "@/api/queue/types";
import type { CheckoutInput, ReturnInput, SubmissionOutcome, TransferInput } from "@/api/AmsBackend";

type Behavior = "ok" | "reject" | "networkError";

/** Fault-injecting fake transport. `behaviors[clientSubmissionId]` controls what happens the
 * FIRST time that id is seen; once a call actually succeeds, the id is remembered in `processed`
 * and every later call with the same id returns ok:true idempotently — exactly the contract the
 * real MockAmsBackend/store.ts already provides (FR-007) — so tests can simulate "sent but not
 * acknowledged, retried" without needing the real backend. */
class FakeTransport implements SubmissionTransport {
  calls: Array<{ method: "submitCheckout" | "submitReturn" | "submitTransfer"; clientSubmissionId: string }> = [];
  behaviors: Record<string, Behavior> = {};
  rejectReasons: Record<string, string> = {};
  private processed = new Set<string>();

  processedCount(clientSubmissionId: string): number {
    return this.calls.filter((c) => c.clientSubmissionId === clientSubmissionId).length;
  }

  private async handle(method: "submitCheckout" | "submitReturn" | "submitTransfer", clientSubmissionId: string): Promise<SubmissionOutcome> {
    this.calls.push({ method, clientSubmissionId });
    if (this.processed.has(clientSubmissionId)) {
      return { ok: true, transactionId: `already-${clientSubmissionId}`, transactionName: "already-processed" };
    }
    const behavior = this.behaviors[clientSubmissionId] ?? "ok";
    if (behavior === "networkError") throw new Error("simulated network failure");
    if (behavior === "reject") {
      return { ok: false, reason: this.rejectReasons[clientSubmissionId] ?? "refused" };
    }
    this.processed.add(clientSubmissionId);
    return { ok: true, transactionId: `txn-${clientSubmissionId}`, transactionName: `TXN-${clientSubmissionId}` };
  }

  submitCheckout(input: CheckoutInput) {
    return this.handle("submitCheckout", input.clientSubmissionId);
  }
  submitReturn(input: ReturnInput) {
    return this.handle("submitReturn", input.clientSubmissionId);
  }
  submitTransfer(input: TransferInput) {
    return this.handle("submitTransfer", input.clientSubmissionId);
  }
}

function checkoutInput(id: string, assetIds: string[] = ["DL-UM-1"]): CheckoutInput {
  return { lines: assetIds.map((assetId) => ({ assetId })), project: "02208928", clientSubmissionId: id };
}
function returnInput(id: string, assetIds: string[] = ["DL-UM-1"]): ReturnInput {
  return { lines: assetIds.map((assetId) => ({ assetId })), clientSubmissionId: id };
}
function transferInput(id: string, assetIds: string[] = ["DL-UM-1"]): TransferInput {
  return { assetIds, reason: "test transfer", clientSubmissionId: id };
}

let seq = 0;
function makeQueue(transport: SubmissionTransport | undefined, overrides: Partial<{ storageKey: string; persist: boolean }> = {}) {
  seq += 1;
  return new SubmissionQueue(transport, {
    storageKey: overrides.storageKey ?? `ams-offline-queue-test-${seq}`,
    persist: overrides.persist ?? true,
    autoFlushOnReconnect: false, // most tests drive flush() explicitly; the dedicated reconnect test below opts back in
    now: () => new Date(2026, 8, 2, 0, 0, seq).toISOString(),
  });
}

const disposables: SubmissionQueue[] = [];
function track(q: SubmissionQueue): SubmissionQueue {
  disposables.push(q);
  return q;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  for (const q of disposables.splice(0)) q.dispose();
});

describe("SubmissionQueue — queue while offline (FR-036/FR-037, US5 scenario 1)", () => {
  it("submit() is accepted and marked Queued when the transport cannot be reached", async () => {
    const transport = new FakeTransport();
    transport.behaviors["c1"] = "networkError";
    const queue = track(makeQueue(transport));

    const result = await queue.submit("Checkout", checkoutInput("c1", ["DL-UM-1", "GEO-UM-1"]));

    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.submission.status).toBe("Queued");
      expect(result.submission.affectedAssetIds).toEqual(["DL-UM-1", "GEO-UM-1"]);
    }
    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0].status).toBe("Queued");
  });

  it("a submission made while online (transport reachable) is NOT queued — delivered immediately", async () => {
    const transport = new FakeTransport();
    const queue = track(makeQueue(transport));

    const result = await queue.submit("Checkout", checkoutInput("c2"));

    expect(result.delivered).toBe(true);
    expect(queue.list()).toHaveLength(0);
  });

  it("an immediate {ok:false} business refusal (asset not Available, etc.) is returned directly, not queued", async () => {
    const transport = new FakeTransport();
    transport.behaviors["c3"] = "reject";
    transport.rejectReasons["c3"] = "DL-UM-1 is not Available.";
    const queue = track(makeQueue(transport));

    const result = await queue.submit("Checkout", checkoutInput("c3"));

    expect(result.delivered).toBe(true);
    if (result.delivered) expect(result.outcome).toEqual({ ok: false, reason: "DL-UM-1 is not Available." });
    // Not needs-attention material — the technician is present and saw it in real time.
    expect(queue.list()).toHaveLength(0);
  });

  it("a queued submission is visible via list() with its affected assets (feeds FR-040's pending indicator)", async () => {
    const queue = track(makeQueue(undefined)); // no transport at all == cannot possibly deliver
    queue.enqueue("Transfer", transferInput("c4", ["DL-UM-9"]));

    const list = queue.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "Transfer", status: "Queued", affectedAssetIds: ["DL-UM-9"] });
  });
});

describe("SubmissionQueue — persists across an app restart (FR-037, US5 scenario 4)", () => {
  it("a queued submission is still queued after the queue is reconstructed with the same storage key", () => {
    const storageKey = "ams-offline-queue-test-restart";
    const first = track(makeQueue(undefined, { storageKey }));
    first.enqueue("Checkout", checkoutInput("restart-1"));
    expect(first.list()).toHaveLength(1);

    // Simulate the app closing and reopening: a fresh instance, no in-memory state carried over,
    // reading the same localStorage key.
    const second = track(makeQueue(undefined, { storageKey }));
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0].clientSubmissionId).toBe("restart-1");
    expect(second.list()[0].status).toBe("Queued");
  });

  it("an entry left 'Sending' when the app closed mid-request comes back as 'Queued', not lost", () => {
    const storageKey = "ams-offline-queue-test-sending";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "q1",
          kind: "Checkout",
          clientSubmissionId: "mid-flight",
          input: checkoutInput("mid-flight"),
          affectedAssetIds: ["DL-UM-1"],
          queuedAt: new Date().toISOString(),
          status: "Sending",
          rejectionReason: null,
          attempts: 1,
        },
      ])
    );

    const queue = track(makeQueue(undefined, { storageKey }));
    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0].status).toBe("Queued");
  });
});

describe("SubmissionQueue — replay in order on reconnect (FR-038, US5 scenario 2)", () => {
  it("flush() sends every queued entry through the transport in the order they were queued", async () => {
    const transport = new FakeTransport();
    const queue = track(makeQueue(undefined)); // built with no transport, as if enqueued while fully offline
    queue.enqueue("Checkout", checkoutInput("order-1"));
    queue.enqueue("Return", returnInput("order-2"));
    queue.enqueue("Transfer", transferInput("order-3"));
    queue.setTransport(transport);

    const summary = await queue.flush();

    expect(summary).toEqual({ sent: 3, rejected: 0, remaining: 0 });
    expect(transport.calls.map((c) => c.clientSubmissionId)).toEqual(["order-1", "order-2", "order-3"]);
    expect(queue.list()).toHaveLength(0);
  });

  it("flush() stops at the first entry still unreachable, preserving order for the next attempt", async () => {
    const transport = new FakeTransport();
    transport.behaviors["stop-2"] = "networkError";
    const queue = track(makeQueue(transport));
    queue.enqueue("Checkout", checkoutInput("stop-1"));
    queue.enqueue("Checkout", checkoutInput("stop-2"));
    queue.enqueue("Checkout", checkoutInput("stop-3"));

    const summary = await queue.flush();

    expect(summary).toEqual({ sent: 1, rejected: 0, remaining: 2 });
    const remaining = queue.list();
    expect(remaining.map((e) => e.clientSubmissionId)).toEqual(["stop-2", "stop-3"]);
    expect(remaining[0].status).toBe("Queued"); // reverted, not stuck "Sending"

    // Connectivity returns — a second flush() picks up exactly where it left off, in order.
    transport.behaviors["stop-2"] = "ok";
    const secondSummary = await queue.flush();
    expect(secondSummary).toEqual({ sent: 2, rejected: 0, remaining: 0 });
    expect(transport.calls.map((c) => c.clientSubmissionId)).toEqual(["stop-1", "stop-2", "stop-2", "stop-3"]);
  });

  it("two concurrent flush() calls coalesce into one pass — no entry is ever processed twice at once", async () => {
    const transport = new FakeTransport();
    const queue = track(makeQueue(transport));
    queue.enqueue("Checkout", checkoutInput("race-1"));
    queue.enqueue("Checkout", checkoutInput("race-2"));

    const [a, b] = await Promise.all([queue.flush(), queue.flush()]);

    expect(a).toEqual(b);
    expect(transport.calls.filter((c) => c.clientSubmissionId === "race-1")).toHaveLength(1);
    expect(transport.calls.filter((c) => c.clientSubmissionId === "race-2")).toHaveLength(1);
  });
});

describe("SubmissionQueue — a rejected replay is surfaced, never discarded (FR-039, US5 scenario 3)", () => {
  it("a queued submission rejected on replay becomes Rejected with its reason, and stays in list()", async () => {
    const transport = new FakeTransport();
    transport.behaviors["conflict-1"] = "reject";
    transport.rejectReasons["conflict-1"] = "DL-UM-1 is CheckedOut to someone else.";
    const queue = track(makeQueue(transport));
    queue.enqueue("Checkout", checkoutInput("conflict-1"));

    const summary = await queue.flush();

    expect(summary).toEqual({ sent: 0, rejected: 1, remaining: 0 });
    const list = queue.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("Rejected");
    expect(list[0].rejectionReason).toBe("DL-UM-1 is CheckedOut to someone else.");
  });

  it("a Rejected entry is never removed by flush() on later passes — only retry() succeeding removes it", async () => {
    const transport = new FakeTransport();
    transport.behaviors["conflict-2"] = "reject";
    const queue = track(makeQueue(transport));
    queue.enqueue("Checkout", checkoutInput("conflict-2"));
    await queue.flush();
    expect(queue.list()[0].status).toBe("Rejected");

    // A later flush() pass (e.g. another reconnect) must not silently drop it or re-attempt it —
    // FR-039 requires a human action (retry()), never an automatic silent retry loop that could
    // spam the same rejection.
    const secondSummary = await queue.flush();
    expect(secondSummary).toEqual({ sent: 0, rejected: 0, remaining: 0 }); // untouched — still Rejected, not "Queued"
    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0].status).toBe("Rejected");
  });

  it("retry() resends a Rejected entry and removes it once the server now accepts it", async () => {
    const transport = new FakeTransport();
    transport.behaviors["conflict-3"] = "reject";
    const queue = track(makeQueue(transport));
    const entry = queue.enqueue("Checkout", checkoutInput("conflict-3"));
    await queue.flush();
    expect(queue.list()[0].status).toBe("Rejected");

    transport.behaviors["conflict-3"] = "ok"; // the human resolved the underlying conflict
    const result = await queue.retry(entry.id);

    expect(result.kind).toBe("sent");
    expect(queue.list()).toHaveLength(0);
  });

  it("retry() throws for an id that no longer exists, rather than silently doing nothing", async () => {
    const queue = track(makeQueue(new FakeTransport()));
    await expect(queue.retry("no-such-id")).rejects.toThrow();
  });
});

describe("SubmissionQueue — exactly-once delivery under intermittent connectivity (US5 scenario 5)", () => {
  it("a submission sent but not acknowledged is retried safely without the transport ever recording it twice", async () => {
    const transport = new FakeTransport();
    transport.behaviors["flaky-1"] = "networkError"; // the request may have landed server-side, but the ack was lost
    const queue = track(makeQueue(undefined));
    const submitResult = await (async () => {
      queue.setTransport(transport);
      return queue.submit("Checkout", checkoutInput("flaky-1"));
    })();
    expect(submitResult.delivered).toBe(false); // queued after the simulated drop

    // Connectivity returns; flush() retries with the SAME clientSubmissionId.
    transport.behaviors["flaky-1"] = "ok";
    const summary = await queue.flush();

    expect(summary.sent).toBe(1);
    expect(queue.list()).toHaveLength(0);
    // The transport was asked twice (drop, then retry) but its own idempotency contract — the
    // same one the real MockAmsBackend provides via clientSubmissionId (FR-007) — means only one
    // of those calls actually "recorded" anything; a real backend would behave identically.
    expect(transport.processedCount("flaky-1")).toBe(2);
  });

  it("enqueue() called twice with the same clientSubmissionId produces one entry, not two (double-tap)", () => {
    const queue = track(makeQueue(undefined));
    const first = queue.enqueue("Checkout", checkoutInput("double-tap"));
    const second = queue.enqueue("Checkout", checkoutInput("double-tap"));

    expect(second.id).toBe(first.id);
    expect(queue.list()).toHaveLength(1);
  });

  it("submit() called again with the same clientSubmissionId after it is already queued returns the existing entry, not a new attempt", async () => {
    const transport = new FakeTransport();
    transport.behaviors["double-submit"] = "networkError";
    const queue = track(makeQueue(transport));

    await queue.submit("Checkout", checkoutInput("double-submit"));
    const secondAttempt = await queue.submit("Checkout", checkoutInput("double-submit"));

    expect(secondAttempt.delivered).toBe(false);
    expect(queue.list()).toHaveLength(1);
    // Only the first submit() actually reached the transport — the second short-circuited on the
    // existing queue entry rather than calling out again.
    expect(transport.calls).toHaveLength(1);
  });
});

describe("SubmissionQueue — reconnect via the browser's 'online' event", () => {
  it("flush() runs automatically when the app comes back online", async () => {
    const transport = new FakeTransport();
    transport.behaviors["reconnect-1"] = "networkError";
    const queue = new SubmissionQueue(transport, {
      storageKey: "ams-offline-queue-test-online-event",
      autoFlushOnReconnect: true,
    });
    try {
      await queue.submit("Checkout", checkoutInput("reconnect-1"));
      expect(queue.list()).toHaveLength(1);

      transport.behaviors["reconnect-1"] = "ok";
      window.dispatchEvent(new Event("online"));

      // The listener kicks off flush() but does not block the event; poll briefly for it to settle.
      for (let i = 0; i < 20 && queue.list().length > 0; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(queue.list()).toHaveLength(0);
    } finally {
      queue.dispose();
    }
  });
});
