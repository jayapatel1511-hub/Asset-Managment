import type { AssetStatus } from "../domain/stateMachine";

const LABEL: Record<AssetStatus, string> = {
  Available: "Available",
  CheckedOut: "Checked out",
  Deployed: "Deployed",
  InCalibration: "In calibration",
  NeedsRepair: "Needs repair",
  Missing: "Missing",
  Retired: "Retired",
};

export function StatusPill({ status }: { status: AssetStatus }) {
  return <span className={`ams-pill ams-pill-${status}`}>{LABEL[status]}</span>;
}
