/**
 * utilisation — feature 006, User Story 4: what proportion of its time an asset spends in each
 * status, idle detection, and the migration-boundary honesty guard (FR-027/FR-028). Pure, same
 * discipline as pointInTime.ts and deriveState.ts.
 *
 * The guard is the point of this file, not a caveat on it (plan.md's Phase 1 design, spec.md's
 * own Assumptions section): every one of the 1,026 migrated assets has exactly one transaction
 * line, dated the migration date. A utilisation period that starts before that date would read as
 * universal idleness for the entire fleet — not a real finding, an artifact of when the system
 * started keeping records. `hasSufficientHistory` exists so nobody can compute a figure over such
 * a period; `computeUtilisation` goes one step further and makes it structurally impossible for a
 * second consumer to forget to check — its return type forces the caller to handle the
 * insufficient-history case before it can reach the spans at all.
 */
import type { AssetStatus } from "./stateMachine";
import type { HistoryEntry } from "../api/types";

function byDateAsc(a: HistoryEntry, b: HistoryEntry): number {
  return a.transactiondate < b.transactiondate ? -1 : a.transactiondate > b.transactiondate ? 1 : 0;
}

export interface StatusSpan {
  status: AssetStatus;
  /** ISO. Clipped to the requested [from, to) window — never earlier than `from`. */
  start: string;
  /** ISO, exclusive. Clipped to the requested window — never later than `to`. */
  end: string;
  durationMs: number;
}

/** FR-026: which of the seven statuses represent productive use, which represent time out of
 * service for a reason (repair or calibration), and which are neither (Available = ready but
 * idle; Missing/Retired = neither in use nor being fixed). Kept here, not duplicated per screen,
 * so a second consumer categorises statuses exactly the same way this one does. */
export type UtilisationCategory = "Available" | "InUse" | "OutOfService" | "Retired";

const IN_USE_STATUSES: ReadonlySet<AssetStatus> = new Set(["CheckedOut", "Deployed"]);
const OUT_OF_SERVICE_STATUSES: ReadonlySet<AssetStatus> = new Set(["InCalibration", "NeedsRepair", "Missing"]);

export function categorize(status: AssetStatus): UtilisationCategory {
  if (status === "Retired") return "Retired";
  if (status === "Available") return "Available";
  if (IN_USE_STATUSES.has(status)) return "InUse";
  if (OUT_OF_SERVICE_STATUSES.has(status)) return "OutOfService";
  return "OutOfService"; // exhaustive in practice — every AssetStatus is one of the four branches above
}

/**
 * FR-023: the spans of time (within [from, to)) an asset spent in each status, computed from its
 * own consecutive transactions. Pure, linear in `history.length` — one sort, one pass.
 *
 * Does NOT itself refuse an out-of-range `from` (see FR-028) — that is `hasSufficientHistory`'s
 * job and, for a caller that must not skip it, `computeUtilisation`'s. This function only ever
 * answers "given this window, what were the spans", which is exactly what T026 tests in
 * isolation.
 */
export function statusSpans(history: HistoryEntry[], from: string, to: string): StatusSpan[] {
  if (!(from < to) || history.length === 0) return [];
  const sorted = [...history].sort(byDateAsc);

  // The status holding at the window's start: the before-status of the first entry at/after
  // `from` if one exists; otherwise the after-status of the last entry at/before `from`;
  // otherwise (every entry is after `from`, which `hasSufficientHistory` would flag as
  // insufficient) the very first entry's before-status.
  const atOrAfterFrom = sorted.find((e) => e.transactiondate >= from);
  const atOrBeforeFrom = [...sorted].reverse().find((e) => e.transactiondate <= from);
  let currentStatus: AssetStatus = atOrAfterFrom?.statusbefore ?? atOrBeforeFrom?.statusafter ?? sorted[0].statusbefore;

  const spans: StatusSpan[] = [];
  let cursor = from;

  for (const entry of sorted) {
    if (entry.transactiondate <= from) {
      currentStatus = entry.statusafter;
      continue;
    }
    if (entry.transactiondate > to) break;
    if (entry.transactiondate > cursor) {
      spans.push(makeSpan(currentStatus, cursor, entry.transactiondate));
      cursor = entry.transactiondate;
    }
    currentStatus = entry.statusafter;
  }
  if (cursor < to) spans.push(makeSpan(currentStatus, cursor, to));

  return spans;
}

function makeSpan(status: AssetStatus, start: string, end: string): StatusSpan {
  return { status, start, end, durationMs: new Date(end).getTime() - new Date(start).getTime() };
}

/**
 * FR-027/FR-028: false when `from` precedes this asset's first recorded transaction — the
 * migration-boundary guard. An asset with no history at all (shouldn't happen for a real asset,
 * every one has at least an AddToInventory line) is also insufficient.
 */
export function hasSufficientHistory(history: HistoryEntry[], from: string): boolean {
  if (history.length === 0) return false;
  const earliest = history.reduce((min, e) => (e.transactiondate < min ? e.transactiondate : min), history[0].transactiondate);
  return earliest <= from;
}

export type UtilisationResult =
  | { sufficient: true; spans: StatusSpan[] }
  | { sufficient: false };

/**
 * FR-027/FR-028, enforced structurally: a caller can only reach `spans` after checking
 * `sufficient`, because that is the only shape that carries them. This is deliberately a
 * different (and stronger) contract than calling `hasSufficientHistory` and `statusSpans`
 * separately — a second consumer of this module cannot reach a number for a period it hasn't
 * earned, even by forgetting a check, because there is no code path to `spans` that skips it.
 */
export function computeUtilisation(history: HistoryEntry[], from: string, to: string): UtilisationResult {
  if (!hasSufficientHistory(history, from)) return { sufficient: false };
  return { sufficient: true, spans: statusSpans(history, from, to) };
}

/**
 * FR-024: the timestamp of an asset's most recent transaction (its history need not be sorted).
 * `null` only for an asset with no history at all, which should not occur in practice — every
 * asset carries at least the transaction that brought it into the register.
 */
export function lastActivityDate(history: HistoryEntry[]): string | null {
  if (history.length === 0) return null;
  return history.reduce((max, e) => (e.transactiondate > max ? e.transactiondate : max), history[0].transactiondate);
}

/** FR-024: true when nothing has happened to this asset since `cutoff` (an ISO date/time —
 * typically "now minus the selected idle period"). */
export function isIdleSince(history: HistoryEntry[], cutoff: string): boolean {
  const last = lastActivityDate(history);
  return last !== null && last < cutoff;
}
