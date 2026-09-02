/**
 * Types for the offline submission queue (feature 003 US5, WS-C — FR-036 through FR-040).
 * See SubmissionQueue.ts's header comment for the full engine design; this file only holds the
 * shapes shared between the engine, its tests, and api/mock/offline.ts's listPendingSubmissions()
 * mapping.
 */
import type { AmsBackend, CheckoutInput, ReturnInput, SubmissionOutcome, TransferInput } from "../AmsBackend";
import type { PendingSubmissionKind, PendingSubmissionStatus } from "../types";

/**
 * The one thing SubmissionQueue depends on to actually send anything — structurally satisfied by
 * the real AmsBackend (every screen's `backend` from api/index.ts already has these three
 * methods) with zero adapter code, and just as easily by a fault-injecting fake in tests. This is
 * what makes the queue drop onto api/dataverse/ unchanged later: nothing in api/queue/** ever
 * imports api/mock or api/dataverse — it only ever sees whatever transport it is handed.
 *
 * Contract each method must honour, exactly like the real submit* methods already do (FR-007):
 *   - resolve `{ ok: true, ... }`      the server accepted it (idempotent replay included).
 *   - resolve `{ ok: false, reason }`  the server understood the request and refused it.
 *   - reject / throw                   the request never reliably reached or returned from the
 *                                      server — a connectivity failure, indistinguishable from
 *                                      "offline" from the queue's point of view.
 */
export type SubmissionTransport = Pick<AmsBackend, "submitCheckout" | "submitReturn" | "submitTransfer">;

export type QueueableInput = CheckoutInput | ReturnInput | TransferInput;

/**
 * One submission the device has accepted but the server has not (yet, or ever) acknowledged.
 * Mirrors api/types.ts's PendingSubmission (the AmsBackend-facing read shape) plus the extra
 * fields the engine itself needs to actually replay the submission later.
 */
export interface QueuedSubmission {
  id: string;
  kind: PendingSubmissionKind;
  clientSubmissionId: string;
  input: QueueableInput;
  affectedAssetIds: string[];
  /** ISO timestamp, for display only — actual replay order is array (insertion) order, see
   * SubmissionQueue.ts, so it is never subject to clock-resolution ties. */
  queuedAt: string;
  status: PendingSubmissionStatus;
  rejectionReason: string | null;
  attempts: number;
}

export type AttemptResult =
  | { kind: "sent"; outcome: SubmissionOutcome }
  | { kind: "rejected"; outcome: SubmissionOutcome }
  | { kind: "networkError" };

export type SubmitResult = { delivered: true; outcome: SubmissionOutcome } | { delivered: false; submission: QueuedSubmission };

export interface FlushSummary {
  sent: number;
  rejected: number;
  remaining: number;
}
