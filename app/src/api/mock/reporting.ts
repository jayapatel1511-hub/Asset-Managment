/**
 * Feature 006 — Fleet Reporting. Owned exclusively by WS-B.
 *
 * Writes nothing (plan.md's Constitution Check, Principle I row: "adds no write path at all").
 * Both methods are pure reads over the existing store, computed fresh on every call — no separate
 * reporting copy of the operational data (FR-030).
 */
import type { AssetFilter, ReportingMethods } from "../AmsBackend";
import { isTemporaryAssetId } from "../../domain/assetId";
import type { Asset, CalibrationCounts, CurrentUser, EquipmentModel, FleetCounts } from "../types";
import type { MockStore } from "./store";

/** Sentinel key for "no value" in a Record<string, number> breakdown (null homeoffice, or a
 * model this asset's (manufacturer, model, equipmenttype) doesn't resolve against
 * equipmentModels). Kept as a plain empty string rather than a translated label because this is
 * data, not UI copy (FR-031 governs JSX literals, not Record keys) — screens render it through
 * `common.unknown`. */
const UNKNOWN_KEY = "";

/**
 * MUST filter `store.assets` exactly the way api/mock/index.ts's `listAssets` does, so
 * `getFleetCounts(filter).total` reconciles exactly with `listAssets(filter).length` (SC-003,
 * T015) — that is why this is a line-for-line copy of `listAssets`'s predicate rather than a
 * second, possibly-diverging query. `listAssets` is the reconciliation target: if it changes,
 * update this copy to match, not the other way around.
 *
 * Phase 2 integration update: `listAssets` now applies `AssetFilter.assetgroup` too (it was
 * declared on the type but silently ignored before — this file's own review caught the gap).
 * Mirrored here for the same reason the rest of this function exists.
 */
function filterAssetsLikeListAssets(store: MockStore, filter: AssetFilter = {}): Asset[] {
  let results = [...store.assets.values()];
  if (!filter.includeRetired) results = results.filter((a) => a.lifecycle !== "Retired"); // FR-029
  if (filter.office) {
    results = results.filter((a) => a.currentlocation === filter.office || (!a.currentlocation && a.homeoffice === filter.office));
  }
  if (filter.status?.length) results = results.filter((a) => filter.status!.includes(a.status));
  if (filter.equipmenttype) results = results.filter((a) => a.equipmentmodel.equipmenttype === filter.equipmenttype);
  if (filter.custodian) results = results.filter((a) => a.custodian === filter.custodian);
  if (filter.project) results = results.filter((a) => a.currentproject === filter.project);
  if (filter.assetgroup) results = results.filter((a) => findModel(store, a)?.assetgroup === filter.assetgroup);
  return results;
}

function findModel(store: MockStore, asset: Asset): EquipmentModel | undefined {
  return store.equipmentModels.find(
    (m) =>
      m.manufacturer === asset.equipmentmodel.manufacturer &&
      m.model === asset.equipmentmodel.model &&
      m.equipmenttype === asset.equipmentmodel.equipmenttype
  );
}

/**
 * FR-012: "the notes field names at least two" (spec.md's own edge case) — the two real examples
 * in the migrated data are TS-014/TS-015, whose notes read "Owned by Vanmar Construction Inc. …".
 * This is a plain-text heuristic over a free-text field (there is no structured "owner" column —
 * Principle IV governs picked reference data, not this legacy notes text), so it is necessarily
 * a pattern match rather than a lookup. Verified against migration/staged/assets.json: matches
 * exactly TS-014 and TS-015, the two rows migration/reports/02_conflicts.md itself flags under
 * "Notes suggesting third-party ownership" — and does not also match the "…RENTAL" notes (Englobe
 * renting equipment IN is a different, more ambiguous case the spec's example does not name) or
 * the "Unit Stolen…" note (loss, not ownership).
 */
const THIRD_PARTY_OWNED_PATTERN = /\bowned by\b/i;

function isThirdPartyOwned(asset: Asset): boolean {
  return !!asset.notes && THIRD_PARTY_OWNED_PATTERN.test(asset.notes);
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function createReportingMethods(store: MockStore, _getCurrentUser: () => Promise<CurrentUser>): ReportingMethods {
  return {
    async getFleetCounts(filter?: AssetFilter): Promise<FleetCounts> {
      await store.ready;
      const assets = filterAssetsLikeListAssets(store, filter);

      const byOffice: Record<string, number> = {};
      const byAssetGroup: Record<string, number> = {};
      const byEquipmentType: Record<string, number> = {};
      let temporaryTags = 0;
      let thirdPartyOwned = 0;

      for (const asset of assets) {
        bump(byOffice, asset.homeoffice ?? UNKNOWN_KEY);
        bump(byEquipmentType, asset.equipmentmodel.equipmenttype || UNKNOWN_KEY);
        bump(byAssetGroup, findModel(store, asset)?.assetgroup ?? UNKNOWN_KEY);

        // FR-011/FR-012: informational tallies WITHIN total, not exclusions from it — total must
        // stay reconciled with listAssets(filter).length (SC-003). A temporary tag still belongs
        // to the company (it just needs catalogue completion, feature 002 FR-032); marking rather
        // than excluding is also spec.md's own explicit alternative for third-party ownership
        // ("exclude, or clearly mark" — FR-012), chosen here specifically to preserve exact
        // reconciliation, which excluding would silently break.
        if (isTemporaryAssetId(asset.assetid)) temporaryTags += 1;
        if (isThirdPartyOwned(asset)) thirdPartyOwned += 1;
      }

      return { byOffice, byAssetGroup, byEquipmentType, total: assets.length, temporaryTags, thirdPartyOwned };
    },

    async getCalibrationCounts(horizonDays: number): Promise<CalibrationCounts> {
      await store.ready;
      const now = new Date();
      const asOf = now.toISOString();
      const today = asOf.slice(0, 10);
      const horizon = new Date(now);
      horizon.setDate(horizon.getDate() + horizonDays);
      const horizonIso = horizon.toISOString().slice(0, 10);

      const byOffice: CalibrationCounts["byOffice"] = {};

      for (const asset of store.assets.values()) {
        if (asset.lifecycle === "Retired") continue; // FR-029 — current counts exclude retired
        const model = findModel(store, asset);
        // Same "does this model even get calibrated" test as listCalibrationDue (feature 004) —
        // a model with no interval and an asset with no cal history/due date never had
        // calibration tracked for it at all, so it belongs in no bucket, not "unknown".
        const isCalibrated = (model?.defaultcalintervalmonths ?? null) !== null || asset.nextcaldue !== null || asset.lastcaldate !== null;
        if (!isCalibrated) continue;

        const office = asset.homeoffice ?? UNKNOWN_KEY;
        const bucket = (byOffice[office] ??= { inCalibration: 0, dueSoon: 0, overdue: 0, unknown: 0 });

        if (asset.status === "InCalibration") {
          bucket.inCalibration += 1; // FR-013: already at the lab — not also "overdue"/"due soon"
        } else if (!asset.nextcaldue) {
          bucket.unknown += 1; // FR-017: counted explicitly, never omitted
        } else if (asset.nextcaldue < today) {
          bucket.overdue += 1; // FR-013/FR-015
        } else if (asset.nextcaldue <= horizonIso) {
          bucket.dueSoon += 1;
        }
        // else: due beyond the horizon — outside every bucket, consistent with
        // listCalibrationDue's own horizon filtering (feature 004).
      }

      return { byOffice, asOf };
    },
  };
}
