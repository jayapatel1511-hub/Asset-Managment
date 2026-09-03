#!/usr/bin/env node
/**
 * Feature 008 (Release & Operations) US1 / FR-003.
 *
 * Scans a built bundle for real fleet data and fails the build if any is found.
 *
 * It checks for four things, drawn from migration/staged/ so the scan is grounded in the actual
 * data rather than a guess at what it looks like:
 *
 *   iccid    eng_asset.identifiervalue  — field-secured (FR-030, Principle VII)
 *   phone    eng_asset.phonenumber      — field-secured
 *   ip       eng_asset.staticip         — field-secured
 *   assetid  eng_asset.assetid          — not secret, but its presence means the fleet shipped
 *
 * plus a filename check for staged data files, which catches the actual failure mode directly:
 * `copy-staged-data.mjs` having populated public/data/ before a release build.
 *
 * IMPORTANT: this never prints a matched value. A scanner that echoes what it found turns the
 * build log into the leak it was meant to prevent.
 *
 * Detection is by tokenise-then-set-membership rather than searching for each of ~1,500 values in
 * turn, so it is linear in bundle size and stays fast as the fleet grows.
 *
 * Usage: node scripts/scan-bundle.mjs [--dist <dir>] [--staged <dir>]
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIST = path.resolve(arg("dist", path.join(APP_ROOT, "dist")));
const STAGED = path.resolve(arg("staged", path.join(APP_ROOT, "..", "migration", "staged")));

/** Files that must never appear in a release bundle, by basename. */
const STAGED_FILENAMES = new Set(
  existsSync(STAGED) ? readdirSync(STAGED).filter((f) => f.endsWith(".json")) : [],
);

const digits = (s) => String(s).replace(/\D/g, "");

function loadSecrets() {
  const assetsPath = path.join(STAGED, "assets.json");
  if (!existsSync(assetsPath)) {
    console.error(`  scan-bundle: cannot find ${assetsPath} — nothing to scan against.`);
    console.error("  Run the migration first, or pass --staged <dir>.");
    process.exit(2);
  }
  const assets = JSON.parse(readFileSync(assetsPath, "utf8"));
  const sets = {
    assetid: new Set(),
    iccid: new Set(),
    phone: new Set(),
    ip: new Set(),
  };
  for (const a of assets) {
    if (a.assetid) sets.assetid.add(String(a.assetid).toUpperCase());
    if (a.identifiervalue) sets.iccid.add(digits(a.identifiervalue));
    if (a.phonenumber) sets.phone.add(digits(a.phonenumber));
    if (a.staticip) sets.ip.add(String(a.staticip).trim());
  }
  return sets;
}

/** Token patterns per kind. Extract candidates once, then test set membership. */
const PATTERNS = {
  assetid: /\b[A-Z0-9]{2,6}(?:-[A-Z0-9]{1,6})+\b/g,
  iccid: /\b\d{15,22}\b/g,
  phone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ip: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
};

const NORMALISE = {
  assetid: (t) => t.toUpperCase(),
  iccid: digits,
  phone: digits,
  ip: (t) => t.trim(),
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scanText(text, secrets) {
  /** @type {Record<string, number>} */
  const found = {};
  for (const [kind, re] of Object.entries(PATTERNS)) {
    re.lastIndex = 0;
    const set = secrets[kind];
    if (set.size === 0) continue;
    let m;
    let hits = 0;
    while ((m = re.exec(text)) !== null) {
      if (set.has(NORMALISE[kind](m[0]))) {
        hits += 1;
        break; // one confirmed hit per kind per file is enough to fail
      }
    }
    if (hits > 0) found[kind] = hits;
  }
  return found;
}

function main() {
  if (!existsSync(DIST)) {
    console.error(`  scan-bundle: no bundle at ${DIST}. Build first.`);
    process.exit(2);
  }
  const secrets = loadSecrets();
  const files = walk(DIST);
  const findings = [];

  for (const file of files) {
    const rel = path.relative(DIST, file);
    const base = path.basename(file);

    if (STAGED_FILENAMES.has(base)) {
      findings.push({ rel, kinds: ["staged-data-file"] });
      continue;
    }

    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable as text — not a carrier for these values
    }
    const found = scanText(text, secrets);
    const kinds = Object.keys(found);
    if (kinds.length) findings.push({ rel, kinds });
  }

  console.log("");
  console.log(`  scan-bundle: ${files.length} file(s) in ${path.relative(APP_ROOT, DIST) || DIST}`);
  console.log(
    `  checking against ${secrets.assetid.size} asset IDs, ${secrets.iccid.size} ICCIDs, ` +
      `${secrets.phone.size} phone numbers, ${secrets.ip.size} static IPs`,
  );

  if (findings.length === 0) {
    console.log("  clean — no fleet data found in the bundle");
    console.log("");
    return;
  }

  console.error("");
  console.error("  RELEASE BUILD REFUSED — fleet data found in the bundle");
  console.error("");
  for (const f of findings) {
    console.error(`    ${f.rel}  →  ${f.kinds.join(", ")}`);
  }
  console.error("");
  console.error("  Values are deliberately not printed: a scanner that echoes what it found");
  console.error("  turns the build log into the leak it was meant to prevent.");
  console.error("");
  console.error("  Most likely cause: public/data/ was populated by copy-staged-data.mjs and then");
  console.error("  bundled. `npm run build:release` sets publicDir to false to prevent this — check");
  console.error("  that the release build was used, not `npm run build`.");
  console.error("");
  process.exit(1);
}

main();
