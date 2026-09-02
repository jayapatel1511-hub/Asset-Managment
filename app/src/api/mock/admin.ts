/**
 * Feature 004 US4 — office → administrator assignment. Owned exclusively by WS-D after Phase 0.
 *
 * No contract doc exists for this workstream either — orchestrator's own minimal design (see
 * api/types.ts's OfficeAdminAssignment comment). Notification delivery itself needs the tenant
 * (solution/flows/F3); this is just the assignment data and the FR-027a gap report that flow
 * needs, buildable and testable without one.
 *
 * Implementation notes for WS-D (delete once real bodies exist):
 *   - `store.officeAdminAssignments` is the new array added in Phase 0 (see store.ts) — read/
 *     write it directly, same pattern as store.relationships elsewhere. store.ts does not need
 *     editing.
 *   - listOfficeAdminAssignments MUST derive its office list from store.locations (locationtype
 *     "Office"), not from a fixed list — that is the entire point of FR-027 replacing
 *     data/reference/office_admins.csv (see that file's own README for why). An office present
 *     in store.locations but absent from store.officeAdminAssignments (or present with an empty
 *     adminUpns array) is a gap per FR-027a — report it, don't skip it.
 *   - setOfficeAdmins is reference-data maintenance, not a transaction — it does not go through
 *     store.applyTransaction (there is no asset state to derive). Still return a
 *     SubmissionOutcome for interface consistency and so a screen can show a uniform
 *     success/error state.
 */
import type { AdminAssignmentMethods } from "../AmsBackend";
import type { CurrentUser } from "../types";
import type { MockStore } from "./store";

export function createAdminMethods(
  _store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): AdminAssignmentMethods {
  return {
    async listOfficeAdminAssignments() {
      throw new Error("not implemented — WS-D (specs/REMAINING-WORK.md § WS-D)");
    },
    async setOfficeAdmins(_office: string, _adminUpns: string[], _clientSubmissionId: string) {
      throw new Error("not implemented — WS-D (specs/REMAINING-WORK.md § WS-D)");
    },
  };
}
