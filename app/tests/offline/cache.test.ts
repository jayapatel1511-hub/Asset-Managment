/**
 * WS-W6 required device tests, the parts that can be proved without a phone:
 *   "airplane-mode cold start"  — a second process opens the same partition with no network at all
 *                                 and still has the fleet;
 *   "offline search"            — find an asset by tag, serial or model with the network gone.
 *
 * `fetch` is deliberately made to throw for the cold-start test. If any of this needed the network
 * the test would fail loudly rather than pass by accident on a machine that happens to be online.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_LIMIT, cacheAgeMs, cacheAssets, cacheReference, clearProjections, getCachedAsset, listCachedReference, matchesCachedAsset, searchCachedAssets } from "../../src/offline/cache";
import { openOfflineDb } from "../../src/offline/db";
import { toAssetProjection } from "../../src/offline/projections";
import { assetWithSecrets, openTestDb, testPartition } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fleet(count: number) {
  return Array.from({ length: count }, (_, i) =>
    assetWithSecrets({
      assetid: `SEIS-INS-MIC-${String(i + 1).padStart(4, "0")}`,
      serialnumber: `UM${1000 + i}`,
      equipmentmodel: { manufacturer: i % 2 ? "Instantel" : "Geosonics", model: i % 2 ? "Micromate" : "SSU2000", equipmenttype: "Data Logger" },
    }),
  );
}

describe("cold start with no network", () => {
  it("serves the cached fleet from a freshly opened database while fetch is dead", async () => {
    const partition = testPartition("coldstart");
    const first = await openOfflineDb(partition);
    await cacheAssets(first, partition, fleet(12));
    first.close(); // the app was killed by the OS

    // Airplane mode: nothing may reach the network from here on.
    vi.stubGlobal("fetch", () => {
      throw new Error("network is unavailable");
    });

    const afterRestart = await openOfflineDb(partition);
    const found = await getCachedAsset(afterRestart, "SEIS-INS-MIC-0007");
    expect(found?.assetid).toBe("SEIS-INS-MIC-0007");
    expect(found?.status).toBe("Available");
    await expect(searchCachedAssets(afterRestart, "UM1006")).resolves.toHaveLength(1);
    afterRestart.close();
  });

  it("reports how stale the cache is, so a screen can say so rather than imply it is live", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, fleet(2), { now: () => "2026-09-01T00:00:00.000Z" });
    const age = await cacheAgeMs(db, Date.parse("2026-09-03T00:00:00.000Z"));
    expect(age).toBe(2 * 24 * 60 * 60 * 1000);
    db.close();
  });

  it("reports a null age when there is nothing cached at all", async () => {
    const { db } = await openTestDb();
    await expect(cacheAgeMs(db)).resolves.toBeNull();
    db.close();
  });
});

describe("offline search", () => {
  it("matches on asset ID, serial and model — the same three the online mock matches", () => {
    const projection = toAssetProjection(assetWithSecrets());
    expect(matchesCachedAsset(projection, "mic-0001")).toBe(true);
    expect(matchesCachedAsset(projection, "um123")).toBe(true);
    expect(matchesCachedAsset(projection, "instantel micro")).toBe(true);
  });

  it("cannot match on an ICCID, because there is no ICCID to match", () => {
    const projection = toAssetProjection(assetWithSecrets());
    expect(matchesCachedAsset(projection, "8912230000000123456")).toBe(false);
  });

  it("returns nothing for an empty query rather than the whole fleet", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, fleet(5));
    await expect(searchCachedAssets(db, "   ")).resolves.toEqual([]);
    db.close();
  });

  it("caps the result set", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, fleet(40));
    await expect(searchCachedAssets(db, "SEIS", 10)).resolves.toHaveLength(10);
    db.close();
  });
});

describe("cache bounds and reference data", () => {
  it("trims oldest-first once the cache exceeds its limit", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, fleet(3), { limit: 5, now: () => "2026-09-01T00:00:00.000Z" });
    await cacheAssets(
      db,
      partition,
      fleet(9).slice(3),
      { limit: 5, now: () => "2026-09-02T00:00:00.000Z" },
    );
    const remaining = (await searchCachedAssets(db, "SEIS", 100)).map((a) => a.assetid);
    expect(remaining).toHaveLength(5);
    // The three oldest went; the six newest were themselves capped at the limit.
    expect(remaining).not.toContain("SEIS-INS-MIC-0001");
    db.close();
  });

  it("has a limit big enough for the stated 5,000-asset fleet", () => {
    expect(CACHE_LIMIT).toBeGreaterThanOrEqual(5000);
  });

  it("caches curated reference records separately from assets", async () => {
    const { db, partition } = await openTestDb();
    await cacheReference(db, partition, "location", [{ id: "Ottawa Warehouse", value: { name: "Ottawa Warehouse", office: "Ottawa" } }]);
    await cacheAssets(db, partition, fleet(2));
    await expect(listCachedReference(db, "location")).resolves.toHaveLength(1);
    await expect(searchCachedAssets(db, "SEIS", 100)).resolves.toHaveLength(2);
    db.close();
  });

  it("clearing projections on sign-out leaves commands and drafts alone", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, fleet(3));
    await db.put("commands", { id: "c1", sequence: 1, clientSubmissionId: "s1", kind: "Checkout", status: "Queued" });
    await clearProjections(db);
    await expect(searchCachedAssets(db, "SEIS", 100)).resolves.toEqual([]);
    await expect(db.count("commands")).resolves.toBe(1);
    db.close();
  });
});
