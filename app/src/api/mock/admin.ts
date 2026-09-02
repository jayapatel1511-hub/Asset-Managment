/**
 * Feature 004 US4 — office → administrator assignment. Owned exclusively by WS-D after Phase 0.
 *
 * No contract doc exists for this workstream either — orchestrator's own minimal design (see
 * api/types.ts's OfficeAdminAssignment comment). Notification delivery itself needs the tenant
 * (solution/flows/F3); this is just the assignment data and the FR-027a gap report that flow
 * needs, buildable and testable without one.
 *
 * Gap signal (documenting the choice AGENT-BRIEF left to WS-D): `OfficeAdminAssignment` (frozen
 * in api/types.ts, Phase 0) has no separate `isGap` field — an empty `adminUpns` array IS the
 * gap signal (its own doc comment says so: "empty = FR-027a gap"). No computed field is added
 * here; the office list this module returns always includes every office from store.locations,
 * and an office with no saved assignment (or an assignment saved with an empty list) surfaces
 * with `adminUpns: []`, which the UI (OfficeAdminsPage.tsx) treats as the gap condition.
 */
import type { AdminAssignmentMethods, SubmissionOutcome } from "../AmsBackend";
import type { CurrentUser, OfficeAdminAssignment } from "../types";
import type { MockStore } from "./store";

export function createAdminMethods(
  store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): AdminAssignmentMethods {
  return {
    async listOfficeAdminAssignments(): Promise<OfficeAdminAssignment[]> {
      await store.ready;
      // FR-027 / the N-offices decision (data/reference/office_admins.README.md): the office list
      // is derived from store.locations every call, never cached or hard-coded, so an eleventh
      // office added to the location table is covered with zero configuration change here.
      const offices = store.locations.filter((l) => l.locationtype === "Office");
      return offices.map((office) => {
        const saved = store.officeAdminAssignments.find((a) => a.office === office.name);
        return { office: office.name, adminUpns: saved?.adminUpns ?? [] };
      });
    },

    async setOfficeAdmins(office: string, adminUpns: string[], _clientSubmissionId: string): Promise<SubmissionOutcome> {
      await store.ready;
      const isKnownOffice = store.locations.some((l) => l.locationtype === "Office" && l.name === office);
      if (!isKnownOffice) {
        return { ok: false, reason: `${office} is not a known office — pick one from the location table.` };
      }

      // Dedupe (case-insensitive) while preserving first-seen casing, and drop blanks — this is
      // reference-data maintenance (a text input standing in for a directory picker, per
      // AGENT-BRIEF's guidance), not a transaction, so validation here is just data hygiene.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of adminUpns) {
        const upn = raw.trim();
        if (!upn) continue;
        const key = upn.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(upn);
      }

      const entry: OfficeAdminAssignment = { office, adminUpns: cleaned };
      const idx = store.officeAdminAssignments.findIndex((a) => a.office === office);
      if (idx >= 0) {
        // Replace, never merge (AGENT-BRIEF: "replace (not merge) the admin list for that office").
        store.officeAdminAssignments[idx] = entry;
      } else {
        store.officeAdminAssignments.push(entry);
      }

      // Reference data, not a transaction — no asset state changes, so this goes straight to
      // store.persist() rather than store.applyTransaction (which is for eng_asset current-state
      // changes derived from deriveState; there is nothing to derive here).
      store.persist();

      return { ok: true, transactionId: `office-admins-${office}`, transactionName: office };
    },
  };
}
