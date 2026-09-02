import { describe, expect, it } from "vitest";
import { categorize, computeUtilisation, hasSufficientHistory, isIdleSince, lastActivityDate, statusSpans } from "@/domain/utilisation";
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

describe("hasSufficientHistory — FR-027/FR-028, T027", () => {
  it("is true when `from` is at or after the asset's first line", () => {
    expect(hasSufficientHistory(history, T1)).toBe(true);
    expect(hasSufficientHistory(history, T2)).toBe(true);
  });

  it("is false when `from` precedes the asset's first line — the migration-boundary guard", () => {
    expect(hasSufficientHistory(history, "2025-06-01T00:00:00.000Z")).toBe(false);
  });

  it("is false for an asset with no history at all", () => {
    expect(hasSufficientHistory([], "2026-01-01")).toBe(false);
  });
});

describe("computeUtilisation — the guard enforced structurally so a second consumer can't skip it (FR-027/FR-028)", () => {
  it("refuses to compute a figure across the migration boundary, returning sufficient: false", () => {
    const result = computeUtilisation(history, "2025-01-01T00:00:00.000Z", T4);
    expect(result.sufficient).toBe(false);
    expect("spans" in result).toBe(false); // the insufficient branch carries no spans at all — nothing to accidentally read
  });

  it("computes spans once there is enough history, identically to calling statusSpans directly", () => {
    const result = computeUtilisation(history, T1, T4);
    expect(result).toEqual({ sufficient: true, spans: statusSpans(history, T1, T4) });
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
