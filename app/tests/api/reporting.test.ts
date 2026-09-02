import { beforeEach, describe, expect, it } from "vitest";
import { MockAmsBackend, setMockCurrentUserKey } from "@/api/mock";
import { MockStore } from "@/api/mock/store";
import type { EquipmentModel, Location } from "@/api/types";

const locations: Location[] = [
  { id: "l1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true },
  { id: "l2", name: "Toronto", locationtype: "Office", parentlocation: "Ontario", isactive: true },
];

const dataLogger: EquipmentModel = { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", assetgroup: "Seismographs", idprefix: "DL-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 };
const geophone: EquipmentModel = { manufacturer: "Instantel", model: "Micromate", equipmenttype: "Geophone", assetgroup: "Seismographs", idprefix: "GEO-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 };
const simCard: EquipmentModel = { manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService", assetgroup: "Communications", idprefix: "DST", isserialised: false, identifiertype: "ICCID", defaultcalintervalmonths: null };

function makeBackend() {
  const store = MockStore.forTesting({
    assets: [
      // Ottawa, Available, DataLogger — fully catalogued, calibration overdue
      { id: "id-1", assetid: "DL-UM-16984", migrationsource: null, equipmentmodel: dataLogger, serialnumber: "UM16984", homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null, lastcaldate: "2025-01-01", nextcaldue: "2025-06-01", retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // Ottawa, CheckedOut with a known custodian — NOT part of the unknown-custodian sweep
      { id: "id-2", assetid: "GEO-UM-16984", migrationsource: null, equipmentmodel: geophone, serialnumber: "UM16984", homeoffice: "Ottawa", lifecycle: "Active", status: "CheckedOut", currentlocation: null, custodian: "tech@englobecorp.com", currentproject: "02208928", parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // Toronto, CheckedOut, no custodian — the Q3 sweep pattern (FR-010)
      { id: "id-3", assetid: "DL-UM-99999", migrationsource: null, equipmentmodel: dataLogger, serialnumber: "UM99999", homeoffice: "Toronto", lifecycle: "Active", status: "CheckedOut", currentlocation: null, custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // Toronto, temporary tag (FR-011)
      { id: "id-4", assetid: "TMP-0001", migrationsource: null, equipmentmodel: simCard, serialnumber: null, homeoffice: "Toronto", lifecycle: "Active", status: "Available", currentlocation: "Toronto", custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: "Bell", identifiervalue: null, phonenumber: null, staticip: null },
      // Ottawa, third-party owned (FR-012) — still Available, still counted in totals
      { id: "id-5", assetid: "TS-014", migrationsource: null, equipmentmodel: dataLogger, serialnumber: "TS014", homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: "Owned by Vanmar Construction Inc.", carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // Retired — excluded from current counts by default (FR-029)
      { id: "id-6", assetid: "DL-UM-00001", migrationsource: null, equipmentmodel: dataLogger, serialnumber: "00001", homeoffice: "Ottawa", lifecycle: "Retired", status: "Retired", currentlocation: null, custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: "Obsolete", notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // In calibration right now — its own bucket, not overdue/due-soon
      { id: "id-7", assetid: "DL-UM-77777", migrationsource: null, equipmentmodel: dataLogger, serialnumber: "77777", homeoffice: "Ottawa", lifecycle: "Active", status: "InCalibration", currentlocation: "Montreal Calibration", custodian: null, currentproject: null, parentasset: null, lastcaldate: "2026-08-01", nextcaldue: "2027-08-01", retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      // Unknown calibration status (FR-017)
      { id: "id-8", assetid: "GEO-UM-88888", migrationsource: null, equipmentmodel: geophone, serialnumber: "88888", homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
    ],
    locations,
    equipmentModels: [dataLogger, geophone, simCard],
    projects: [{ id: "p1", projectnumber: "02208928", name: "Test project", status: "Active", office: "Ottawa", pm: null }],
  });
  return { backend: new MockAmsBackend(store), store };
}

beforeEach(() => {
  setMockCurrentUserKey("admin");
  window.localStorage.clear();
});

describe("getFleetCounts — reconciliation with listAssets (SC-003, T015)", () => {
  it("total reconciles exactly with listAssets() with no filter", async () => {
    const { backend } = makeBackend();
    const [counts, assets] = await Promise.all([backend.getFleetCounts(), backend.listAssets()]);
    expect(counts.total).toBe(assets.length);
  });

  it("total reconciles exactly with listAssets(filter) for an office filter", async () => {
    const { backend } = makeBackend();
    const filter = { office: "Ottawa" };
    const [counts, assets] = await Promise.all([backend.getFleetCounts(filter), backend.listAssets(filter)]);
    expect(counts.total).toBe(assets.length);
  });

  it("total reconciles exactly with listAssets(filter) for a status filter", async () => {
    const { backend } = makeBackend();
    const filter = { status: ["CheckedOut"] };
    const [counts, assets] = await Promise.all([backend.getFleetCounts(filter), backend.listAssets(filter)]);
    expect(counts.total).toBe(assets.length);
  });

  it("total reconciles exactly with listAssets({ includeRetired: true })", async () => {
    const { backend } = makeBackend();
    const filter = { includeRetired: true };
    const [counts, assets] = await Promise.all([backend.getFleetCounts(filter), backend.listAssets(filter)]);
    expect(counts.total).toBe(assets.length);
  });

  it("breakdowns sum to the same total (by office, by asset group, by equipment type)", async () => {
    const { backend } = makeBackend();
    const counts = await backend.getFleetCounts();
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(counts.byOffice)).toBe(counts.total);
    expect(sum(counts.byAssetGroup)).toBe(counts.total);
    expect(sum(counts.byEquipmentType)).toBe(counts.total);
  });
});

describe("getFleetCounts — FR-010/FR-011/FR-012", () => {
  it("does not conflate an unknown-custodian CheckedOut asset with one held by a known person", async () => {
    const { backend } = makeBackend();
    const assets = await backend.listAssets({ status: ["CheckedOut"] });
    const unknownCustodian = assets.filter((a) => !a.custodian);
    expect(unknownCustodian.map((a) => a.assetid)).toEqual(["DL-UM-99999"]);
    expect(assets.find((a) => a.assetid === "GEO-UM-16984")?.custodian).toBe("tech@englobecorp.com");
  });

  it("counts temporary tags separately, without excluding them from the total (FR-011)", async () => {
    const { backend } = makeBackend();
    const counts = await backend.getFleetCounts();
    expect(counts.temporaryTags).toBe(1); // TMP-0001
    expect(counts.total).toBeGreaterThan(counts.temporaryTags);
  });

  it("marks third-party-owned assets without excluding them from the total (FR-012)", async () => {
    const { backend } = makeBackend();
    const counts = await backend.getFleetCounts();
    expect(counts.thirdPartyOwned).toBe(1); // TS-014, "Owned by Vanmar Construction Inc."
    const assets = await backend.listAssets();
    expect(counts.total).toBe(assets.length); // marking, not excluding — SC-003 still holds
  });
});

describe("getCalibrationCounts — FR-013/FR-015/FR-017", () => {
  it("buckets in-calibration, overdue, and unknown explicitly, never omitting any", async () => {
    const { backend, store } = makeBackend();
    void store;
    const counts = await backend.getCalibrationCounts(30);
    const ottawa = counts.byOffice["Ottawa"];
    expect(ottawa.inCalibration).toBe(1); // DL-UM-77777
    expect(ottawa.overdue).toBe(1); // DL-UM-16984, nextcaldue 2025-06-01
    expect(ottawa.unknown).toBe(3); // GEO-UM-16984, TS-014, GEO-UM-88888 — all calibrated models, no nextcaldue recorded
  });

  it("excludes retired assets from current calibration counts (FR-029)", async () => {
    const { backend } = makeBackend();
    const counts = await backend.getCalibrationCounts(30);
    const totalCounted = Object.values(counts.byOffice).reduce((sum, o) => sum + o.inCalibration + o.dueSoon + o.overdue + o.unknown, 0);
    // 6 calibration-tracked assets: DL-UM-16984 (overdue), GEO-UM-16984 (unknown), DL-UM-99999
    // (unknown), TS-014 (unknown), DL-UM-77777 (inCalibration), GEO-UM-88888 (unknown) — every
    // DataLogger/Geophone asset is tracked; TMP-0001 (a SIM, no interval) and the retired asset
    // are never counted at all.
    expect(totalCounted).toBe(6);
  });

  it("never tracks a model with no calibration interval and no history (SIM cards)", async () => {
    const { backend } = makeBackend();
    const counts = await backend.getCalibrationCounts(30);
    const toronto = counts.byOffice["Toronto"];
    // Toronto holds DL-UM-99999 (tracked, unknown) and TMP-0001 (a SIM — never tracked)
    expect(toronto.unknown + toronto.overdue + toronto.dueSoon + toronto.inCalibration).toBe(1);
  });

  it("states the data's currency via asOf", async () => {
    const { backend } = makeBackend();
    const before = Date.now();
    const counts = await backend.getCalibrationCounts(30);
    expect(new Date(counts.asOf).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
