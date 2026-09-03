import { describe, expect, it } from "vitest";
import {
  acquisitionDate,
  categorize,
  computeUtilisation,
  hasSufficientHistory,
  isIdleSince,
  lastActivityDate,
  recordsBeganAt,
  statusSpans,
} from "@/domain/utilisation";
import type { HistoryEntry } from "@/api/types";

function entry(overrides: Partial<HistoryEntry> & Pick<HistoryEntry, "transaction" | "transactiondate" | "transactiontype" | "statusbefore" | "statusafter">): HistoryEntry {
  return {
    id: `line-${overrides.transaction}`,
    asset: "DL-UM-16984",
    kitrole: null,
    orientation: null,
    powersource: null,
    condition: null,
    processed: true,
    notes: null,
    performedby: "tech@englobecorp.com",
    fromlocation: null,
    tolocation: null,
    fromuser: null,
    touser: null,
    fromproject: null,
    toproject: null,
    ...overrides,
  };
}

const T1 = "2026-01-01T00:00:00.000Z"; // AddToInventory — Available
const T2 = "2026-01-11T00:00:00.000Z"; // Checkout — CheckedOut for 5 days
const T3 = "2026-01-16T00:00:00.000Z"; // Return — Available
const T4 = "2026-01-21T00:00:00.000Z"; // window end

const history: HistoryEntry[] = [
  entry({ transaction: "t1", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available" }),
  entry({ transaction: "t2", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut" }),
  entry({ transaction: "t3", transactiondate: T3, transactiontype: "Return", statusbefore: "CheckedOut", statusafter: "Available" }),
];

describe("statusSpans — FR-023, T026", () => {
  it("produces one span per status interval, clipped to the window, with correct durations", () => {
    const spans = statusSpans(history, T1, T4);
    expect(spans).toEqual([
      { status: "Available", start: T1, end: T2, durationMs: 10 * 86_400_000 },
      { status: "CheckedOut", start: T2, end: T3, durationMs: 5 * 86_400_000 },
      { status: "Available", start: T3, end: T4, durationMs: 5 * 86_400_000 },
    ]);
  });

  it("clips a window that starts after the asset's first line to the window, not the asset's full life", () => {
    const spans = statusSpans(history, T2, T4);
    expect(spans[0]).toEqual({ status: "CheckedOut", start: T2, end: T3, durationMs: 5 * 86_400_000 });
    expect(spans.reduce((sum, s) => sum + s.durationMs, 0)).toBe(new Date(T4).getTime() - new Date(T2).getTime());
  });

  it("a window entirely after the last transaction is one span in the final status", () => {
    const spans = statusSpans(history, T4, "2026-02-01T00:00:00.000Z");
    expect(spans).toEqual([{ status: "Available", start: T4, end: "2026-02-01T00:00:00.000Z", durationMs: 11 * 86_400_000 }]);
  });

  it("returns nothing for an empty or inverted window", () => {
    expect(statusSpans(history, T4, T4)).toEqual([]);
    expect(statusSpans(history, T4, T1)).toEqual([]);
    expect(statusSpans([], T1, T4)).toEqual([]);
  });
});

// A second asset, acquired well after the fleet's records began — the case FR-028's clarification
// is about, and the one the first implementation got wrong. The real migrated data cannot express
// it (every asset's first line is dated the migration day), which is exactly why it went unnoticed.
const T0 = "2025-06-01T00:00:00.000Z"; // the fleet's records begin here, on the older asset
const olderAsset: HistoryEntry[] = [
  entry({ transaction: "o1", transactiondate: T0, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available" }),
];
const RECORDS_BEGAN = T0;

describe("recordsBeganAt — FR-028's boundary is fleet-wide, not per asset", () => {
  it("is the earliest transaction across every history given", () => {
    expect(recordsBeganAt([history, olderAsset])).toBe(T0);
    expect(recordsBeganAt([history])).toBe(T1);
  });

  it("is null when there is no history to go on", () => {
    expect(recordsBeganAt([])).toBeNull();
    expect(recordsBeganAt([[], []])).toBeNull();
  });
});

describe("acquisitionDate — when the asset became ours", () => {
  it("is the earliest AddToInventory line, not merely the earliest line", () => {
    const withLaterAcquisition = [
      entry({ transaction: "x1", transactiondate: T2, transactiontype: "Audit", statusbefore: "Available", statusafter: "Available" }),
      entry({ transaction: "x2", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available" }),
    ];
    expect(acquisitionDate(withLaterAcquisition)).toBe(T1);
  });

  it("is null when acquisition was never recorded — there is nothing to clip to", () => {
    const noAcquisition = [
      entry({ transaction: "y1", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut" }),
    ];
    expect(acquisitionDate(noAcquisition)).toBeNull();
    expect(acquisitionDate([])).toBeNull();
  });
});

describe("hasSufficientHistory — FR-027/FR-028, T027", () => {
  it("is true when `from` is at or after the date the fleet's records began", () => {
    expect(hasSufficientHistory(history, T1, RECORDS_BEGAN)).toBe(true);
    expect(hasSufficientHistory(history, T2, RECORDS_BEGAN)).toBe(true);
  });

  it("is false when `from` precedes the fleet's records — the migration-boundary guard", () => {
    expect(hasSufficientHistory(history, "2025-01-01T00:00:00.000Z", RECORDS_BEGAN)).toBe(false);
  });

  it("is TRUE for an asset acquired after `from`, so long as the fleet's records reach back that far", () => {
    // THE FIX. `from` = T0 precedes this asset's own first line (T1) but not the fleet's records,
    // so the answer is "yes, with a shorter window" — not "we cannot say". Under the previous
    // implementation this returned false and the asset vanished from the report.
    expect(hasSufficientHistory(history, T0, RECORDS_BEGAN)).toBe(true);
  });

  it("falls back to the asset's own first line when the boundary is unknown — the conservative reading", () => {
    expect(hasSufficientHistory(history, T0, null)).toBe(false);
    expect(hasSufficientHistory(history, T1, null)).toBe(true);
  });

  it("is false for an asset with no history at all", () => {
    expect(hasSufficientHistory([], "2026-01-01", RECORDS_BEGAN)).toBe(false);
  });
});

describe("computeUtilisation — the guard enforced structurally so a second consumer can't skip it (FR-027/FR-028)", () => {
  it("refuses to compute a figure across the migration boundary, returning sufficient: false", () => {
    const result = computeUtilisation(history, "2025-01-01T00:00:00.000Z", T4, { recordsBegan: RECORDS_BEGAN });
    expect(result).toEqual({ sufficient: false, reason: "beforeRecords" });
    expect("spans" in result).toBe(false); // the insufficient branch carries no spans at all — nothing to accidentally read
  });

  it("computes spans once there is enough history, identically to calling statusSpans directly", () => {
    const result = computeUtilisation(history, T1, T4, { recordsBegan: RECORDS_BEGAN });
    expect(result).toEqual({
      sufficient: true,
      spans: statusSpans(history, T1, T4),
      effectiveFrom: T1,
      clippedToAcquisition: false,
    });
  });

  it("clips to the acquisition date instead of refusing, for an asset bought inside the period", () => {
    // FR-028 as clarified: before-acquisition is not before-records. The figure covers T1→T4,
    // the time this asset was actually owned, and says so.
    const result = computeUtilisation(history, T0, T4, { recordsBegan: RECORDS_BEGAN });
    expect(result.sufficient).toBe(true);
    if (!result.sufficient) return;
    expect(result.effectiveFrom).toBe(T1);
    expect(result.clippedToAcquisition).toBe(true);
    expect(result.spans).toEqual(statusSpans(history, T1, T4));
    // And the clipped window is not padded with phantom idleness: the total measured time is the
    // ownership window, not the requested one.
    const measured = result.spans.reduce((n, s) => n + s.durationMs, 0);
    expect(measured).toBe(new Date(T4).getTime() - new Date(T1).getTime());
  });

  it("excludes an asset acquired at or after the window ends, rather than calling it a gap", () => {
    const to = T1; // the window ends exactly when this asset was acquired
    const result = computeUtilisation(history, T0, to, { recordsBegan: RECORDS_BEGAN });
    expect(result).toEqual({ sufficient: false, reason: "notYetAcquired" });
  });

  it("distinguishes no history at all from a period before the records began", () => {
    expect(computeUtilisation([], T1, T4, { recordsBegan: RECORDS_BEGAN })).toEqual({
      sufficient: false,
      reason: "noHistory",
    });
  });

  it("computes without clipping for an asset whose acquisition was never recorded", () => {
    const noAcquisition = [
      entry({ transaction: "z1", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut" }),
    ];
    const result = computeUtilisation(noAcquisition, T1, T4, { recordsBegan: RECORDS_BEGAN });
    expect(result.sufficient).toBe(true);
    if (!result.sufficient) return;
    expect(result.effectiveFrom).toBe(T1);
    expect(result.clippedToAcquisition).toBe(false);
  });
});

describe("categorize — FR-026, productive use vs out of service", () => {
  it("classifies every status into exactly one of Available/InUse/OutOfService/Retired", () => {
    expect(categorize("Available")).toBe("Available");
    expect(categorize("CheckedOut")).toBe("InUse");
    expect(categorize("Deployed")).toBe("InUse");
    expect(categorize("InCalibration")).toBe("OutOfService");
    expect(categorize("NeedsRepair")).toBe("OutOfService");
    expect(categorize("Missing")).toBe("OutOfService");
    expect(categorize("Retired")).toBe("Retired");
  });
});

describe("lastActivityDate / isIdleSince — FR-024", () => {
  it("finds the most recent transaction regardless of input order", () => {
    expect(lastActivityDate([...history].reverse())).toBe(T3);
  });

  it("is null for an asset with no history", () => {
    expect(lastActivityDate([])).toBeNull();
  });

  it("flags an asset idle once its last activity precedes the cutoff", () => {
    expect(isIdleSince(history, "2026-06-01T00:00:00.000Z")).toBe(true); // nothing since T3
    expect(isIdleSince(history, "2026-01-10T00:00:00.000Z")).toBe(false); // T2/T3 are after this cutoff
  });

  it("never marks an asset with no history as idle (there is nothing to compare)", () => {
    expect(isIdleSince([], "2026-01-01")).toBe(false);
  });
});
