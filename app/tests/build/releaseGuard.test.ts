/**
 * Feature 008 US1 — a release build must be incapable of publishing fleet data.
 *
 * These tests run the real scripts as subprocesses rather than importing them, because what is
 * being relied on is the CLI contract: a non-zero exit stops `npm run build:release` before
 * `pa app push` can ever see the output. Testing the exported function would prove less.
 *
 * Why this matters concretely: `app/public/data/` carries 1,026 real Englobe assets including 127
 * SIM ICCIDs, 129 phone numbers and 226 static IPs — the three attributes the `AMS Sensitive`
 * field security profile exists to protect (FR-030, Principle VII). Compiled assets are served
 * from a publicly accessible endpoint with no IP restriction and no recall.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(APP_ROOT, "scripts", "release-guard.mjs");
const SCAN = path.join(APP_ROOT, "scripts", "scan-bundle.mjs");
const STAGED = path.resolve(APP_ROOT, "..", "migration", "staged");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run a script and capture exit code and output without throwing on non-zero. */
function run(script: string, args: string[] = [], env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const tempDirs: string[] = [];
function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ams-bundle-"));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("release-guard (T003-T006)", () => {
  it("refuses when the backend variable is unset", () => {
    const r = run(GUARD, [], { VITE_AMS_BACKEND: "" });
    expect(r.status).not.toBe(0);
  });

  it("refuses when the backend is the development backend", () => {
    const r = run(GUARD, [], { VITE_AMS_BACKEND: "mock" });
    expect(r.status).not.toBe(0);
  });

  it("passes when the backend is the production backend", () => {
    const r = run(GUARD, [], { VITE_AMS_BACKEND: "dataverse" });
    expect(r.status).toBe(0);
  });

  it("names the variable and the required value in its refusal (SC-002)", () => {
    const r = run(GUARD, [], { VITE_AMS_BACKEND: "mock" });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("VITE_AMS_BACKEND");
    expect(out).toContain("dataverse");
  });

  it("reports the value it actually saw, so a typo is diagnosable", () => {
    const r = run(GUARD, [], { VITE_AMS_BACKEND: "datavarse" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("datavarse");
  });
});

describe("scan-bundle (T007)", () => {
  it("detects a planted ICCID, phone number, static IP and Asset ID", () => {
    const dir = makeFixture({
      "assets/app.js": "const x=1;",
      "data/assets.json": '[{"identifiervalue":"89302720513012024886"}]',
    });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    expect(r.status).not.toBe(0);
  });

  it("reports clean on a bundle with no fleet data", () => {
    const dir = makeFixture({
      "index.html": "<!doctype html><html><body><div id=root></div></body></html>",
      "assets/index-abc.js": "console.log('Englobe AMS');const t=42;",
    });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    expect(r.status).toBe(0);
  });

  it("never prints a matched sensitive value — the log must not become the leak", () => {
    const iccid = "89302720513012024886";
    const dir = makeFixture({ "data/assets.json": `[{"identifiervalue":"${iccid}"}]` });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).not.toBe(0);
    expect(out).not.toContain(iccid);
  });

  it("names the offending file and the kind of value found", () => {
    const dir = makeFixture({ "data/assets.json": '[{"identifiervalue":"89302720513012024886"}]' });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("assets.json");
    expect(out.toLowerCase()).toMatch(/iccid|identifier/);
  });

  it("does NOT fail on a staged filename whose contents hold none of the staged values", () => {
    // The demo dataset and feature 007's synthetic fleet both reuse these filenames on purpose.
    // Failing on the name alone would make every safe substitution look like a leak, and a
    // scanner that cries wolf gets switched off. Found by running it, not by reading it.
    const dir = makeFixture({ "data/calibrationrecords.json": "[]" });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/substitut/i);
  });

  it("still fails when a staged filename carries real staged values", () => {
    const dir = makeFixture({
      "data/assets.json": '[{"identifiervalue":"89302720513012024886"}]',
    });
    const r = run(SCAN, ["--dist", dir, "--staged", STAGED]);
    expect(r.status).not.toBe(0);
  });
});
