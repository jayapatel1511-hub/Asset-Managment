/**
 * Three stored axes ↔ compatibility pill (DC-21 / DC-22).
 *
 * Axes → pill is total and mechanical (transition-table.md §7.1). Pill → axes is the
 * conservative mapping used only to backfill history that was written with two status
 * columns, and to hydrate a snapshot that still carries a pill and no axes.
 *
 * One definition, consumed by deriveState, seed, and the SQL twin `ams_compat_status`
 * in db/migrations/0016_dc22_stored_axes.sql. Do not fork.
 */
import type { AssetStatus } from "./stateMachine";

export type Lifecycle = "Active" | "Retired";
export type Disposition =
  | "AtOffice"
  | "CheckedOut"
  | "Deployed"
  | "InTransit"
  | "AtCalibrationLab"
  | "Missing";
export type Serviceability = "Serviceable" | "NeedsRepair" | "OutOfService";

export interface StateAxes {
  lifecycle: Lifecycle;
  disposition: Disposition;
  serviceability: Serviceability;
}

/** DC-21 precedence, first match wins. Vocabulary is the app's camelCase pills, not the display labels. */
export function statusFromAxes(axes: StateAxes): AssetStatus {
  if (axes.lifecycle === "Retired") return "Retired";
  if (axes.disposition === "Missing") return "Missing";
  if (axes.disposition === "AtCalibrationLab") return "InCalibration";
  if (axes.serviceability === "NeedsRepair" || axes.serviceability === "OutOfService") return "NeedsRepair";
  if (axes.disposition === "Deployed") return "Deployed";
  if (axes.disposition === "CheckedOut") return "CheckedOut";
  // InTransit has no compatibility pill in the seven-value matrix; the axis is stored,
  // the pill collapses (DC-21 row 7 is the display view, not AssetStatus).
  return "Available";
}

/**
 * Conservative pill → axes. Deterministic; lossy for NeedsRepair (disposition),
 * InCalibration (serviceability), Missing (prior serviceability) and Retired (prior disposition).
 * Replay of a statusbefore→statusafter chain can recover some of those — see 0013.
 */
export function axesFromStatus(status: AssetStatus | string, lifecycle?: Lifecycle): StateAxes {
  if (status === "Retired" || lifecycle === "Retired") {
    return { lifecycle: "Retired", disposition: "AtOffice", serviceability: "OutOfService" };
  }
  const active: Lifecycle = "Active";
  switch (status) {
    case "Available":
      return { lifecycle: active, disposition: "AtOffice", serviceability: "Serviceable" };
    case "CheckedOut":
      return { lifecycle: active, disposition: "CheckedOut", serviceability: "Serviceable" };
    case "Deployed":
      return { lifecycle: active, disposition: "Deployed", serviceability: "Serviceable" };
    case "InCalibration":
      return { lifecycle: active, disposition: "AtCalibrationLab", serviceability: "Serviceable" };
    case "NeedsRepair":
      return { lifecycle: active, disposition: "AtOffice", serviceability: "NeedsRepair" };
    case "Missing":
      return { lifecycle: active, disposition: "Missing", serviceability: "Serviceable" };
    default:
      return { lifecycle: active, disposition: "AtOffice", serviceability: "Serviceable" };
  }
}
