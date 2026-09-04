/**
 * WS-W6's replay rules and the required device tests that do not need a phone:
 *   "reconnect/replay", "accepted response loss", "conflict from second device", "expired auth",
 *   "same-device user change".
 *
 * Every test drives the REAL `SubmissionQueue` through the REAL guarded transport. The fault
 * injection is at the network boundary only (helpers.ts's `scriptedTransport`), which is where a
 * real failure happens — a fake queue would let the assertions pass without the engine's
 * order-preserving, rejection-keeping behaviour ever being exercised.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { SubmissionQueue } from "../../src/api/queue";
import { listConflicts } from "../../src/offline/conflicts";
import { openOfflineDb, type OfflineDb } from "../../src/offline/db";
import { type CachePartition } from "../../src/offline/partition";
import { installQueueMirror, type QueueMirrorHandle } from "../../src/offline/queueMirror";
import { DurableCommandStore, QUEUE_STORAGE_KEY } from "../../src/offline/queueStore";
import { ReplayCoordinator, classifyTransportFailure } from "../../src/offline/replay";
import { accepted, checkoutInput, scriptedTransport, testPartition, transferInput, type RecordingTransport } from "./helpers";
import type { SubmissionOutcome } from "../../src/api/AmsBackend";

const queues: SubmissionQueue[] = [];
const mirrors: QueueMirrorHandle[] = [];
const dbs: OfflineDb[] = [];

afterEach(async () => {
  for (const mirror of mirrors.splice(0)) {
    await mirror.settled();
    mirror.uninstall();
  }
  for (const queue of queues.splice(0)) queue.dispose();
  for (const db of dbs.splice(0)) db.close();
  window.localStorage.removeItem(QUEUE_STORAGE_KEY);
});

interface Harness {
  queue: SubmissionQueue;
  coordinator: ReplayCoordinator;
  store: DurableCommandStore;
  db: OfflineDb;
  partition: CachePartition;
  transport: RecordingTransport;
  setIdentity(objectId: string | null): void;
}

async function harness(script: Array<SubmissionOutcome | "network" | "auth">, label = "replay"): Promise<Harness> {
  const partition = testPartition(label);
  const db = await openOfflineDb(partition);
  dbs.push(db);
  const store = new DurableCommandStore(db, partition);
  mirrors.push(installQueueMirror(store));

  const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
  queues.push(queue);

  const transport = scriptedTransport(script);
  let identity: string | null = partition.objectId;
  const coordinator = new ReplayCoordinator({
    queue,
    transport,
    store,
    db,
    partition,
    currentObjectId: () => identity,
    intervalMs: 0,
    isOnline: () => true,
  });
  return { queue, coordinator, store, db, partition, transport, setIdentity: (value) => (identity = value) };
}

describe("replay on reconnect", () => {
  it("sends every queued command, in the order the technician made them, and clears the queue", async () => {
    const h = await harness([accepted, accepted, accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    h.queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-B" }));
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-C" }));
    await mirrors[0]!.settled();

    const summary = await h.coordinator.replayNow();
    expect(summary.sent).toBe(3);
    expect(summary.blocked).toBeNull();
    expect(h.transport.calls.map((c) => c.clientSubmissionId)).toEqual(["sub-A", "sub-B", "sub-C"]);
    expect(h.queue.list()).toEqual([]);
    // The durable rows are eventually consistent with the engine's array until the injectable
    // storage seam lands (queueStore.ts's SUBMISSION_QUEUE_SEAM note) — drain the mirror first.
    await mirrors[0]!.settled();
    await expect(h.store.count()).resolves.toBe(0);
  });

  it("does nothing at all while the device is offline", async () => {
    const partition = testPartition("offline");
    const db = await openOfflineDb(partition);
    dbs.push(db);
    const store = new DurableCommandStore(db, partition);
    const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false, storageKey: "ams-offline-queue-test-offline" });
    queues.push(queue);
    const transport = scriptedTransport([accepted]);
    const coordinator = new ReplayCoordinator({
      queue,
      transport,
      store,
      db,
      partition,
      currentObjectId: () => partition.objectId,
      intervalMs: 0,
      isOnline: () => false,
    });
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));

    const summary = await coordinator.replayNow();
    expect(summary.blocked).toBe("offline");
    expect(transport.calls).toEqual([]);
    expect(queue.list()).toHaveLength(1);
  });

  it("stops the pass on the first connectivity failure so order is preserved for the next one", async () => {
    const h = await harness([accepted, "network", accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    h.queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-B" }));
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-C" }));
    await mirrors[0]!.settled();

    const summary = await h.coordinator.replayNow();
    expect(summary.sent).toBe(1);
    expect(summary.blocked).toBe("offline");
    expect(h.queue.list().map((e) => e.clientSubmissionId)).toEqual(["sub-B", "sub-C"]);
  });
});

describe("accepted response is lost — retry must return the original result", () => {
  it("replays under the same clientSubmissionId, so the server's idempotency answers", async () => {
    // The server accepted it and the response never arrived (transport throws), then the link
    // comes back and the same request is sent again.
    const h = await harness(["network", accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-LOST" }));
    await mirrors[0]!.settled();

    const first = await h.coordinator.replayNow();
    expect(first.sent).toBe(0);
    expect(h.queue.list()[0]!.status).toBe("Queued"); // kept, not written off

    const second = await h.coordinator.replayNow();
    expect(second.sent).toBe(1);

    // Both attempts carried the *same* idempotency key — the server therefore returns the original
    // transaction rather than creating a second one (FR-007).
    expect(h.transport.calls.map((c) => c.clientSubmissionId)).toEqual(["sub-LOST", "sub-LOST"]);

    // Drain the write-through mirror first. Until the injectable seam lands (queueStore.ts's
    // SUBMISSION_QUEUE_SEAM note), the engine's localStorage write and the durable write are two
    // steps, so the durable rows are eventually — not instantaneously — consistent with the queue.
    // Asserting after `settled()` is asserting the guarantee that actually exists.
    await mirrors[0]!.settled();
    await expect(h.store.count()).resolves.toBe(0);
  });

  it("never enqueues the same submission twice, however many times it is offered", async () => {
    const h = await harness([accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-DOUBLE" }));
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-DOUBLE" }));
    await mirrors[0]!.settled();
    expect(h.queue.list()).toHaveLength(1);
    await expect(h.store.count()).resolves.toBe(1);
  });
});

describe("conflict from a second device surfaces in Needs attention", () => {
  it("keeps the refused command and records a durable conflict naming the asset", async () => {
    const refusal: SubmissionOutcome = {
      ok: false,
      reason: "SEIS-INS-MIC-0001 was returned by another user after this cart was built.",
      offendingAssetId: "SEIS-INS-MIC-0001",
    };
    const h = await harness([refusal]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-CONFLICT" }));
    await mirrors[0]!.settled();

    const summary = await h.coordinator.replayNow();
    expect(summary.rejected).toBe(1);

    // The engine keeps it for a human (FR-039) — NeedsAttentionPage's Retry list.
    const entry = h.queue.list()[0]!;
    expect(entry.status).toBe("Rejected");
    expect(entry.rejectionReason).toContain("another user");

    // And there is a durable record that outlives the retry.
    const conflicts = await listConflicts(h.db);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("rejected");
    expect(conflicts[0]!.affectedAssetIds).toEqual(["SEIS-INS-MIC-0001"]);
  });

  it("resolves the conflict when a retry finally succeeds, without deleting the record", async () => {
    const refusal: SubmissionOutcome = { ok: false, reason: "Asset is not available" };
    const h = await harness([refusal, accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-RETRY" }));
    await mirrors[0]!.settled();

    await h.coordinator.replayNow();
    expect(await listConflicts(h.db)).toHaveLength(1);

    await h.queue.retry(h.queue.list()[0]!.id);
    expect(await listConflicts(h.db)).toHaveLength(0);
    expect(await listConflicts(h.db, { includeResolved: true })).toHaveLength(1);
  });

  it("does not create one conflict row per attempt", async () => {
    const refusal: SubmissionOutcome = { ok: false, reason: "Asset is not available" };
    const h = await harness([refusal]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-REPEAT" }));
    await mirrors[0]!.settled();

    await h.coordinator.replayNow();
    await h.queue.retry(h.queue.list()[0]!.id);
    const conflicts = await listConflicts(h.db);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.occurrences).toBe(2);
  });
});

describe("expired auth during replay", () => {
  it("is not mistaken for a dead link", () => {
    expect(classifyTransportFailure(new Error("POST /api/commands/Checkout failed: 401 Unauthorized"))).toBe("auth-expired");
    expect(classifyTransportFailure(Object.assign(new Error("nope"), { status: 403 }))).toBe("auth-expired");
    expect(classifyTransportFailure(new Error("Failed to fetch"))).toBe("network");
    expect(classifyTransportFailure(new Error("NetworkError when attempting to fetch resource"))).toBe("network");
  });

  it("stops the pass, keeps the command, and tells the technician to sign in again", async () => {
    const h = await harness(["auth"]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-AUTH" }));
    await mirrors[0]!.settled();

    const summary = await h.coordinator.replayNow();
    expect(summary.blocked).toBe("auth-expired");
    expect(summary.sent).toBe(0);

    // Not rejected: the server never judged the request, so no verdict may be recorded against it.
    expect(h.queue.list()[0]!.status).toBe("Queued");

    const conflicts = await listConflicts(h.db);
    expect(conflicts[0]!.kind).toBe("auth-expired");
    expect(conflicts[0]!.detail).toMatch(/sign in again/i);
  });
});

describe("no replay under another identity", () => {
  it("refuses to put a command on the wire when a different user is signed in", async () => {
    const h = await harness([accepted], "identity");
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-ALPHA" }));
    await mirrors[0]!.settled();

    // Alpha walks away; Bravo signs in on the same device without the app reloading.
    h.setIdentity("oid-bravo-live");

    const summary = await h.coordinator.replayNow();
    expect(h.transport.calls).toEqual([]); // nothing reached the network
    expect(summary.blocked).toBe("identity-changed");

    // The command is neither sent nor lost.
    await mirrors[0]!.settled();
    const rows = await h.store.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("HeldForIdentity");

    const conflicts = await listConflicts(h.db);
    expect(conflicts.some((c) => c.kind === "identity-mismatch")).toBe(true);
  });

  it("refuses when nobody is signed in at all", async () => {
    const h = await harness([accepted], "nobody");
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-NOONE" }));
    await mirrors[0]!.settled();
    h.setIdentity(null);

    const summary = await h.coordinator.replayNow();
    expect(summary.blocked).toBe("no-identity");
    expect(h.transport.calls).toEqual([]);
    expect(h.queue.list()).toHaveLength(1);
  });

  it("coalesces concurrent passes rather than interleaving two replays of the same queue", async () => {
    const h = await harness([accepted, accepted]);
    h.queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    h.queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-B" }));
    await mirrors[0]!.settled();

    const [first, second] = await Promise.all([h.coordinator.replayNow(), h.coordinator.replayNow()]);
    expect(first).toBe(second);
    expect(h.transport.calls).toHaveLength(2);
  });
});
