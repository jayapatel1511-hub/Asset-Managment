/// <reference types="node" />
/**
 * Synthetic fleet history generator — feature 007 (specs/007-synthetic-data/spec.md).
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/synthetic/generate.ts \
 *        [--profile demo|standard|large] [--seed <text>] [--as-of YYYY-MM-DD] \
 *        [--history-years 20] [--detail-years 5] [--deep-rate 0.4] [--scale <n>] \
 *        [--out <dir>] [--check-determinism]
 *
 * Runs the simulation, computes the answer key, verifies every invariant, and writes the dataset
 * to migration/synthetic/<profile>/ plus a report to migration/reports/. Exit code 1 when any
 * check fails (FR-056 — fail, not warn); the manifest then says `verified: false` and the app's
 * copy step refuses the dataset.
 *
 * Run from app/ with the portable Node (specs/AGENT-BRIEF.md §1). `npm run synthetic` wraps this.
 */
import { buildAnswerKey } from "./lib/answerKey";
import { loadConfig, parseParams, type LoadedConfig, type Params } from "./lib/config";
import { IdFactory } from "./lib/ids";
import { Ledger } from "./lib/ledger";
import { buildManifest, powerBiTables, serialiseDataset, writeDataset, writeReport } from "./lib/output";
import { Rng } from "./lib/rng";
import { Simulation } from "./lib/sim";
import { verify, type Check } from "./lib/verify";

function runOnce(cfg: LoadedConfig, params: Params) {
  const rng = new Rng(params.seed);
  const ids = new IdFactory(params.seed);
  const ledger = new Ledger(ids, cfg.catalogue, cfg.locations, `[SYNTHETIC s=${params.seed}]`, `SYNTHETIC seed=${params.seed} profile=${params.profile}`);
  const sim = new Simulation(cfg, params, rng, ledger);
  sim.run();
  const key = buildAnswerKey(ledger, sim, cfg.catalogue, params.asOf);
  return { ledger, sim, key };
}

async function main(): Promise<number> {
  const started = Date.now();
  const params = parseParams(process.argv.slice(2));
  const checkDeterminism = process.argv.includes("--check-determinism");
  const cfg = loadConfig();
  console.log(`synthetic: profile=${params.profile} scale=${params.scale} seed=${params.seed} as-of=${params.asOf} horizon=${params.historyYears}y detail=${params.detailYears}y deep-rate=${params.deepRate}`);

  const { ledger, sim, key } = runOnce(cfg, params);
  console.log(`synthetic: simulated ${ledger.assets.size} assets, ${ledger.transactions.length} transactions, ${ledger.lines.length} lines in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const checks: Check[] = await verify(ledger, sim, cfg, params, key);
  const files = serialiseDataset(ledger, sim, cfg, key);

  let determinism: Check | null = null;
  if (checkDeterminism) {
    const t = Date.now();
    const second = runOnce(cfg, params);
    const files2 = serialiseDataset(second.ledger, second.sim, cfg, second.key);
    const differing = Object.keys(files).filter((f) => files[f] !== files2[f]);
    determinism = { id: "FR-052", name: "Two generations with the same seed and parameters are byte-identical", pass: differing.length === 0, value: differing.length === 0 ? `all ${Object.keys(files).length} files identical` : `${differing.length} files differ`, detail: differing.join(", ") + ` (${((Date.now() - t) / 1000).toFixed(1)} s)` };
  }

  const failed = [...checks, ...(determinism ? [determinism] : [])].filter((c) => c.pass === false);
  const generatedAt = new Date().toISOString();
  const manifest = buildManifest(ledger, sim, cfg, params, failed.length === 0, [...Object.keys(files), "manifest.json"], generatedAt);
  writeDataset(params, files, manifest, powerBiTables(ledger, sim, cfg));
  const report = writeReport(params, manifest, checks, Date.now() - started, determinism);

  for (const c of [...checks, ...(determinism ? [determinism] : [])]) {
    const tag = c.pass === null ? "info" : c.pass ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${c.id.padEnd(8)} ${c.name} — ${c.value}${c.pass === false && c.detail ? `\n           ${c.detail}` : ""}`);
  }
  console.log(`synthetic: wrote ${params.outDir}`);
  console.log(`synthetic: report ${report}`);
  console.log(`synthetic: ${failed.length === 0 ? "PASS" : `FAIL (${failed.length})`} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return failed.length === 0 ? 0 : 1;
}

process.exitCode = await main();
