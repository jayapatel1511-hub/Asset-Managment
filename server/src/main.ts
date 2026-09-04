/**
 * Entry point: open the database for the selected dataset, seed it if this is the first run
 * against that dataset, and serve the API on loopback.
 *
 *   npm run start                 start (AMS_DB=postgres by default — docker compose up first)
 *   npm run start -- --reseed     discard local writes, reload dataset
 *   npm run reseed                reload and stop (script use)
 *
 * The driver is chosen by AMS_DB (see db/open.ts). "postgres" talks to the container in
 * docker-compose.yml; "pglite" keeps the original in-process database.
 */
import { DATASET, DATASET_DIR, DB_DIR, HOST, PORT } from "./config";
import { buildApp, createContext } from "./app";
import { openDatabase } from "./db/open";
import { loadDatasetInfo, seedIfNeeded } from "./db/seed";
import { createDocumentStore, reconcileDocuments, reconciliationCounts } from "./documents";
import { JobScheduler, createOutboxWorker } from "./outbox";

const reseed = process.argv.includes("--reseed");
const exitAfterSeed = process.argv.includes("--exit");

const db = await openDatabase({ dir: DB_DIR });
const seed = await seedIfNeeded(db, DATASET_DIR, { force: reseed });
const dataset = seed.seeded ? seed.dataset : await loadDatasetInfo(db);

const app = await buildApp(createContext(db, dataset));
app.log.info(
  {
    driver: db.driver,
    dataset: DATASET,
    dbDir: db.driver === "pglite" ? DB_DIR : null,
    seeded: seed.seeded,
    synthetic: dataset.synthetic,
    profile: dataset.profile ?? null,
  },
  seed.seeded ? "database seeded from dataset" : "database already seeded — local writes preserved"
);

if (exitAfterSeed) {
  await app.close();
  await db.close();
  process.exit(0);
}

/**
 * Background work. Deliberately started here and not inside `buildApp`, because `buildApp` is
 * what every test calls: 15 test files would otherwise each spin up a polling worker and a
 * five-minute scheduler against their own throwaway database, and the outbox suite drives the
 * worker explicitly precisely so it can assert one tick at a time.
 *
 * The worker delivers `outbox_event` rows that accepted commands wrote inside their own
 * transaction (CLAUDE.md rule 2). Delivery is best-effort and never changes asset truth — a
 * failing consumer retries with bounded backoff and eventually dead-letters to an alert, and the
 * business fact it was describing is already committed either way.
 *
 * In Azure this belongs in a separate Container Apps job rather than in the API process, so that
 * a slow consumer cannot compete with a user's request for the same pool. Running it in-process is
 * a local convenience; the composition below is the whole of what has to move.
 */
const documents = createDocumentStore();
const worker = createOutboxWorker(db, { log: (payload, message) => app.log.info(payload, message) });
const scheduler = new JobScheduler(db, {
  log: (payload, message) => app.log.info(payload, message),
  reconcile: async () => reconciliationCounts(await reconcileDocuments(db, documents)),
});
worker.start();
scheduler.start();
app.log.info({ worker: "outbox", scheduler: "jobs" }, "background workers started");

/** Stop taking work before closing the pool, so an in-flight delivery is not cut off mid-write. */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await scheduler.stop();
  await worker.stop();
  await app.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: PORT, host: HOST });
