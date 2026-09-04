/**
 * WS-W6 "web manifest" — installability, checked against the files on disk rather than against a
 * belief about them.
 *
 * A manifest that names an icon which is not there fails installability *silently*: the browser
 * offers no install prompt and reports nothing to the page. That is the specific failure these
 * tests exist to catch, which is why every icon is opened and its PNG header read, rather than
 * merely `existsSync`-ed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC = path.join(APP_ROOT, "public");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8")) as Manifest;
const html = readFileSync(path.join(APP_ROOT, "index.html"), "utf8");

/** Width and height from a PNG's IHDR chunk. Throws on anything that is not a real PNG. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web manifest", () => {
  it("is valid JSON with the fields installability requires", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // Android truncates beyond this
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
    expect(manifest.display).toBe("standalone");
  });

  it("is portrait-locked, because the Field surface is a one-handed phone slice", () => {
    expect(manifest.orientation).toBe("portrait-primary");
  });

  it("uses the Fluent brand and neutral background the app itself paints", () => {
    // @fluentui/tokens webLightTheme: colorBrandBackground / colorNeutralBackground1.
    expect(manifest.theme_color).toBe("#0f6cbd");
    expect(manifest.background_color).toBe("#ffffff");
  });

  it("uses relative start_url and scope, so hosting under a path prefix does not break the install", () => {
    expect(manifest.start_url.startsWith("/")).toBe(false);
    expect(manifest.scope.startsWith("/")).toBe(false);
  });

  it("declares no inbound handler that would let the OS originate a business event", () => {
    const raw = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8")) as Record<string, unknown>;
    expect(raw.share_target).toBeUndefined();
    expect(raw.protocol_handlers).toBeUndefined();
    expect(raw.file_handlers).toBeUndefined();
  });
});

describe("icons exist and are what the manifest says they are", () => {
  it("every referenced icon file is present and readable", () => {
    for (const icon of manifest.icons) {
      expect(() => readFileSync(path.join(PUBLIC, icon.src))).not.toThrow();
    }
  });

  it("every PNG is a real PNG at the declared pixel size", () => {
    for (const icon of manifest.icons.filter((i) => i.type === "image/png")) {
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(path.join(PUBLIC, icon.src))).toEqual({ width: w, height: h });
    }
  });

  it("supplies the two sizes Android installability requires, plus a maskable variant", () => {
    const sizes = manifest.icons.filter((i) => i.type === "image/png").map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("supplies an opaque apple-touch-icon, which iOS needs and the manifest does not cover", () => {
    const { width, height } = pngSize(path.join(PUBLIC, "icons", "apple-touch-icon-180.png"));
    expect({ width, height }).toEqual({ width: 180, height: 180 });
    expect(html).toContain('rel="apple-touch-icon"');
  });
});

describe("index.html wires the manifest up", () => {
  it("links the manifest", () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it("carries a theme-color for each colour scheme, matching useSystemTheme's OS-following rule", () => {
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#ffffff"');
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#292929"');
  });

  it("declares the iOS standalone tags a manifest alone does not cover", () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title"');
  });

  it("keeps the 390 px mobile-first viewport and covers the notch in standalone", () => {
    expect(html).toContain("width=device-width");
    expect(html).toContain("viewport-fit=cover");
  });
});
