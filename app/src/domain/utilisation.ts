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
 *
 * FR-028 DEFECT FIXED (recorded in docs/08-decisions.md): the first implementation used *each
 * asset's own first transaction* as the boundary. FR-028 as clarified 2026-09-02 says the boundary
 * is the date the FLEET's records began, and that a period starting before an asset's own
 * **acquisition** is a different case entirely — the asset did not yet exist, so it must be
 * clipped to its acquisition date or excluded, never reported as insufficient history. The two
 * coincide in the migrated data, where every asset's first line is dated the migration day, which
 * is why the conflation was invisible until feature 007 supplied a fleet acquired across twenty
 * years — and why it would have mattered for every asset bought after go-live: a logger bought
 * last month made a 90-day report refuse rather than report its five weeks of service.
 *
 * So the boundary is now an explicit argument. A function that infers it from the one history in
 * front of it cannot tell the two facts apart; the caller has to say which one it means.
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

/** ISO date of the earliest transaction in a history, or null for an empty one. */
function earliestDate(history: HistoryEntry[]): string | null {
  if (history.length === 0) return null;
  return history.reduce((min, e) => (e.transactiondate < min ? e.transactiondate : min), history[0].transactiondate);
}

/**
 * FR-028's actual boundary: the date the FLEET's records began — the earliest transaction across
 * every asset considered, not any one asset's first line. Computed once by the caller and passed
 * to `computeUtilisation` for each asset.
 *
 * Against the real migrated data every line is dated the migration day, so this is that day and a
 * period reaching further back is still refused — the behaviour that was right all along. With
 * feature 007's twenty-year synthetic history it is 2006, so periods inside those twenty years
 * compute instead of refusing.
 */
export function recordsBeganAt(histories: Iterable<HistoryEntry[]>): string | null {
  let earliest: string | null = null;
  for (const history of histories) {
    const candidate = earliestDate(history);
    if (candidate !== null && (earliest === null || candidate < earliest)) earliest = candidate;
  }
  return earliest;
}

/**
 * When this asset entered the register: the earliest `AddToInventory` line. Distinct from its
 * earliest line of any kind — for a migrated asset they are the same date, but for an asset that
 * arrived later this is what separates "our records do not go back that far" from "it was not
 * ours yet". Null when acquisition was never recorded, in which case there is nothing to clip to.
 */
export function acquisitionDate(history: HistoryEntry[]): string | null {
  return earliestDate(history.filter((e) => e.transactiontype === "AddToInventory"));
}

/**
 * FR-027/FR-028: false when `from` precedes the date the fleet's records began — when no amount
 * of stored history could answer the question, so presenting a figure would be a claim about a
 * period the system knows nothing about.
 *
 * `recordsBegan` is required rather than inferred, and `null` (an unknown boundary) falls back to
 * this asset's own earliest line — the conservative reading, which refuses more rather than
 * inventing a figure. This deliberately does NOT consider the asset's acquisition: an asset
 * bought inside the period has sufficient history, just a shorter window, which
 * `computeUtilisation` clips.
 */
export function hasSufficientHistory(history: HistoryEntry[], from: string, recordsBegan: string | null): boolean {
  if (history.length === 0) return false;
  const boundary = recordsBegan ?? earliestDate(history);
  return boundary !== null && boundary <= from;
}

/** Why no proportion figure is available for an asset. `notYetAcquired` is not a shortcoming of
 * the records — the asset was not owned during the window at all, so it is excluded from the
 * aggregate rather than counted as a gap in what we know. */
export type InsufficientReason = "noHistory" | "beforeRecords" | "notYetAcquired";

export type UtilisationResult =
  | {
      sufficient: true;
      spans: StatusSpan[];
      /** The window actually measured — `from`, or the acquisition date if that is later. */
      effectiveFrom: string;
      /** True when the window was shortened because the asset was acquired inside the period. */
      clippedToAcquisition: boolean;
    }
  | { sufficient: false; reason: InsufficientReason };

/**
 * FR-027/FR-028, enforced structurally: a caller can only reach `spans` after checking
 * `sufficient`, because that is the only shape that carries them. This is deliberately a
 * different (and stronger) contract than calling `hasSufficientHistory` and `statusSpans`
 * separately — a second consumer of this module cannot reach a number for a period it hasn't
 * earned, even by forgetting a check, because there is no code path to `spans` that skips it.
 *
 * Three outcomes, per FR-028 as clarified:
 *   before the fleet's records began   refused  — nothing could answer it
 *   acquired at or after the window end excluded — it was not ours during the period
 *   acquired inside the window          COMPUTED, clipped to the acquisition date
 */
export function computeUtilisation(
  history: HistoryEntry[],
  from: string,
  to: string,
  options: { recordsBegan: string | null }
): UtilisationResult {
  if (history.length === 0) return { sufficient: false, reason: "noHistory" };
  if (!hasSufficientHistory(history, from, options.recordsBegan)) return { sufficient: false, reason: "beforeRecords" };

  const acquired = acquisitionDate(history);
  if (acquired !== null && acquired >= to) return { sufficient: false, reason: "notYetAcquired" };

  const effectiveFrom = acquired !== null && acquired > from ? acquired : from;
  return {
    sufficient: true,
    spans: statusSpans(history, effectiveFrom, to),
    effectiveFrom,
    clippedToAcquisition: effectiveFrom !== from,
  };
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
