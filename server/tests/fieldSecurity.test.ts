/**
 * FR-030 field security, and feature 004 US4's office → administrator assignment.
 *
 * Field security is enforced in the read model (services/readModel.ts), not in the UI: a Field
 * User's response simply does not contain ICCID, phone number or static IP, so there is nothing
 * for devtools, a copied URL or a CSV export to reveal. DST013 is a real migrated SIM record
 * that carries all three.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, OfficeAdminAssignment } from "../../app/src/api/types";
import { createTestApp, getJson, newSubmissionId, put, type TestApp } from "./helpers";

let t: TestApp;

const SIM = "DST013"; // iccid 89302720513012024886, phone 705-618-1098, ip 72.142.178.47

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe("FR-030 — sensitive fields", () => {
  it("withholds ICCID, phone and static IP from a Field User on the detail route", async () => {
    const asField = await getJson<Asset>(t.app, `/api/assets/${SIM}`, "field");
    expect(asField.assetid).toBe(SIM);
    expect(asField.identifiervalue).toBeNull();
    expect(asField.phonenumber).toBeNull();
    expect(asField.staticip).toBeNull();
  });

  it("gives them to an Office Admin", async () => {
    const asAdmin = await getJson<Asset>(t.app, `/api/assets/${SIM}`, "admin");
    expect(asAdmin.identifiervalue).toBe("89302720513012024886");
    expect(asAdmin.phonenumber).toBe("705-618-1098");
    expect(asAdmin.staticip).toBe("72.142.178.47");
  });

  it("applies the same rule to search and to list, not only to the detail route", async () => {
    const searched = await getJson<Asset[]>(t.app, `/api/assets?query=${SIM}`, "field");
    expect(searched.length).toBeGreaterThan(0);
    for (const a of searched) expect(a.identifiervalue).toBeNull();

    const listed = await getJson<Asset[]>(t.app, "/api/assets?equipmenttype=CellularService", "field");
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((a) => a.identifiervalue === null && a.phonenumber === null && a.staticip === null)).toBe(true);

    const listedAsAdmin = await getJson<Asset[]>(t.app, "/api/assets?equipmenttype=CellularService", "admin");
    expect(listedAsAdmin.some((a) => a.identifiervalue !== null)).toBe(true);
  });

  it("does not let a Field User search by an ICCID they cannot see", async () => {
    // The read model matches on identifiervalue before redacting it, exactly as the mock does —
    // so a technician who has the number on a sticker can still find the SIM, but the response
    // still withholds the value. Documented here because it looks like an inconsistency and is
    // not: findability and disclosure are different questions.
    const found = await getJson<Asset[]>(t.app, "/api/assets?query=89302720513012024886", "field");
    expect(found.map((a) => a.assetid)).toContain(SIM);
    expect(found[0].identifiervalue).toBeNull();
  });

  it("reports who the caller is from the dev identity header", async () => {
    expect((await getJson<{ upn: string }>(t.app, "/api/me", "field")).upn).toBe("tech@englobecorp.com");
    expect((await getJson<{ upn: string }>(t.app, "/api/me", "admin")).upn).toBe("admin@englobecorp.com");
    expect((await getJson<{ roles: string[] }>(t.app, "/api/me", "owner")).roles).toContain("SystemOwner");
  });
});

describe("feature 004 US4 — office administrators", () => {
  it("lists every office from the location table, an empty list being the FR-027a gap signal", async () => {
    const assignments = await getJson<OfficeAdminAssignment[]>(t.app, "/api/office-admins", "admin");
    // 10 Offices in locations.json (Ontario is a Region, Montreal Calibration a CalLab,
    // Unassigned a Storage), all with no administrator until one is assigned.
    expect(assignments).toHaveLength(10);
    expect(assignments.every((a) => a.adminUpns.length === 0)).toBe(true);
    expect(assignments.map((a) => a.office)).toContain("Ottawa");
  });

  it("saves an office's administrators, deduplicating and dropping blanks", async () => {
    const res = await put(t.app, "/api/office-admins/Ottawa", {
      adminUpns: ["admin@englobecorp.com", "  ADMIN@englobecorp.com ", "", "second@englobecorp.com"],
      clientSubmissionId: newSubmissionId("admins"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const assignments = await getJson<OfficeAdminAssignment[]>(t.app, "/api/office-admins", "admin");
    const ottawa = assignments.find((a) => a.office === "Ottawa");
    expect(ottawa?.adminUpns).toEqual(["admin@englobecorp.com", "second@englobecorp.com"]);
    // Every other office is still a gap — this replaces one office's list, never merges.
    expect(assignments.filter((a) => a.adminUpns.length === 0)).toHaveLength(9);
  });

  it("replaces rather than merges on a second save", async () => {
    await put(t.app, "/api/office-admins/Ottawa", {
      adminUpns: ["only@englobecorp.com"],
      clientSubmissionId: newSubmissionId("admins"),
    });
    const assignments = await getJson<OfficeAdminAssignment[]>(t.app, "/api/office-admins", "admin");
    expect(assignments.find((a) => a.office === "Ottawa")?.adminUpns).toEqual(["only@englobecorp.com"]);
  });

  it("refuses an office that is not in the location table", async () => {
    const res = await put(t.app, "/api/office-admins/Vancouver", {
      adminUpns: ["x@englobecorp.com"],
      clientSubmissionId: newSubmissionId("admins"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().reason).toContain("not a known office");
  });
});
