/**
 * Feature 001 registration (asset-ID minting against the id_sequence table) and feature 004
 * calibration, over HTTP.
 *
 * The minting case is feature 001 FR-006's own worked example, reproduced against the real
 * catalogue: serial `UM21999` on an *Instantel Micromate (DataLogger)* must mint `DL-UM-21999`,
 * not `DL-UM-UM21999` — the embedded manufacturer code is stripped once, and the bug that once
 * produced the double prefix is what domain/assetId.ts's regression test exists for.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, CalibrationRecord, HistoryEntry } from "../../app/src/api/types";
import { createTestApp, get, getJson, newSubmissionId, submit, type TestApp } from "./helpers";

let t: TestApp;

const MICROMATE = { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger" };
const AIRTAG = { manufacturer: "Apple", model: "AirTag", equipmenttype: "AssetTracker" }; // non-serialised, no cal interval
const LAB = "Montreal Calibration";
const TO_LAB = "DL-MP-13332"; // Available at Ottawa

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

function asset(assetId: string): Promise<Asset> {
  return getJson<Asset>(t.app, `/api/assets/${assetId}`, "admin");
}

describe("asset ID minting", () => {
  it("previews DL-UM-21999 for serial UM21999 on an Instantel Micromate (DataLogger)", async () => {
    const res = await get(
      t.app,
      `/api/assets/next-id?manufacturer=Instantel&model=Micromate&equipmenttype=DataLogger&serial=UM21999`,
      "admin"
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().assetId).toBe("DL-UM-21999");
  });

  it("refuses to preview a model that is not in the catalogue", async () => {
    const res = await get(
      t.app,
      "/api/assets/next-id?manufacturer=Acme&model=Rocket&equipmenttype=DataLogger&serial=1",
      "admin"
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("pick one from the catalogue");
  });

  it("registers the asset at that tag, Available at its home office, with an AddToInventory line", async () => {
    const outcome = await submit(
      t.app,
      "/api/assets",
      { ...MICROMATE, serial: "UM21999", homeoffice: "Ottawa", clientSubmissionId: newSubmissionId("register") },
      "admin"
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The screen shows transactionName, and for a registration the useful value is the new tag.
    expect(outcome.transactionName).toBe("DL-UM-21999");

    const created = await asset("DL-UM-21999");
    expect(created.status).toBe("Available");
    expect(created.lifecycle).toBe("Active");
    expect(created.currentlocation).toBe("Ottawa");
    expect(created.serialnumber).toBe("UM21999");
    expect(created.equipmentmodel).toEqual(MICROMATE);

    const lines = await getJson<HistoryEntry[]>(t.app, "/api/assets/DL-UM-21999/history", "admin");
    expect(lines).toHaveLength(1);
    expect(lines[0].transactiontype).toBe("AddToInventory");
    expect(lines[0].statusafter).toBe("Available");
  });

  it("refuses a second registration at the same tag", async () => {
    const outcome = await submit(
      t.app,
      "/api/assets",
      { ...MICROMATE, serial: "UM21999", homeoffice: "Ottawa", clientSubmissionId: newSubmissionId("register-again") },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.offendingAssetId).toBe("DL-UM-21999");
    expect(outcome.reason).toContain("already exists");
  });

  it("refuses a model that is not in the catalogue (Principle IV)", async () => {
    const outcome = await submit(
      t.app,
      "/api/assets",
      {
        manufacturer: "Acme",
        model: "Rocket",
        equipmenttype: "DataLogger",
        serial: "1",
        homeoffice: "Ottawa",
        clientSubmissionId: newSubmissionId("register-freetext"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("free-text models are not permitted");
  });

  it("issues each non-serialised registration its own sequence value (FR-007)", async () => {
    const before = await getJson<{ assetId: string }>(
      t.app,
      "/api/assets/next-id?manufacturer=Apple&model=AirTag&equipmenttype=AssetTracker",
      "admin"
    );
    expect(before.assetId).toBe("AT-0009"); // idsequence.json says AT is at 9

    const first = await submit(
      t.app,
      "/api/assets",
      { ...AIRTAG, homeoffice: "Ottawa", clientSubmissionId: newSubmissionId("airtag") },
      "admin"
    );
    const second = await submit(
      t.app,
      "/api/assets",
      { ...AIRTAG, homeoffice: "Toronto", clientSubmissionId: newSubmissionId("airtag") },
      "admin"
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.transactionName).toBe("AT-0009");
    expect(second.transactionName).toBe("AT-0010");
  });
});

describe("calibration", () => {
  it("computes next-due from the model's interval (FR-009)", async () => {
    const outcome = await submit(
      t.app,
      "/api/calibrations",
      {
        assetId: "DL-UM-21999",
        calibrationdate: "2026-08-01",
        lab: LAB,
        result: "Pass",
        clientSubmissionId: newSubmissionId("cal"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);

    const calibrated = await asset("DL-UM-21999");
    expect(calibrated.lastcaldate).toBe("2026-08-01");
    expect(calibrated.nextcaldue).toBe("2027-08-01"); // 12-month interval on the Micromate

    const records = await getJson<CalibrationRecord[]>(t.app, "/api/assets/DL-UM-21999/calibrations", "admin");
    expect(records).toHaveLength(1);
    expect(records[0].lab).toBe(LAB);
    expect(records[0].result).toBe("Pass");
  });

  it("refuses a calibration date in the future (FR-011)", async () => {
    const outcome = await submit(
      t.app,
      "/api/calibrations",
      { assetId: "DL-UM-21999", calibrationdate: "2099-01-01", clientSubmissionId: newSubmissionId("cal-future") },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("Calibration date cannot be in the future.");
  });

  it("requires a next-due date for a model with no interval (FR-010)", async () => {
    const outcome = await submit(
      t.app,
      "/api/calibrations",
      { assetId: "AT-0009", calibrationdate: "2026-08-01", clientSubmissionId: newSubmissionId("cal-nointerval") },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("a next-due date is required");
  });

  it("flags a second record on the same date rather than rejecting it", async () => {
    const outcome = await submit(
      t.app,
      "/api/calibrations",
      { assetId: "DL-UM-21999", calibrationdate: "2026-08-01", clientSubmissionId: newSubmissionId("cal-dup") },
      "admin"
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.transactionName).toContain("duplicate date flagged");
  });

  it("sends an asset to the lab and brings it back through a transaction, never a status edit (F2)", async () => {
    const sent = await submit(
      t.app,
      "/api/commands/SendToCalibration",
      { assetIds: [TO_LAB], lab: LAB, clientSubmissionId: newSubmissionId("tolab") },
      "admin"
    );
    expect(sent.ok).toBe(true);
    const atLab = await asset(TO_LAB);
    expect(atLab.status).toBe("InCalibration");
    expect(atLab.currentlocation).toBe(LAB);
    expect(atLab.custodian).toBeNull();

    const recorded = await submit(
      t.app,
      "/api/calibrations",
      {
        assetId: TO_LAB,
        calibrationdate: "2026-08-15",
        lab: LAB,
        result: "Pass",
        clientSubmissionId: newSubmissionId("cal-return"),
      },
      "admin"
    );
    expect(recorded.ok).toBe(true);

    const back = await asset(TO_LAB);
    expect(back.status).toBe("Available");
    expect(back.currentlocation).toBe("Ottawa"); // its home office
    const types = (await getJson<HistoryEntry[]>(t.app, `/api/assets/${TO_LAB}/history`, "admin")).map(
      (l) => l.transactiontype
    );
    expect(types).toContain("SendToCalibration");
    expect(types).toContain("ReturnFromCalibration");
  });
});
