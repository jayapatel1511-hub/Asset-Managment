#!/usr/bin/env node
/**
 * Copies migration/staged/*.json into app/public/data/ so the mock backend can `fetch()` them
 * like any other static asset, in dev and in a production build alike (Vite copies `public/`
 * verbatim into `dist/`). This is the seam: swap this copy step for a real Dataverse connection
 * string and api/dataverse/ becomes live with zero change to api/mock/ or the screens.
 *
 * Wired as predev/prebuild in package.json, same as generate-state-machine.mjs.
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, "../../migration/staged");
const TARGET_DIR = path.resolve(__dirname, "../public/data");

if (!existsSync(SOURCE_DIR)) {
  console.error(
    `migration/staged/ not found at ${SOURCE_DIR}. Run the migration pipeline first:\n` +
      "  cd migration && python 01_profile.py && python 02_clean.py && python 03_models.py " +
      "&& python 04_load.py --env dev && python 05_calibrations.py"
  );
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".json"));
for (const file of files) {
  copyFileSync(path.join(SOURCE_DIR, file), path.join(TARGET_DIR, file));
}
console.log(`Copied ${files.length} staged data file(s) from migration/staged/ to public/data/.`);
