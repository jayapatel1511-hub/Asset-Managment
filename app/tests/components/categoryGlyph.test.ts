import { describe, expect, it } from "vitest";
import { categoryGlyph } from "@/components/categoryGlyph";

describe("categoryGlyph", () => {
  it("maps every catalogue asset group to the mockup CAT_ICON set", () => {
    expect(categoryGlyph("Seismographs")).toBe("wave");
    expect(categoryGlyph("Acoustics")).toBe("mic");
    expect(categoryGlyph("GeotechnicalMonitoring")).toBe("drill");
    expect(categoryGlyph("Geomatics")).toBe("tri");
    expect(categoryGlyph("Communications")).toBe("radio");
    expect(categoryGlyph("Imaging")).toBe("cam2");
    expect(categoryGlyph("AirQuality")).toBe("wind");
    expect(categoryGlyph("General")).toBe("crate");
    expect(categoryGlyph("CellularService")).toBe("radio");
    expect(categoryGlyph("Microphone")).toBe("mic");
    expect(categoryGlyph("SoundLevelMeter")).toBe("mic");
  });

  it("accepts spaced or slashed labels from humanised copy", () => {
    expect(categoryGlyph("Geotechnical Monitoring")).toBe("drill");
    expect(categoryGlyph("Geomatics / Survey")).toBe("tri");
    expect(categoryGlyph("Air Quality")).toBe("wind");
  });

  it("falls back to the crate/box family rather than rendering an empty slot", () => {
    expect(categoryGlyph("UnknownFamily")).toBe("box");
    expect(categoryGlyph("")).toBe("box");
  });
});
