/**
 * Feature 007 FR-060 / SC-014: the base dataset is served from static files and never written to
 * localStorage; only the delta a user creates on top of it is persisted, and it survives a reload.
 * FR-007/FR-008: the app knows which dataset it is showing, and treats a missing manifest as real.
 *
 * These tests drive MockStore's real `load()` path (not `forTesting`), with `fetch` stubbed to
 * serve a small dataset — the same code path the browser takes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAmsBackend } from "@/api/mock";
import { MockStore } from "@/api/mock/store";
import type { Asset, EquipmentModel, Location, Project, TransactionHeader, TransactionLine } from "@/api/types";

const models: EquipmentModel[] = [
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", assetgroup: "Seismographs", idprefix: "DL-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
];

const locations: Location[] = [{ id: "l1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true }];
const projects: Project[] = [{ id: "p1", projectnumber: "09000001", name: "Synthetic test project", status: "Active", office: "Ottawa", pm: null }];

function asset(assetid: string): Asset {
  return {
    id: `id-${assetid}`, assetid, migrationsource: "SYNTHETIC seed=test profile=demo",
    equipmentmodel: { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger" },
    serialnumber: assetid.slice(-5), homeoffice: "Ottawa", lifecycle: "Active", status: "Available",
    currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null,
    lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null,
    identifiervalue: null, phonenumber: null, staticip: null,
  };
}

/** A base dataset big enough that persisting it whole would be silly, small enough to be fast. */
const BASE_ASSETS = Array.from({ length: 200 }, (_, i) => asset(`DL-UM-${40000 + i}`));
const BASE_TRANSACTIONS: TransactionHeader[] = BASE_ASSETS.map((_a, i) => ({
  id: `txn-${i}`, name: `TXN-${String(i).padStart(6, "0")}`, transactiontype: "AddToInventory",
  transactiondate: "2020-01-02T14:00:00Z", performedby: "svc-ams@englobecorp.com", fromlocation: null,
  tolocation: "Ottawa", fromuser: null, touser: null, fromproject: null, toproject: null,
  primaryasset: null, notes: "[SYNTHETIC s=test]", expectedreturn: null,
}));
const BASE_LINES: TransactionLine[] = BASE_ASSETS.map((a, i) => ({
  id: `line-${i}`, transaction: `txn-${i}`, asset: a.assetid, statusbefore: "Available",
  statusafter: "Available", kitrole: null, orientation: null, powersource: null, condition: null,
  processed: true, notes: null,
}));

const MANIFEST = { dataset: "synthetic", seed: "test", profile: "demo", asOf: "2026-09-02", generatedAt: "2026-09-02T00:00:00Z", verified: true, counts: { assets: 200 } };

function stubFetch(withManifest: boolean) {
  const body: Record<string, unknown> = {
    "/data/assets.json": BASE_ASSETS,
    "/data/locations.json": locations,
    "/data/equipment_models.json": models,
    "/data/projects.json": projects,
    "/data/transactions.json": BASE_TRANSACTIONS,
    "/data/transactionlines.json": BASE_LINES,
    "/data/assetrelationships.json": [],
    "/data/calibrationrecords.json": [],
    "/data/idsequence.json": {},
  };
  if (withManifest) body["/data/manifest.json"] = MANIFEST;
  vi.stubGlobal("fetch", async (url: string) => {
    const data = body[url];
    if (data === undefined) return { ok: false, status: 404, json: async () => ({}) };
    // A real fetch().json() parses a fresh object graph every call. Returning the same arrays
    // would let two stores share — and mutate — one dataset, which no browser ever does.
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dataset provenance (feature 007 FR-007/FR-008)", () => {
  it("reports a synthetic dataset with its seed and as-of date", async () => {
    stubFetch(true);
    const backend = new MockAmsBackend(new MockStore());
    const info = await backend.getDatasetInfo();
    expect(info).toMatchObject({ synthetic: true, seed: "test", profile: "demo", asOf: "2026-09-02", verified: true });
  });

  it("treats a dataset with no manifest as real — the safe direction", async () => {
    stubFetch(false);
    const backend = new MockAmsBackend(new MockStore());
    const info = await backend.getDatasetInfo();
    expect(info.synthetic).toBe(false);
    expect(info.seed).toBeUndefined();
  });
});

describe("delta persistence (feature 007 FR-060 / SC-014)", () => {
  it("persists only the user's own writes, not the base dataset", async () => {
    stubFetch(true);
    const store = new MockStore();
    const backend = new MockAmsBackend(store);
    await store.ready;

    const result = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-40000" }], project: "09000001", clientSubmissionId: "delta-1" });
    expect(result.ok).toBe(true);

    const raw = window.localStorage.getItem("ams-mock-store-v2")!;
    expect(raw).not.toBeNull();
    const delta = JSON.parse(raw);
    // one changed asset and one new transaction — not the 200 assets and 200 transactions of the base
    expect(delta.assets).toHaveLength(1);
    expect(delta.assets[0].assetid).toBe("DL-UM-40000");
    expect(delta.transactions).toHaveLength(1);
    expect(delta.transactionLines).toHaveLength(1);
    expect(delta.datasetKey).toContain("synthetic:test:demo");
    // the whole base dataset is nowhere in what we stored
    expect(raw).not.toContain("DL-UM-40001");
    expect(raw.length).toBeLessThan(6000);
  });

  it("a user's transaction survives a reload, and the base dataset is re-read from the files", async () => {
    stubFetch(true);
    const first = new MockStore();
    const backendA = new MockAmsBackend(first);
    await first.ready;
    await backendA.submitCheckout({ lines: [{ assetId: "DL-UM-40007" }], project: "09000001", clientSubmissionId: "delta-2" });

    // a fresh store, as a page reload would build
    const second = new MockStore();
    const backendB = new MockAmsBackend(second);
    await second.ready;

    const reloaded = await backendB.getAsset("DL-UM-40007");
    expect(reloaded?.status).toBe("CheckedOut");
    expect(reloaded?.custodian).toBe("tech@englobecorp.com");
    expect(await backendB.getAssetHistory("DL-UM-40007")).toHaveLength(2); // AddToInventory + Checkout
    expect(second.assets.size).toBe(200); // the base is complete, not just the changed row
    const untouched = await backendB.getAsset("DL-UM-40001");
    expect(untouched?.status).toBe("Available");
  });

  it("discards a delta recorded against a different dataset rather than replaying it", async () => {
    stubFetch(true);
    const synthetic = new MockStore();
    const backendA = new MockAmsBackend(synthetic);
    await synthetic.ready;
    await backendA.submitCheckout({ lines: [{ assetId: "DL-UM-40003" }], project: "09000001", clientSubmissionId: "delta-3" });
    expect(window.localStorage.getItem("ams-mock-store-v2")).not.toBeNull();

    // now the real data is loaded instead (no manifest) — the synthetic delta must not apply
    vi.unstubAllGlobals();
    stubFetch(false);
    const real = new MockStore();
    const backendB = new MockAmsBackend(real);
    await real.ready;
    const asset = await backendB.getAsset("DL-UM-40003");
    expect(asset?.status).toBe("Available");
    expect(await backendB.getAssetHistory("DL-UM-40003")).toHaveLength(1);
    expect(window.localStorage.getItem("ams-mock-store-v2")).toBeNull();
  });

  it("keeps working when localStorage refuses the write", async () => {
    stubFetch(true);
    const store = new MockStore();
    const backend = new MockAmsBackend(store);
    await store.ready;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const result = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-40009" }], project: "09000001", clientSubmissionId: "delta-4" });
    expect(result.ok).toBe(true);
    expect((await backend.getAsset("DL-UM-40009"))?.status).toBe("CheckedOut");
    setItem.mockRestore();
  });
});
