import { describe, expect, it } from "vitest";
import { STATE_MACHINE, STATUSES, type TransactionType } from "@/domain/stateMachine";
import { deriveState, type AssetSnapshot } from "@/domain/deriveState";

// Every transaction type that appears ANYWHERE in the matrix — used to build the full
// status x type grid so both allowed and disallowed cells are exercised (build-order DoD).
const ALL_TRANSACTION_TYPES = [
  ...new Set(STATUSES.flatMap((s) => Object.keys(STATE_MACHINE[s]) as TransactionType[])),
].sort();

function snapshotAt(status: (typeof STATUSES)[number]): AssetSnapshot {
  return {
    assetId: "DL-UM-00001",
    status,
    lifecycle: status === "Retired" ? "Retired" : "Active",
    homeoffice: "Ottawa",
    currentlocation: status === "Available" ? "Ottawa" : null,
    custodian: status === "CheckedOut" ? "tech@englobecorp.com" : null,
    currentproject: status === "CheckedOut" ? "02208928" : null,
    parentasset: null,
  };
}

describe("state machine — every cell, allowed and disallowed (SC-005)", () => {
  for (const status of STATUSES) {
    for (const type of ALL_TRANSACTION_TYPES) {
      const expected = STATE_MACHINE[status][type];
      const label = expected ? `${status} --${type}--> ${expected}` : `${status} --${type}--> REFUSED`;

      it(label, () => {
        const result = deriveState(snapshotAt(status), {
          type,
          date: "2026-09-02T09:00:00-04:00",
          touser: "someone@englobecorp.com",
          toproject: "02208928",
          tolocation: "Toronto",
          retirementReason: "Obsolete",
        });

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
