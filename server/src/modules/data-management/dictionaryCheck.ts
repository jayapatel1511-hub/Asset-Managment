/**
 * `npm run data:dictionary:check`
 *
 * Fails when a production column from `db/migrations/` lacks a dictionary entry,
 * or when an entry contradicts its declared sensitivity / offline / export rule.
 * Writes `data/dictionary/fields.json` so the committed artifact matches the catalogue.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_DIR } from "../../db/migrate";
import { committedDictionaryPath, coverageFromCatalogue, writeCommittedDictionaryJson } from "./dictionary";
import { dictionaryContradictions } from "./fieldCatalogue";

const here = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = committedDictionaryPath();
mkdirSync(path.dirname(jsonPath), { recursive: true });
writeCommittedDictionaryJson(jsonPath);

const report = coverageFromCatalogue(MIGRATIONS_DIR);
const contradictions = dictionaryContradictions();
const problems: string[] = [];
if (report.missing.length) {
  problems.push(`${report.missing.length} production field(s) missing a dictionary entry:`);
  for (const m of report.missing) problems.push(`  - ${m.entityName}.${m.fieldName}`);
}
if (contradictions.length) {
  problems.push(`${contradictions.length} dictionary contradiction(s):`);
  for (const c of contradictions) problems.push(`  - ${c.entityName}.${c.fieldName}: ${c.detail}`);
}

if (problems.length) {
  console.error(`data:dictionary:check failed (${report.withEntry}/${report.totalProductionFields} covered)\n${problems.join("\n")}`);
  process.exit(1);
}

console.log(`data:dictionary:check ok — ${report.withEntry}/${report.totalProductionFields} fields, artifact ${path.relative(path.resolve(here, "../../../../"), jsonPath)}`);
