#!/usr/bin/env node
/**
 * Feature 008 (Release & Operations) US1 / FR-001.
 *
 * Refuses to let a release build proceed unless the data backend is explicitly the production one.
 *
 * Why this is a build-time refusal and not a review step: publishing is a one-way door. Compiled
 * assets are served from a public endpoint, and there is no recall for anything already served.
 * A checklist item can be forgotten at 5pm on a Friday; a non-zero exit code cannot.
 *
 * Run by `npm run build:release` before anything is compiled.
 *
 * REQUIRED was "dataverse" until 2026-09-03. Dataverse is parked and `api/index.ts` no longer
 * has that branch, so the real data platform is now `http` — the API in server/, and in
 * production the same adapter against the Azure API. FR-001 itself is unchanged: it says "the
 * real data platform", never which one, so this is a rebinding and not a spec deviation.
 */

const VAR = "VITE_AMS_BACKEND";
const REQUIRED = "http";
const DEV_BACKEND = "mock";

/** @param {NodeJS.ProcessEnv} env */
export function checkBackend(env) {
  const seen = (env[VAR] ?? "").trim();
  if (seen === REQUIRED) {
    return { ok: true, seen };
  }
  const because =
    seen === ""
      ? `${VAR} is not set.`
      : seen === DEV_BACKEND
        ? `${VAR} is "${DEV_BACKEND}" — the development backend, which loads the staged fleet data.`
        : `${VAR} is "${seen}", which is not a recognised backend.`;
  return { ok: true === false, seen, because };
}

const result = checkBackend(process.env);

if (!result.ok) {
  console.error("");
  console.error("  RELEASE BUILD REFUSED");
  console.error("");
  console.error(`  ${result.because}`);
  console.error(`  A release build requires ${VAR}=${REQUIRED}.`);
  console.error("");
  console.error("  The development backend loads migration/staged/ — 1,026 real assets including");
  console.error("  SIM ICCIDs, phone numbers and static IPs. Published assets are served from a");
  console.error("  public endpoint with no IP restriction and no recall.");
  console.error("");
  console.error(`  To build a release:   ${VAR}=${REQUIRED} npm run build:release`);
  console.error("  To build for local development, use `npm run build` instead.");
  console.error("");
  process.exit(1);
}

console.log(`  release-guard: OK — ${VAR}=${result.seen}`);
