/**
 * The six questions docs/00-brief.md says the system exists to answer, asked over HTTP against
 * the real migrated data. (Question 7 — where an asset was on a past date and what was attached
 * to it — is covered in deployment.test.ts, which is where the dated installation rows are.)
 *
 * Where a figure depends on today's date, the test asserts the API agrees with an independently
 * computed count from the same rows, and pins the value measured on 2026-09-03 as a lower bound
 * rather than an equality: `nextcaldue` values are fixed and today advances, so the overdue count
 * can only grow. A hard-coded 107 would have become a false failure within a month.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, CalibrationCounts, FleetCounts } from "../../app/src/api/types";
import { createTestApp, getJson, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe("acceptance questions (docs/00-brief.md)", () => {
  it("1 — what do we own?", async () => {
    const counts = await getJson<FleetCounts>(t.app, "/api/reports/fleet-counts", "admin");
    expect(counts.total).toBe(1026);
    expect(counts.byOffice.Ottawa).toBeGreaterThan(0);
    expect(Object.keys(counts.byEquipmentType).length).toBeGreaterThan(5);
    expect(counts.temporaryTags).toBe(35); // TMP- tags carried over from the source spreadsheet
    expect(counts.thirdPartyOwned).toBe(2);

    // SC-003: the report and the list must reconcile exactly — one predicate, not two.
    const listed = await getJson<Asset[]>(t.app, "/api/assets", "admin");
    expect(listed).toHaveLength(counts.total);
  });

  it("2 — where is asset X right now?", async () => {
    const a = await getJson<Asset>(t.app, "/api/assets/DL-UM-16984", "admin");
    expect(a.status).toBe("CheckedOut");
    // Honestly unknown, not falsely "at the Sudbury office" — Principle I.
    expect(a.currentlocation).toBeNull();
    expect(a.homeoffice).toBe("Sudbury");
  });

  it("3 — who has asset X?", async () => {
    const a = await getJson<Asset>(t.app, "/api/assets/DL-UM-16984", "admin");
    expect(a.custodian).toBe("James Ross");
  });

  it("4 — what is available at office Y?", async () => {
    const ottawa = await getJson<Asset[]>(t.app, "/api/assets?office=Ottawa&status=Available", "admin");
    expect(ottawa).toHaveLength(49);
    expect(ottawa.every((a) => a.status === "Available")).toBe(true);

    const all = await getJson<Asset[]>(t.app, "/api/assets?status=Available", "admin");
    expect(all).toHaveLength(375);

    const counts = await getJson<FleetCounts>(t.app, "/api/reports/fleet-counts?office=Ottawa&status=Available", "admin");
    expect(counts.total).toBe(ottawa.length); // SC-003 again, with a filter
  });

  it("5 — what needs calibration in the next 30 days?", async () => {
    const counts = await getJson<CalibrationCounts>(t.app, "/api/reports/calibration-counts?horizonDays=30", "admin");
    const overdue = Object.values(counts.byOffice).reduce((n, b) => n + b.overdue, 0);
    const dueSoon = Object.values(counts.byOffice).reduce((n, b) => n + b.dueSoon, 0);

    // Independently computed from the same rows: no model catalogue join is needed for the
    // overdue bucket, because an asset with a nextcaldue is calibrated by definition.
    const expected = await t.db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM asset
        WHERE lifecycle <> 'Retired' AND status <> 'InCalibration'
          AND nextcaldue IS NOT NULL AND nextcaldue < to_char(now(), 'YYYY-MM-DD')`
    );
    expect(overdue).toBe(expected.rows[0].c);
    expect(overdue).toBeGreaterThanOrEqual(107); // 107 measured 2026-09-03; can only grow
    expect(overdue + dueSoon).toBe(109); // the 109 assets with a known next-due date

    // FR-003: assets whose next-due date is unknown are counted, never omitted.
    const unknown = Object.values(counts.byOffice).reduce((n, b) => n + b.unknown, 0);
    expect(unknown).toBe(608);

    const due = await getJson<Asset[]>(t.app, "/api/calibration/due?horizonDays=30", "admin");
    expect(due.length).toBe(overdue + dueSoon + unknown);
  });

  it("6 — what is assigned to project Z?", async () => {
    const assigned = await getJson<Asset[]>(t.app, "/api/assets?project=01937805", "admin");
    expect(assigned.map((a) => a.assetid).sort()).toEqual([
      "DL-UM-15387",
      "DL-UM-15713",
      "DL-UM-16842",
      "DL-UM-16956",
      "DL-UM-16984",
      "DL-UM-21947",
    ]);
  });
});

describe("Principle III — the tag is not the key", () => {
  it("keeps DL-UM-16984 and GEO-UM-16984 as two distinct assets sharing one serial", async () => {
    const found = await getJson<Asset[]>(t.app, "/api/assets?query=16984", "admin");
    const ids = found.map((a) => a.assetid);
    expect(ids).toContain("DL-UM-16984");
    expect(ids).toContain("GEO-UM-16984");

    const logger = found.find((a) => a.assetid === "DL-UM-16984")!;
    const geophone = found.find((a) => a.assetid === "GEO-UM-16984")!;
    expect(logger.serialnumber).toBe(geophone.serialnumber);
    expect(logger.id).not.toBe(geophone.id); // different rows, different primary keys
    expect(logger.equipmentmodel.equipmenttype).toBe("DataLogger");
    expect(geophone.equipmentmodel.equipmenttype).toBe("Geophone");
    expect(geophone.status).toBe("Available");
    expect(geophone.homeoffice).toBe("Toronto");
  });
});

describe("dataset provenance (feature 007 FR-007)", () => {
  it("reports the real migrated data as not synthetic", async () => {
    const dataset = await getJson<{ synthetic: boolean }>(t.app, "/api/dataset", "field");
    expect(dataset.synthetic).toBe(false);
  });
});
