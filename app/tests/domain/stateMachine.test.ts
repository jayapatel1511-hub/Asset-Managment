import { describe, expect, it } from "vitest";
import { STATE_MACHINE, STATUSES, TRANSITION_RULES, type TransactionType } from "@/domain/stateMachine";
import { deriveState, type AssetSnapshot } from "@/domain/deriveState";
import { axesFromStatus } from "@/domain/stateAxes";

const ALL_TRANSACTION_TYPES = [
  ...new Set(STATUSES.flatMap((s) => Object.keys(STATE_MACHINE[s]) as TransactionType[])),
].sort();

function locationForPill(status: (typeof STATUSES)[number]): string | null {
  if (status === "Available" || status === "NeedsRepair") return "Ottawa";
  if (status === "Deployed") return "site-1";
  if (status === "InCalibration") return "lab-1";
  return null;
}

function snapshotAt(status: (typeof STATUSES)[number]): AssetSnapshot {
  const axes = axesFromStatus(status);
  return {
    assetId: "DL-UM-00001",
    status,
    lifecycle: axes.lifecycle,
    disposition: axes.disposition,
    serviceability: axes.serviceability,
    homeoffice: "Ottawa",
    currentlocation: locationForPill(status),
    custodian: status === "CheckedOut" ? "tech@englobecorp.com" : null,
    currentproject: status === "CheckedOut" ? "02208928" : null,
    parentasset: null,
  };
}

function inputFor(type: TransactionType) {
  const date = "2026-09-02T09:00:00-04:00";
  switch (type) {
    case "Checkout":
      return { type, date, touser: "someone@englobecorp.com", toproject: "02208928" };
    case "Deploy":
      return { type, date, touser: "someone@englobecorp.com", toproject: "02208928", tolocation: "site-1" };
    case "Transfer":
    case "Found":
    case "Return":
    case "ReturnFromCalibration":
      return { type, date, tolocation: "Toronto", toLocationKind: "Office" as const };
    case "Retire":
      return { type, date, retirementReason: "Obsolete" };
    default:
      return { type, date };
  }
}

describe("state machine — every compatibility-pill cell, allowed and disallowed (SC-005)", () => {
  for (const status of STATUSES) {
    for (const type of ALL_TRANSACTION_TYPES) {
      const expected = STATE_MACHINE[status][type];
      const label = expected ? `${status} --${type}--> ${expected}` : `${status} --${type}--> REFUSED`;

      it(label, () => {
        const result = deriveState(snapshotAt(status), inputFor(type));

        if (expected) {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.fields.statusAfter).toBe(expected);
          }
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toContain(type);
            expect(result.reason).toContain(status);
          }
        }
      });
    }
  }

  it("covers every status defined in the matrix (no status silently skipped)", () => {
    expect(STATUSES.length).toBeGreaterThanOrEqual(7);
    for (const status of STATUSES) {
      expect(STATE_MACHINE).toHaveProperty(status);
    }
  });

  it("Retired has no outbound transitions except Audit (constitution: retirement is terminal)", () => {
    const keys = Object.keys(STATE_MACHINE.Retired);
    expect(keys).toEqual(["Audit"]);
  });
});

describe("generated axis machine", () => {
  it("emits 27 rule variants covering the catalogue", () => {
    expect(TRANSITION_RULES).toHaveLength(27);
    const types = new Set(TRANSITION_RULES.map((r) => r.type));
    expect(types.has("Checkout")).toBe(true);
    expect(types.has("ReportFault")).toBe(true);
    expect(types.has("Correction")).toBe(true);
  });
});
