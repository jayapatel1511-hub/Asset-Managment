/**
 * Entry point: open (or create) the PGlite database for the selected dataset, seed it if this
 * is the first run against that dataset, and serve the API on loopback.
 *
 *   node .../tsx/dist/cli.mjs server/src/main.ts              start
 *   ... main.ts --reseed                                       discard local writes, reload dataset
 *   ... main.ts --reseed --exit                                reload and stop (script use)
 */
import { DATASET, DATASET_DIR, DB_DIR, HOST, PORT } from "./config";
import { buildApp, createContext } from "./app";
import { openDatabase } from "./db/pglite";
import { loadDatasetInfo, seedIfNeeded } from "./db/seed";

const reseed = process.argv.includes("--reseed");
const exitAfterSeed = process.argv.includes("--exit");

const db = await openDatabase(DB_DIR);
const seed = await seedIfNeeded(db, DATASET_DIR, { force: reseed });
const dataset = seed.seeded ? seed.dataset : await loadDatasetInfo(db);

const app = await buildApp(createContext(db, dataset));
app.log.info(
  { dataset: DATASET, dbDir: DB_DIR, seeded: seed.seeded, synthetic: dataset.synthetic, profile: dataset.profile ?? null },
  seed.seeded ? "database seeded from dataset" : "database already seeded — local writes preserved"
);

if (exitAfterSeed) {
  await app.close();
  await db.close();
  process.exit(0);
}

await app.listen({ port: PORT, host: HOST });
