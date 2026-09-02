/**
 * Feature 003 US5 — offline queueing. Owned exclusively by WS-C after Phase 0.
 *
 * No contract doc exists for this workstream (unlike 005/006) — `listPendingSubmissions` is the
 * orchestrator's own minimal addition to AmsBackend, made in Phase 0 so there is a fixed target.
 * See api/types.ts's PendingSubmission comment for why its storage almost certainly does NOT
 * live in MockStore.
 *
 * Implementation notes for WS-C (delete once a real body exists):
 *   - specs/REMAINING-WORK.md's WS-C section is the spec here (no spec.md exists solely for
 *     this — it's feature 003 US5, FR-036 through FR-040). Build api/queue/** as a transport-
 *     agnostic queue with an injectable transport and a fault-injecting fake for tests; this
 *     file's job is just to expose that queue's state through the one AmsBackend method a screen
 *     needs (a "pending" badge per FR-040, a "needs attention" list per FR-039).
 *   - Do NOT make this file call store.applyTransaction directly to "simulate" offline — the
 *     queue should wrap calls to the EXISTING submitCheckout/submitReturn/submitTransfer, which
 *     already accept clientSubmissionId and are idempotent (FR-007), so replay-after-reconnect
 *     is "call the same method again with the same id," not a new write path.
 */
import type { OfflineMethods } from "../AmsBackend";
import type { CurrentUser, PendingSubmission } from "../types";
import type { MockStore } from "./store";

export function createOfflineMethods(
  _store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): OfflineMethods {
  return {
    async listPendingSubmissions(): Promise<PendingSubmission[]> {
      throw new Error("not implemented — WS-C (specs/REMAINING-WORK.md § WS-C)");
    },
  };
}
