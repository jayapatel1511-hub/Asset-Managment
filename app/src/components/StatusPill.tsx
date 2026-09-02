import { Badge } from "@fluentui/react-components";
import type { AssetStatus } from "../domain/stateMachine";

const APPEARANCE: Record<AssetStatus, { color: "success" | "informative" | "warning" | "danger" | "subtle"; text: string }> = {
  Available: { color: "success", text: "Available" },
  CheckedOut: { color: "informative", text: "Checked out" },
  Deployed: { color: "informative", text: "Deployed" },
  InCalibration: { color: "warning", text: "In calibration" },
  NeedsRepair: { color: "danger", text: "Needs repair" },
  Missing: { color: "danger", text: "Missing" },
  Retired: { color: "subtle", text: "Retired" },
};

export function StatusPill({ status }: { status: AssetStatus }) {
  const info = APPEARANCE[status];
  return (
    <Badge color={info.color} appearance="filled" shape="rounded">
      {info.text}
    </Badge>
  );
}
