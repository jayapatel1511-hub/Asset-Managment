/**
 * Registering the service worker and deciding when an update is allowed to take over - WS-W6's
 * "service-worker update behavior", and CLAUDE.md's offline rule "Preserve queued commands across
 * service-worker updates."
 *
 * WHAT GOES WRONG IF YOU JUST CALL skipWaiting():
 *
 *   The usual recipe is `self.skipWaiting()` in `install` plus `clients.claim()` in `activate`, so
 *   an update takes effect immediately. On this app that is a data-loss shape. A technician on a
 *   site with three queued check-outs reconnects; a replay pass starts; a deploy landed an hour
 *   ago, so the new worker installs and claims the page mid-pass. The old page keeps its
 *   JavaScript, but the module graph it is running and the worker now controlling it disagree, and
 *   any in-flight request can be re-routed by a worker that has just wiped the previous
 *   generation's caches.
 *
 *   The queued commands themselves are safe either way - they are in IndexedDB and localStorage,
 *   which a worker update does not touch (see sw.ts's activate: it deletes `ams-shell-*` caches
 *   and nothing else). But "safe" is not the standard here; the standard is that a replay pass is
 *   never interrupted by something the user did not ask for. So:
 *
 *     queue empty     -> apply the update now; nothing is in flight and the next load is current.
 *     queue non-empty -> stay on the current worker, tell the caller an update is waiting, and
 *                        apply it after the queue drains or when the user asks.
 *
 *   `decideServiceWorkerUpdate` is that rule as a pure function so it can be tested without a
 *   registration, a worker, or a browser.
 */

export type UpdateAction = "apply-now" | "defer";

export interface UpdateDecisionInput {
  /** Commands still Queued or Sending in the submission queue. */
  readonly pendingCommands: number;
  /** True when a human pressed "update now" - an explicit choice outranks the heuristic. */
  readonly userRequested?: boolean;
  /** True when a replay pass is running at this instant. */
  readonly replayInFlight?: boolean;
}

export interface UpdateDecision {
  readonly action: UpdateAction;
  readonly reason: string;
}

export function decideServiceWorkerUpdate(input: UpdateDecisionInput): UpdateDecision {
  if (input.replayInFlight) {
    // Even an explicit request waits for the pass to finish - it is seconds, and interrupting it
    // is the one thing this function exists to prevent.
    return { action: "defer", reason: "a replay pass is in flight" };
  }
  if (input.userRequested) {
    return { action: "apply-now", reason: "the user asked for the update" };
  }
  if (input.pendingCommands > 0) {
    return { action: "defer", reason: `${input.pendingCommands} submission(s) still queued` };
  }
  return { action: "apply-now", reason: "no queued submissions" };
}

export interface ServiceWorkerHandle {
  readonly registration: ServiceWorkerRegistration | null;
  /** A newer worker is installed and waiting for permission to take over. */
  hasUpdate(): boolean;
  /** Ask the waiting worker to activate, subject to `decideServiceWorkerUpdate`. Returns the
   * decision so a caller can show why nothing happened. */
  applyUpdate(input: UpdateDecisionInput): UpdateDecision;
  unregister(): Promise<boolean>;
}

export interface RegisterOptions {
  /** Defaults to `${import.meta.env.BASE_URL}sw.js`. */
  readonly scriptUrl?: string;
  readonly scope?: string;
  /** Called when a new worker reaches `waiting`. The app should surface this, not act on it. */
  readonly onUpdateWaiting?: (handle: ServiceWorkerHandle) => void;
  /** Called when the worker asks a client to replay (its `sync` handler). */
  readonly onReplayRequest?: () => void;
  readonly container?: ServiceWorkerContainer;
}

const inertHandle: ServiceWorkerHandle = {
  registration: null,
  hasUpdate: () => false,
  applyUpdate: () => ({ action: "defer", reason: "no service worker is registered" }),
  unregister: () => Promise.resolve(false),
};

/**
 * Register the worker. Resolves to an inert handle rather than throwing when service workers are
 * unavailable - jsdom, an insecure origin, a browser with them disabled - because every caller's
 * correct response to that is "carry on without offline support", not "fail to boot".
 */
export async function registerServiceWorker(options: RegisterOptions = {}): Promise<ServiceWorkerHandle> {
  const container = options.container ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (!container) return inertHandle;

  const base = import.meta.env?.BASE_URL ?? "/";
  const scriptUrl = options.scriptUrl ?? `${base}sw.js`;

  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register(scriptUrl, { scope: options.scope ?? base, type: "classic" });
  } catch (error) {
    // A failed registration is not a failed app. Offline support is absent; everything else works.
    console.warn("offline: service worker registration failed", error);
    return inertHandle;
  }

  const handle: ServiceWorkerHandle = {
    registration,
    hasUpdate: () => registration.waiting !== null,
    applyUpdate(input) {
      const decision = decideServiceWorkerUpdate(input);
      if (decision.action === "apply-now") registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      return decision;
    },
    unregister: () => registration.unregister(),
  };

  if (registration.waiting) options.onUpdateWaiting?.(handle);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // `controller` is null on the very first install; that is not an update, it is the app
      // becoming installable for the first time and needs no user decision.
      if (installing.state === "installed" && container.controller) options.onUpdateWaiting?.(handle);
    });
  });

  if (options.onReplayRequest) {
    container.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data as { type?: string } | null;
      if (data?.type === "REPLAY_REQUEST") options.onReplayRequest?.();
    });
  }

  return handle;
}
