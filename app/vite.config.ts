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
// The release backend is Dataverse, which fetches its data at runtime after authentication, so a
// release genuinely does not need these files.
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
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
  },
}));
