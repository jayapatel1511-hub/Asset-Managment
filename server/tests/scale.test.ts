/**
 * Scale proof — WS-W12's "5,000 active assets, 100,000+ transaction lines".
 *
 * Opt-in. It seeds the LARGE synthetic profile (6,626 assets, 438,619 transaction lines) into an
 * isolated database, which takes long enough that putting it in the default suite would tax every
 * run to prove something that changes rarely. Run it deliberately:
 *
 *   AMS_SCALE=1 npx vitest run tests/scale.test.ts
 *
 * Why it exists at all, when the fleet today is 1,026 assets: `services/readModel.ts` says in its
 * own header that the asset predicates are "ports of api/mock/index.ts running in TypeScript over
 * the full asset table, not rewritten as SQL WHERE clauses", justified because "the fleet is
 * ~1,000–5,000 rows". That is a reasonable POC trade with a stated validity range, and a stated
 * range is a thing to test at its edge rather than assume. This file is what turns
 * "should be fine" into a number.
 *
 * The budgets below are deliberately loose — they are regression detectors, not SLOs. A read that
 * takes 300 ms instead of 30 ms is not a user-visible problem; a read that takes 30 seconds is a
 * design failure, and that is the difference this catches. The measured figures are recorded in
 * the assertion messages so a future run can see what changed rather than only that it changed.
 *
 * Rule 12 is checked first and hardest: this dataset is synthetic, it must be *marked* synthetic,
 * and nothing here may run against a database holding real data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp, createContext } from "../src/app";
import { REPO_ROOT } from "../src/config";
import type { Database } from "../src/db/database";
import { openTestDatabase } from "../src/db/open";
import { seedIfNeeded } from "../src/db/seed";
import type { Asset, DatasetInfo, FleetCounts, HistoryEntry } from "../../packages/contracts/src/types";

const ENABLED = process.env.AMS_SCALE === "1";
const LARGE = path.join(REPO_ROOT, "migration", "synthetic", "large");

// WS-W12's stated targets. The profile exceeds both; asserting the floor rather than the exact
// figure means regenerating the profile with a new seed does not break the test.
const MIN_ASSETS = 5_000;
const MIN_LINES = 100_000;

/** Loose ceilings, in milliseconds. See the header: regression detectors, not SLOs. */
const BUDGET = {
  listAll: 4_000,
  search: 4_000,
  filtered: 4_000,
  assetDetail: 500,
  history: 1_500,
  fleetCounts: 4_000,
  calibrationDue: 4_000,
};

let app: FastifyInstance;
let db: Database;
let dataset: DatasetInfo;

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - started)];
}

async function getJson<T>(url: string, as = "owner"): Promise<T> {
  const res = await app.inject({ method: "GET", url, headers: { "x-ams-dev-user": as } });
  if (res.statusCode !== 200) throw new Error(`GET ${url} → ${res.statusCode}: ${res.body.slice(0, 200)}`);
  return res.json() as T;
}

beforeAll(async () => {
  if (!ENABLED) return;
  db = await openTestDatabase();
  const seed = await seedIfNeeded(db, LARGE);
  dataset = seed.dataset;
  app = await buildApp(createContext(db, dataset), { logger: false });
  await app.ready();
}, 600_000);

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe.skipIf(!ENABLED)("scale — the large synthetic profile", () => {
  it("is marked synthetic, and is big enough to be worth measuring (rule 12, WS-W12)", async () => {
    // Rule 12 first. A scale run that quietly loaded real production data would be a far worse
    // outcome than a slow query.
    expect(dataset.synthetic, "the large profile must declare itself synthetic").toBe(true);
    expect(dataset.profile).toBe("large");

    const assets = await db.query<{ n: string }>("SELECT count(*) AS n FROM asset");
    const lines = await db.query<{ n: string }>("SELECT count(*) AS n FROM asset_transaction_line");
    const nAssets = Number(assets.rows[0].n);
    const nLines = Number(lines.rows[0].n);

    expect(nAssets, `assets loaded: ${nAssets}`).toBeGreaterThanOrEqual(MIN_ASSETS);
    expect(nLines, `transaction lines loaded: ${nLines}`).toBeGreaterThanOrEqual(MIN_LINES);
    console.log(`[scale] ${nAssets} assets, ${nLines} transaction lines`);
  });

  it("answers the fleet list, search and filters inside budget", async () => {
    const [all, tList] = await timed(() => getJson<Asset[]>("/api/assets"));
    expect(all.length).toBeGreaterThanOrEqual(MIN_ASSETS);
    expect(tList, `listAssets (unfiltered, ${all.length} rows) took ${tList} ms`).toBeLessThan(BUDGET.listAll);

    const [found, tSearch] = await timed(() => getJson<Asset[]>("/api/assets?query=SEIS"));
    expect(tSearch, `searchAssets took ${tSearch} ms (${found.length} rows)`).toBeLessThan(BUDGET.search);

    const [filtered, tFilter] = await timed(() =>
      getJson<Asset[]>("/api/assets?status=Available&assetgroup=Seismographs")
    );
    expect(tFilter, `filtered list took ${tFilter} ms (${filtered.length} rows)`).toBeLessThan(BUDGET.filtered);

    console.log(`[scale] list ${tList} ms · search ${tSearch} ms · filtered ${tFilter} ms`);
  });

  it("answers a single asset and its full history inside budget", async () => {
    // The asset with the LONGEST history, not an arbitrary one — WS-W12 asks for "long timeline",
    // and an average asset would not exercise it.
    const busiest = await db.query<{ asset: string; n: string }>(
      "SELECT asset, count(*) AS n FROM asset_transaction_line GROUP BY asset ORDER BY count(*) DESC LIMIT 1"
    );
    const assetId = busiest.rows[0].asset;
    const lineCount = Number(busiest.rows[0].n);

    const [asset, tAsset] = await timed(() => getJson<Asset>(`/api/assets/${encodeURIComponent(assetId)}`));
    expect(asset.assetid).toBe(assetId);
    expect(tAsset, `asset detail took ${tAsset} ms`).toBeLessThan(BUDGET.assetDetail);

    const [history, tHistory] = await timed(() =>
      getJson<HistoryEntry[]>(`/api/assets/${encodeURIComponent(assetId)}/history`)
    );
    expect(history.length).toBe(lineCount);
    expect(tHistory, `history for ${assetId} (${lineCount} lines) took ${tHistory} ms`).toBeLessThan(BUDGET.history);

    console.log(`[scale] busiest asset ${assetId}: ${lineCount} lines · detail ${tAsset} ms · history ${tHistory} ms`);
  });

  it("answers the reports inside budget, and their totals reconcile with the fleet list", async () => {
    const [counts, tCounts] = await timed(() => getJson<FleetCounts>("/api/reports/fleet-counts"));
    expect(tCounts, `fleet counts took ${tCounts} ms`).toBeLessThan(BUDGET.fleetCounts);

    const [due, tDue] = await timed(() => getJson<Asset[]>("/api/calibration/due?horizonDays=30"));
    expect(tDue, `calibration due took ${tDue} ms`).toBeLessThan(BUDGET.calibrationDue);

    // WS-W9: "every figure reconciles to operational data". At 1,026 assets a drift between the
    // report predicate and the list predicate could hide; at 6,626 it is the same check with more
    // chances to be wrong.
    const all = await getJson<Asset[]>("/api/assets");
    const byOfficeTotal = Object.values(counts.byOffice).reduce((a, b) => a + b, 0);
    expect(byOfficeTotal, "fleet counts by office must total the fleet list").toBe(all.length);

    const byGroupTotal = Object.values(counts.byAssetGroup).reduce((a, b) => a + b, 0);
    expect(byGroupTotal, "fleet counts by asset group must total the fleet list").toBe(all.length);

    console.log(`[scale] fleet counts ${tCounts} ms · calibration due ${tDue} ms (${due.length} rows)`);
  });
});
