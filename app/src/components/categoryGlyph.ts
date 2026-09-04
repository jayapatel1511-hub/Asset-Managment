import type { GlyphName } from "./Glyph";

/**
 * Category tile icons from mockup `CAT_ICON` (`docs/mockups/ams-ui/js/app.js`),
 * keyed by the catalogue's `eng_assetgroup` values rather than the prototype's short ids.
 */
const GROUP_GLYPH: Record<string, GlyphName> = {
  seismographs: "wave",
  acoustics: "mic",
  soundlevelmeter: "mic",
  microphone: "mic",
  geotechnicalmonitoring: "drill",
  geotechnical: "drill",
  geomatics: "tri",
  geomaticssurvey: "tri",
  survey: "tri",
  communications: "radio",
  cellularservice: "radio",
  imaging: "cam2",
  airquality: "wind",
  general: "crate",
  generalequipment: "crate",
};

function normaliseGroup(group: string): string {
  return group.replace(/[\s/_-]+/g, "").toLowerCase();
}

export function categoryGlyph(group: string): GlyphName {
  return GROUP_GLYPH[normaliseGroup(group)] ?? "box";
}
