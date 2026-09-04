/**
 * The boot sequence itself — src/offline/index.ts, called from main.tsx.
 *
 * The individual pieces are covered by the other files here; what this one proves is the ORDER,
 * which is where the offline layer can go wrong in a way no unit test would notice:
 *
 *   - the durable rows are reconciled and the identity filter applied BEFORE the submission queue
 *     is ever constructed, so the engine cannot hydrate someone else's commands;
 *   - a boot with no network still completes (an offline cold start is the normal case, not the
 *     exception);
 *   - a boot on a device with no usable storage returns a degraded runtime instead of throwing,
 *     because the app must keep working online-only.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSubmissionQueueForTesting, SubmissionQueue } from "../../src/api/queue";
import type { CurrentUser } from "../../src/api/types";
import { listConflicts } from "../../src/offline/conflicts";
import { openOfflineDb } from "../../src/offline/db";
import { DurableCommandStore } from "../../src/offline/queueStore";
import { CACHED_IDENTITY_KEY, QUEUE_OWNER_KEY, QUEUE_QUARANTINE_KEY, claimQueueOwnership, guardQueueSnapshotForIdentity, writeCachedIdentity } from "../../src/offline/identity";
import { guardOfflineQueueBoot, startOfflineRuntime, type OfflineRuntime } from "../../src/offline";
import { QUEUE_STORAGE_KEY } from "../../src/offline/queueStore";
import { checkoutInput } from "./helpers";

const runtimes: OfflineRuntime[] = [];

/** A transport that would fail loudly if replay ever reached it. Passing it also keeps these tests
 * from lazily importing the real backend, whose mock store fetches /data/*.json — a relative URL
 * jsdom cannot resolve. */
const noTransport = {
  submitCheckout: async () => {
    throw new Error("no network in this test");
  },
  submitReturn: async () => {
    throw new Error("no network in this test");
  },
  submitTransfer: async () => {
    throw new Error("no network in this test");
  },
};

const alpha: CurrentUser = { upn: "alpha@englobecorp.com", displayName: "Alpha", homeoffice: "Ottawa", roles: ["FieldUser"], objectId: "oid-alpha" };
const bravo: CurrentUser = { upn: "bravo@englobecorp.com", displayName: "Bravo", homeoffice: "Ottawa", roles: ["FieldUser"], objectId: "oid-bravo" };

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  resetSubmissionQueueForTesting();
  for (const key of [QUEUE_STORAGE_KEY, QUEUE_OWNER_KEY, QUEUE_QUARANTINE_KEY, CACHED_IDENTITY_KEY]) window.localStorage.removeItem(key);
  vi.unstubAllGlobals();
});

function track(runtime: OfflineRuntime): OfflineRuntime {
  runtimes.push(runtime);
  return runtime;
}

/** Put one queued command on the device as the given user, the way a screen would. */
function queueAs(objectId: string, clientSubmissionId: string): void {
  writeCachedIdentity({ objectId, upn: `${objectId}@englobecorp.com`, tenant: "englobe.local" });
  claimQueueOwnership(objectId);
  const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
  queue.enqueue("Checkout", checkoutInput({ clientSubmissionId }));
  queue.dispose();
}

describe("first ever run", () => {
  it("degrades cleanly when there is no cached identity yet, and seeds one for next time", async () => {
    const runtime = track(await startOfflineRuntime({ registerWorker: false, getCurrentUser: async () => alpha, transport: noTransport }));
    expect(runtime.degraded).toBe("no-identity");
    expect(runtime.db).toBeNull();

    // The background confirmation seeds the cache so the *next* boot — possibly offline — works.
    await vi.waitFor(() => expect(window.localStorage.getItem(CACHED_IDENTITY_KEY)).toBeTruthy());
  });

  it("guardOfflineQueueBoot is safe to call with nothing stored at all", () => {
    expect(() => guardOfflineQueueBoot()).not.toThrow();
  });
});

describe("ordinary boot", () => {
  it("opens the partition, wires the coordinator, and reports no degradation", async () => {
    writeCachedIdentity({ objectId: "oid-alpha", upn: alpha.upn, tenant: "englobe.local" });
    const runtime = track(await startOfflineRuntime({ registerWorker: false, getCurrentUser: async () => alpha, transport: noTransport }));

    expect(runtime.degraded).toBeNull();
    expect(runtime.partition?.objectId).toBe("oid-alpha");
    expect(runtime.partition?.environment).toBe("test");
    expect(runtime.db).not.toBeNull();
    expect(runtime.coordinator).not.toBeNull();
  });

  it("completes with the network dead — the airplane-mode cold start", async () => {
    writeCachedIdentity({ objectId: "oid-alpha-offline", upn: alpha.upn, tenant: "englobe.local" });
    vi.stubGlobal("fetch", () => {
      throw new Error("offline");
    });

    const runtime = track(
      await startOfflineRuntime({
        registerWorker: false,
        transport: noTransport,
        getCurrentUser: async () => {
          throw new Error("offline");
        },
      }),
    );
    expect(runtime.degraded).toBeNull();
    expect(runtime.partition?.objectId).toBe("oid-alpha-offline");
  });

  it("makes an already-queued command durable at boot without changing what the engine sees", async () => {
    queueAs("oid-alpha-durable", "sub-A");
    const runtime = track(await startOfflineRuntime({ registerWorker: false, getCurrentUser: async () => alpha, transport: noTransport }));

    await expect(runtime.store!.count()).resolves.toBe(1);
    const queue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
    expect(queue.list().map((e) => e.clientSubmissionId)).toEqual(["sub-A"]);
    queue.dispose();
  });
});

describe("the device changed hands", () => {
  it("files the previous user's quarantined queue as held rows plus a visible conflict", async () => {
    queueAs("oid-alpha-handover", "sub-ALPHA");

    // Bravo signs in. main.tsx's synchronous gate runs first, before anything can hydrate.
    writeCachedIdentity({ objectId: "oid-bravo-handover", upn: bravo.upn, tenant: "englobe.local" });
    const gate = guardQueueSnapshotForIdentity("oid-bravo-handover", { queueKey: QUEUE_STORAGE_KEY });
    expect(gate.quarantined).toBe(true);
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).toBeNull();

    const runtime = track(await startOfflineRuntime({ registerWorker: false, getCurrentUser: async () => bravo, transport: noTransport }));
    expect(runtime.heldCommands).toBe(1);

    // Alpha's command is durable and held — filed in ALPHA's own partition, so it is waiting for
    // them when they sign back in, and Bravo's cache never contains another technician's work.
    const alphaPartition = { ...runtime.partition!, objectId: "oid-alpha-handover" };
    const alphaDb = await openOfflineDb(alphaPartition);
    const held = await new DurableCommandStore(alphaDb, alphaPartition).listHeld();
    expect(held.map((row) => row.clientSubmissionId)).toEqual(["sub-ALPHA"]);
    expect(held[0]!.originObjectId).toBe("oid-alpha-handover");
    expect(await listConflicts(alphaDb)).toHaveLength(1);
    alphaDb.close();

    // Bravo's partition holds nothing of Alpha's, only a notice that something is held.
    await expect(runtime.store!.listAll()).resolves.toEqual([]);
    const conflicts = await listConflicts(runtime.db!);
    expect(conflicts.some((c) => c.kind === "identity-mismatch")).toBe(true);

    // The quarantine is emptied only now that the rows are durable.
    expect(window.localStorage.getItem(QUEUE_QUARANTINE_KEY)).toBeNull();

    const bravoQueue = new SubmissionQueue(undefined, { autoFlushOnReconnect: false });
    expect(bravoQueue.list()).toEqual([]);
    bravoQueue.dispose();
  });
});

describe("a device with no usable storage", () => {
  it("returns a degraded runtime rather than throwing, so the app still boots online-only", async () => {
    writeCachedIdentity({ objectId: "oid-nostorage", upn: alpha.upn, tenant: "englobe.local" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("indexedDB", {
      open() {
        throw new Error("SecurityError: storage disabled");
      },
    });

    const runtime = track(await startOfflineRuntime({ registerWorker: false, getCurrentUser: async () => alpha, transport: noTransport }));
    expect(runtime.degraded).toBe("storage-unavailable");
    expect(runtime.db).toBeNull();
    expect(() => runtime.stop()).not.toThrow();
    warn.mockRestore();
  });
});
