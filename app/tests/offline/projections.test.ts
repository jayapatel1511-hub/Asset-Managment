/**
 * CLAUDE.md rule 10 ("Field users never receive or cache restricted SIM/network fields"), rule 11
 * ("Production documents and job artifacts are private") and the offline rule "Cache only approved
 * projections, never unrestricted API rows".
 *
 * This is the test the whole offline layer answers to. `scripts/scan-bundle.mjs` already fails a
 * release build that ships an ICCID; these assertions are the same rule applied to the copy that
 * would otherwise sit on a technician's phone for months, readable by anyone who picks it up.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { cacheAssets, getCachedAsset, listCachedAssets } from "../../src/offline/cache";
import { STORE } from "../../src/offline/db";
import { saveDraft } from "../../src/offline/drafts";
import {
  ASSET_PROJECTION_FIELDS,
  RESTRICTED_FIELDS,
  RestrictedFieldError,
  assertCacheSafe,
  isCacheSafe,
  toAssetProjection,
} from "../../src/offline/projections";
import { assetWithSecrets, openTestDb } from "./helpers";

describe("asset projection — the narrowing", () => {
  it("drops every field-secured attribute (FR-030)", () => {
    const projection = toAssetProjection(assetWithSecrets()) as Record<string, unknown>;
    for (const field of RESTRICTED_FIELDS) {
      expect(Object.hasOwn(projection, field)).toBe(false);
    }
  });

  it("drops the carrier, the free-text notes and the server GUID as well", () => {
    const projection = toAssetProjection(assetWithSecrets()) as Record<string, unknown>;
    expect(Object.hasOwn(projection, "carrier")).toBe(false);
    expect(Object.hasOwn(projection, "notes")).toBe(false);
    expect(Object.hasOwn(projection, "id")).toBe(false);
  });

  it("contains exactly the approved field list and nothing else", () => {
    const projection = toAssetProjection(assetWithSecrets());
    expect(Object.keys(projection).sort()).toEqual([...ASSET_PROJECTION_FIELDS].sort());
  });

  it("keeps what the phone slice actually needs", () => {
    const projection = toAssetProjection(assetWithSecrets());
    expect(projection.assetid).toBe("SEIS-INS-MIC-0001");
    expect(projection.serialnumber).toBe("UM12345");
    expect(projection.manufacturer).toBe("Instantel");
    expect(projection.nextcaldue).toBe("2027-01-15");
  });
});

describe("assertCacheSafe — the runtime guard behind the narrowing", () => {
  it("refuses a restricted field at any depth", () => {
    expect(() => assertCacheSafe({ nested: { deeper: [{ identifiervalue: "891223..." }] } })).toThrow(RestrictedFieldError);
    expect(() => assertCacheSafe({ phonenumber: "+1-613-555-0142" })).toThrow(RestrictedFieldError);
    expect(() => assertCacheSafe({ staticip: "10.20.30.40" })).toThrow(RestrictedFieldError);
  });

  it("never repeats the offending value in the error, only the field and path", () => {
    try {
      assertCacheSafe({ sim: { identifiervalue: "8912230000000123456" } });
      throw new Error("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RestrictedFieldError);
      expect((error as Error).message).not.toContain("8912230000000123456");
      expect((error as Error).message).toContain("$.sim.identifiervalue");
    }
  });

  it("refuses certificate bytes and document handles (rule 11)", () => {
    expect(() => assertCacheSafe({ certificateurl: "https://blob/private/cert.pdf?sig=..." })).toThrow(RestrictedFieldError);
    expect(() => assertCacheSafe({ payload: new Uint8Array([1, 2, 3]) })).toThrow(RestrictedFieldError);
    expect(() => assertCacheSafe({ sasToken: "sv=2024" })).toThrow(RestrictedFieldError);
  });

  it("allows the *absence* of a certificate — that is a fact, not a document", () => {
    expect(isCacheSafe({ certificateurl: null, certificatenumber: "" })).toBe(true);
  });

  it("allows an ordinary approved projection", () => {
    expect(isCacheSafe(toAssetProjection(assetWithSecrets()))).toBe(true);
  });
});

describe("nothing restricted ever reaches IndexedDB", () => {
  it("caching a full API asset writes only the projection", async () => {
    const { db, partition } = await openTestDb();
    await cacheAssets(db, partition, [assetWithSecrets()]);

    const cached = await getCachedAsset(db, "SEIS-INS-MIC-0001");
    expect(cached).toBeDefined();

    // Read the raw stored bytes, not the typed accessor — the assertion has to be about what is
    // physically on the device, not about what the reader chooses to expose.
    const raw = JSON.stringify(await db.getAll(STORE.PROJECTIONS));
    expect(raw).not.toContain("8912230000000123456");
    expect(raw).not.toContain("613-555-0142");
    expect(raw).not.toContain("10.20.30.40");
    expect(raw).not.toContain("Rogers");
    expect(raw).not.toContain("Do not cache this free text");
    expect(raw).toContain("SEIS-INS-MIC-0001");
    db.close();
  });

  it("refuses a draft that somehow carries a restricted value, instead of persisting it", async () => {
    const { db, partition } = await openTestDb();
    await expect(saveDraft(db, partition, "Checkout", { assetId: "X", staticip: "10.0.0.1" })).rejects.toBeInstanceOf(RestrictedFieldError);
    await expect(db.count(STORE.DRAFTS)).resolves.toBe(0);
    db.close();
  });

  it("caches many assets without any of them leaking a restricted attribute", async () => {
    const { db, partition } = await openTestDb();
    const fleet = Array.from({ length: 25 }, (_, i) =>
      assetWithSecrets({ assetid: `SEIS-INS-MIC-${String(i).padStart(4, "0")}`, identifiervalue: `8912230000000${i}` }),
    );
    await cacheAssets(db, partition, fleet);
    await expect(listCachedAssets(db)).resolves.toHaveLength(25);
    expect(JSON.stringify(await db.getAll(STORE.PROJECTIONS))).not.toMatch(/89122300000/);
    db.close();
  });
});
