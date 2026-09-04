/**
 * S01 Field home — the decisions, not the rendering.
 *
 * Adopted under decision D2 (`docs/08-decisions.md` § UI decisions), which replaced the
 * search-first home. The greeting and initials are cheap to get subtly wrong and cost nothing to
 * pin; the calibration split is the one a technician actually plans around, and it is the reason
 * this file exists.
 */
import { describe, expect, it } from "vitest";
import { greetingKey, firstName, initials, isoDay, splitCalibration, qualityIssuesPath, QUALITY_RULE_OVERDUE, QUALITY_RULE_UNKNOWN_DUE } from "@/features/home/homeModel";
import type { Asset } from "@/api/types";

function asset(assetid: string, nextcaldue: string | null): Asset {
  return {
    id: assetid,
    assetid,
    equipmentmodel: { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger" },
    serialnumber: null,
    homeoffice: "Ottawa",
    lifecycle: "Active",
    status: "Available",
    currentlocation: null,
    custodian: null,
    currentproject: null,
    parentasset: null,
    lastcaldate: null,
    nextcaldue,
    retirementreason: null,
    notes: null,
    carrier: null,
    identifiervalue: null,
    phonenumber: null,
    staticip: null,
  };
}

describe("greeting", () => {
  it("changes at noon and at five, and never falls through", () => {
    expect(greetingKey(0)).toBe("home.greeting.morning");
    expect(greetingKey(11)).toBe("home.greeting.morning");
    expect(greetingKey(12)).toBe("home.greeting.afternoon");
    expect(greetingKey(16)).toBe("home.greeting.afternoon");
    expect(greetingKey(17)).toBe("home.greeting.evening");
    expect(greetingKey(23)).toBe("home.greeting.evening");
  });
});

describe("name handling", () => {
  it("strips the demo identities' parenthesised role rather than greeting someone as '(demo'", () => {
    // The three demo users are literally named "Sam Tech (demo Field User)" and friends. An
    // earlier version split on whitespace-or-paren and produced the right answer here by luck;
    // this pins the intent.
    expect(firstName("Sam Tech (demo Field User)")).toBe("Sam");
    expect(firstName("Alex Admin (demo Office Admin)")).toBe("Alex");
    expect(initials("Sam Tech (demo Field User)")).toBe("ST");
  });

  it("copes with one name, extra spaces and nothing at all", () => {
    expect(firstName("Cher")).toBe("Cher");
    expect(initials("Cher")).toBe("C");
    expect(initials("  Marie   Claire  Dubois ")).toBe("MD");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  it("never renders more than two initials", () => {
    expect(initials("Jean Paul Marie Gaultier")).toHaveLength(2);
  });
});

describe("calibration split", () => {
  const today = "2026-09-04";

  it("counts a date before today as overdue and a later one as due soon", () => {
    const { dueSoon, overdue } = splitCalibration(
      [asset("A", "2026-09-01"), asset("B", "2026-09-30"), asset("C", "2026-08-15")],
      today
    );
    expect(overdue).toBe(2);
    expect(dueSoon).toBe(1);
  });

  it("treats an asset due EXACTLY today as due soon, not overdue", () => {
    // The boundary, stated: it has not been missed yet. Telling someone their calibration is
    // overdue on the morning it is due is wrong, and a number that cries wolf stops being read.
    const { dueSoon, overdue } = splitCalibration([asset("A", today)], today);
    expect(overdue).toBe(0);
    expect(dueSoon).toBe(1);
  });

  it("counts an asset with no due date as UNKNOWN, not as due soon", () => {
    // The bug this pins, found by launching the app and reading the number: `listCalibrationDue`
    // returns unknowns too — 608 of them on the real migrated fleet — and an earlier version
    // folded them into "due in 30 days", displaying 610 where the honest answer is 2.
    const { dueSoon, overdue, unknown } = splitCalibration([asset("A", null), asset("B", "2026-09-01")], today);
    expect(dueSoon).toBe(0);
    expect(overdue).toBe(1);
    expect(unknown).toBe(1);
  });

  it("keeps unknown out of the two action counts entirely", () => {
    const { dueSoon, overdue, unknown } = splitCalibration([asset("A", null), asset("B", null)], today);
    expect(dueSoon).toBe(0);
    expect(overdue).toBe(0);
    expect(unknown).toBe(2);
  });

  it("returns zeroes for an empty list rather than NaN", () => {
    expect(splitCalibration([], today)).toEqual({ dueSoon: 0, overdue: 0, unknown: 0 });
  });

  it("never double-counts and never drops: the three numbers account for every asset", () => {
    // This is the invariant that matters. Two of the three are actionable and one is not, but all
    // three together must equal what the API handed over — otherwise assets vanish from the home.
    const assets = [asset("A", "2026-09-01"), asset("B", today), asset("C", "2026-12-01"), asset("D", null)];
    const { dueSoon, overdue, unknown } = splitCalibration(assets, today);
    expect(dueSoon + overdue + unknown).toBe(assets.length);
    expect(dueSoon + overdue).toBe(assets.filter((a) => a.nextcaldue !== null).length);
  });
});

describe("isoDay", () => {
  it("is a plain ISO day, so it compares correctly against nextcaldue as a string", () => {
    expect(isoDay(new Date("2026-09-04T23:59:59.999Z"))).toBe("2026-09-04");
    expect(isoDay(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05");
    // Zero-padded, which string comparison depends on entirely.
    expect(isoDay(new Date("2026-01-05T00:00:00.000Z")) < "2026-01-06").toBe(true);
    expect(isoDay(new Date("2026-01-05T00:00:00.000Z")) > "2026-01-04").toBe(true);
  });
});

describe("quality issue routing", () => {
  it("sends overdue and unknown-due counts to the quality queue, not calibration/compliance", () => {
    expect(qualityIssuesPath(QUALITY_RULE_OVERDUE)).toBe("/data-management/quality/issues?ruleKey=DQ-CAL-OVERDUE");
    expect(qualityIssuesPath(QUALITY_RULE_UNKNOWN_DUE)).toBe("/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE");
  });
});
