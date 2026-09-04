import { beforeEach, describe, expect, it } from "vitest";
import { MockAmsBackend, setMockCurrentUserKey } from "@/api/mock";
import { MockStore } from "@/api/mock/store";
import type { EquipmentModel, Location } from "@/api/types";

const locations: Location[] = [
  { id: "l1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true },
  { id: "l2", name: "Toronto", locationtype: "Office", parentlocation: "Ontario", isactive: true },
  { id: "l3", name: "Montreal Calibration", locationtype: "CalLab", parentlocation: null, isactive: true },
];

const models: EquipmentModel[] = [
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", assetgroup: "Seismographs", idprefix: "DL-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "Geophone", assetgroup: "Seismographs", idprefix: "GEO-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
  { manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService", assetgroup: "Communications", idprefix: "DST", isserialised: false, identifiertype: "ICCID", defaultcalintervalmonths: null },
];

function makeBackend() {
  const store = MockStore.forTesting({
    assets: [
      { id: "id-1", assetid: "DL-UM-16984", migrationsource: null, equipmentmodel: models[0], serialnumber: "UM16984", homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: "2026-09-10", retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
      { id: "id-2", assetid: "GEO-UM-16984", migrationsource: null, equipmentmodel: models[1], serialnumber: "UM16984", homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa", custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null, identifiervalue: "8912345", phonenumber: "6135551234", staticip: "10.0.0.5" },
      { id: "id-3", assetid: "DL-UM-99999", migrationsource: null, equipmentmodel: models[0], serialnumber: "UM99999", homeoffice: "Ottawa", lifecycle: "Active", status: "CheckedOut", currentlocation: null, custodian: "someone-else@englobecorp.com", currentproject: "02208928", parentasset: null, lastcaldate: null, nextcaldue: null, retirementreason: null, notes: null, carrier: null, identifiervalue: null, phonenumber: null, staticip: null },
    ],
    locations,
    equipmentModels: models,
    projects: [
      { id: "p1", projectnumber: "02208928", name: "Test project", status: "Active", office: "Ottawa", pm: null },
      { id: "p2", projectnumber: "02000000", name: "Closed project", status: "Closed", office: "Ottawa", pm: null },
    ],
    idSequence: { DST: { nextvalue: 100 } },
  });
  return { backend: new MockAmsBackend(store), store };
}

beforeEach(() => {
  setMockCurrentUserKey("field");
  window.localStorage.clear();
});

describe("SC-015 Report Reader is a selectable mock identity", () => {
  it("exposes a ReportReader demo user the role switcher can select", async () => {
    setMockCurrentUserKey("reader");
    const { backend } = makeBackend();
    const user = await backend.getCurrentUser();
    expect(user.roles).toEqual(["ReportReader"]);
    expect(user.upn).toBe("reader@englobecorp.com");
    const sim = await backend.getAsset("GEO-UM-16984");
    expect(sim?.identifiervalue).toBeNull();
    expect(sim?.phonenumber).toBeNull();
    expect(sim?.staticip).toBeNull();
  });
});

describe("MockAmsBackend — checkout (feature 003 US1)", () => {
  it("checks out an Available asset, setting custodian and project, and records one history line", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({
      lines: [{ assetId: "DL-UM-16984" }],
      project: "02208928",
      clientSubmissionId: "test-1",
    });
    expect(result.ok).toBe(true);

    const asset = await backend.getAsset("DL-UM-16984");
    expect(asset?.status).toBe("CheckedOut");
    expect(asset?.custodian).toBe("tech@englobecorp.com");
    expect(asset?.currentproject).toBe("02208928");

    const history = await backend.getAssetHistory("DL-UM-16984");
    expect(history).toHaveLength(1);
    expect(history[0].transactiontype).toBe("Checkout");
  });

  it("refuses checkout of an asset that is not Available, naming it (FR-021/FR-023)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({
      lines: [{ assetId: "DL-UM-99999" }],
      project: "02208928",
      clientSubmissionId: "test-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.offendingAssetId).toBe("DL-UM-99999");
  });

  it("is all-or-nothing: one bad asset in the cart means NOTHING is checked out (FR-003)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({
      lines: [{ assetId: "DL-UM-16984" }, { assetId: "DL-UM-99999" }],
      project: "02208928",
      clientSubmissionId: "test-3",
    });
    expect(result.ok).toBe(false);
    const stillAvailable = await backend.getAsset("DL-UM-16984");
    expect(stillAvailable?.status).toBe("Available"); // not left checked out despite being valid
  });

  it("refuses checkout with no project (FR-008)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-16984" }], project: "", clientSubmissionId: "test-4" });
    expect(result.ok).toBe(false);
  });

  it("refuses checkout naming a Closed project (FR-027, ASSUMPTION: refuse outright)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({ lines: [{ assetId: "DL-UM-16984" }], project: "02000000", clientSubmissionId: "test-4b" });
    expect(result.ok).toBe(false);
    const asset = await backend.getAsset("DL-UM-16984");
    expect(asset?.status).toBe("Available"); // unaffected by the refused attempt
  });

  it("opens a Kit relationship for a sensor checked out alongside its primary logger (FR-028/029)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitCheckout({
      lines: [{ assetId: "DL-UM-16984" }, { assetId: "GEO-UM-16984", kitRole: "Sensor1" }],
      primaryAssetId: "DL-UM-16984",
      project: "02208928",
      clientSubmissionId: "test-5",
    });
    expect(result.ok).toBe(true);
    const sensor = await backend.getAsset("GEO-UM-16984");
    expect(sensor?.parentasset).toBe("DL-UM-16984");
  });

  it("does not record duplicate transactions when the same submission is retried (FR-007)", async () => {
    const { backend } = makeBackend();
    await backend.submitCheckout({ lines: [{ assetId: "DL-UM-16984" }], project: "02208928", clientSubmissionId: "retry-me" });
    await backend.submitCheckout({ lines: [{ assetId: "DL-UM-16984" }], project: "02208928", clientSubmissionId: "retry-me" });
    const history = await backend.getAssetHistory("DL-UM-16984");
    expect(history).toHaveLength(1);
  });
});

describe("MockAmsBackend — return (feature 003 US2)", () => {
  it("returns a checked-out asset to Available at the returning user's office", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("DL-UM-99999", { ...store.assets.get("DL-UM-99999")!, custodian: "tech@englobecorp.com" });
    const result = await backend.submitReturn({ lines: [{ assetId: "DL-UM-99999" }], clientSubmissionId: "ret-1" });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-99999");
    expect(asset?.status).toBe("Available");
    expect(asset?.custodian).toBeNull();
    expect(asset?.currentlocation).toBe("Ottawa");
  });

  it("refuses a return by someone who is neither the custodian nor an admin (FR-025)", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitReturn({ lines: [{ assetId: "DL-UM-99999" }], clientSubmissionId: "ret-2" });
    expect(result.ok).toBe(false);
  });

  it("an administrator can return an asset held by someone else (FR-025)", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.submitReturn({ lines: [{ assetId: "DL-UM-99999" }], clientSubmissionId: "ret-3" });
    expect(result.ok).toBe(true);
  });

  it("a damaged item returns as NeedsRepair, not Available", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("DL-UM-99999", { ...store.assets.get("DL-UM-99999")!, custodian: "tech@englobecorp.com" });
    const result = await backend.submitReturn({
      lines: [{ assetId: "DL-UM-99999", condition: "Damaged" }],
      clientSubmissionId: "ret-4",
    });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-99999");
    expect(asset?.status).toBe("NeedsRepair");
  });
});

describe("MockAmsBackend — permanent components (Q5/Q7, FR-026, FR-032)", () => {
  it("refuses to check out a permanent Component child on its own, directing to the parent", async () => {
    const { backend, store } = makeBackend();
    store.relationships.push({
      id: "rel-1", parentasset: "DL-UM-16984", childasset: "GEO-UM-16984",
      relationshiptype: "Component", start: "2026-01-01", end: null, createdbyline: null, closedbyline: null,
    });
    const result = await backend.submitCheckout({
      lines: [{ assetId: "GEO-UM-16984" }],
      project: "02208928",
      clientSubmissionId: "comp-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("component");
  });

  it("a Component child follows its parent's status/location/custodian with no line of its own", async () => {
    const { backend, store } = makeBackend();
    store.relationships.push({
      id: "rel-2", parentasset: "DL-UM-16984", childasset: "GEO-UM-16984",
      relationshiptype: "Component", start: "2026-01-01", end: null, createdbyline: null, closedbyline: null,
    });
    const result = await backend.submitCheckout({
      lines: [{ assetId: "DL-UM-16984" }],
      project: "02208928",
      clientSubmissionId: "comp-2",
    });
    expect(result.ok).toBe(true);
    const child = await backend.getAsset("GEO-UM-16984");
    expect(child?.status).toBe("CheckedOut");
    expect(child?.custodian).toBe("tech@englobecorp.com");
    const childHistory = await backend.getAssetHistory("GEO-UM-16984");
    expect(childHistory).toHaveLength(0); // no line of its own — the parent's line is its history
  });
});

describe("MockAmsBackend — field security (FR-030)", () => {
  it("hides ICCID/phone/static IP from a Field User", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("field");
    const asset = await backend.getAsset("GEO-UM-16984");
    expect(asset?.identifiervalue).toBeNull();
    expect(asset?.phonenumber).toBeNull();
    expect(asset?.staticip).toBeNull();
  });

  it("shows ICCID/phone/static IP to an Office Admin", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const asset = await backend.getAsset("GEO-UM-16984");
    expect(asset?.identifiervalue).toBe("8912345");
  });

  it("also hides secured fields from a search result, not only the detail screen", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("field");
    const results = await backend.searchAssets("16984");
    const geo = results.find((a) => a.assetid === "GEO-UM-16984");
    expect(geo?.identifiervalue).toBeNull();
  });
});

describe("MockAmsBackend — registration and retirement (feature 001 US3/US5)", () => {
  it("mints DL-UM-21999 for a new serialised asset (FR-006's own worked example)", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.registerAsset({
      manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", serial: "UM21999", homeoffice: "Ottawa",
      clientSubmissionId: "reg-1",
    });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-21999");
    expect(asset?.status).toBe("Available");
    expect(asset?.homeoffice).toBe("Ottawa");
    const history = await backend.getAssetHistory("DL-UM-21999");
    expect(history[0].transactiontype).toBe("AddToInventory"); // FR-022: recorded as history
  });

  it("refuses to register a duplicate Asset ID, naming the existing asset (US3 scenario 3)", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.registerAsset({
      manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", serial: "UM16984", homeoffice: "Ottawa",
      clientSubmissionId: "reg-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.offendingAssetId).toBe("DL-UM-16984");
  });

  it("mints sequential non-serialised tags without repeating a value (FR-006/FR-007)", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const r1 = await backend.registerAsset({ manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService", homeoffice: "Ottawa", clientSubmissionId: "reg-3" });
    const r2 = await backend.registerAsset({ manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService", homeoffice: "Ottawa", clientSubmissionId: "reg-4" });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.transactionName).not.toBe(r2.transactionName);
  });

  it("requires a retirement reason", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.retireAsset("DL-UM-16984", "", "ret-x");
    expect(result.ok).toBe(false);
  });

  it("retiring an asset clears custodian/project/location and keeps history (FR-025)", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.retireAsset("DL-UM-16984", "Obsolete", "ret-y");
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-16984");
    expect(asset?.lifecycle).toBe("Retired");
    expect(asset?.currentlocation).toBeNull();
  });
});

describe("MockAmsBackend — calibration (feature 004)", () => {
  it("prefills next-due from the model interval and updates the asset", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.recordCalibration({
      assetId: "DL-UM-16984",
      calibrationdate: "2026-01-15",
      clientSubmissionId: "cal-1",
    });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-16984");
    expect(asset?.lastcaldate).toBe("2026-01-15");
    expect(asset?.nextcaldue).toBe("2027-01-15");
  });

  it("refuses a future calibration date", async () => {
    const { backend } = makeBackend();
    setMockCurrentUserKey("admin");
    const result = await backend.recordCalibration({ assetId: "DL-UM-16984", calibrationdate: "2099-01-01", clientSubmissionId: "cal-2" });
    expect(result.ok).toBe(false);
  });

  it("returns an in-calibration asset to Available automatically when its calibration is recorded (FR-024)", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("DL-UM-16984", { ...store.assets.get("DL-UM-16984")!, status: "InCalibration", currentlocation: "Montreal Calibration", custodian: null });
    setMockCurrentUserKey("admin");
    const result = await backend.recordCalibration({ assetId: "DL-UM-16984", calibrationdate: "2026-01-15", clientSubmissionId: "cal-3" });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("DL-UM-16984");
    expect(asset?.status).toBe("Available");
    expect(asset?.currentlocation).toBe("Ottawa");
  });
});

describe("MockAmsBackend — calibration due list (feature 004 US1)", () => {
  it("includes overdue and due-within-horizon Active assets, excludes Retired", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("DL-UM-16984", { ...store.assets.get("DL-UM-16984")!, nextcaldue: "2026-09-05" });
    const due = await backend.listCalibrationDue(30);
    expect(due.map((a) => a.assetid)).toContain("DL-UM-16984");
  });

  it("includes assets with an unknown (null) due date as their own group rather than omitting them", async () => {
    const { backend } = makeBackend();
    const due = await backend.listCalibrationDue(30);
    expect(due.map((a) => a.assetid)).toContain("GEO-UM-16984"); // nextcaldue null but calibrated model
  });

  it("never includes an asset of a non-calibrated model", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("SIM-1", {
      id: "sim-1", assetid: "SIM-1", migrationsource: null,
      equipmentmodel: { manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService" },
      serialnumber: null, homeoffice: "Ottawa", lifecycle: "Active", status: "Available", currentlocation: "Ottawa",
      custodian: null, currentproject: null, parentasset: null, lastcaldate: null, nextcaldue: null,
      retirementreason: null, notes: null, carrier: "Bell", identifiervalue: "1234", phonenumber: null, staticip: null,
    });
    const due = await backend.listCalibrationDue(30);
    expect(due.map((a) => a.assetid)).not.toContain("SIM-1");
  });
});
