/**
 * The synchronous identity gate — WS-W6's "same-device user change", and the half of it that has
 * to happen before React renders because `api/queue`'s engine hydrates inside its constructor.
 *
 * See src/offline/identity.ts for the ordering argument. These tests pin the behaviour that
 * argument depends on: a foreign snapshot is *moved*, never deleted, and the live key is empty by
 * the time anything can read it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { SubmissionQueue } from "../../src/api/queue";
import {
  CACHED_IDENTITY_KEY,
  QUEUE_OWNER_KEY,
  QUEUE_QUARANTINE_KEY,
  claimQueueOwnership,
  clearQuarantine,
  guardQueueSnapshotForIdentity,
  readCachedIdentity,
  readQuarantine,
  writeCachedIdentity,
} from "../../src/offline/identity";
import { QUEUE_STORAGE_KEY } from "../../src/offline/queueStore";
import { checkoutInput } from "./helpers";

const queues: SubmissionQueue[] = [];

afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose();
  for (const key of [QUEUE_STORAGE_KEY, QUEUE_OWNER_KEY, QUEUE_QUARANTINE_KEY, CACHED_IDENTITY_KEY]) {
    window.localStorage.removeItem(key);
  }
});

function queueOneCommand(): void {
  const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
  queues.push(queue);
  queue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-ALPHA" }));
}

describe("cached identity", () => {
  it("round-trips, so an airplane-mode cold start knows which partition to open", () => {
    writeCachedIdentity({ objectId: "oid-alpha", upn: "alpha@englobecorp.com", tenant: "englobe.test" }, undefined, () => "2026-09-03T10:00:00.000Z");
    expect(readCachedIdentity()).toEqual({ objectId: "oid-alpha", upn: "alpha@englobecorp.com", tenant: "englobe.test", cachedAt: "2026-09-03T10:00:00.000Z" });
  });

  it("returns null rather than a half-built identity when the stored value is junk", () => {
    window.localStorage.setItem(CACHED_IDENTITY_KEY, "{not json");
    expect(readCachedIdentity()).toBeNull();
    window.localStorage.setItem(CACHED_IDENTITY_KEY, JSON.stringify({ upn: "a@b" }));
    expect(readCachedIdentity()).toBeNull();
  });
});

describe("the synchronous snapshot gate", () => {
  it("does nothing on a first run", () => {
    const result = guardQueueSnapshotForIdentity("oid-alpha");
    expect(result.quarantined).toBe(false);
    expect(window.localStorage.getItem(QUEUE_OWNER_KEY)).toBe("oid-alpha");
  });

  it("leaves the same user's own queue exactly where it is", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();
    const before = window.localStorage.getItem(QUEUE_STORAGE_KEY);

    const result = guardQueueSnapshotForIdentity("oid-alpha");
    expect(result.quarantined).toBe(false);
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).toBe(before);
  });

  it("moves another user's queue out of the engine's reach before it can hydrate", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();

    const result = guardQueueSnapshotForIdentity("oid-bravo");
    expect(result.quarantined).toBe(true);
    expect(result.previousOwner).toBe("oid-alpha");

    // The live key is empty, so whichever component constructs the queue first finds nothing.
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).toBeNull();
    const bravoQueue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
    queues.push(bravoQueue);
    expect(bravoQueue.list()).toEqual([]);
  });

  it("keeps the moved queue, rather than deleting somebody's work", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();
    guardQueueSnapshotForIdentity("oid-bravo");

    const quarantine = readQuarantine();
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0]!.owner).toBe("oid-alpha");
    expect(JSON.parse(quarantine[0]!.snapshot)[0].clientSubmissionId).toBe("sub-ALPHA");
  });

  it("keeps both when a device changes hands twice before the async boot files them", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();
    guardQueueSnapshotForIdentity("oid-bravo");

    // Bravo queues something too, then Charlie takes the phone.
    const bravoQueue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
    queues.push(bravoQueue);
    bravoQueue.enqueue("Checkout", checkoutInput({ clientSubmissionId: "sub-BRAVO" }));
    guardQueueSnapshotForIdentity("oid-charlie");

    expect(readQuarantine().map((q) => q.owner)).toEqual(["oid-alpha", "oid-bravo"]);
  });

  it("adopts an ownerless snapshot, because a build that predates the owner key had only one queue", () => {
    queueOneCommand(); // no owner recorded — the upgrade case
    const result = guardQueueSnapshotForIdentity("oid-alpha");
    expect(result.quarantined).toBe(false);
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(QUEUE_OWNER_KEY)).toBe("oid-alpha");
  });

  it("does nothing at all when nobody is signed in — an unknown identity is not a licence to move things", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();
    const result = guardQueueSnapshotForIdentity(null);
    expect(result.quarantined).toBe(false);
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).not.toBeNull();
  });

  it("clears the quarantine only when asked, which is after the rows are durable", () => {
    claimQueueOwnership("oid-alpha");
    queueOneCommand();
    guardQueueSnapshotForIdentity("oid-bravo");
    expect(readQuarantine()).toHaveLength(1);
    clearQuarantine();
    expect(readQuarantine()).toEqual([]);
  });

  it("survives a Storage that throws, without taking the app down with it", () => {
    const hostile = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    };
    expect(() => guardQueueSnapshotForIdentity("oid-alpha", { storage: hostile })).not.toThrow();
    expect(readCachedIdentity(hostile)).toBeNull();
  });
});
