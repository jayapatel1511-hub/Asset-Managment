/**
 * Feature 003 US5 (FR-039/FR-040) — api/mock/offline.ts's listPendingSubmissions(), and an
 * end-to-end check that SubmissionQueue genuinely "wraps calls to the existing
 * submitCheckout/submitReturn/submitTransfer" (this workstream's non-negotiable) rather than a
 * fake transport standing in for the real thing — the second describe block below drives the
 * queue against the REAL MockAmsBackend/state machine, including a genuine FR-039 conflict
 * (the asset's status changes while the submission is queued).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAmsBackend, setMockCurrentUserKey } from "@/api/mock";
import { MockStore } from "@/api/mock/store";
import { getSubmissionQueue, resetSubmissionQueueForTesting, SubmissionQueue } from "@/api/queue";
import type { EquipmentModel, Location } from "@/api/types";

beforeEach(() => {
  window.localStorage.clear();
  resetSubmissionQueueForTesting();
  setMockCurrentUserKey("field");
});

afterEach(() => {
  resetSubmissionQueueForTesting();
});

describe("api/mock/offline.ts — listPendingSubmissions() (FR-039/FR-040)", () => {
  function makeBackend() {
    const store = MockStore.forTesting({ assets: [] });
    return new MockAmsBackend(store);
  }

  it("starts empty — a fresh backend with nothing queued reports no pending submissions", async () => {
    const backend = makeBackend();
    await expect(backend.listPendingSubmissions()).resolves.toEqual([]);
  });

  it("reflects a queued submission, mapped to the AmsBackend PendingSubmission shape", async () => {
    const backend = makeBackend();
    getSubmissionQueue().enqueue("Checkout", {
      lines: [{ assetId: "DL-UM-1" }],
      project: "02208928",
      clientSubmissionId: "offline-t1",
    });

    const list = await backend.listPendingSubmissions();
    expect(list).toEqual([
      {
        id: expect.any(String),
        kind: "Checkout",
        queuedAt: expect.any(String),
        status: "Queued",
        affectedAssetIds: ["DL-UM-1"],
        rejectionReason: null,
      },
    ]);
  });

  it("surfaces a rejected replay with its reason, never silently dropping it (FR-039)", async () => {
    const backend = makeBackend();
    const queue = getSubmissionQueue({
      submitCheckout: async () => ({ ok: false, reason: "DL-UM-1 is CheckedOut to someone else." }),
      submitReturn: async () => ({ ok: true, transactionId: "x", transactionName: "x" }),
      submitTransfer: async () => ({ ok: true, transactionId: "x", transactionName: "x" }),
    });
    queue.enqueue("Checkout", { lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: "offline-t2" });
    await queue.flush();

    const list = await backend.listPendingSubmissions();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("Rejected");
    expect(list[0].rejectionReason).toBe("DL-UM-1 is CheckedOut to someone else.");
  });

  it("does not touch MockStore at all — queue state is independent of asset data", async () => {
    const store = MockStore.forTesting({ assets: [] });
    const backend = new MockAmsBackend(store);
    getSubmissionQueue().enqueue("Transfer", { assetIds: ["GEO-UM-1"], reason: "test", clientSubmissionId: "offline-t3" });

    expect(store.transactions).toHaveLength(0);
    expect(store.transactionLines).toHaveLength(0);
    await expect(backend.listPendingSubmissions()).resolves.toHaveLength(1);
  });
});

describe("SubmissionQueue wrapping the REAL MockAmsBackend end-to-end", () => {
  const locations: Location[] = [{ id: "l1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true }];
  const models: EquipmentModel[] = [
    {
      manufacturer: "Instantel",
      model: "Micromate",
      equipmenttype: "DataLogger",
      assetgroup: "Seismographs",
      idprefix: "DL-UM",
      isserialised: true,
      identifiertype: "Serial",
      defaultcalintervalmonths: 12,
    },
  ];

  function makeRealBackend() {
    const store = MockStore.forTesting({
      assets: [
        {
          id: "id-1",
          assetid: "DL-UM-1",
          migrationsource: null,
          equipmentmodel: models[0],
          serialnumber: "UM1",
          homeoffice: "Ottawa",
          lifecycle: "Active",
          status: "Available",
          currentlocation: "Ottawa",
          custodian: null,
          currentproject: null,
          parentasset: null,
          lastcaldate: null,
          nextcaldue: null,
          retirementreason: null,
          notes: null,
          carrier: null,
          identifiervalue: null,
          phonenumber: null,
          staticip: null,
        },
      ],
      locations,
      equipmentModels: models,
      projects: [{ id: "p1", projectnumber: "02208928", name: "Test project", status: "Active", office: "Ottawa", pm: null }],
    });
    return { backend: new MockAmsBackend(store), store };
  }

  it("a queued checkout, once replayed, actually takes effect through the real backend (non-negotiable: no direct store.applyTransaction)", async () => {
    const { backend } = makeRealBackend();
    const queue = new SubmissionQueue(backend, { persist: false, autoFlushOnReconnect: false });
    queue.enqueue("Checkout", { lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: "real-1" });

    const summary = await queue.flush();

    expect(summary).toEqual({ sent: 1, rejected: 0, remaining: 0 });
    const asset = await backend.getAsset("DL-UM-1");
    expect(asset?.status).toBe("CheckedOut");
    expect(asset?.custodian).toBe("tech@englobecorp.com");
    const history = await backend.getAssetHistory("DL-UM-1");
    expect(history).toHaveLength(1); // exactly one line — the replay, not a duplicate
  });

  it("a queued checkout rejected on replay because the asset's status changed while queued is surfaced, not force-applied (FR-039, edge case)", async () => {
    const { backend } = makeRealBackend();
    const queue = new SubmissionQueue(backend, { persist: false, autoFlushOnReconnect: false });
    queue.enqueue("Checkout", { lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: "real-2" });

    // "The world changed while offline": someone else checks the same asset out through the same
    // real backend before this queued submission gets to replay.
    const other = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: "someone-else" });
    expect(other.ok).toBe(true);

    const summary = await queue.flush();

    expect(summary).toEqual({ sent: 0, rejected: 1, remaining: 0 });
    const entry = queue.list()[0];
    expect(entry.status).toBe("Rejected");
    expect(entry.rejectionReason).toContain("DL-UM-1");
    // The asset's real state is exactly what the successful in-between checkout produced — the
    // rejected replay never touched it.
    const asset = await backend.getAsset("DL-UM-1");
    expect(asset?.custodian).toBe("tech@englobecorp.com");
  });

  it("replaying the SAME queued checkout twice (idempotent retry) never records a second transaction (FR-007)", async () => {
    const { backend } = makeRealBackend();
    const queue = new SubmissionQueue(backend, { persist: false, autoFlushOnReconnect: false });
    const entry = queue.enqueue("Checkout", { lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: "real-3" });
    await queue.flush();

    // Re-enqueue the identical submission (e.g. a naive caller retries after losing the response)
    // and replay it again directly through the real backend's own method.
    const replay = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-1" }], project: "02208928", clientSubmissionId: entry.clientSubmissionId });

    expect(replay.ok).toBe(true);
    const history = await backend.getAssetHistory("DL-UM-1");
    expect(history).toHaveLength(1); // still one — idempotent, not doubled
  });
});
