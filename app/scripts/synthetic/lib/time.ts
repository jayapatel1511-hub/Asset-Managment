/**
 * Time handling for the generator. Two rules from the spec drive everything here:
 *
 *  FR-017  every timestamp is in one uniform form whose text order equals chronological order —
 *          `YYYY-MM-DDTHH:MM:SSZ`, UTC, seconds precision. The app orders history by comparing
 *          these strings (domain/pointInTime.ts, domain/utilisation.ts), so mixed offsets would
 *          misorder events around each Toronto clock change.
 *  FR-018  transactions happen in Toronto working hours, so the wall clock is sampled locally
 *          and converted — DST rules included, because 20 years of history crosses 40 changeovers.
 *  FR-023  date-only attributes (calibration dates, expected return) are Toronto calendar dates.
 *
 * Ontario DST: from 2007, second Sunday in March 02:00 to first Sunday in November 02:00. 2006 and
 * earlier: first Sunday in April to last Sunday in October. Standard offset -5h, daylight -4h. The
 * ambiguous 01:00–02:00 hour on the autumn changeover never occurs because working hours are
 * sampled from 06:00 onward.
 */
import type { Rng } from "./rng";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type DateStr = string; // YYYY-MM-DD
export type UtcIso = string; // YYYY-MM-DDTHH:MM:SSZ

function nthSunday(year: number, month0: number, n: number): number {
  // day-of-month of the n-th Sunday (n>=1) of the month
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - first) % 7);
  return firstSunday + (n - 1) * 7;
}

function lastSunday(year: number, month0: number): number {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month0, daysInMonth)).getUTCDay();
  return daysInMonth - lastDow;
}

/** [start, end) of DST as "wall clock expressed as if it were UTC" millis. */
function dstWallBounds(year: number): [number, number] {
  if (year >= 2007) {
    return [Date.UTC(year, 2, nthSunday(year, 2, 2), 2), Date.UTC(year, 10, nthSunday(year, 10, 1), 2)];
  }
  return [Date.UTC(year, 3, nthSunday(year, 3, 1), 2), Date.UTC(year, 9, lastSunday(year, 9), 2)];
}

function isDstWall(wallMs: number): boolean {
  const year = new Date(wallMs).getUTCFullYear();
  const [s, e] = dstWallBounds(year);
  return wallMs >= s && wallMs < e;
}

/** Toronto wall clock (as a UTC-encoded millis value) -> real UTC millis. */
export function wallToUtcMs(wallMs: number): number {
  return wallMs + (isDstWall(wallMs) ? 4 : 5) * HOUR;
}

/** Real UTC millis -> Toronto wall clock as UTC-encoded millis. */
export function utcToWallMs(utcMs: number): number {
  const standard = utcMs - 5 * HOUR;
  return isDstWall(standard + HOUR) ? utcMs - 4 * HOUR : standard;
}

export function formatUtc(utcMs: number): UtcIso {
  return new Date(Math.floor(utcMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function parseUtc(iso: UtcIso): number {
  return Date.parse(iso);
}

export function dateOf(wallOrUtcMs: number): DateStr {
  return new Date(wallOrUtcMs).toISOString().slice(0, 10);
}

/** Toronto calendar date of a UTC instant (FR-023). */
export function localDateOf(iso: UtcIso): DateStr {
  return dateOf(utcToWallMs(parseUtc(iso)));
}

export function dateToWallMs(date: DateStr, hour = 0, minute = 0, second = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour, minute, second);
}

export function addDays(date: DateStr, n: number): DateStr {
  return dateOf(dateToWallMs(date) + n * DAY);
}

export function addMonths(date: DateStr, n: number): DateStr {
  // Same rule the app uses in recordCalibration: Date.setMonth, then slice — month overflow
  // (Jan 31 + 1 month) rolls the same way there and here.
  const d = new Date(dateToWallMs(date));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((dateToWallMs(b) - dateToWallMs(a)) / DAY);
}

export function isWeekend(date: DateStr): boolean {
  const dow = new Date(dateToWallMs(date)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function yearOf(date: DateStr): number {
  return Number(date.slice(0, 4));
}

export function monthOf(date: DateStr): number {
  return Number(date.slice(5, 7));
}

/** Next date on or after `date` that is a working day (weekends skipped with 92% probability). */
export function workingDayOnOrAfter(rng: Rng, date: DateStr): DateStr {
  let d = date;
  while (isWeekend(d) && rng.chance(0.92)) d = addDays(d, 1);
  return d;
}

/**
 * A UTC timestamp on `date` during Toronto working hours (FR-018): 07:00–18:00 weighted toward
 * mid-morning and mid-afternoon; ~4% fall outside (06:00–07:00, 18:00–21:00) because field work
 * does. Seconds are random so no two transactions share an instant by default.
 */
export function workingTime(rng: Rng, date: DateStr, opts: { earliestWallMs?: number; hourBias?: "morning" | "afternoon" | "any" } = {}): UtcIso {
  let hour: number;
  const r = rng.next();
  if (r < 0.04) hour = rng.chance(0.5) ? 6 : rng.int(18, 20);
  else if (opts.hourBias === "morning") hour = rng.int(7, 11);
  else if (opts.hourBias === "afternoon") hour = rng.int(13, 17);
  else hour = rng.weighted([[7, 1], [8, 3], [9, 4], [10, 4], [11, 3], [12, 2], [13, 3], [14, 4], [15, 4], [16, 3], [17, 2]] as const);
  let wall = dateToWallMs(date, hour, rng.int(0, 59), rng.int(0, 59));
  if (opts.earliestWallMs !== undefined && wall < opts.earliestWallMs) wall = opts.earliestWallMs;
  return formatUtc(wallToUtcMs(wall));
}

/** `iso` plus `seconds`, still in the uniform form. */
export function plusSeconds(iso: UtcIso, seconds: number): UtcIso {
  return formatUtc(parseUtc(iso) + seconds * 1000);
}

export function maxIso(a: UtcIso, b: UtcIso): UtcIso {
  return a > b ? a : b;
}
