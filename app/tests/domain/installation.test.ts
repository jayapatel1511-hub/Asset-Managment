import { describe, expect, it } from "vitest";
import { componentsAsOf, isFullyRecovered, openComponents, requiresOrientation } from "@/domain/installation";
import type { InstallationComponent } from "@/api/types";

function comp(overrides: Partial<InstallationComponent>): InstallationComponent {
  return {
    id: "c1",
    installation: "inst-1",
    asset: "GEO-UM-16984",
    kitrole: "Sensor1",
    orientation: "V",
    start: "2026-01-01T00:00:00.000Z",
    end: null,
    openedbyline: "txn-1",
    closedbyline: null,
    ...overrides,
  };
}

describe("requiresOrientation — FR-004", () => {
  it("requires orientation for every sensor slot", () => {
    expect(requiresOrientation("Sensor1")).toBe(true);
    expect(requiresOrientation("Sensor2")).toBe(true);
    expect(requiresOrientation("Sensor3")).toBe(true);
    expect(requiresOrientation("Sensor4")).toBe(true);
  });

  it("does not require orientation for the primary, microphone, modem, cellular, router or accessory roles", () => {
    expect(requiresOrientation("Primary")).toBe(false);
    expect(requiresOrientation("Microphone")).toBe(false);
    expect(requiresOrientation("Modem")).toBe(false);
    expect(requiresOrientation("Cellular")).toBe(false);
    expect(requiresOrientation("Router")).toBe(false);
    expect(requiresOrientation("Accessory")).toBe(false);
  });
});

describe("componentsAsOf — FR-020 / acceptance question 7", () => {
  const outgoing = comp({ id: "c-out", asset: "GEO-A", start: "2026-01-01", end: "2026-06-01", closedbyline: "txn-swap" });
  const incoming = comp({ id: "c-in", asset: "GEO-B", start: "2026-06-01", end: null, openedbyline: "txn-swap" });
  const untouchedOpen = comp({ id: "c-open", asset: "DL-PRIMARY", start: "2026-01-01", end: null });

  it("includes a component whose span covers asOf", () => {
    const result = componentsAsOf([outgoing, incoming, untouchedOpen], "2026-03-01");
    expect(result.map((c) => c.asset).sort()).toEqual(["DL-PRIMARY", "GEO-A"]);
  });

  it("boundary: exactly at start, the component IS included", () => {
    const result = componentsAsOf([incoming], "2026-06-01");
    expect(result.map((c) => c.asset)).toEqual(["GEO-B"]);
  });

  it("boundary: exactly at end, the component is NOT included (half-open span)", () => {
    const result = componentsAsOf([outgoing], "2026-06-01");
    expect(result).toHaveLength(0);
  });

  it("a mid-installation swap: the outgoing component is returned before the swap date and the incoming one after, with no gap or overlap on the swap date itself (FR-022)", () => {
    const before = componentsAsOf([outgoing, incoming], "2026-05-01");
    const onSwapDate = componentsAsOf([outgoing, incoming], "2026-06-01");
    const after = componentsAsOf([outgoing, incoming], "2026-09-01");

    expect(before.map((c) => c.asset)).toEqual(["GEO-A"]);
    expect(onSwapDate.map((c) => c.asset)).toEqual(["GEO-B"]);
    expect(after.map((c) => c.asset)).toEqual(["GEO-B"]);
  });

  it("still-open components remain included arbitrarily far in the future", () => {
    const result = componentsAsOf([untouchedOpen], "2099-01-01");
    expect(result).toHaveLength(1);
  });

  it("a component that has not started yet is excluded", () => {
    const future = comp({ id: "c-future", asset: "GEO-FUTURE", start: "2026-12-01", end: null });
    const result = componentsAsOf([future], "2026-06-01");
    expect(result).toHaveLength(0);
  });
});

describe("openComponents / isFullyRecovered — FR-014/FR-015/FR-018", () => {
  it("openComponents returns only rows with a null end", () => {
    const open = comp({ id: "c-open", end: null });
    const closed = comp({ id: "c-closed", end: "2026-06-01" });
    expect(openComponents([open, closed])).toEqual([open]);
  });

  it("isFullyRecovered is false while any component remains open", () => {
    const open = comp({ id: "c-open", end: null });
    const closed = comp({ id: "c-closed", end: "2026-06-01" });
    expect(isFullyRecovered([open, closed])).toBe(false);
  });

  it("isFullyRecovered is true once every component is closed", () => {
    const closedA = comp({ id: "c-a", end: "2026-06-01" });
    const closedB = comp({ id: "c-b", end: "2026-06-01" });
    expect(isFullyRecovered([closedA, closedB])).toBe(true);
  });
});
