/**
 * WS-W6: "pending-command queue", "commands persist through app/device restarts", "no replay under
 * another identity", and the required device tests "queue multiple commands", "storage eviction"
 * and "same-device user change".
 *
 * These tests drive the REAL `SubmissionQueue` from api/queue wherever a queue is needed, not a
 * stand-in. The point of this lane is that the existing engine gains durable storage without
 * changing behaviour, and a test against a fake engine would prove the wrong thing.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { SubmissionQueue } from "../../src/api/queue";
import { openOfflineDb } from "../../src/offline/db";
import { installQueueMirror, type QueueMirrorHandle } from "../../src/offline/queueMirror";
import { DurableCommandStore, QUEUE_STORAGE_KEY, canonicalise, requestHash } from "../../src/offline/queueStore";
import { resolvePartition } from "../../src/offline/partition";
import { checkoutInput, testPartition, transferInput } from "./helpers";

const KEY = QUEUE_STORAGE_KEY;
const created: SubmissionQueue[] = [];
const mirrors: QueueMirrorHandle[] = [];

function makeQueue(): SubmissionQueue {
  // Default options: the real storage key, real localStorage persistence, real 'online' listener —
  // i.e. exactly what the running app constructs.
  const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
  created.push(queue);
  return queue;
}

afterEach(() => {
  for (const queue of created.splice(0)) queue.dispose();
  for (const mirror of mirrors.splice(0)) mirror.uninstall();
  window.localStorage.removeItem(KEY);
});

describe("the durable store and the engine agree on where the queue lives", () => {
  it("uses the same localStorage key SubmissionQueue writes", () => {
    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput());
    expect(window.localStorage.getItem(KEY)).toBeTruthy();
  });
});

describe("canonical request hashing", () => {
  it("is stable under key order", () => {
    expect(canonicalise({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalise({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("is not stable under array order — a reordered cart is a different request", () => {
    expect(requestHash("Checkout", { lines: [{ assetId: "A" }, { assetId: "B" }] })).not.toBe(
      requestHash("Checkout", { lines: [{ assetId: "B" }, { assetId: "A" }] }),
    );
  });

  it("changes when any field changes, which is what makes 'same ID, different payload' visible", () => {
    const a = requestHash("Checkout", checkoutInput());
    const b = requestHash("Checkout", checkoutInput({ project: "P-DIFFERENT" }));
    expect(a).not.toBe(b);
  });

  it("distinguishes two kinds carrying an identical payload", () => {
    expect(requestHash("Checkout", { x: 1 })).not.toBe(requestHash("Return", { x: 1 }));
  });
});

describe("queue multiple commands, restart, queue survives", () => {
  it("rebuilds the queue in the original order after the device is restarted", async () => {
    const partition = testPartition("restart");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    mirrors.push(installQueueMirror(store));

    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-B" }));
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-C", lines: [{ assetId: "SEIS-INS-MIC-0009" }] }));
    await mirrors[0]!.settled();

    await expect(store.count()).resolves.toBe(3);

    // Device restart: the page is gone, localStorage happens to have survived.
    const restored = await store.restoreForIdentity(partition.objectId);
    expect(restored.restored.map((row) => row.clientSubmissionId)).toEqual(["sub-A", "sub-B", "sub-C"]);
    store.writeSnapshotToStorage(restored.snapshot);

    const afterRestart = makeQueue();
    expect(afterRestart.list().map((entry) => entry.clientSubmissionId)).toEqual(["sub-A", "sub-B", "sub-C"]);
    await mirrors[0]!.settled();
    db.close();
  });

  it("drops a durable row once the server has accepted it", async () => {
    const partition = testPartition("accepted");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    await store.reconcileSnapshot(
      JSON.stringify([
        { id: "q1", kind: "Checkout", clientSubmissionId: "sub-A", input: checkoutInput({ clientSubmissionId: "sub-A" }), affectedAssetIds: ["A"], queuedAt: "t", status: "Queued", rejectionReason: null, attempts: 0 },
      ]),
    );
    await expect(store.count()).resolves.toBe(1);
    await store.markAccepted("sub-A");
    await expect(store.count()).resolves.toBe(0);
    db.close();
  });
});

describe("storage eviction is survived in both directions", () => {
  it("rebuilds the localStorage snapshot from IndexedDB when the browser clears site data", async () => {
    const partition = testPartition("evict-ls");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    mirrors.push(installQueueMirror(store));

    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-B" }));
    await mirrors[0]!.settled();

    // The browser evicts localStorage but not IndexedDB — the ordinary quota-pressure case.
    window.localStorage.removeItem(KEY);

    const restored = await store.restoreForIdentity(partition.objectId);
    expect(restored.rebuiltSnapshot).toBe(true);
    expect(restored.restored).toHaveLength(2);
    store.writeSnapshotToStorage(restored.snapshot);
    expect(makeQueue().list()).toHaveLength(2);
    await mirrors[0]!.settled();
    db.close();
  });

  it("reseeds IndexedDB from the localStorage snapshot when offline storage is the half that was lost", async () => {
    const partition = testPartition("evict-idb");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);

    // A snapshot exists but the durable rows do not — a cleared profile, a new browser version.
    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    await expect(store.count()).resolves.toBe(0);

    const restored = await store.restoreForIdentity(partition.objectId);
    expect(restored.reseededRows).toBe(true);
    await expect(store.count()).resolves.toBe(1);
    expect(restored.restored[0]!.clientSubmissionId).toBe("sub-A");
    db.close();
  });

  it("treats a corrupted snapshot as empty rather than losing the durable rows", async () => {
    const partition = testPartition("corrupt");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    await store.reconcileSnapshot(
      JSON.stringify([
        { id: "q1", kind: "Checkout", clientSubmissionId: "sub-A", input: checkoutInput({ clientSubmissionId: "sub-A" }), affectedAssetIds: ["A"], queuedAt: "t", status: "Queued", rejectionReason: null, attempts: 0 },
      ]),
    );
    window.localStorage.setItem(KEY, "{not json");
    const restored = await store.restoreForIdentity(partition.objectId);
    expect(restored.restored).toHaveLength(1);
    db.close();
  });
});

describe("same-device user change does not replay another user's queue", () => {
  it("holds every foreign command and hands the new user an empty queue", async () => {
    const alpha = testPartition("alpha");
    const db = await openOfflineDb(alpha);
    const store = new DurableCommandStore(db, alpha);
    mirrors.push(installQueueMirror(store));

    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-alpha-1" }));
    queue.enqueue("Transfer", transferInput({ clientSubmissionId: "sub-alpha-2" }));
    await mirrors[0]!.settled();

    // Bravo signs in on the same phone, in the same partition database.
    const bravo = resolvePartition({ upn: "bravo@englobecorp.com", objectId: "oid-bravo" }, { tenant: alpha.tenant, environment: alpha.environment });
    const bravoStore = new DurableCommandStore(db, bravo);
    const restored = await bravoStore.restoreForIdentity(bravo.objectId);

    expect(restored.restored).toEqual([]);
    expect(restored.held.map((row) => row.clientSubmissionId)).toEqual(["sub-alpha-1", "sub-alpha-2"]);
    expect(restored.snapshot).toBeNull();

    // Held, never deleted: Alpha's work is still there for when Alpha signs back in.
    await expect(bravoStore.count()).resolves.toBe(2);
    for (const row of await bravoStore.listHeld()) {
      expect(row.status).toBe("HeldForIdentity");
      expect(row.originObjectId).toBe(alpha.objectId);
      expect(row.holdReason).toContain("different signed-in user");
    }

    // And the engine Bravo gets has nothing of Alpha's in it.
    store.writeSnapshotToStorage(restored.snapshot);
    expect(makeQueue().list()).toEqual([]);
    await mirrors[0]!.settled();
    db.close();
  });

  it("returns the held commands intact when the original user signs back in", async () => {
    const alpha = testPartition("alpha-return");
    const db = await openOfflineDb(alpha);
    const alphaStore = new DurableCommandStore(db, alpha);
    mirrors.push(installQueueMirror(alphaStore));

    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-alpha-1" }));
    await mirrors[0]!.settled();

    const bravo = resolvePartition({ upn: "b@englobecorp.com", objectId: "oid-bravo-2" }, { tenant: alpha.tenant, environment: alpha.environment });
    await new DurableCommandStore(db, bravo).restoreForIdentity(bravo.objectId);

    // Held rows carry the original identity, so they are recoverable — the hold is a pause, not a
    // deletion. (Returning them to Queued is a deliberate, separate step, not something a boot
    // does silently; asserting the row is intact is what matters here.)
    const held = await alphaStore.listHeld();
    expect(held).toHaveLength(1);
    expect(held[0]!.originObjectId).toBe(alpha.objectId);
    expect(held[0]!.payload).toMatchObject({ project: "P-2026-014" });
    await mirrors[0]!.settled();
    db.close();
  });

  it("never restamps the originating identity of a command it has already seen", async () => {
    const alpha = testPartition("stamp");
    const db = await openOfflineDb(alpha);
    const alphaStore = new DurableCommandStore(db, alpha);
    const snapshot = JSON.stringify([
      { id: "q1", kind: "Checkout", clientSubmissionId: "sub-A", input: checkoutInput({ clientSubmissionId: "sub-A" }), affectedAssetIds: ["A"], queuedAt: "t", status: "Queued", rejectionReason: null, attempts: 0 },
    ]);
    await alphaStore.reconcileSnapshot(snapshot);

    const bravo = resolvePartition({ upn: "b@englobecorp.com", objectId: "oid-bravo-3" }, { tenant: alpha.tenant, environment: alpha.environment });
    await new DurableCommandStore(db, bravo).reconcileSnapshot(snapshot);

    const rows = await alphaStore.listAll();
    expect(rows[0]!.originObjectId).toBe(alpha.objectId);
    db.close();
  });
});

describe("the injectable seam (QueueSnapshotStorage)", () => {
  it("reads back exactly what SubmissionQueue.hydrate() expects", async () => {
    const partition = testPartition("seam");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    mirrors.push(installQueueMirror(store));

    const queue = makeQueue();
    queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-A" }));
    await mirrors[0]!.settled();

    const json = await store.readSnapshot();
    window.localStorage.setItem(KEY, json!);
    const rehydrated = makeQueue();
    expect(rehydrated.list()[0]).toMatchObject({ clientSubmissionId: "sub-A", kind: "Checkout", status: "Queued" });
    await mirrors[0]!.settled();
    db.close();
  });

  it("hands a mid-flight 'Sending' row back as 'Queued', matching the engine's own rule", async () => {
    const partition = testPartition("sending");
    const db = await openOfflineDb(partition);
    const store = new DurableCommandStore(db, partition);
    await store.reconcileSnapshot(
      JSON.stringify([
        { id: "q1", kind: "Checkout", clientSubmissionId: "sub-A", input: checkoutInput({ clientSubmissionId: "sub-A" }), affectedAssetIds: ["A"], queuedAt: "t", status: "Sending", rejectionReason: null, attempts: 1 },
      ]),
    );
    const json = await store.readSnapshot();
    expect(JSON.parse(json!)[0].status).toBe("Queued");
    db.close();
  });
});
