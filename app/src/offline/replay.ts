/**
 * The replay coordinator - WS-W6's "replay coordinator", and the enforcement point for three of
 * its rules: "replay while app is active; Background Sync is optional enhancement", "no replay
 * under another identity", and "conflicts are visible and never silently dropped".
 *
 * WHERE THE GUARD SITS, AND WHY THERE:
 *
 *   The obvious place to check identity is before calling `queue.flush()`. That is not enough: a
 *   flush replays N commands in one pass, and the check would happen once for all of them. So the
 *   guard is wrapped around the *transport* instead - the thing the engine calls to put one
 *   command on the wire (api/queue/types.ts's SubmissionTransport). Every single command passes
 *   through `createGuardedTransport` on its way out, and the check runs per command, against that
 *   command's own durable `originObjectId`.
 *
 *   The guard refuses by *throwing*. That is deliberate and it exploits behaviour the engine
 *   already has: `SubmissionQueue.attemptOne` treats a transport throw as "still offline" - it
 *   reverts the entry to Queued, and `runFlush` stops the whole pass rather than racing on. So a
 *   held command is (1) not sent, (2) not lost, (3) not reordered, and (4) does not let the
 *   commands behind it jump the queue. Returning `{ok:false}` instead would have marked it
 *   Rejected, which is a *server* verdict this device has no right to invent.
 *
 * WHY AUTH EXPIRY IS NOT A NETWORK ERROR:
 *   `api/http/index.ts` throws on any non-JSON response, so a 401 arrives at the queue looking
 *   exactly like a dead link, and the queue would retry it forever on every reconnect while the
 *   technician sees nothing. `classifyTransportFailure` separates the two, and an auth expiry
 *   stops replay and raises a conflict that says "sign in again" - the one thing that will
 *   actually fix it.
 *
 * WHY BACKGROUND SYNC IS AN ENHANCEMENT AND NOT THE MECHANISM:
 *   iOS Safari does not implement it at all, which is most of the fleet's phones. More
 *   fundamentally, a service worker cannot replay these commands: the transport is an AmsBackend
 *   living in the page, with the page's session. So the worker's only role is to *wake a client*
 *   (see sw.ts's `sync` handler posting REPLAY_REQUEST); the replay itself always happens here,
 *   while the app is active. If Background Sync is missing, nothing is lost except the wake-up.
 */
import type { SubmissionOutcome } from "../api/AmsBackend";
import type { CheckoutInput, ReturnInput, TransferInput } from "../api/AmsBackend";
import type { FlushSummary, QueuedSubmission, SubmissionTransport } from "../api/queue/types";
import { recordConflict, resolveConflictsFor, type ConflictKind } from "./conflicts";
import type { OfflineDb } from "./db";
import type { CachePartition } from "./partition";
import type { DurableCommandStore } from "./queueStore";

/** The bit of SubmissionQueue this module uses. Structural, so nothing here depends on the engine's
 * construction or its localStorage behaviour - only on its published contract. */
export interface ReplayableQueue {
  list(): QueuedSubmission[];
  flush(): Promise<FlushSummary>;
  setTransport(transport: SubmissionTransport): void;
}

export type ReplayBlockReason = "no-identity" | "identity-changed" | "auth-expired" | "offline" | "storage-unavailable";

export interface ReplaySummary extends FlushSummary {
  /** Present when the pass stopped for a reason a human needs to know about. */
  readonly blocked: ReplayBlockReason | null;
  /** Commands withheld this pass because a different identity queued them. */
  readonly held: number;
}

/** Thrown by the guarded transport to withhold one command. Never leaves this module's surface. */
export class ReplayHeldError extends Error {
  constructor(readonly reason: ReplayBlockReason, message: string) {
    super(message);
    this.name = "ReplayHeldError";
  }
}

/**
 * Sort a transport failure into "the link is down" and "the session is gone".
 *
 * Coupled to the message `api/http/index.ts` builds (`"POST /path failed: 401 Unauthorized"`) and
 * to a duck-typed numeric `status`, so an adapter that throws a richer error is understood without
 * changing this. Anything unrecognised is treated as a network error, which is the safe default:
 * the command stays queued and is retried, rather than being written off.
 */
export function classifyTransportFailure(error: unknown): "auth-expired" | "network" {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && (status === 401 || status === 403)) return "auth-expired";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(401|403)\b|unauthori[sz]ed|forbidden|session expired/i.test(message) ? "auth-expired" : "network";
}

export interface GuardedTransportOptions {
  readonly inner: SubmissionTransport;
  readonly store: DurableCommandStore;
  /** The signed-in Entra objectId, read fresh on every call - a same-device user change must be
   * seen mid-session, not only at boot. */
  readonly currentObjectId: () => string | null;
  readonly onConflict: (kind: ConflictKind, subject: string, detail: string, assetIds: string[]) => Promise<void> | void;
  readonly onAccepted?: (clientSubmissionId: string) => Promise<void> | void;
}

interface GuardedTransportState {
  lastFailure: "auth-expired" | "network" | null;
  held: number;
}

/**
 * Wrap a transport so that every command is identity-checked before it leaves the device and
 * every outcome is recorded durably.
 */
export function createGuardedTransport(options: GuardedTransportOptions): SubmissionTransport & { state: GuardedTransportState } {
  const state: GuardedTransportState = { lastFailure: null, held: 0 };

  async function guard<T extends { clientSubmissionId: string }>(
    input: T,
    assetIds: string[],
    send: (value: T) => Promise<SubmissionOutcome>,
  ): Promise<SubmissionOutcome> {
    const signedIn = options.currentObjectId();
    if (!signedIn) {
      state.held += 1;
      throw new ReplayHeldError("no-identity", "Replay refused: nobody is signed in on this device.");
    }

    const row = await options.store.findBySubmissionId(input.clientSubmissionId);
    if (row && row.originObjectId !== signedIn) {
      state.held += 1;
      await options.store.markHeld(row.id, `Queued by ${row.originObjectId}; ${signedIn} is signed in now.`);
      await options.onConflict(
        "identity-mismatch",
        input.clientSubmissionId,
        "This submission was made by a different signed-in user and will not be sent under yours. It is kept until they sign in again.",
        assetIds,
      );
      throw new ReplayHeldError("identity-changed", "Replay refused: this command was queued under a different identity.");
    }

    let outcome: SubmissionOutcome;
    try {
      outcome = await send(input);
    } catch (error) {
      const failure = classifyTransportFailure(error);
      state.lastFailure = failure;
      if (failure === "auth-expired") {
        await options.onConflict(
          "auth-expired",
          input.clientSubmissionId,
          "Your session expired before this submission could be sent. Sign in again and it will be retried.",
          assetIds,
        );
      }
      throw error;
    }

    state.lastFailure = null;
    if (outcome.ok) {
      await options.onAccepted?.(input.clientSubmissionId);
      await options.store.markAccepted(input.clientSubmissionId);
    } else {
      await options.store.markRejected(input.clientSubmissionId, outcome.reason ?? null);
      await options.onConflict("rejected", input.clientSubmissionId, outcome.reason ?? "The server refused this submission.", assetIds);
    }
    return outcome;
  }

  return {
    state,
    submitCheckout: (input: CheckoutInput) => guard(input, input.lines.map((line) => line.assetId), (value) => options.inner.submitCheckout(value)),
    submitReturn: (input: ReturnInput) => guard(input, input.lines.map((line) => line.assetId), (value) => options.inner.submitReturn(value)),
    submitTransfer: (input: TransferInput) => guard(input, input.assetIds, (value) => options.inner.submitTransfer(value)),
  };
}

export interface ReplayCoordinatorOptions {
  readonly queue: ReplayableQueue;
  readonly transport: SubmissionTransport;
  readonly store: DurableCommandStore;
  readonly db: OfflineDb;
  readonly partition: CachePartition;
  readonly currentObjectId: () => string | null;
  /** Poll interval while the document is visible. Cheap - `list()` is an in-memory array read -
   * and it is the backstop for the case where no event fires: a link that comes back without an
   * `online` event, which is ordinary on a phone switching cell towers. */
  readonly intervalMs?: number;
  /** Injected in tests. Defaults to `window`. */
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly documentRef?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  readonly isOnline?: () => boolean;
  readonly onSummary?: (summary: ReplaySummary) => void;
}

export const DEFAULT_REPLAY_INTERVAL_MS = 30_000;

export class ReplayCoordinator {
  private readonly options: ReplayCoordinatorOptions;
  private readonly guarded: ReturnType<typeof createGuardedTransport>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<ReplaySummary> | null = null;
  private listeners: Array<() => void> = [];
  /** The identity in force when the queue was hydrated. A change means the array in the engine
   * belongs to somebody else and must not be replayed at all. */
  private bootObjectId: string | null;

  constructor(options: ReplayCoordinatorOptions) {
    this.options = options;
    this.bootObjectId = options.currentObjectId();
    this.guarded = createGuardedTransport({
      inner: options.transport,
      store: options.store,
      currentObjectId: options.currentObjectId,
      onConflict: (kind, subject, detail, affectedAssetIds) =>
        recordConflict(options.db, options.partition, { kind, subject, detail, affectedAssetIds }).then(() => undefined),
      onAccepted: (clientSubmissionId) => resolveConflictsFor(options.db, clientSubmissionId).then(() => undefined),
    });
    options.queue.setTransport(this.guarded);
  }

  /** Attach the active-app triggers. Safe to call twice. */
  start(): void {
    if (this.listeners.length > 0) return;
    const target = this.options.target ?? (typeof window !== "undefined" ? window : undefined);
    const doc = this.options.documentRef ?? (typeof document !== "undefined" ? document : undefined);

    if (target) {
      const onOnline = () => void this.replayNow();
      const onFocus = () => void this.replayNow();
      target.addEventListener("online", onOnline);
      target.addEventListener("focus", onFocus);
      this.listeners.push(() => target.removeEventListener("online", onOnline));
      this.listeners.push(() => target.removeEventListener("focus", onFocus));
    }
    if (doc) {
      const onVisible = () => {
        if (doc.visibilityState === "visible") void this.replayNow();
      };
      doc.addEventListener("visibilitychange", onVisible);
      this.listeners.push(() => doc.removeEventListener("visibilitychange", onVisible));
    }

    const interval = this.options.intervalMs ?? DEFAULT_REPLAY_INTERVAL_MS;
    if (interval > 0) {
      this.timer = setInterval(() => {
        if (doc && doc.visibilityState !== "visible") return; // never burn battery in the background
        void this.replayNow();
      }, interval);
      this.listeners.push(() => {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
      });
    }
  }

  stop(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  /** Tell the coordinator the signed-in identity changed. The engine's in-memory array still
   * belongs to the previous user, so replay stops until the app reloads and boots the queue under
   * the new identity (see bootOfflineQueue in index.ts). */
  notifyIdentityChanged(objectId: string | null): void {
    this.bootObjectId = objectId;
  }

  /** One replay pass. Reentrant-safe: concurrent callers share the in-flight pass, matching
   * SubmissionQueue.flush()'s own guard. */
  replayNow(): Promise<ReplaySummary> {
    if (this.running) return this.running;
    this.running = this.runPass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runPass(): Promise<ReplaySummary> {
    const summarise = (summary: FlushSummary, blocked: ReplayBlockReason | null, held: number): ReplaySummary => {
      const result: ReplaySummary = { ...summary, blocked, held };
      this.options.onSummary?.(result);
      return result;
    };
    const idle = (): FlushSummary => ({ sent: 0, rejected: 0, remaining: this.pendingCount() });

    const signedIn = this.options.currentObjectId();
    if (!signedIn) return summarise(idle(), "no-identity", 0);

    if (this.bootObjectId !== null && signedIn !== this.bootObjectId) {
      // Belt and braces with the per-command guard: even if the durable rows were lost, a queue
      // hydrated under one identity is never replayed under another. `flush()` is not called at
      // all here, so nothing reaches the network and the per-command guard is never consulted -
      // which is why the durable rows have to be marked held from this branch too, or Needs
      // attention would show them as ordinary pending work that is quietly never sent.
      const held = await this.holdRowsNotBelongingTo(signedIn);
      await recordConflict(this.options.db, this.options.partition, {
        kind: "identity-mismatch",
        subject: "session",
        detail: "A different user signed in on this device. Queued submissions from the previous session are held until they sign in again.",
      });
      return summarise(idle(), "identity-changed", held);
    }

    const online = this.options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
    if (!online()) return summarise(idle(), "offline", 0);

    const heldBefore = this.guarded.state.held;
    this.guarded.state.lastFailure = null;
    const summary = await this.options.queue.flush();
    const held = this.guarded.state.held - heldBefore;

    let blocked: ReplayBlockReason | null = null;
    if (held > 0) blocked = "identity-changed";
    else if (this.guarded.state.lastFailure === "auth-expired") blocked = "auth-expired";
    else if (this.guarded.state.lastFailure === "network") blocked = "offline";

    return summarise(summary, blocked, held);
  }

  /** Mark every durable row queued by somebody else as held, and report how many. Never deletes:
   * the previous user's work is theirs, and they get it back when they sign in again. */
  private async holdRowsNotBelongingTo(objectId: string): Promise<number> {
    const rows = await this.options.store.listAll();
    const foreign = rows.filter((row) => row.originObjectId !== objectId && row.status !== "HeldForIdentity");
    for (const row of foreign) {
      await this.options.store.markHeld(row.id, `Queued by ${row.originObjectId}; ${objectId} is signed in now.`);
    }
    return foreign.length;
  }

  private pendingCount(): number {
    return this.options.queue.list().filter((entry) => entry.status === "Queued" || entry.status === "Sending").length;
  }
}

/**
 * Register Background Sync, if the browser has it. Enhancement only - see this file's header.
 * Returns whether registration succeeded, purely so a caller can log it; nothing branches on it.
 */
export async function registerBackgroundSync(registration: ServiceWorkerRegistration, tag = "ams-replay"): Promise<boolean> {
  const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
  if (!sync) return false;
  try {
    await sync.register(tag);
    return true;
  } catch {
    return false;
  }
}
