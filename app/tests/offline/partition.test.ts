/**
 * WS-W6 rule: "cache partition: tenant + environment + user object ID"; CLAUDE.md offline rule
 * "Partition IndexedDB by tenant + environment + user object ID".
 *
 * These are the tests that stop the partition quietly becoming two-of-three. Every one of them is
 * a way a real deployment merges two caches that must never meet.
 */
import { describe, expect, it } from "vitest";
import {
  DB_NAME_PREFIX,
  databaseNameFor,
  fallbackObjectId,
  partitionKey,
  resolveObjectId,
  resolvePartition,
  samePartition,
} from "../../src/offline/partition";

const base = { tenant: "englobe.test", environment: "test" };

describe("cache partition — all three components", () => {
  it("separates two tenants with the same user and environment", () => {
    const a = resolvePartition({ upn: "tech@englobecorp.com", objectId: "oid-1" }, { ...base, tenant: "tenant-a" });
    const b = resolvePartition({ upn: "tech@englobecorp.com", objectId: "oid-1" }, { ...base, tenant: "tenant-b" });
    expect(samePartition(a, b)).toBe(false);
    expect(databaseNameFor(a)).not.toBe(databaseNameFor(b));
  });

  it("separates Dev from Prod for the same user in the same tenant", () => {
    const dev = resolvePartition({ upn: "tech@englobecorp.com", objectId: "oid-1" }, { ...base, environment: "development" });
    const prod = resolvePartition({ upn: "tech@englobecorp.com", objectId: "oid-1" }, { ...base, environment: "production" });
    expect(samePartition(dev, prod)).toBe(false);
  });

  it("separates two users on the same shared site phone", () => {
    const alpha = resolvePartition({ upn: "alpha@englobecorp.com", objectId: "oid-alpha" }, base);
    const bravo = resolvePartition({ upn: "bravo@englobecorp.com", objectId: "oid-bravo" }, base);
    expect(samePartition(alpha, bravo)).toBe(false);
  });

  it("keys on the object ID, not the UPN, so a rename does not merge two caches", () => {
    const before = resolvePartition({ upn: "sam.tech@englobecorp.com", objectId: "oid-sam" }, base);
    const afterRename = resolvePartition({ upn: "sam.patel@englobecorp.com", objectId: "oid-sam" }, base);
    expect(samePartition(before, afterRename)).toBe(true);
  });
});

describe("cache partition — encoding", () => {
  it("cannot be made ambiguous by a component containing the separator", () => {
    const a = resolvePartition({ upn: "u@x", objectId: "oid" }, { tenant: "a|b", environment: "test" });
    const b = resolvePartition({ upn: "u@x", objectId: "oid" }, { tenant: "a", environment: "b|test" });
    expect(partitionKey(a)).not.toBe(partitionKey(b));
  });

  it("refuses an empty component rather than opening a shared cache", () => {
    expect(() => partitionKey({ tenant: "", environment: "test", objectId: "oid" })).toThrow(/must not be empty/);
    expect(() => partitionKey({ tenant: "t", environment: "  ", objectId: "oid" })).toThrow(/must not be empty/);
  });

  it("prefixes the database name so a device sweep can find every AMS partition", () => {
    const partition = resolvePartition({ upn: "u@x", objectId: "oid" }, base);
    expect(databaseNameFor(partition).startsWith(`${DB_NAME_PREFIX}|`)).toBe(true);
  });
});

describe("cache partition — object ID fallback (A-TENANT)", () => {
  it("uses the real object ID when the API supplied one", () => {
    expect(resolveObjectId({ upn: "tech@englobecorp.com", objectId: "oid-real" })).toBe("oid-real");
  });

  it("derives a labelled stand-in when it did not, so the two can never be confused", () => {
    const derived = resolveObjectId({ upn: "Tech@EnglobeCorp.com" });
    expect(derived).toBe("upn:tech@englobecorp.com");
    expect(derived.startsWith("upn:")).toBe(true);
  });

  it("normalises case, so one person does not get two partitions", () => {
    expect(fallbackObjectId("Tech@Englobe.com")).toBe(fallbackObjectId("tech@englobe.com"));
  });

  it("refuses to derive an identity from nothing", () => {
    expect(() => fallbackObjectId("   ")).toThrow(/empty UPN/);
  });
});
