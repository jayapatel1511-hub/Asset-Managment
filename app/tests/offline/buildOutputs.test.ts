/**
 * WS-W6 definition of done: the build emits the manifest, the icons and the service worker — and,
 * just as importantly, does NOT emit anything it was supposed to structurally exclude.
 *
 * This runs a real `vite build --mode release` as a subprocess, for the same reason
 * tests/build/releaseGuard.test.ts runs the real scripts: what is being relied on is the build's
 * output, and asserting against a mocked bundle would prove nothing about the file that ships.
 *
 * THE REGRESSION THIS EXISTS FOR: the service worker is produced by a *second, nested* Vite build
 * (vite.config.ts's `serviceWorker` plugin). A nested build defaults `publicDir` to "public", so
 * the first version of that plugin copied app/public/data/ — 1,026 real assets with ICCIDs, phone
 * numbers and static IPs — back into dist/ immediately after the release build had excluded it.
 * Nothing in the existing suite would have caught that, because scan-bundle.mjs is a separate
 * `npm run build:release` step and the plugin ran after the main build finished. Hence this test.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..", "..");

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(path.join(tmpdir(), "ams-pwa-build-"));
  execFileSync("npx", ["vite", "build", "--mode", "release", "--outDir", outDir, "--emptyOutDir"], {
    cwd: APP_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}, 180_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const read = (relative: string) => readFileSync(path.join(outDir, relative), "utf8");

describe("the build emits an installable PWA", () => {
  it("emits the manifest even in release mode, where publicDir is switched off", () => {
    expect(existsSync(path.join(outDir, "manifest.webmanifest"))).toBe(true);
    expect(JSON.parse(read("manifest.webmanifest")).display).toBe("standalone");
  });

  it("emits every icon the manifest references", () => {
    const manifest = JSON.parse(read("manifest.webmanifest")) as { icons: Array<{ src: string }> };
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(outDir, icon.src))).toBe(true);
    }
    expect(existsSync(path.join(outDir, "icons", "apple-touch-icon-180.png"))).toBe(true);
  });

  it("emits the service worker at the scope root, under a stable name", () => {
    expect(existsSync(path.join(outDir, "sw.js"))).toBe(true);
  });
});

describe("the service worker's precache manifest", () => {
  const shellPattern = /\[("\/"[^\]]*)\]/;

  it("lists the shell, the hashed build output and the PWA assets", () => {
    const sw = read("sw.js");
    const listed = sw.match(shellPattern)?.[1] ?? "";
    expect(listed).toContain('"/index.html"');
    expect(listed).toContain("/assets/index-");
    expect(listed).toContain('"/manifest.webmanifest"');
    expect(listed).toContain('"/icons/icon-192.png"');
  });

  it("never lists the staged fleet data", () => {
    expect(read("sw.js")).not.toMatch(/["'`]\/data\//);
  });

  it("is stamped with a build version, so a deploy invalidates the cache generation", () => {
    expect(read("sw.js")).toMatch(/ams-shell-/);
  });
});

describe("a release build still ships no fleet data", () => {
  it("emits no data/ directory — including from the nested service-worker build", () => {
    expect(existsSync(path.join(outDir, "data"))).toBe(false);
  });

  it("passes the existing bundle scanner", () => {
    const result = execFileSync(process.execPath, [path.join(APP_ROOT, "scripts", "scan-bundle.mjs"), "--dist", outDir], {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result).toContain("clean");
  });
});
