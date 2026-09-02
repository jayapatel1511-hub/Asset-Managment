/**
 * Feature 003 US5 — offline queueing. Owned exclusively by WS-C.
 *
 * The engine lives in api/queue/ (see SubmissionQueue.ts's header comment for the full design).
 * This file's only job, per its own original stub comment, is to expose that queue's state
 * through the one AmsBackend method a screen needs (a "pending" badge per FR-040, a "needs
 * attention" list per FR-039). It deliberately does NOT call store.applyTransaction, or anything
 * else on `store`, to simulate offline behaviour — the queue wraps the EXISTING
 * submitCheckout/submitReturn/submitTransfer (see api/queue/index.ts's header comment for how a
 * screen attaches them as the queue's transport), which already accept clientSubmissionId and are
 * idempotent (FR-007), so replay-after-reconnect is "call the same method again", not a second
 * write path.
 *
 * `_store` and `_getCurrentUser` are accepted only because api/mock/index.ts's factory call site
 * (frozen) always passes both to every createXMethods() — the queue's state is per-device
 * submission metadata, not asset data (see api/types.ts's PendingSubmission comment), so neither
 * parameter is actually needed here.
 */
import type { OfflineMethods } from "../AmsBackend";
import { getSubmissionQueue } from "../queue";
import type { CurrentUser, PendingSubmission } from "../types";
import type { MockStore } from "./store";

export function createOfflineMethods(
  _store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): OfflineMethods {
  return {
    async listPendingSubmissions(): Promise<PendingSubmission[]> {
      return getSubmissionQueue()
        .list()
        .map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          queuedAt: entry.queuedAt,
          status: entry.status,
          affectedAssetIds: entry.affectedAssetIds,
          rejectionReason: entry.rejectionReason,
        }));
    },
  };
}
