/**
 * Feature 004 US4 (WS-D) — office → administrator assignment.
 * Covers: every office from store.locations appears (even with zero assignments); an office with
 * an empty admin list is a gap (FR-027a); setOfficeAdmins replaces (not merges) and persists; a
 * newly added office is picked up immediately with zero configuration (FR-027 / the N-offices
 * decision, data/reference/office_admins.README.md).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createAdminMethods } from "@/api/mock/admin";
import { MockStore } from "@/api/mock/store";
import type { CurrentUser, Location } from "@/api/types";

const fakeUser: CurrentUser = { upn: "svc-ams@englobecorp.com", displayName: "System Owner (test)", homeoffice: "Ottawa", roles: ["SystemOwner"] };
const getCurrentUser = async () => fakeUser;

function office(name: string): Location {
  return { id: `loc-${name}`, name, locationtype: "Office", parentlocation: "Ontario", isactive: true };
}

const TEN_OFFICES = ["Ottawa", "Toronto", "Sudbury", "SWO", "Office5", "Office6", "Office7", "Office8", "Office9", "Office10"];

function makeStore(extraLocations: Location[] = []): MockStore {
  return MockStore.forTesting({
    assets: [],
    locations: [
      ...TEN_OFFICES.map(office),
      { id: "loc-cal", name: "Montreal Calibration", locationtype: "CalLab", parentlocation: null, isactive: true }, // non-office, must never appear
      ...extraLocations,
    ],
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("createAdminMethods — listOfficeAdminAssignments (FR-027)", () => {
  it("returns every office from store.locations, none omitted, with zero assignments to start", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    const result = await admin.listOfficeAdminAssignments();
    expect(result.map((a) => a.office).sort()).toEqual([...TEN_OFFICES].sort());
    for (const a of result) expect(a.adminUpns).toEqual([]);
  });

  it("never includes a non-Office location (e.g. a calibration lab)", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    const result = await admin.listOfficeAdminAssignments();
    expect(result.some((a) => a.office === "Montreal Calibration")).toBe(false);
  });

  it("reports an office with an empty admin list as a gap — adminUpns: [] is the signal, never omitted (FR-027a)", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    const result = await admin.listOfficeAdminAssignments();
    const gaps = result.filter((a) => a.adminUpns.length === 0);
    expect(gaps).toHaveLength(TEN_OFFICES.length); // every office starts as a gap
    expect(gaps.map((g) => g.office)).toContain("Ottawa");
  });

  it("shows an eleventh office immediately once it exists in store.locations — zero configuration (FR-027 / SC-011)", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    expect(await admin.listOfficeAdminAssignments()).toHaveLength(TEN_OFFICES.length);

    store.locations.push(office("Windsor"));

    const afterAdd = await admin.listOfficeAdminAssignments();
    expect(afterAdd).toHaveLength(TEN_OFFICES.length + 1);
    const windsor = afterAdd.find((a) => a.office === "Windsor");
    expect(windsor).toBeDefined();
    expect(windsor?.adminUpns).toEqual([]); // new office is a gap immediately too
  });
});

describe("createAdminMethods — setOfficeAdmins", () => {
  it("assigns an administrator, and the office is no longer a gap", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    const result = await admin.setOfficeAdmins("Ottawa", ["jay.patel@englobecorp.com"], "sub-1");
    expect(result.ok).toBe(true);

    const after = await admin.listOfficeAdminAssignments();
    const ottawa = after.find((a) => a.office === "Ottawa");
    expect(ottawa?.adminUpns).toEqual(["jay.patel@englobecorp.com"]);
  });

  it("replaces the list rather than merging with the previous one", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    await admin.setOfficeAdmins("Ottawa", ["a@englobecorp.com", "b@englobecorp.com"], "sub-1");
    await admin.setOfficeAdmins("Ottawa", ["c@englobecorp.com"], "sub-2");

    const after = await admin.listOfficeAdminAssignments();
    const ottawa = after.find((a) => a.office === "Ottawa");
    expect(ottawa?.adminUpns).toEqual(["c@englobecorp.com"]); // not ["a", "b", "c"]
  });

  it("setting the list back to empty re-opens the gap", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    await admin.setOfficeAdmins("Ottawa", ["a@englobecorp.com"], "sub-1");
    await admin.setOfficeAdmins("Ottawa", [], "sub-2");

    const after = await admin.listOfficeAdminAssignments();
    expect(after.find((a) => a.office === "Ottawa")?.adminUpns).toEqual([]);
  });

  it("trims whitespace, drops blanks, and dedupes case-insensitively while keeping first-seen casing", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    await admin.setOfficeAdmins("Ottawa", ["  Jay@englobecorp.com ", "jay@englobecorp.com", "", "   ", "Sam@englobecorp.com"], "sub-1");

    const after = await admin.listOfficeAdminAssignments();
    expect(after.find((a) => a.office === "Ottawa")?.adminUpns).toEqual(["Jay@englobecorp.com", "Sam@englobecorp.com"]);
  });

  it("refuses an office that is not in the location table", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    const result = await admin.setOfficeAdmins("Nowhere", ["a@englobecorp.com"], "sub-1");
    expect(result.ok).toBe(false);
  });

  it("persists to localStorage so a reload does not lose the assignment", async () => {
    const store = makeStore();
    const admin = createAdminMethods(store, getCurrentUser);
    await admin.setOfficeAdmins("Toronto", ["admin@englobecorp.com"], "sub-1");

    // v2 since feature 007 FR-060: localStorage now holds only the delta on top of the base
    // dataset, not the whole snapshot. Office admin assignments are part of that delta.
    const raw = window.localStorage.getItem("ams-mock-store-v2");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { officeAdminAssignments: Array<{ office: string; adminUpns: string[] }> };
    expect(parsed.officeAdminAssignments).toContainEqual({ office: "Toronto", adminUpns: ["admin@englobecorp.com"] });
  });
});
