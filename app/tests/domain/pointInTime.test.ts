import { describe, expect, it } from "vitest";
import { buildTimeline, stateAsOf } from "@/domain/pointInTime";
import type { AssetRelationship, HistoryEntry } from "@/api/types";

/** Builds one HistoryEntry with sensible defaults, matching what getAssetHistory(assetId)
 * actually returns (a TransactionLine joined to its header — types.ts's own definition). */
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

// A realistic four-event life: migrated in Available, checked out, returned, then transferred to
// a new office. Every timestamp is distinct and ordered so boundary assertions are unambiguous.
const T1 = "2026-01-01T09:00:00.000Z"; // AddToInventory
const T2 = "2026-02-01T09:00:00.000Z"; // Checkout
const T3 = "2026-03-01T09:00:00.000Z"; // Return
const T4 = "2026-04-01T09:00:00.000Z"; // Transfer

const history: HistoryEntry[] = [
  entry({ transaction: "t1", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available", tolocation: "Ottawa" }),
  entry({ transaction: "t2", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut", touser: "tech@englobecorp.com", toproject: "02208928" }),
  entry({ transaction: "t3", transactiondate: T3, transactiontype: "Return", statusbefore: "CheckedOut", statusafter: "Available", tolocation: "Ottawa" }),
  entry({ transaction: "t4", transactiondate: T4, transactiontype: "Transfer", statusbefore: "Available", statusafter: "Available", tolocation: "Toronto" }),
];

describe("stateAsOf — replaying a full life (US3, FR-018/FR-020, SC-003's agreement claim)", () => {
  it("returns the AssetSnapshot shape (directly comparable with deriveState.ts's own output)", () => {
    const snapshot = stateAsOf(history, T4);
    expect(Object.keys(snapshot).sort()).toEqual(
      ["assetId", "custodian", "currentlocation", "currentproject", "homeoffice", "lifecycle", "parentasset", "status"].sort()
    );
  });

  it("reproduces the current derived state exactly after replaying every line", () => {
    const snapshot = stateAsOf(history, T4);
    expect(snapshot).toEqual({
      assetId: "DL-UM-16984",
      status: "Available",
      lifecycle: "Active",
      homeoffice: "Ottawa",
      currentlocation: "Toronto",
      custodian: null,
      currentproject: null,
      parentasset: null,
    });
  });

  it("mid-checkout: custodian and project set, location honestly unknown (not the office)", () => {
    const snapshot = stateAsOf(history, T2);
    expect(snapshot.status).toBe("CheckedOut");
    expect(snapshot.custodian).toBe("tech@englobecorp.com");
    expect(snapshot.currentproject).toBe("02208928");
    expect(snapshot.currentlocation).toBeNull();
  });

  it("after the return, before the transfer: back at the office, custodian cleared", () => {
    const snapshot = stateAsOf(history, T3);
    expect(snapshot.status).toBe("Available");
    expect(snapshot.custodian).toBeNull();
    expect(snapshot.currentlocation).toBe("Ottawa");
  });
});

describe("stateAsOf — boundary cases (T008)", () => {
  it("asOf before the first line returns the pre-history placeholder, not a guess", () => {
    const snapshot = stateAsOf(history, "2025-12-31T00:00:00.000Z");
    expect(snapshot).toEqual({
      assetId: "DL-UM-16984",
      status: "Available", // the first line's own statusbefore — what AddToInventory asserts was already true
      lifecycle: "Active",
      homeoffice: null,
      currentlocation: null,
      custodian: null,
      currentproject: null,
      parentasset: null,
    });
  });

  it("asOf exactly on a transaction timestamp includes that transaction", () => {
    const snapshot = stateAsOf(history, T2);
    expect(snapshot.status).toBe("CheckedOut"); // T2's own statusafter, not the state just before it
  });

  it("asOf after the last line equals the current (fully replayed) state", () => {
    const farFuture = stateAsOf(history, "2099-01-01T00:00:00.000Z");
    expect(farFuture).toEqual(stateAsOf(history, T4));
  });
});

describe("stateAsOf — migration-only assets (T009, the common case: 1,026 of 1,026 staged assets)", () => {
  const migrationOnly: HistoryEntry[] = [
    entry({ transaction: "m1", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available", tolocation: "Kitchener" }),
  ];

  it("reconstructs a single-line Available asset correctly at and after its only line", () => {
    expect(stateAsOf(migrationOnly, T1)).toMatchObject({ status: "Available", homeoffice: "Kitchener", currentlocation: "Kitchener", custodian: null });
    expect(stateAsOf(migrationOnly, "2026-06-01")).toMatchObject({ status: "Available", homeoffice: "Kitchener", currentlocation: "Kitchener" });
  });

  it("reconstructs a single-line CheckedOut-with-unknown-custodian asset honestly (the Q3 sweep pattern, 592 real assets)", () => {
    const sweepAsset: HistoryEntry[] = [
      entry({ transaction: "m2", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "CheckedOut", statusafter: "CheckedOut", tolocation: "Ottawa", touser: null }),
    ];
    const snapshot = stateAsOf(sweepAsset, T1);
    expect(snapshot.status).toBe("CheckedOut");
    expect(snapshot.homeoffice).toBe("Ottawa"); // home office is still known even though current location is not
    expect(snapshot.currentlocation).toBeNull(); // never falsely "at the office" — Principle I
    expect(snapshot.custodian).toBeNull(); // FR-010's own distinction: unknown, not "at the office"
  });

  it("reconstructs a single-line NeedsRepair asset with a known location (the 3 real TMP- servers)", () => {
    const brokenOnArrival: HistoryEntry[] = [
      entry({ transaction: "m3", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "NeedsRepair", tolocation: "Mississauga" }),
    ];
    const snapshot = stateAsOf(brokenOnArrival, T1);
    expect(snapshot.status).toBe("NeedsRepair");
    expect(snapshot.currentlocation).toBe("Mississauga");
  });
});

describe("stateAsOf — retirement (T011, FR-022)", () => {
  const retiredHistory: HistoryEntry[] = [
    ...history,
    entry({ transaction: "t5", transactiondate: "2026-05-01T09:00:00.000Z", transactiontype: "Retire", statusbefore: "Available", statusafter: "Retired" }),
  ];

  it("a retired asset's timeline is fully reconstructable — before, at, and after retirement", () => {
    expect(stateAsOf(retiredHistory, T4).lifecycle).toBe("Active");
    const atRetirement = stateAsOf(retiredHistory, "2026-05-01T09:00:00.000Z");
    expect(atRetirement.lifecycle).toBe("Retired");
    expect(atRetirement.status).toBe("Retired");
    expect(atRetirement.currentlocation).toBeNull();
    expect(atRetirement.custodian).toBeNull();
    // still fully available afterwards, not truncated at the retirement event
    expect(stateAsOf(retiredHistory, "2027-01-01").lifecycle).toBe("Retired");
  });
});

describe("stateAsOf — parentasset via relationships (T010's data source)", () => {
  const kitHistory: HistoryEntry[] = [
    entry({ transaction: "k1", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available", tolocation: "Ottawa" }),
    entry({ transaction: "k2", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut", kitrole: "Sensor1" }),
    entry({ transaction: "k3", transactiondate: T3, transactiontype: "Return", statusbefore: "CheckedOut", statusafter: "Available", tolocation: "Ottawa" }),
  ];
  const kitRelationship: AssetRelationship = {
    id: "rel-1",
    parentasset: "DL-UM-16984-PRIMARY",
    childasset: "DL-UM-16984",
    relationshiptype: "Kit",
    start: T2,
    end: T3,
    createdbyline: "k2",
    closedbyline: "k3",
  };

  it("reports the parent only for the span the relationship was open", () => {
    expect(stateAsOf(kitHistory, T1, [kitRelationship]).parentasset).toBeNull();
    expect(stateAsOf(kitHistory, T2, [kitRelationship]).parentasset).toBe("DL-UM-16984-PRIMARY");
    expect(stateAsOf(kitHistory, T3, [kitRelationship]).parentasset).toBeNull(); // closed exactly at T3
  });

  it("without relationship data supplied, parentasset is null rather than guessed", () => {
    expect(stateAsOf(kitHistory, T2).parentasset).toBeNull();
  });
});

describe("buildTimeline — attach/detach events name the other asset and the role (FR-019, T010)", () => {
  it("surfaces an attachment on the transaction that opened it, and a detachment on the one that closed it", () => {
    const kitHistory: HistoryEntry[] = [
      entry({ transaction: "k1", transactiondate: T1, transactiontype: "AddToInventory", statusbefore: "Available", statusafter: "Available", tolocation: "Ottawa" }),
      entry({ transaction: "k2", transactiondate: T2, transactiontype: "Checkout", statusbefore: "Available", statusafter: "CheckedOut", kitrole: "Sensor1" }),
      entry({ transaction: "k3", transactiondate: T3, transactiontype: "Return", statusbefore: "CheckedOut", statusafter: "Available", tolocation: "Ottawa" }),
    ];
    const relationships: AssetRelationship[] = [
      { id: "rel-1", parentasset: "DL-UM-16984-PRIMARY", childasset: "DL-UM-16984", relationshiptype: "Kit", start: T2, end: T3, createdbyline: "k2", closedbyline: "k3" },
    ];
    const timeline = buildTimeline(kitHistory, relationships);

    const checkoutEvent = timeline.find((e) => e.entry.transaction === "k2")!;
    expect(checkoutEvent.attachments).toEqual([{ assetId: "DL-UM-16984-PRIMARY", role: "Sensor1", kind: "attach" }]);

    const returnEvent = timeline.find((e) => e.entry.transaction === "k3")!;
    expect(returnEvent.attachments).toEqual([{ assetId: "DL-UM-16984-PRIMARY", role: "Sensor1", kind: "detach" }]);

    const migrationEvent = timeline.find((e) => e.entry.transaction === "k1")!;
    expect(migrationEvent.attachments).toEqual([]);
  });

  it("orders events newest first, matching getAssetHistory's own convention (FR-033)", () => {
    const timeline = buildTimeline(history, []);
    expect(timeline.map((e) => e.entry.transaction)).toEqual(["t4", "t3", "t2", "t1"]);
  });
});
