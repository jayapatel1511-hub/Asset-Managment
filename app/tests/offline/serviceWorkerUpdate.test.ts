/**
 * WS-W6 "service-worker update behavior" and the required device test "update with queued
 * commands"; CLAUDE.md's "Preserve queued commands across service-worker updates."
 *
 * The registration half is exercised against a hand-built fake `ServiceWorkerContainer` rather
 * than a real one, because jsdom has no service workers at all. That is honest about what these
 * prove: the *decision* and the *wiring* are covered here; whether a real Chrome or iOS Safari
 * activates the worker when told to is a device test (see the report accompanying this lane).
 */
import { describe, expect, it, vi } from "vitest";
import { decideServiceWorkerUpdate, registerServiceWorker } from "../../src/offline/swRegistration";

describe("when an update may take over", () => {
  it("applies immediately when nothing is queued", () => {
    expect(decideServiceWorkerUpdate({ pendingCommands: 0 })).toEqual({ action: "apply-now", reason: "no queued submissions" });
  });

  it("defers while a technician still has queued submissions", () => {
    const decision = decideServiceWorkerUpdate({ pendingCommands: 3 });
    expect(decision.action).toBe("defer");
    expect(decision.reason).toContain("3 submission(s)");
  });

  it("lets an explicit human choice override the queue-depth heuristic", () => {
    expect(decideServiceWorkerUpdate({ pendingCommands: 3, userRequested: true }).action).toBe("apply-now");
  });

  it("defers even an explicit request while a replay pass is actually in flight", () => {
    const decision = decideServiceWorkerUpdate({ pendingCommands: 0, userRequested: true, replayInFlight: true });
    expect(decision.action).toBe("defer");
    expect(decision.reason).toMatch(/in flight/);
  });
});

/** The smallest thing that behaves like a ServiceWorkerContainer for these paths. */
function fakeContainer(options: { waiting?: boolean; controller?: boolean } = {}) {
  const postMessage = vi.fn();
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const registration = {
    waiting: options.waiting ? { postMessage } : null,
    installing: null,
    scope: "/",
    addEventListener: vi.fn(),
    unregister: vi.fn(async () => true),
  };
  const container = {
    controller: options.controller ? {} : null,
    register: vi.fn(async () => registration),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    dispatch: (type: string, event: unknown) => (listeners.get(type) ?? []).forEach((l) => l(event)),
  };
  return { container: container as unknown as ServiceWorkerContainer & { dispatch: (t: string, e: unknown) => void }, registration, postMessage };
}

describe("registration", () => {
  it("returns an inert handle where service workers do not exist, instead of failing to boot", async () => {
    const handle = await registerServiceWorker({ container: undefined });
    expect(handle.registration).toBeNull();
    expect(handle.hasUpdate()).toBe(false);
    expect(handle.applyUpdate({ pendingCommands: 0 }).action).toBe("defer");
  });

  it("returns an inert handle when registration itself is refused", async () => {
    // The warning is the point of the code path; silence it so a green run stays readable.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = { register: vi.fn(async () => Promise.reject(new Error("insecure origin"))), addEventListener: vi.fn(), controller: null };
    const handle = await registerServiceWorker({ container: container as unknown as ServiceWorkerContainer });
    expect(handle.registration).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not tell a waiting worker to activate while commands are queued", async () => {
    const { container, postMessage } = fakeContainer({ waiting: true });
    const handle = await registerServiceWorker({ container });
    expect(handle.hasUpdate()).toBe(true);

    const decision = handle.applyUpdate({ pendingCommands: 2 });
    expect(decision.action).toBe("defer");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("tells a waiting worker to activate once the queue has drained", async () => {
    const { container, postMessage } = fakeContainer({ waiting: true });
    const handle = await registerServiceWorker({ container });

    expect(handle.applyUpdate({ pendingCommands: 0 }).action).toBe("apply-now");
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("surfaces an already-waiting worker to the caller rather than acting on it", async () => {
    const { container } = fakeContainer({ waiting: true });
    const onUpdateWaiting = vi.fn();
    await registerServiceWorker({ container, onUpdateWaiting });
    expect(onUpdateWaiting).toHaveBeenCalledTimes(1);
  });

  it("relays the worker's REPLAY_REQUEST to the page, which is the only place replay can happen", async () => {
    const { container } = fakeContainer();
    const onReplayRequest = vi.fn();
    await registerServiceWorker({ container, onReplayRequest });
    container.dispatch("message", { data: { type: "REPLAY_REQUEST" } });
    expect(onReplayRequest).toHaveBeenCalledTimes(1);

    container.dispatch("message", { data: { type: "SOMETHING_ELSE" } });
    expect(onReplayRequest).toHaveBeenCalledTimes(1);
  });
});
