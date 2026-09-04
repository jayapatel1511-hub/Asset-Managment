/**
 * The Field home's decisions, separated from its rendering.
 *
 * This repository tests pure logic and does not render React in tests — there is no
 * `@testing-library/react` and adding one to cover a greeting would be a poor trade. So the parts
 * of S01 that can actually be *wrong* live here, where they are ordinary functions: which greeting
 * the clock implies, how a display name becomes a first name and initials, and — the one that
 * matters — how a calibration horizon splits into "due soon" and "overdue".
 *
 * That last one is not cosmetic. The home shows two numbers that a technician plans their day
 * around, and `listCalibrationDue(30)` returns **both** categories in one list; splitting it wrong
 * either double-counts an overdue asset in "due in 30 days" or hides it. The split is a string
 * comparison on ISO days for the same reason every other date comparison in this app is: a
 * `Date`-based comparison moves a due date across midnight depending on the device's timezone,
 * and a technician in Thunder Bay must see the same number as one in Ottawa.
 */
import type { Asset } from "../../api/types";

export type GreetingKey = "home.greeting.morning" | "home.greeting.afternoon" | "home.greeting.evening";

/** Local clock, not the server's: this is a greeting, not a business fact. */
export function greetingKey(hour: number): GreetingKey {
  if (hour < 12) return "home.greeting.morning";
  if (hour < 17) return "home.greeting.afternoon";
  return "home.greeting.evening";
}

/** First name only — "Good morning, Sam Tech (demo Field User)" reads like a form letter. The
 * demo identities carry a parenthesised role, so that is stripped before splitting. */
export function firstName(displayName: string): string {
  const cleaned = displayName.replace(/\(.*\)/, "").trim();
  return cleaned.split(/\s+/)[0] || displayName;
}

/** One or two letters for the avatar. Never more, and never empty. */
export function initials(displayName: string): string {
  const parts = displayName.replace(/\(.*\)/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export interface CalibrationSplit {
  dueSoon: number;
  overdue: number;
  /** Tracked, but with no due date. FR-017 counts these explicitly and never omits them. */
  unknown: number;
}

/**
 * Splits the calibration-due list into the two counts the home shows.
 *
 * `today` is passed in rather than read from the clock so the boundary is testable. An asset due
 * exactly today counts as **due soon, not overdue** — it has not been missed yet, and telling
 * someone their calibration is overdue on the morning it is due would be wrong and would erode
 * trust in the number.
 *
 * An asset with no due date at all goes in NEITHER of the two action counts — it is a different
 * question from "what do I need to do this month". It is counted separately rather than dropped,
 * because FR-017 requires unknown to be stated explicitly and never omitted, and because on the
 * real migrated fleet it is the *majority*: 608 of 1,026 assets have no due date. An earlier
 * version of this screen folded them into "due in 30 days" and displayed 610 where the honest
 * answer is 2 — a number that large and that wrong is worse than no number.
 *
 * The three counts here sum to `getCalibrationCounts`' `dueSoon + overdue + unknown` for the same
 * horizon, which is what keeps the home and the compliance screen from disagreeing.
 */
export function splitCalibration(due: readonly Asset[], today: string): CalibrationSplit {
  let dueSoon = 0;
  let overdue = 0;
  let unknown = 0;
  for (const asset of due) {
    if (asset.nextcaldue === null) unknown += 1;
    else if (asset.nextcaldue < today) overdue += 1;
    else dueSoon += 1;
  }
  return { dueSoon, overdue, unknown };
}

/** Today as the API spells dates: a plain ISO day, compared as a string. */
export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Quality rules Field home attention numbers belong to. */
export const QUALITY_RULE_OVERDUE = "DQ-CAL-OVERDUE";
export const QUALITY_RULE_UNKNOWN_DUE = "DQ-CAL-UNKNOWN-DUE";

/** Issue-queue path for a quality rule — where Field home overdue/unknown counts go. */
export function qualityIssuesPath(ruleKey: string): string {
  return `/data-management/quality/issues?ruleKey=${encodeURIComponent(ruleKey)}`;
}
