/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: mode === "release" ? false : "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    // Local POC: server/ (TypeScript API + in-process PostgreSQL) listens on 127.0.0.1:3001.
    // Same-origin /api/* is proxied there so the http adapter needs no CORS and no absolute URL.
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
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
