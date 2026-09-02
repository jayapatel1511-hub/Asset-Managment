/**
 * deriveState — the F1 logic (docs/03-automation.md) as a pure function.
 *
 * Constitution Principle I: current status/location/custodian/project/parent are OUTPUTS of a
 * transaction line, never a direct write. Principle V: an invalid transition is refused here
 * exactly as it would be refused by the app's own pre-submit check — this is the same function
 * both call (see api/mock/transactions.ts), so there is only one place the rule actually lives.
 *
 * This function is intentionally pure and synchronous: give it the asset's current snapshot and
 * one transaction line's inputs, get back either a rejection or the field updates plus the
 * relationship operations (kit open/close) the caller should apply. It does not touch a store —
 * that lets every cell of data/reference/state_machine.json be exercised by a plain unit test
 * (tests/domain/deriveState.test.ts) with no backend at all.
 *
 * What this function does NOT do (by design, kept in the API layer instead — see
 * api/mock/transactions.ts):
 *   - Mirror a status/location/custodian change onto an asset's permanent Component children
 *     (F1 step 5). That is a store-wide fan-out over the relationship table, not a
 *     single-asset derivation.
 *   - Re-verify the asset's status hasn't changed since it was added to a cart (FR-023) — a
 *     concurrency concern the store's write path owns.
 *   - Persist anything.
 */
import { STATE_MACHINE, type AssetStatus, type TransactionType } from "./stateMachine";

export type Lifecycle = "Active" | "Retired";

export interface AssetSnapshot {
  assetId: string;
  status: AssetStatus;
  lifecycle: Lifecycle;
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
  touser?: string | null;
  toproject?: string | null;
  /** Set only when this transaction forms or breaks a kit (Checkout/Deploy/Return/Undeploy). */
  primaryAssetId?: string | null;
  retirementReason?: string | null;
  /** True when this line's asset IS the transaction's primary asset (the kit parent itself). */
  isPrimary?: boolean;
}

export interface DerivedFields {
  statusAfter: AssetStatus;
  lifecycle: Lifecycle;
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
  | { ok: true; fields: DerivedFields; relationshipOps: RelationshipOp[] }
  | { ok: false; reason: string };

const KIT_OPENING_TYPES: ReadonlySet<TransactionType> = new Set(["Checkout", "Deploy"]);
const KIT_CLOSING_TYPES: ReadonlySet<TransactionType> = new Set([
  "Return",
  "Undeploy",
  "Retire",
  "MarkMissing",
]);

/**
 * FR-020/FR-021/FR-022/FR-024: refuse a transition the matrix doesn't allow, for EVERY asset —
 * including a Retired one (the matrix has no entries at all under "Retired", so any transaction
 * type against it falls straight into the rejection branch here, satisfying FR-022 without a
 * separate special case).
 */
export function deriveState(asset: AssetSnapshot, line: TransactionLineInput): DeriveResult {
  const allowed = STATE_MACHINE[asset.status];
  const statusAfter = allowed[line.type];
  if (!statusAfter) {
    return {
      ok: false,
      reason: `${line.type} is not a valid transition from ${asset.status} for ${asset.assetId}.`,
    };
  }

  const fields = deriveFields(asset, line, statusAfter);
  const relationshipOps = deriveRelationshipOps(asset, line);

  return { ok: true, fields, relationshipOps };
}

function deriveFields(asset: AssetSnapshot, line: TransactionLineInput, statusAfter: AssetStatus): DerivedFields {
  const base: DerivedFields = {
    statusAfter,
    lifecycle: asset.lifecycle,
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
    case "Undeploy":
      return {
        ...base,
        custodian: null,
        currentproject: null,
        currentlocation: line.tolocation ?? asset.homeoffice,
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
      return { ...base, currentlocation: asset.homeoffice };

    case "Retire":
      return {
        ...base,
        lifecycle: "Retired",
        custodian: null,
        currentproject: null,
        currentlocation: null,
        retirementReason: line.retirementReason ?? null,
      };

    case "ReportFault":
    case "MarkMissing":
    case "RepairComplete":
    case "Found":
      // status changes only; custodian/location/project are whatever they already were
      return base;

    case "Audit":
    case "AddToInventory":
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
    // this asset, if it is itself a kit child, has its own relationship closed
    ops.push({ op: "closeAsChild", childAssetId: asset.assetId, end: line.date });
    // and if it is a kit parent, every child relationship it opened is closed too
    ops.push({ op: "closeAllAsParent", parentAssetId: asset.assetId, end: line.date });
  }

  return ops;
}
