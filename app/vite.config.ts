/// <reference types="vitest/config" />
import { build, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// https://vitejs.dev/config/
//
// `mode` is "release" only for `npm run build:release`. In that mode publicDir is disabled, which
// structurally excludes app/public/data/ — the copy of migration/staged/ holding 1,026 real assets
// with SIM ICCIDs, phone numbers and static IPs (feature 008 FR-002, Principle VII).
//
// Structural rather than a cleanup step, deliberately: a `rm -rf public/data` before build is a
// thing someone can forget, and published assets are served from a public endpoint with no recall.
// The release backend fetches its data at runtime from the API after authentication, so a release
// genuinely does not need these files. (Was Dataverse; that path is parked — see src/api/index.ts.)
//
// WS-W6 added two plugins below. Read `pwaAssets` before changing the release behaviour: turning
// publicDir back on to get the manifest into a release build would undo the paragraph above.

/** Files under public/ that a release build still needs, by exact name. An allowlist, never a
 * directory copy — that is what keeps public/data/ structurally excluded when publicDir is off. */
const PWA_PUBLIC_FILES = [
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon-180.png",
];

/**
 * Emit the PWA static files when `publicDir` is disabled (the release build).
 *
 * Without this, `build:release` would produce an app whose index.html links a manifest that is not
 * there — installable in development and not in the one build that ships. Naming each file means
 * nothing else in public/ can ride along.
 */
function pwaAssets(enabled: boolean): Plugin {
  return {
    name: "ams-pwa-assets",
    apply: "build",
    generateBundle() {
      if (!enabled) return; // publicDir already copied them
      for (const file of PWA_PUBLIC_FILES) {
        this.emitFile({ type: "asset", fileName: file, source: readFileSync(path.resolve(__dirname, "public", file)) });
      }
    },
  };
}

/**
 * Build src/sw.ts into dist/sw.js as a second, separate bundle.
 *
 * WHY HAND-ROLLED INSTEAD OF vite-plugin-pwa / Workbox:
 *   The worker is ~120 lines and its policy lives in src/offline/cachePolicy.ts with its own
 *   tests. Workbox would add a build-time dependency plus a runtime library to cache an app shell
 *   and route six URL patterns, and its generated precache manifest would still need the same
 *   `data/` exclusion applied by hand. The dependency surface is the honest cost here — this
 *   repo's release-time guarantee is that no fleet data ships, and every extra build plugin is
 *   another thing that can emit a file into dist/.
 *
 * WHY A SECOND BUILD RATHER THAN A SECOND ROLLUP INPUT:
 *   A service worker must be one self-contained classic script at a stable URL, at the root of the
 *   scope it controls. A second input in the main build gets a hashed name and shared chunks, both
 *   of which break that. The nested `build()` runs with `configFile: false` and its own plugin
 *   list, so it cannot recurse into this config.
 *
 * The precache manifest and the version are computed from the *finished* main bundle, so a deploy
 * that changes one byte of the app changes the worker's cache name and invalidates cleanly.
 */
function serviceWorker(): Plugin {
  let precache: string[] = [];
  let version = "dev";
  let base = "/";
  let outDir = "dist";
  let minify: boolean | "esbuild" | "terser" = "esbuild";

  return {
    name: "ams-service-worker",
    apply: "build",
    configResolved(config) {
      base = config.base;
      outDir = config.build.outDir;
      minify = config.build.minify;
    },
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle).filter(shouldPrecacheFile);
      const prefix = base.endsWith("/") ? base : `${base}/`;

      // Three sources, because they arrive from three places and none of them covers the others:
      //   `prefix`             the navigation URL itself — what a cold start actually requests;
      //   the bundle           the content-hashed JS/CSS, plus index.html;
      //   PWA_PUBLIC_FILES     the manifest and icons, which Vite copies from public/ *after*
      //                        this hook and therefore never appear in `bundle` at all. Omitting
      //                        them would leave an installed app unable to re-read its own
      //                        manifest offline.
      precache = [prefix, `${prefix}index.html`, ...names.map((name) => `${prefix}${name}`), ...PWA_PUBLIC_FILES.map((file) => `${prefix}${file}`)].filter(
        (value, index, all) => all.indexOf(value) === index,
      );

      // Version = a hash of exactly what is being precached. Two builds with identical output get
      // the same worker (no pointless cache churn); one changed byte gets a new cache name.
      const hash = createHash("sha256");
      for (const name of names.sort()) {
        const entry = bundle[name];
        const source = entry && "code" in entry ? entry.code : entry && "source" in entry ? entry.source : name;
        hash.update(name);
        hash.update(typeof source === "string" ? source : Buffer.from(source as Uint8Array));
      }
      for (const file of PWA_PUBLIC_FILES) hash.update(readFileSync(path.resolve(__dirname, "public", file)));
      version = hash.digest("hex").slice(0, 12);
    },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        // NOT NEGOTIABLE. A nested Vite build defaults `publicDir` to "public", so without this
        // the worker build would copy app/public/data/ — 1,026 real assets with ICCIDs, phone
        // numbers and static IPs — into dist/ *after* the main build had structurally excluded it
        // for `--mode release`. Caught by tests/offline/buildOutputs.test.ts, which asserts a
        // release build emits no data/ directory.
        publicDir: false,
        define: {
          __SW_VERSION__: JSON.stringify(version),
          __SW_PRECACHE__: JSON.stringify(precache),
          __SW_BASE__: JSON.stringify(base.endsWith("/") ? base : `${base}/`),
        },
        build: {
          outDir,
          emptyOutDir: false,
          minify,
          // `iife` because a classic service worker cannot use ESM imports on Safari, and
          // `type: "module"` workers are still not universally available on iOS.
          rollupOptions: {
            input: path.resolve(__dirname, "src/sw.ts"),
            output: { entryFileNames: "sw.js", format: "iife", inlineDynamicImports: true },
          },
        },
      });
    },
  };
}

/**
 * Kept in step with src/offline/cachePolicy.ts's `shouldPrecache`. Duplicated rather than imported
 * because this file compiles under tsconfig.node.json (Node types, no DOM) and importing from src/
 * would drag the app's module graph into the config. tests/offline/cachePolicy.test.ts asserts the
 * two agree on the cases that matter — above all that `data/` is never precached.
 */
function shouldPrecacheFile(fileName: string): boolean {
  if (fileName.startsWith("data/")) return false;
  if (fileName.endsWith(".map")) return false;
  if (fileName === "sw.js") return false;
  return /\.(html|js|css|webmanifest|svg|png|woff2?)$/i.test(fileName);
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), pwaAssets(mode === "release"), serviceWorker()],
  publicDir: mode === "release" ? false : "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    // Local: server/ (TypeScript API over PostgreSQL) listens on 127.0.0.1:3001 by default.
    // Same-origin /api/* is proxied there so the http adapter needs no CORS and no absolute URL.
    //
    // AMS_API_PORT overrides the target. It exists so a second stack can run beside a demo that
    // already holds 3001 — reviewing a change while someone else's server is up, or running two
    // datasets side by side — without editing this file and risking that edit being committed.
    // It matches server/'s own AMS_PORT, so `AMS_PORT=3002 npm run dev:api` and
    // `AMS_API_PORT=3002 npm run dev:localapi` pair up.
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.AMS_API_PORT ?? 3001}`, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Restores Storage under jsdom on Node >= 26, which shadows it with its own experimental
    // localStorage global. No-op on Node 22. See tests/setup.ts for the full explanation.
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
  },
}));
