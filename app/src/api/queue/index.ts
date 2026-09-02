/**
 * Public surface of the offline submission queue (feature 003 US5, WS-C). See SubmissionQueue.ts
 * for the engine and its full design comment.
 *
 * getSubmissionQueue() is the one instance the running app shares. api/mock/offline.ts calls it
 * with no transport — it only ever needs to list current state for FR-040's pending indicator.
 * features/offline/NeedsAttentionPage.tsx calls it WITH `backend` (from api/index.ts — the same
 * seam every other screen already uses, per specs/AGENT-BRIEF.md's invariant 1) so its Retry
 * button has something to actually resend through. Whichever call happens first creates the
 * instance; a later call that supplies a transport attaches it if one was not set yet.
 *
 * This file deliberately imports nothing from api/mock or api/index — it never decides which
 * backend is "the" backend, which is what lets it drop onto api/dataverse/ unchanged later.
 */
import { SubmissionQueue } from "./SubmissionQueue";
import type { SubmissionTransport } from "./types";

let instance: SubmissionQueue | null = null;

export function getSubmissionQueue(transport?: SubmissionTransport): SubmissionQueue {
  if (!instance) {
    instance = new SubmissionQueue(transport);
  } else if (transport) {
    instance.setTransport(transport);
  }
  return instance;
}

/** Test-only: drop the shared instance (and its 'online' listener) so tests don't leak queue
 * state or event listeners across test files. */
export function resetSubmissionQueueForTesting(): void {
  instance?.dispose();
  instance = null;
}

export { SubmissionQueue } from "./SubmissionQueue";
export type { SubmissionQueueOptions } from "./SubmissionQueue";
export * from "./types";
