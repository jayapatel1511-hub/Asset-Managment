/**
 * FR-028: deployment forms are long and sites often have no signal — a partially completed form
 * must survive interruption (backgrounding the app, a dropped connection, a phone that reboots).
 * This is a plain localStorage mirror of the form's own state, restored on reopen and cleared
 * only on a successful submit. Not a network queue (that's feature 003 US5 / WS-C's
 * api/queue/**) — this is purely "don't lose what the technician already typed".
 */
const DRAFT_KEY = "ams-deploy-draft-v1";

export interface DeployDraftComponent {
  assetId: string;
  kitRole: string;
  orientation?: string;
}

export interface DeployDraft {
  primaryAssetId: string;
  project: string;
  components: DeployDraftComponent[];
  site: string;
  locationtype: string;
  sitename: string;
  position: string;
  latitude: string;
  longitude: string;
  coordinatesource: string | null;
  powersource: string;
  deploymentDate: string;
  notes: string;
}

export function saveDraft(draft: DeployDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // localStorage can throw (private browsing, quota) — losing draft persistence is not fatal,
    // the in-memory form state still works for this session.
  }
}

export function loadDraft(): DeployDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DeployDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing to do — worst case the stale draft prompts a restore next time, which the
    // technician can dismiss by submitting or clearing the form again.
  }
}
