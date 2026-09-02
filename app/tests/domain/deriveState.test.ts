import { describe, expect, it } from "vitest";
import { deriveState, type AssetSnapshot } from "@/domain/deriveState";

const available: AssetSnapshot = {
  assetId: "DL-UM-16984",
  status: "Available",
  lifecycle: "Active",
  homeoffice: "Ottawa",
  currentlocation: "Ottawa",
  custodian: null,
  currentproject: null,
  parentasset: null,
};

const checkedOut: AssetSnapshot = {
  ...available,
  status: "CheckedOut",
  currentlocation: null,
  custodian: "tech@englobecorp.com",
  currentproject: "02208928",
};

describe("Checkout — FR-017/FR-014 equivalents at the domain layer", () => {
  it("sets custodian and project, and clears location to unknown (not the office)", () => {
    const result = deriveState(available, {
      type: "Checkout",
      date: "2026-09-02T09:00:00-04:00",
      touser: "tech@englobecorp.com",
      toproject: "02208928",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("CheckedOut");
      expect(result.fields.custodian).toBe("tech@englobecorp.com");
      expect(result.fields.currentproject).toBe("02208928");
      expect(result.fields.currentlocation).toBeNull();
    }
  });

  it("refuses checkout of an asset that is not Available (FR-021)", () => {
    const result = deriveState(checkedOut, {
      type: "Checkout",
      date: "2026-09-02T09:00:00-04:00",
      touser: "someone-else@englobecorp.com",
    });
    expect(result.ok).toBe(false);
  });

  it("opens a Kit relationship when a primary asset is named and this asset is not it (FR-029)", () => {
    const result = deriveState(available, {
      type: "Checkout",
      date: "2026-09-02T09:00:00-04:00",
      touser: "tech@englobecorp.com",
      primaryAssetId: "DL-UM-16984-PRIMARY",
      isPrimary: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationshipOps).toContainEqual({
        op: "open",
        relationshipType: "Kit",
        parentAssetId: "DL-UM-16984-PRIMARY",
        childAssetId: "DL-UM-16984",
        start: "2026-09-02T09:00:00-04:00",
      });
    }
  });

  it("does not open a relationship for the primary asset's own line", () => {
    const result = deriveState(available, {
      type: "Checkout",
      date: "2026-09-02T09:00:00-04:00",
      touser: "tech@englobecorp.com",
      primaryAssetId: "DL-UM-16984",
      isPrimary: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationshipOps).toHaveLength(0);
    }
  });
});

describe("Return — FR-017", () => {
  it("clears custodian and project, sets location to the return location", () => {
    const result = deriveState(checkedOut, {
      type: "Return",
      date: "2026-09-02T09:00:00-04:00",
      tolocation: "Sudbury",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("Available");
      expect(result.fields.custodian).toBeNull();
      expect(result.fields.currentproject).toBeNull();
      expect(result.fields.currentlocation).toBe("Sudbury");
    }
  });

  it("defaults the return location to the asset's home office when none is given (FR-010)", () => {
    const result = deriveState(checkedOut, { type: "Return", date: "2026-09-02T09:00:00-04:00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.currentlocation).toBe("Ottawa");
    }
  });

  it("closes this asset's own kit membership and anything it is a kit parent of (FR-029, FR-031)", () => {
    const result = deriveState(checkedOut, { type: "Return", date: "2026-09-02T10:00:00-04:00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationshipOps).toContainEqual({
        op: "closeAsChild",
        childAssetId: "DL-UM-16984",
        end: "2026-09-02T10:00:00-04:00",
      });
      expect(result.relationshipOps).toContainEqual({
        op: "closeAllAsParent",
        parentAssetId: "DL-UM-16984",
        end: "2026-09-02T10:00:00-04:00",
      });
    }
  });
});

describe("Transfer — FR-018", () => {
  it("changes only the fields explicitly provided, leaving status unchanged", () => {
    const result = deriveState(checkedOut, {
      type: "Transfer",
      date: "2026-09-02T09:00:00-04:00",
      touser: "someone-else@englobecorp.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("CheckedOut");
      expect(result.fields.custodian).toBe("someone-else@englobecorp.com");
      expect(result.fields.currentproject).toBe("02208928"); // untouched
    }
  });

  it("transferring a Deployed station to a new project leaves status/location untouched (feature 005 FR-027, requires Transfer:Deployed in state_machine.json)", () => {
    const deployed: AssetSnapshot = { ...available, status: "Deployed", currentlocation: "337 Power Street", currentproject: "02208928" };
    const result = deriveState(deployed, { type: "Transfer", date: "2026-09-02T09:00:00-04:00", toproject: "02999999" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("Deployed");
      expect(result.fields.currentlocation).toBe("337 Power Street");
      expect(result.fields.currentproject).toBe("02999999");
    }
  });

  it("transferring an Available asset between offices keeps it Available (edge case)", () => {
    const result = deriveState(available, {
      type: "Transfer",
      date: "2026-09-02T09:00:00-04:00",
      tolocation: "Toronto",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("Available");
      expect(result.fields.currentlocation).toBe("Toronto");
    }
  });
});

describe("Retire — FR-024/FR-025", () => {
  it("clears custodian, project and location; sets lifecycle and reason; is terminal", () => {
    const result = deriveState(available, {
      type: "Retire",
      date: "2026-09-02T09:00:00-04:00",
      retirementReason: "Sold",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("Retired");
      expect(result.fields.lifecycle).toBe("Retired");
      expect(result.fields.custodian).toBeNull();
      expect(result.fields.currentproject).toBeNull();
      expect(result.fields.currentlocation).toBeNull();
      expect(result.fields.retirementReason).toBe("Sold");
    }
  });

  it("refuses to retire a CheckedOut asset directly — the edge case's resolution: the open custody must be accounted for (a Return) before retirement, not silently overridden", () => {
    const result = deriveState(checkedOut, { type: "Retire", date: "2026-09-02T09:00:00-04:00", retirementReason: "Lost" });
    expect(result.ok).toBe(false);
  });

  it("no transaction (except Audit) is accepted against a Retired asset", () => {
    const retired: AssetSnapshot = { ...available, status: "Retired", lifecycle: "Retired" };
    for (const type of ["Checkout", "Return", "Transfer", "ReportFault"] as const) {
      const result = deriveState(retired, { type, date: "2026-09-02T09:00:00-04:00" });
      expect(result.ok).toBe(false);
    }
  });
});

describe("Calibration round trip — feature 004 FR-022/FR-024", () => {
  it("SendToCalibration clears custodian and moves to the lab location", () => {
    const result = deriveState(available, {
      type: "SendToCalibration",
      date: "2026-09-02T09:00:00-04:00",
      tolocation: "Montreal Calibration",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("InCalibration");
      expect(result.fields.custodian).toBeNull();
      expect(result.fields.currentlocation).toBe("Montreal Calibration");
    }
  });

  it("ReturnFromCalibration returns the asset to its home office without an admin setting status by hand", () => {
    const inCal: AssetSnapshot = { ...available, status: "InCalibration", currentlocation: "Montreal Calibration", custodian: null };
    const result = deriveState(inCal, { type: "ReturnFromCalibration", date: "2026-09-02T09:00:00-04:00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("Available");
      expect(result.fields.currentlocation).toBe("Ottawa");
    }
  });

  it("Undeploy returns a recovered component to the RECOVERING USER's custody, not to nobody (feature 005 FR-013, fixing a docs/03-automation.md-era assumption)", () => {
    const deployed: AssetSnapshot = { ...available, status: "Deployed", currentlocation: "337 Power Street", custodian: null, currentproject: "02208928" };
    const result = deriveState(deployed, {
      type: "Undeploy",
      date: "2026-09-02T09:00:00-04:00",
      touser: "tech@englobecorp.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.statusAfter).toBe("CheckedOut");
      expect(result.fields.custodian).toBe("tech@englobecorp.com");
      expect(result.fields.currentproject).toBeNull();
    }
  });

  it("Undeploy with no touser given leaves custodian unknown rather than fabricating one", () => {
    const deployed: AssetSnapshot = { ...available, status: "Deployed", currentlocation: "337 Power Street" };
    const result = deriveState(deployed, { type: "Undeploy", date: "2026-09-02T09:00:00-04:00" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.custodian).toBeNull();
  });

  it("refuses checkout of an asset in calibration (feature 004 FR-023)", () => {
    const inCal: AssetSnapshot = { ...available, status: "InCalibration" };
    const result = deriveState(inCal, { type: "Checkout", date: "2026-09-02T09:00:00-04:00", touser: "x@englobecorp.com" });
    expect(result.ok).toBe(false);
  });
});
