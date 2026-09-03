#!/usr/bin/env node
/**
 * Copies one dataset's *.json into app/public/data/ so the mock backend can `fetch()` them like
 * any other static asset, in dev and in a production build alike (Vite copies `public/` verbatim
 * into `dist/`). This is the seam: swap this copy step for a real Dataverse connection string and
 * api/dataverse/ becomes live with zero change to api/mock/ or the screens.
 *
 * Wired as predev/prebuild in package.json, same as generate-state-machine.mjs.
 *
 * Which dataset (feature 007 FR-008: the real migrated data is always the default):
 *
 *   node scripts/copy-staged-data.mjs                             migration/staged  (real)
 *   node scripts/copy-staged-data.mjs --dataset synthetic/demo    migration/synthetic/demo
 *   AMS_DATASET=synthetic/standard node scripts/copy-staged-data.mjs
 *
 * A synthetic dataset carries a manifest.json; the real one does not, and that absence is what
 * identifies it as real to the app (FR-007). The target directory is emptied first so switching
 * back to the real data cannot leave a stale manifest behind claiming the data is synthetic.
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync, rmSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(__dirname, "../../migration");
const TARGET_DIR = path.resolve(__dirname, "../public/data");

const argIndex = process.argv.indexOf("--dataset");
const requested = (argIndex >= 0 ? process.argv[argIndex + 1] : process.env.AMS_DATASET) ?? "real";
const relative = requested === "real" || requested === "staged" ? "staged" : requested;

if (relative.includes("..") || path.isAbsolute(relative)) {
  console.error(`Refusing dataset path "${requested}" — name a directory under migration/, e.g. synthetic/standard.`);
  process.exit(1);
}

const SOURCE_DIR = path.join(MIGRATION_DIR, relative);

if (!existsSync(SOURCE_DIR)) {
  if (relative === "staged") {
    console.error(
      `migration/staged/ not found at ${SOURCE_DIR}. Run the migration pipeline first:\n` +
        "  cd migration && python 01_profile.py && python 02_clean.py && python 03_models.py " +
        "&& python 04_load.py --env dev && python 05_calibrations.py"
    );
  } else {
    console.error(
      `${SOURCE_DIR} not found. Generate it first:\n` +
        `  node node_modules/vite-node/vite-node.mjs scripts/synthetic/generate.ts --profile ${path.basename(relative)}`
    );
  }
  process.exit(1);
}

// FR-056: a dataset that failed its own verification is never loaded into the app.
const manifestPath = path.join(SOURCE_DIR, "manifest.json");
let manifest = null;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.verified === false) {
    console.error(
      `Refusing to load ${relative}: its manifest says verified: false — the generator's own checks failed.\n` +
        `See migration/reports/07_synthetic_${manifest.profile}_report.md, fix the cause, and regenerate.`
    );
    process.exit(1);
  }
}

if (existsSync(TARGET_DIR)) rmSync(TARGET_DIR, { recursive: true, force: true });
mkdirSync(TARGET_DIR, { recursive: true });

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".json"));
let bytes = 0;
for (const file of files) {
  const from = path.join(SOURCE_DIR, file);
  copyFileSync(from, path.join(TARGET_DIR, file));
  bytes += statSync(from).size;
}

const mb = bytes / 1e6;
const label = manifest ? `SYNTHETIC ${manifest.profile} (seed ${manifest.seed}, as of ${manifest.asOf})` : "the real migrated data";
console.log(`Copied ${files.length} file(s), ${mb.toFixed(1)} MB, from migration/${relative}/ to public/data/ — ${label}.`);

// FR-060 (amended): the loader says plainly when a dataset is too large for a browser to hold
// comfortably, rather than letting it fail obscurely at run time.
if (mb > 150) {
  console.warn(
    `WARNING: ${mb.toFixed(0)} MB is beyond what a browser tab will hold comfortably. Expect a slow first load and\n` +
      "         possible out-of-memory errors. Use --profile standard for interactive work; this profile exists to\n" +
      "         measure feature 006's SC-010 limits, and hitting them here is a finding to record, not a surprise."
  );
}
if (manifest) {
  console.log("This is fictional data. Every asset, person, project and site in it is invented — see data/synthetic/README.md.");
}
