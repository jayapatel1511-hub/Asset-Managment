/**
 * G-24 / D1 option A (`docs/08-decisions.md`): Fluent v9 stays the component library,
 * Englobe green `#14713a` remaps `colorBrand*`. Neutrals, radii and type are pinned to
 * `docs/mockups/ams-ui/css/tokens.css` so leftover Fluent defaults do not fight the mockup.
 */
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

export const ENGLOBE_GREEN = "#14713a";

const englobe: BrandVariants = {
  10: "#EAF4EE",
  20: "#C5E3D0",
  30: "#9DCEB0",
  40: "#74B890",
  50: "#4FA373",
  60: "#2D8D58",
  70: "#1C7D48",
  80: ENGLOBE_GREEN,
  90: "#126534",
  100: "#10582D",
  110: "#0D4C27",
  120: "#0B4021",
  130: "#09341B",
  140: "#072815",
  150: "#051C0F",
  160: "#031009",
};

const mockupLight: Partial<Theme> = {
  colorNeutralBackground1: "#ffffff",
  colorNeutralBackground2: "#fafafa",
  colorNeutralBackground3: "#f5f5f5",
  colorNeutralBackground4: "#f0f0f0",
  colorNeutralBackground5: "#f0f0f0",
  colorNeutralForeground1: "#242424",
  colorNeutralForeground2: "#424242",
  colorNeutralForeground3: "#616161",
  colorNeutralForeground4: "#8a8a8a",
  colorNeutralStroke1: "#d1d1d1",
  colorNeutralStroke2: "#e0e0e0",
  colorNeutralStroke3: "#f0f0f0",
  colorNeutralStrokeAccessible: "#616161",
  colorBrandBackground: ENGLOBE_GREEN,
  colorBrandBackgroundHover: "#126534",
  colorBrandBackgroundPressed: "#10582D",
  colorBrandBackground2: "#eaf4ee",
  colorBrandForeground1: ENGLOBE_GREEN,
  colorBrandForeground2: "#126534",
  colorBrandStroke1: ENGLOBE_GREEN,
  colorBrandStroke2: "#d7eadc",
  colorNeutralForegroundOnBrand: "#ffffff",
  borderRadiusSmall: "2px",
  borderRadiusMedium: "4px",
  borderRadiusLarge: "6px",
  borderRadiusXLarge: "8px",
  fontFamilyBase:
    '"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif',
  fontFamilyMonospace: 'Consolas, "Courier New", Courier, monospace',
};

export const englobeLightTheme: Theme = {
  ...createLightTheme(englobe),
  ...mockupLight,
};

export const englobeDarkTheme: Theme = {
  ...createDarkTheme(englobe),
  colorBrandForeground1: englobe[110],
  colorBrandForeground2: englobe[120],
  colorBrandBackground: ENGLOBE_GREEN,
};
