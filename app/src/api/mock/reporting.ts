/**
 * Feature 006 — Fleet Reporting. Owned exclusively by WS-B after Phase 0.
 *
 * Implementation notes for WS-B (delete once real bodies exist):
 *   - This feature writes nothing (see plan.md's Constitution Check — Principle I row: "adds no
 *     write path at all"). Both methods are pure reads over the existing store.
 *   - getFleetCounts MUST reconcile exactly with listAssets over the same filter (SC-003) — the
 *     cleanest way to guarantee that is to literally filter store.assets the same way
 *     ../mock/index.ts's listAssets does, then group-count, rather than writing a second query.
 *   - domain/pointInTime.ts and domain/utilisation.ts (also WS-B's) have no store dependency at
 *     all — they take HistoryEntry[] and dates, and this file is where their output gets called
 *     from the backend seam, if a screen needs it through AmsBackend rather than calling the
 *     pure functions directly (screens may import domain/ directly; only mutations must go
 *     through AmsBackend).
 */
import type { AssetFilter, ReportingMethods } from "../AmsBackend";
import type { CalibrationCounts, CurrentUser, FleetCounts } from "../types";
import type { MockStore } from "./store";

export function createReportingMethods(
  _store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): ReportingMethods {
  return {
    async getFleetCounts(_filter?: AssetFilter): Promise<FleetCounts> {
      throw new Error("not implemented — WS-B (specs/006-fleet-reporting)");
    },
    async getCalibrationCounts(_horizonDays: number): Promise<CalibrationCounts> {
      throw new Error("not implemented — WS-B (specs/006-fleet-reporting)");
    },
  };
}
