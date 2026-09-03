/**
 * `docs/12-ui-spec.md` G-09. Every value asserted here is one that actually appears in
 * `migration/staged/` — the equipment types, asset groups and office names of the real fleet —
 * because the acronyms in that data (SWO, VWReadout, MEMSSensor, HDCamera) are precisely what a
 * naive camelCase split gets wrong.
 */
import { describe, expect, it } from "vitest";
import { equipmentTypeLabel, humaniseEnum, statusLabel } from "@/i18n/humanise";

describe("humaniseEnum — equipment types from the real catalogue", () => {
  it("splits PascalCase into a sentence", () => {
    expect(equipmentTypeLabel("DataLogger")).toBe("Data logger");
    expect(equipmentTypeLabel("SoundLevelMeter")).toBe("Sound level meter");
    expect(equipmentTypeLabel("CellularService")).toBe("Cellular service");
    expect(equipmentTypeLabel("AutomatedTotalStation")).toBe("Automated total station");
    expect(equipmentTypeLabel("AcousticCalibrator")).toBe("Acoustic calibrator");
    expect(equipmentTypeLabel("FieldController")).toBe("Field controller");
    expect(equipmentTypeLabel("DustMonitor")).toBe("Dust monitor");
    expect(equipmentTypeLabel("TiltSensor")).toBe("Tilt sensor");
    expect(equipmentTypeLabel("AssetTracker")).toBe("Asset tracker");
  });

  it("keeps acronyms upper-case instead of title-casing them", () => {
    // The whole reason this module is not a one-line regex.
    expect(equipmentTypeLabel("VWReadout")).toBe("VW readout");
    expect(equipmentTypeLabel("MEMSSensor")).toBe("MEMS sensor");
    expect(equipmentTypeLabel("HDCamera")).toBe("HD camera");
  });

  it("leaves a single word alone", () => {
    expect(equipmentTypeLabel("Geophone")).toBe("Geophone");
    expect(equipmentTypeLabel("Microphone")).toBe("Microphone");
    expect(equipmentTypeLabel("Server")).toBe("Server");
    expect(equipmentTypeLabel("TotalStation")).toBe("Total station");
  });

  it("leaves an all-caps office code alone — SWO must not become Swo", () => {
    expect(humaniseEnum("SWO")).toBe("SWO");
  });

  it("returns anything already containing a space untouched", () => {
    // Office names and the catalogue's long-form manufacturer strings must survive unchanged.
    expect(humaniseEnum("Stoney Creek")).toBe("Stoney Creek");
    expect(humaniseEnum("Thunder Bay")).toBe("Thunder Bay");
    expect(humaniseEnum("Montreal Calibration")).toBe("Montreal Calibration");
    expect(humaniseEnum("N/A (service, not a manufactured unit)")).toBe("N/A (service, not a manufactured unit)");
  });

  it("handles asset groups", () => {
    expect(humaniseEnum("GeotechnicalMonitoring")).toBe("Geotechnical monitoring");
    expect(humaniseEnum("AirQuality")).toBe("Air quality");
    expect(humaniseEnum("Seismographs")).toBe("Seismographs");
    expect(humaniseEnum("Communications")).toBe("Communications");
  });

  it("is safe on empty and degenerate input", () => {
    expect(humaniseEnum("")).toBe("");
    expect(humaniseEnum("A")).toBe("A");
    expect(humaniseEnum("_")).toBe("_"); // no word characters — returned as-is
  });
});

describe("statusLabel — every status in the state machine", () => {
  it("renders each one as prose", () => {
    expect(statusLabel("Available")).toBe("Available");
    expect(statusLabel("CheckedOut")).toBe("Checked out");
    expect(statusLabel("Deployed")).toBe("Deployed");
    expect(statusLabel("InCalibration")).toBe("In calibration");
    expect(statusLabel("NeedsRepair")).toBe("Needs repair");
    expect(statusLabel("Missing")).toBe("Missing");
    expect(statusLabel("Retired")).toBe("Retired");
  });

  it("renders transaction types too, which share the same shape", () => {
    expect(statusLabel("AddToInventory")).toBe("Add to inventory");
    expect(statusLabel("ReturnFromCalibration")).toBe("Return from calibration");
    expect(statusLabel("SendToCalibration")).toBe("Send to calibration");
    expect(statusLabel("ReportFault")).toBe("Report fault");
  });
});
