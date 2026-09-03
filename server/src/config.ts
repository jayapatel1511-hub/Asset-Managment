/**
 * Runtime configuration for the local API. Everything resolves relative to the repository so
 * the server can be started from any working directory (the app's launch.json invokes node.exe
 * directly, exactly like the Vite entry).
 *
 *   AMS_DATASET   directory under migration/ to seed from: "staged" (real, default) or e.g.
 *                 "synthetic/demo". Same vocabulary as app/scripts/copy-staged-data.mjs.
 *   AMS_DATA_DIR  where PGlite persists; default server/data/ (gitignored).
 *   AMS_PORT/HOST default 3001 on 127.0.0.1 — loopback only; Vite proxies /api to it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../..");

const requestedDataset = process.env.AMS_DATASET ?? "staged";
if (requestedDataset.includes("..") || path.isAbsolute(requestedDataset)) {
  throw new Error(`Refusing AMS_DATASET="${requestedDataset}" — name a directory under migration/, e.g. synthetic/demo.`);
}
export const DATASET = requestedDataset;
export const DATASET_DIR = path.join(REPO_ROOT, "migration", DATASET);

export const DATA_ROOT = process.env.AMS_DATA_DIR ?? path.join(REPO_ROOT, "server", "data");
/** One database directory per dataset, so switching real <-> synthetic never replays one's
 * writes onto the other (the same rule the mock store's datasetKey enforces). */
export const DB_DIR = path.join(DATA_ROOT, DATASET.replace(/[\\/]/g, "_"));

export const PORT = Number(process.env.AMS_PORT ?? 3001);
export const HOST = process.env.AMS_HOST ?? "127.0.0.1";
