/**
 * deriveState — one transaction line's consequences as a pure function.
 *
 * Constitution Principle I: current axes/location/custodian/project/parent are OUTPUTS of a
 * transaction line, never a direct write. Principle V: an invalid transition is refused here
 * exactly as it would be refused by the app's own pre-submit check — this is the same function
 * both call, so there is only one place the rule actually lives.
 *
 * Allow/deny is TRANSITION_RULES (transition-table.md §3 / DC-22 item 4), evaluated against the
 * three stored axes. The seven-value STATE_MACHINE pill matrix is a generated compatibility
 * projection, not the authority.
 *
 * This function is intentionally pure and synchronous. It does not touch a store — that lets
 * every rule variant be exercised by a plain unit test with no backend at all.
 *
 * What this function does NOT do (by design, kept in the API layer instead):
 *   - Mirror a status/location/custodian change onto an asset's permanent Component children
 *   - Re-verify the asset's status hasn't changed since it was added to a cart (FR-023)
 *   - Persist anything.
 */
import type { AssetStatus, TransactionType } from "./stateMachine";
import {
  axesFromStatus,
  statusFromAxes,
  type Disposition,
  type Serviceability,
  type StateAxes,
} from "./stateAxes";
import { evaluateTransition } from "./transition";

export type Lifecycle = "Active" | "Retired";
export type { Disposition, Serviceability, StateAxes };

export interface AssetSnapshot {
  assetId: string;
  status: AssetStatus;
  lifecycle: Lifecycle;
  /** Stored axes when known. Absent snapshots are hydrated from `status` (lossy). */
  disposition?: Disposition;
  serviceability?: Serviceability;
  homeoffice: string | null;
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  parentasset: string | null;
}

export interface TransactionLineInput {
  type: TransactionType;
  /** ISO date/time the transaction is recorded at. */
  date: string;
  tolocation?: string | null;
  toLocationKind?: "Office" | "Site" | "CalibrationLab" | "Other" | null;
  touser?: string | null;
  toproject?: string | null;
  calibrationResult?: "Pass" | "Fail" | "Adjusted" | null;
  /** Set only when this transaction forms or breaks a kit (Checkout/Deploy/Return/Undeploy). */
  primaryAssetId?: string | null;
  retirementReason?: string | null;
  /** True when this line's asset IS the transaction's primary asset (the kit parent itself). */
  isPrimary?: boolean;
}

export interface DerivedFields {
  /** Compatibility pill — derived from the three axes (DC-21). Never stored as authority. */
  statusAfter: AssetStatus;
  lifecycle: Lifecycle;
  disposition: Disposition;
  serviceability: Serviceability;
  custodian: string | null;
  currentlocation: string | null;
  currentproject: string | null;
  retirementReason: string | null;
}

export type RelationshipOp =
  | { op: "open"; relationshipType: "Kit"; parentAssetId: string; childAssetId: string; start: string }
  | { op: "closeAsChild"; childAssetId: string; end: string }
  | { op: "closeAllAsParent"; parentAssetId: string; end: string };

export type DeriveResult =
  | { ok: true; fields: DerivedFields; relationshipOps: RelationshipOp[]; ruleId: string }
  | { ok: false; reason: string; code: string; failedAxis: "lifecycle" | "disposition" | "serviceability" | null };

const KIT_OPENING_TYPES: ReadonlySet<TransactionType> = new Set(["Checkout", "Deploy"]);
const KIT_CLOSING_TYPES: ReadonlySet<TransactionType> = new Set(["Return", "Undeploy", "Retire"]);

function snapshotAxes(asset: AssetSnapshot): StateAxes {
  if (asset.disposition && asset.serviceability) {
    return { lifecycle: asset.lifecycle, disposition: asset.disposition, serviceability: asset.serviceability };
  }
  return axesFromStatus(asset.status, asset.lifecycle);
}

export function deriveState(asset: AssetSnapshot, line: TransactionLineInput): DeriveResult {
  const current = snapshotAxes(asset);
  const pill = statusFromAxes(current);
  const matched = evaluateTransition(line.type, current, {
    currentLocation: asset.currentlocation,
    toLocation: line.tolocation,
    toLocationKind: line.toLocationKind,
    toUser: line.touser,
    toProject: line.toproject,
    calibrationResult: line.calibrationResult,
  });

  if (!matched.ok) {
    return {
      ok: false,
      reason: `${line.type} is not a valid transition from ${pill} for ${asset.assetId}.`,
      code: matched.code,
      failedAxis: matched.failedAxis,
    };
  }

  const statusAfter = statusFromAxes(matched.axesAfter);
  const fields = deriveFields(asset, line, statusAfter, matched.axesAfter);
  const relationshipOps = deriveRelationshipOps(asset, line);

  return { ok: true, fields, relationshipOps, ruleId: matched.rule.id };
}

function deriveFields(
  asset: AssetSnapshot,
  line: TransactionLineInput,
  statusAfter: AssetStatus,
  axesAfter: StateAxes
): DerivedFields {
  const base: DerivedFields = {
    statusAfter,
    lifecycle: axesAfter.lifecycle,
    disposition: axesAfter.disposition,
    serviceability: axesAfter.serviceability,
    custodian: asset.custodian,
    currentlocation: asset.currentlocation,
    currentproject: asset.currentproject,
    retirementReason: null,
  };

  switch (line.type) {
    case "Checkout":
      // Location becomes unknown, not the office — the item has left, and claiming it is still
      // at the office is exactly the dishonesty Principle I exists to remove (same reasoning as
      // migration's Q3 handling of "Deployed or NOT Available").
      return { ...base, custodian: line.touser ?? null, currentproject: line.toproject ?? null, currentlocation: null };

    case "Deploy":
      return {
        ...base,
        custodian: line.touser ?? null,
        currentproject: line.toproject ?? asset.currentproject,
        currentlocation: line.tolocation ?? asset.currentlocation,
      };

    case "Return":
      return {
        ...base,
        custodian: null,
        currentproject: null,
        currentlocation: line.tolocation ?? asset.homeoffice,
      };

    case "Undeploy":
      // DC-06: Undeploy targets CheckedOut and keeps the project. Feature 005 FR-013 still
      // returns the component to the recovering user's custody (location unknown until Return).
      return {
        ...base,
        custodian: line.touser ?? null,
        currentproject: asset.currentproject,
        currentlocation: line.tolocation ?? null,
      };

    case "Transfer":
      return {
        ...base,
        custodian: line.touser !== undefined ? line.touser : asset.custodian,
        currentlocation: line.tolocation !== undefined ? line.tolocation : asset.currentlocation,
        currentproject: line.toproject !== undefined ? line.toproject : asset.currentproject,
      };

    case "SendToCalibration":
      return { ...base, custodian: null, currentlocation: line.tolocation ?? asset.currentlocation };

    case "ReturnFromCalibration":
      return { ...base, currentlocation: line.tolocation ?? asset.homeoffice };

    case "Retire":
      return {
        ...base,
        lifecycle: "Retired",
        custodian: null,
        currentproject: null,
        currentlocation: null,
        retirementReason: line.retirementReason ?? null,
      };

    case "Found":
      if (line.touser) {
        return { ...base, custodian: line.touser, currentlocation: null };
      }
      if (line.toproject) {
        return { ...base, currentproject: line.toproject, currentlocation: line.tolocation ?? asset.currentlocation };
      }
      return { ...base, currentlocation: line.tolocation ?? asset.homeoffice };

    case "RehomeAsset":
      return base;

    case "ReportFault":
    case "MarkMissing":
    case "RepairComplete":
    case "MarkOutOfService":
    case "ReturnToService":
    case "Audit":
    case "AddToInventory":
    case "Correction":
      return base;

    default:
      return base;
  }
}

function deriveRelationshipOps(asset: AssetSnapshot, line: TransactionLineInput): RelationshipOp[] {
  const ops: RelationshipOp[] = [];

  if (
    KIT_OPENING_TYPES.has(line.type) &&
    line.primaryAssetId &&
    line.primaryAssetId !== asset.assetId &&
    !line.isPrimary
  ) {
    ops.push({
      op: "open",
      relationshipType: "Kit",
      parentAssetId: line.primaryAssetId,
      childAssetId: asset.assetId,
      start: line.date,
    });
  }

  if (KIT_CLOSING_TYPES.has(line.type)) {
    ops.push({ op: "closeAsChild", childAssetId: asset.assetId, end: line.date });
    ops.push({ op: "closeAllAsParent", parentAssetId: asset.assetId, end: line.date });
  }

  return ops;
}
