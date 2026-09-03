/**
 * Which assets have a submission still sitting in the offline queue — feature 003 FR-040, and
 * `docs/12-ui-spec.md`'s C10 / gap G-08 ("the string and data flag exist; the inline badge is not
 * yet placed"). This is the missing half.
 *
 * The queue engine (`api/queue/`) has no change notification, and adding one to it for a badge
 * would be the wrong trade: it is a device-local array behind localStorage, so reading it is
 * cheap and polling is honest. What matters is that the poll happens **once** no matter how many
 * rows are on screen — a hundred `AssetRow`s must not create a hundred intervals — which is what
 * `useSyncExternalStore` over a module-level cache buys. The interval only runs while something is
 * subscribed, and subscribers are woken only when the set actually changes, so a screen full of
 * rows does not re-render every two seconds for nothing.
 */
import { useSyncExternalStore } from "react";
import { getSubmissionQueue } from "../api/queue";

const POLL_MS = 2000;
const EMPTY: ReadonlySet<string> = new Set();

let snapshot: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function read(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of getSubmissionQueue().list()) {
    // "Sending" counts too: it has left the device's hands but has not been confirmed, which is
    // exactly the uncertainty the badge exists to show.
    if (entry.status === "Queued" || entry.status === "Sending" || entry.status === "Rejected") {
      for (const id of entry.affectedAssetIds) ids.add(id);
    }
  }
  return ids;
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function poll(): void {
  const next = read();
  if (sameMembers(next, snapshot)) return; // identity is stable, so React skips the re-render
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    poll(); // so the first render after a submit is already correct
    timer = setInterval(poll, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The set of asset IDs with a queued, in-flight or rejected submission. */
export function usePendingSyncIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** True when this one asset has a submission the server has not confirmed. */
export function usePendingSync(assetId: string): boolean {
  return usePendingSyncIds().has(assetId);
}
