/**
 * The offline submission queue engine (feature 003 US5, WS-C — FR-036 through FR-040).
 *
 * ARCHITECTURE (read this before touching a call site elsewhere):
 *
 *   This module creates the network boundary the mock backend does not otherwise have (it is a
 *   same-origin static fetch plus localStorage — nothing to fail against on its own). It wraps an
 *   injectable `SubmissionTransport` (types.ts): in production, whichever `AmsBackend` a screen
 *   already has — `backend` from api/index.ts structurally satisfies the transport with zero
 *   adapter code, since it already has submitCheckout/submitReturn/submitTransfer; in tests, a
 *   fault-injecting fake that rejects to simulate a dropped connection, resolves `{ok:false}` to
 *   simulate a real server refusal, or delays to simulate a slow link. Because the transport IS an
 *   AmsBackend's own submit* methods, every replay reuses the same clientSubmissionId the original
 *   attempt carried (FR-007) — the queue never invents a second write path, it just calls the
 *   existing one again, possibly much later. Nothing in api/queue/** imports api/mock or
 *   api/dataverse, which is what lets it drop onto a Dataverse-backed AmsBackend unchanged later.
 *
 *   Two entry points, matching the two situations a caller is in:
 *     enqueue(kind, input)  — definitely queue this now, no attempt to send. For a caller that
 *                             already knows it is offline and does not want to wait out a timeout.
 *     submit(kind, input)   — try the transport once, right now; falls back to the queue only if
 *                             the transport call itself fails to complete (a connectivity
 *                             failure). An immediate `{ok:false}` business refusal (wrong status,
 *                             no project, etc.) is returned to the caller directly, unqueued — the
 *                             technician is present and sees it in real time, which is a different
 *                             situation from FR-039's "rejected on replay, nobody is watching"
 *                             case.
 *
 *   flush() replays every currently "Queued" entry in ARRAY order — the order enqueue()/submit()'s
 *   fallback added them, i.e. the order the technician made them (FR-038) — one at a time, always
 *   awaiting one attempt before starting the next so two lines from the same device are never in
 *   flight together. A resolved `{ok:false}` during replay moves the entry to "Rejected" and keeps
 *   it in the queue for a human (FR-039 — there is no method anywhere in this class that discards
 *   a Rejected entry; the only way out is retry() succeeding). A transport throw during replay is
 *   treated as "still offline": the entry reverts to "Queued" and flush() stops immediately rather
 *   than racing ahead through the rest of the queue while the network is down — order is preserved
 *   for the next attempt. flush() is reentrant-safe (a `flushing` guard coalesces concurrent
 *   callers onto one in-flight pass) since it can legitimately be triggered from more than one
 *   place at once (the browser's 'online' event here, and a screen's own explicit call).
 *
 *   retry(id) is a human resolving one Rejected entry (or nudging a Queued one) from
 *   NeedsAttentionPage's Retry button — the same per-entry logic flush() uses, for one id.
 *
 *   Persistence is this module's own localStorage key (see api/types.ts's PendingSubmission
 *   comment for why this is NOT part of MockStore's snapshot) — survives an app restart (FR-037).
 *   An entry found "Sending" on load (the device closed mid-request — the "sent but not
 *   acknowledged" edge case, US5 scenario 5) is downgraded back to "Queued" rather than trusted
 *   either way: because every replay is idempotent on clientSubmissionId, retrying a request that
 *   actually DID land the first time is always safe (the server just returns ok:true again), so
 *   "assume it needs resending" can never produce a duplicate transaction — at worst it makes one
 *   redundant, already-idempotent network call.
 */
import type { CheckoutInput, ReturnInput, SubmissionOutcome, TransferInput } from "../AmsBackend";
import type { PendingSubmissionKind } from "../types";
import type { AttemptResult, FlushSummary, QueuedSubmission, QueueableInput, SubmissionTransport, SubmitResult } from "./types";

const DEFAULT_STORAGE_KEY = "ams-offline-queue-v1";

export interface SubmissionQueueOptions {
  /** localStorage key. Override in tests that want isolation from other test files / the real app. */
  storageKey?: string;
  /** Set false in tests that want a pure in-memory queue with no localStorage involved at all. */
  persist?: boolean;
  /** Set false in tests that want to control flush() timing explicitly rather than via a real
   * browser 'online' event. Default true. */
  autoFlushOnReconnect?: boolean;
  now?: () => string;
  idFactory?: () => string;
}

function clientSubmissionIdOf(input: QueueableInput): string {
  return input.clientSubmissionId;
}

function affectedAssetIdsFor(kind: PendingSubmissionKind, input: QueueableInput): string[] {
  if (kind === "Transfer") return (input as TransferInput).assetIds;
  return (input as CheckoutInput | ReturnInput).lines.map((l) => l.assetId);
}

export class SubmissionQueue {
  private entries: QueuedSubmission[] = [];
  private transport?: SubmissionTransport;
  private readonly storageKey: string;
  private readonly persistEnabled: boolean;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private onlineHandler?: () => void;
  private flushing: Promise<FlushSummary> | null = null;

  constructor(transport?: SubmissionTransport, options: SubmissionQueueOptions = {}) {
    this.transport = transport;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.persistEnabled = options.persist ?? true;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `queued-${crypto.randomUUID()}`);
    this.hydrate();
    if (typeof window !== "undefined" && (options.autoFlushOnReconnect ?? true)) {
      this.onlineHandler = () => {
        void this.flush().catch((err) => {
          // No screen may have attached a transport yet this session (nobody has visited
          // NeedsAttentionPage) — that is a wiring gap, not a reason to crash on the browser's
          // own 'online' event.
          console.warn("SubmissionQueue: flush on reconnect did not complete", err);
        });
      };
      window.addEventListener("online", this.onlineHandler);
    }
  }

  /** Attach (or replace) the transport used to actually send anything. Safe to call more than
   * once — e.g. the first screen that visits NeedsAttentionPage supplies `backend`; nothing else
   * needs to. */
  setTransport(transport: SubmissionTransport): void {
    this.transport = transport;
  }

  /** Removes the 'online' listener. Production never needs this (the queue outlives the page);
   * tests use it so instances from one test don't keep reacting to events in the next. */
  dispose(): void {
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    this.onlineHandler = undefined;
  }

  /** Current queue state, in queued order — what api/mock/offline.ts's listPendingSubmissions()
   * (FR-040) and NeedsAttentionPage's list (FR-039) both read. Copies, not live references. */
  list(): QueuedSubmission[] {
    return this.entries.map((e) => ({ ...e }));
  }

  enqueue(kind: "Checkout", input: CheckoutInput): QueuedSubmission;
  enqueue(kind: "Return", input: ReturnInput): QueuedSubmission;
  enqueue(kind: "Transfer", input: TransferInput): QueuedSubmission;
  enqueue(kind: PendingSubmissionKind, input: QueueableInput): QueuedSubmission {
    return this.enqueueInternal(kind, input);
  }

  submit(kind: "Checkout", input: CheckoutInput): Promise<SubmitResult>;
  submit(kind: "Return", input: ReturnInput): Promise<SubmitResult>;
  submit(kind: "Transfer", input: TransferInput): Promise<SubmitResult>;
  submit(kind: PendingSubmissionKind, input: QueueableInput): Promise<SubmitResult> {
    return this.submitInternal(kind, input);
  }

  /** Replays every "Queued" entry, in order, until one fails to reach the transport at all or the
   * queue runs dry. Reentrant-safe: a caller that invokes this while a pass is already running
   * gets that same pass's result rather than starting a second, interleaved one. */
  flush(): Promise<FlushSummary> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** A human resolving one entry — from NeedsAttentionPage's Retry button (FR-039), or a caller
   * nudging a still-Queued one. Throws if no such entry exists (already sent and removed, or a
   * bad id) or if no transport has ever been attached. */
  async retry(id: string): Promise<AttemptResult> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`SubmissionQueue: no queued submission with id ${id}.`);
    return this.attemptOne(entry);
  }

  private enqueueInternal(kind: PendingSubmissionKind, input: QueueableInput): QueuedSubmission {
    const clientSubmissionId = clientSubmissionIdOf(input);
    // Double-tap / retry-after-lost-response (edge case: "cart submitted twice"): one local
    // record per clientSubmissionId, not two, regardless of how many times enqueue() is called
    // for it.
    const existing = this.entries.find((e) => e.clientSubmissionId === clientSubmissionId);
    if (existing) return { ...existing };
    const entry: QueuedSubmission = {
      id: this.idFactory(),
      kind,
      clientSubmissionId,
      input,
      affectedAssetIds: affectedAssetIdsFor(kind, input),
      queuedAt: this.now(),
      status: "Queued",
      rejectionReason: null,
      attempts: 0,
    };
    this.entries.push(entry);
    this.persist();
    return { ...entry };
  }

  private async submitInternal(kind: PendingSubmissionKind, input: QueueableInput): Promise<SubmitResult> {
    const clientSubmissionId = clientSubmissionIdOf(input);
    const already = this.entries.find((e) => e.clientSubmissionId === clientSubmissionId);
    if (already) return { delivered: false, submission: { ...already } };

    if (this.transport) {
      try {
        const outcome = await this.callTransport(kind, input);
        return { delivered: true, outcome };
      } catch {
        // Connectivity failure — fall through to queueing below.
      }
    }
    return { delivered: false, submission: this.enqueueInternal(kind, input) };
  }

  private async runFlush(): Promise<FlushSummary> {
    let sent = 0;
    let rejected = 0;
    for (const entry of [...this.entries]) {
      if (entry.status !== "Queued") continue; // Rejected waits for a human via retry(); Sending shouldn't occur between passes
      const result = await this.attemptOne(entry);
      if (result.kind === "sent") sent++;
      else if (result.kind === "rejected") rejected++;
      else break; // networkError — still offline; stop here so order is preserved for the next pass
    }
    return { sent, rejected, remaining: this.entries.filter((e) => e.status === "Queued").length };
  }

  private async attemptOne(entry: QueuedSubmission): Promise<AttemptResult> {
    if (!this.transport) throw new Error("SubmissionQueue: no transport configured — call setTransport() first.");
    entry.status = "Sending";
    entry.attempts += 1;
    this.persist();
    try {
      const outcome = await this.callTransport(entry.kind, entry.input);
      if (outcome.ok) {
        this.entries = this.entries.filter((e) => e.id !== entry.id);
        this.persist();
        return { kind: "sent", outcome };
      }
      entry.status = "Rejected";
      entry.rejectionReason = outcome.reason;
      this.persist();
      return { kind: "rejected", outcome };
    } catch {
      entry.status = "Queued";
      this.persist();
      return { kind: "networkError" };
    }
  }

  private callTransport(kind: PendingSubmissionKind, input: QueueableInput): Promise<SubmissionOutcome> {
    if (!this.transport) throw new Error("SubmissionQueue: no transport configured — call setTransport() first.");
    switch (kind) {
      case "Checkout":
        return this.transport.submitCheckout(input as CheckoutInput);
      case "Return":
        return this.transport.submitReturn(input as ReturnInput);
      case "Transfer":
        return this.transport.submitTransfer(input as TransferInput);
    }
  }

  private persist(): void {
    if (!this.persistEnabled) return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {
      // localStorage can throw (private browsing, quota) — in-memory state is still correct for
      // this session; a reload would just re-hydrate from whatever was last durably written.
    }
  }

  private hydrate(): void {
    if (!this.persistEnabled) return;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as QueuedSubmission[];
      // A "Sending" entry persisted right before the app closed means we never learned whether
      // the request landed — see this file's header comment for why "assume it needs resending"
      // is always safe.
      this.entries = parsed.map((e) => (e.status === "Sending" ? { ...e, status: "Queued" } : e));
    } catch {
      this.entries = [];
    }
  }
}
