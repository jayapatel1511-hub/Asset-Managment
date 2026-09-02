import { describe, expect, it } from "vitest";
import {
  isIncompleteAssetId,
  isTemporaryAssetId,
  mintAssetId,
  mintSequencedId,
  mintSerialisedId,
  mintTemporaryId,
  parseAssetId,
  stripEmbeddedPrefixCode,
} from "@/domain/assetId";

describe("stripEmbeddedPrefixCode", () => {
  it("strips a manufacturer code the serial repeats from the prefix", () => {
    expect(stripEmbeddedPrefixCode("DL-UM", "UM16984")).toBe("16984");
    expect(stripEmbeddedPrefixCode("GEO-UM", "UM16984")).toBe("16984");
    expect(stripEmbeddedPrefixCode("DL-BE", "BE18794")).toBe("18794");
  });

  it("leaves a plain numeric serial untouched (Sigicom style)", () => {
    expect(stripEmbeddedPrefixCode("GEO-V12", "32700")).toBe("32700");
    expect(stripEmbeddedPrefixCode("DL-D10", "107245")).toBe("107245");
  });

  it("does not strip when the serial is exactly the code with nothing after it", () => {
    expect(stripEmbeddedPrefixCode("DL-UM", "UM")).toBe("UM");
  });
});

describe("mintSerialisedId — FR-006", () => {
  it("mints {prefix}-{serial digits}, per the spec's own worked examples", () => {
    expect(mintSerialisedId("DL-UM", "UM16984")).toBe("DL-UM-16984");
    expect(mintSerialisedId("GEO-V12", "30220")).toBe("GEO-V12-30220");
    expect(mintSerialisedId("SLM-S50", "13595")).toBe("SLM-S50-13595");
  });

  it("never repeats the manufacturer code (the DL-UM-UM16984 bug, regression-tested)", () => {
    const id = mintSerialisedId("GEO-UM", "UM16920");
    expect(id).toBe("GEO-UM-16920");
    expect(id).not.toContain("UM-UM");
  });

  it("the shared-serial case: a data logger and its geophone sibling get different, correct tags", () => {
    expect(mintSerialisedId("DL-UM", "UM16984")).toBe("DL-UM-16984");
    expect(mintSerialisedId("GEO-UM", "UM16984")).toBe("GEO-UM-16984");
  });

  it("refuses a blank serial rather than minting a broken tag", () => {
    expect(() => mintSerialisedId("DL-UM", "")).toThrow();
    expect(() => mintSerialisedId("DL-UM", "   ")).toThrow();
  });
});

describe("mintSequencedId / mintTemporaryId — FR-006, FR-007", () => {
  it("zero-pads to 4 digits by default", () => {
    expect(mintSequencedId("DST", 246)).toBe("DST-0246");
    expect(mintSequencedId("AC", 12)).toBe("AC-0012");
    expect(mintSequencedId("SRV", 16)).toBe("SRV-0016");
  });

  it("does not truncate a sequence value wider than the padding", () => {
    expect(mintSequencedId("DST", 12345)).toBe("DST-12345");
  });

  it("mints TMP- tags the same way", () => {
    expect(mintTemporaryId(21)).toBe("TMP-0021");
  });

  it("rejects a non-positive-integer sequence value", () => {
    expect(() => mintSequencedId("DST", 0)).toThrow();
    expect(() => mintSequencedId("DST", -1)).toThrow();
    expect(() => mintSequencedId("DST", 1.5)).toThrow();
  });
});

describe("mintAssetId — dispatches on model.isserialised", () => {
  it("mints a serialised id when the model is serialised", () => {
    expect(mintAssetId({ idprefix: "DL-UM", isserialised: true }, "UM21999", 999)).toBe("DL-UM-21999");
  });

  it("mints a sequenced id when the model is not serialised, ignoring any serial given", () => {
    expect(mintAssetId({ idprefix: "DST", isserialised: false }, null, 246)).toBe("DST-0246");
  });

  it("throws for a serialised model given no serial", () => {
    expect(() => mintAssetId({ idprefix: "DL-UM", isserialised: true }, null, 1)).toThrow();
    expect(() => mintAssetId({ idprefix: "DL-UM", isserialised: true }, "  ", 1)).toThrow();
  });
});

describe("parseAssetId — round trips and legacy/incomplete tags", () => {
  it("round trips a normal serialised tag", () => {
    const parsed = parseAssetId("DL-UM-16984");
    expect(parsed).toMatchObject({ prefix: "DL-UM", suffix: "16984", isTemporary: false, isPrefixOnly: false });
  });

  it("round trips a multi-segment prefix like SLM-LD-PA", () => {
    const parsed = parseAssetId("SLM-LD-PA-1712");
    expect(parsed).toMatchObject({ prefix: "SLM-LD-PA", suffix: "1712" });
  });

  it("round trips a non-serialised sequence tag", () => {
    expect(parseAssetId("DST-0246")).toMatchObject({ prefix: "DST", suffix: "0246" });
  });

  it("flags a prefix-only legacy tag (GEO-, DL-) rather than throwing", () => {
    const parsed = parseAssetId("GEO-");
    expect(parsed.isPrefixOnly).toBe(true);
    expect(parsed.prefix).toBe("GEO");
    expect(isIncompleteAssetId("GEO-")).toBe(true);
  });

  it("flags a TMP tag as temporary and incomplete", () => {
    expect(isTemporaryAssetId("TMP-0021")).toBe(true);
    expect(isIncompleteAssetId("TMP-0021")).toBe(true);
  });

  it("a fully-formed permanent tag is neither temporary nor incomplete", () => {
    expect(isIncompleteAssetId("DL-UM-16984")).toBe(false);
    expect(isTemporaryAssetId("DL-UM-16984")).toBe(false);
  });

  it("handles a blank id without throwing (edge case: asset with no serial, mid-completion)", () => {
    expect(() => parseAssetId("")).not.toThrow();
    expect(parseAssetId("").isPrefixOnly).toBe(true);
  });
});
