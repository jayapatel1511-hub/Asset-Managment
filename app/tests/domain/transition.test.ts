import { describe, expect, it } from "vitest";
import { deriveState, type AssetSnapshot } from "@/domain/deriveState";
import { evaluateTransition } from "@/domain/transition";
import type { StateAxes } from "@/domain/stateAxes";

const office: StateAxes = { lifecycle: "Active", disposition: "AtOffice", serviceability: "Serviceable" };
const deployed: StateAxes = { lifecycle: "Active", disposition: "Deployed", serviceability: "Serviceable" };
const deployedBroken: StateAxes = { lifecycle: "Active", disposition: "Deployed", serviceability: "NeedsRepair" };
const checkedOut: StateAxes = { lifecycle: "Active", disposition: "CheckedOut", serviceability: "Serviceable" };
const missing: StateAxes = { lifecycle: "Active", disposition: "Missing", serviceability: "Serviceable" };
const lab: StateAxes = { lifecycle: "Active", disposition: "AtCalibrationLab", serviceability: "Serviceable" };
const retired: StateAxes = { lifecycle: "Retired", disposition: "AtOffice", serviceability: "Serviceable" };

describe("axis allow/deny — TRANSITION_RULES, not the pill matrix", () => {
  it("allows Checkout only from Active + AtOffice + Serviceable (DC-02)", () => {
    expect(evaluateTransition("Checkout", office).ok).toBe(true);
    const fromCheckedOut = evaluateTransition("Checkout", checkedOut);
    expect(fromCheckedOut.ok).toBe(false);
    if (!fromCheckedOut.ok) {
      expect(fromCheckedOut.code).toBe("conflict.error.assetNotEligible");
      expect(fromCheckedOut.failedAxis).toBe("disposition");
    }
    const broken = evaluateTransition("Checkout", { ...office, serviceability: "NeedsRepair" });
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.code).toBe("transition.error.serviceability");
      expect(broken.failedAxis).toBe("serviceability");
    }
  });

  it("lets ReportFault keep disposition — Deployed + NeedsRepair is representable (DC-08 / rule 9)", () => {
    const matched = evaluateTransition("ReportFault", deployed);
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.axesAfter.disposition).toBe("Deployed");
      expect(matched.axesAfter.serviceability).toBe("NeedsRepair");
      expect(matched.axesAfter.lifecycle).toBe("Active");
    }
  });

  it("refuses ReportFault from Missing and when already faulted", () => {
    const fromMissing = evaluateTransition("ReportFault", missing);
    expect(fromMissing.ok).toBe(false);
    const already = evaluateTransition("ReportFault", deployedBroken);
    expect(already.ok).toBe(false);
    if (!already.ok) expect(already.code).toBe("transition.error.serviceability");
  });

  it("refuses an invalid type from a state that has no matching rule", () => {
    const result = evaluateTransition("Undeploy", office);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict.error.assetNotEligible");
  });

  it("refuses every operational type from Retired except Audit and Correction (DC-13)", () => {
    expect(evaluateTransition("Checkout", retired).ok).toBe(false);
    expect(evaluateTransition("Audit", retired).ok).toBe(true);
    expect(evaluateTransition("Correction", retired).ok).toBe(true);
    const refused = evaluateTransition("Transfer", retired);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("transition.error.lifecycleRetired");
  });

  it("requires a Found destination (DC-12)", () => {
    const none = evaluateTransition("Found", missing, {});
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.code).toBe("transition.error.destinationRequired");
    const officeFind = evaluateTransition("Found", missing, { toLocation: "Ottawa", toLocationKind: "Office" });
    expect(officeFind.ok).toBe(true);
    if (officeFind.ok) expect(officeFind.axesAfter.disposition).toBe("AtOffice");
    const custody = evaluateTransition("Found", missing, { toUser: "tech@englobecorp.com" });
    expect(custody.ok).toBe(true);
    if (custody.ok) expect(custody.axesAfter.disposition).toBe("CheckedOut");
  });

  it("sets NeedsRepair on ReturnFromCalibration Fail, and leaves serviceability on Pass (DC-07)", () => {
    const pass = evaluateTransition("ReturnFromCalibration", lab, { calibrationResult: "Pass" });
    expect(pass.ok).toBe(true);
    if (pass.ok) {
      expect(pass.axesAfter.disposition).toBe("AtOffice");
      expect(pass.axesAfter.serviceability).toBe("Serviceable");
    }
    const fail = evaluateTransition("ReturnFromCalibration", lab, { calibrationResult: "Fail" });
    expect(fail.ok).toBe(true);
    if (fail.ok) {
      expect(fail.axesAfter.disposition).toBe("AtOffice");
      expect(fail.axesAfter.serviceability).toBe("NeedsRepair");
    }
  });

  it("dispatches Transfer: inter-office AtOffice → InTransit, receipt ends transit (DC-04)", () => {
    const dispatch = evaluateTransition("Transfer", office, {
      currentLocation: "Ottawa",
      toLocation: "Toronto",
      toLocationKind: "Office",
    });
    expect(dispatch.ok).toBe(true);
    if (dispatch.ok) {
      expect(dispatch.rule.id).toBe("R-04");
      expect(dispatch.axesAfter.disposition).toBe("InTransit");
    }
    const receipt = evaluateTransition("Transfer", { ...office, disposition: "InTransit" }, { toLocation: "Toronto" });
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.rule.id).toBe("R-05");
      expect(receipt.axesAfter.disposition).toBe("AtOffice");
    }
    const projectMove = evaluateTransition("Transfer", deployed, { toProject: "02999999" });
    expect(projectMove.ok).toBe(true);
    if (projectMove.ok) {
      expect(projectMove.rule.id).toBe("R-06");
      expect(projectMove.axesAfter.disposition).toBe("Deployed");
    }
  });

  it("freezes disposition and serviceability on Retire (DC-13)", () => {
    const fromLab = evaluateTransition("Retire", lab);
    expect(fromLab.ok).toBe(true);
    if (fromLab.ok) {
      expect(fromLab.axesAfter.lifecycle).toBe("Retired");
      expect(fromLab.axesAfter.disposition).toBe("AtCalibrationLab");
      expect(fromLab.axesAfter.serviceability).toBe("Serviceable");
    }
    expect(evaluateTransition("Retire", checkedOut).ok).toBe(false);
    expect(evaluateTransition("Retire", deployed).ok).toBe(false);
  });

  it("allows SendToCalibration from CheckedOut (R-09 — not a pill-matrix cell originally)", () => {
    const matched = evaluateTransition("SendToCalibration", checkedOut);
    expect(matched.ok).toBe(true);
    if (matched.ok) expect(matched.axesAfter.disposition).toBe("AtCalibrationLab");
  });
});

describe("deriveState — ReportFault on a deployed asset (T035)", () => {
  const deployedAsset: AssetSnapshot = {
    assetId: "DL-UM-16984",
    status: "Deployed",
    lifecycle: "Active",
    disposition: "Deployed",
    serviceability: "Serviceable",
    homeoffice: "Ottawa",
    currentlocation: "337 Power Street",
    custodian: "tech@englobecorp.com",
    currentproject: "02208928",
    parentasset: null,
  };

  it("writes serviceability only; custody and deployment stay", () => {
    const result = deriveState(deployedAsset, { type: "ReportFault", date: "2026-09-02T09:00:00-04:00" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.disposition).toBe("Deployed");
      expect(result.fields.serviceability).toBe("NeedsRepair");
      expect(result.fields.statusAfter).toBe("NeedsRepair");
      expect(result.fields.custodian).toBe("tech@englobecorp.com");
      expect(result.fields.currentproject).toBe("02208928");
      expect(result.fields.currentlocation).toBe("337 Power Street");
      expect(result.relationshipOps).toHaveLength(0);
    }
  });
});
