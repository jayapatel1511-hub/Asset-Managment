/**
 * Read-only field dictionary: seed, page, lookup, coverage.
 *
 * The committed catalogue in `fieldCatalogue.ts` is the source. The table is a
 * queryable copy so coverage and the API share one store. There is no PATCH.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataDictionaryEntry, DictionaryCoverageReport, DictionaryPage } from "../../../../packages/contracts/src/dataManagement";
import type { Queryable } from "../../db/database";
import { FIELD_DICTIONARY, dictionaryContradictions } from "./fieldCatalogue";

interface EntryRow {
  id: string;
  entity_name: string;
  field_name: string;
  display_name: string;
  definition: string;
  data_type: string;
  allowed_values: unknown;
  owner_role: string;
  steward_role: string;
  authority_mode: DataDictionaryEntry["authorityMode"];
  classification: string;
  read_roles: string[];
  write_roles: string[];
  export_roles: string[];
  offline_cache_allowed: boolean;
  retention_class: string;
  quality_rule_ids: string[];
  lineage_source: string | null;
  deprecated_at: Date | string | null;
  replaced_by_field: string | null;
  row_version: number;
}

export function entryFromRow(r: EntryRow): DataDictionaryEntry {
  return {
    id: r.id,
    entityName: r.entity_name,
    fieldName: r.field_name,
    displayName: r.display_name,
    definition: r.definition,
    dataType: r.data_type,
    allowedValues: r.allowed_values ?? undefined,
    ownerRole: r.owner_role,
    stewardRole: r.steward_role,
    authorityMode: r.authority_mode,
    classification: r.classification,
    readRoles: r.read_roles ?? [],
    writeRoles: r.write_roles ?? [],
    exportRoles: r.export_roles ?? [],
    offlineCacheAllowed: r.offline_cache_allowed,
    retentionClass: r.retention_class,
    qualityRuleIds: r.quality_rule_ids ?? [],
    lineageSource: r.lineage_source,
    deprecatedAt: r.deprecated_at ? new Date(r.deprecated_at).toISOString() : null,
    replacedByField: r.replaced_by_field,
    rowVersion: r.row_version,
  };
}

export async function ensureDictionary(db: Queryable): Promise<void> {
  const stamp = `v1:${FIELD_DICTIONARY.length}`;
  const current = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", ["dictionary_stamp"]);
  if (current.rows[0]?.value === stamp) return;
  for (const e of FIELD_DICTIONARY) {
    await db.query(
      `INSERT INTO data_dictionary_entry (
         id, entity_name, field_name, display_name, definition, data_type, allowed_values,
         owner_role, steward_role, authority_mode, classification, read_roles, write_roles,
         export_roles, offline_cache_allowed, retention_class, quality_rule_ids, lineage_source, row_version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1
       )
       ON CONFLICT (entity_name, field_name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         definition = EXCLUDED.definition,
         data_type = EXCLUDED.data_type,
         allowed_values = EXCLUDED.allowed_values,
         owner_role = EXCLUDED.owner_role,
         steward_role = EXCLUDED.steward_role,
         authority_mode = EXCLUDED.authority_mode,
         classification = EXCLUDED.classification,
         read_roles = EXCLUDED.read_roles,
         write_roles = EXCLUDED.write_roles,
         export_roles = EXCLUDED.export_roles,
         offline_cache_allowed = EXCLUDED.offline_cache_allowed,
         retention_class = EXCLUDED.retention_class,
         quality_rule_ids = EXCLUDED.quality_rule_ids,
         lineage_source = EXCLUDED.lineage_source,
         updated_at = now()`,
      [
        e.id, e.entityName, e.fieldName, e.displayName, e.definition, e.dataType,
        JSON.stringify(e.allowedValues ?? null), e.ownerRole, e.stewardRole, e.authorityMode,
        e.classification, e.readRoles, e.writeRoles, e.exportRoles, e.offlineCacheAllowed,
        e.retentionClass, e.qualityRuleIds, e.lineageSource ?? null,
      ]
    );
  }
  await db.query(
    "INSERT INTO meta (key, value) VALUES ('dictionary_stamp', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [stamp]
  );
}

export async function listDictionary(
  db: Queryable,
  q: { entityName?: string; authorityMode?: string; classification?: string; page: number; pageSize: number }
): Promise<DictionaryPage> {
  await ensureDictionary(db);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.entityName) {
    params.push(q.entityName);
    where.push(`entity_name = $${params.length}`);
  }
  if (q.authorityMode) {
    params.push(q.authorityMode);
    where.push(`authority_mode = $${params.length}`);
  }
  if (q.classification) {
    params.push(q.classification);
    where.push(`classification = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM data_dictionary_entry ${clause}`, params);
  const offset = (q.page - 1) * q.pageSize;
  params.push(q.pageSize, offset);
  const rows = await db.query<EntryRow>(
    `SELECT * FROM data_dictionary_entry ${clause}
      ORDER BY entity_name, field_name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: rows.rows.map(entryFromRow),
    page: q.page,
    pageSize: q.pageSize,
    total: total.rows[0]?.n ?? 0,
    dataCurrency: new Date().toISOString(),
  };
}

export async function getDictionaryEntry(db: Queryable, entityName: string, fieldName: string): Promise<DataDictionaryEntry | null> {
  await ensureDictionary(db);
  const res = await db.query<EntryRow>(
    "SELECT * FROM data_dictionary_entry WHERE entity_name = $1 AND field_name = $2",
    [entityName, fieldName]
  );
  return res.rows[0] ? entryFromRow(res.rows[0]) : null;
}

const SKIP_TABLES = new Set<string>();

/** Columns created by CREATE TABLE / ALTER TABLE ADD COLUMN in db/migrations. */
export function productionFieldsFromMigrations(dir: string): Array<{ entityName: string; fieldName: string }> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const found = new Map<string, { entityName: string; fieldName: string }>();
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const create = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/gi;
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      const entity = m[1];
      if (SKIP_TABLES.has(entity)) continue;
      for (const line of m[2].split("\n")) {
        const col = line.trim().match(/^([a-z][a-z0-9_]*)\s+/i);
        if (!col) continue;
        const name = col[1].toLowerCase();
        if (["primary", "unique", "check", "constraint", "foreign"].includes(name)) continue;
        found.set(`${entity}.${name}`, { entityName: entity, fieldName: name });
      }
    }
    const alter = /ALTER TABLE (\w+)\s+ADD COLUMN(?: IF NOT EXISTS)? (\w+)/gi;
    while ((m = alter.exec(sql))) {
      found.set(`${m[1]}.${m[2]}`, { entityName: m[1], fieldName: m[2] });
    }
    const drop = /ALTER TABLE (\w+)\s+DROP COLUMN(?: IF EXISTS)? (\w+)/gi;
    while ((m = drop.exec(sql))) {
      found.delete(`${m[1]}.${m[2]}`);
    }
  }
  // The ledger is created by the runner, not a numbered file, and is still a production table.
  found.set("schema_migration.version", { entityName: "schema_migration", fieldName: "version" });
  found.set("schema_migration.name", { entityName: "schema_migration", fieldName: "name" });
  found.set("schema_migration.checksum", { entityName: "schema_migration", fieldName: "checksum" });
  found.set("schema_migration.applied_at", { entityName: "schema_migration", fieldName: "applied_at" });
  return [...found.values()].sort((a, b) => a.entityName.localeCompare(b.entityName) || a.fieldName.localeCompare(b.fieldName));
}

export function coverageFromCatalogue(migrationsDir: string, asOf = new Date().toISOString()): DictionaryCoverageReport {
  const production = productionFieldsFromMigrations(migrationsDir);
  const have = new Set(FIELD_DICTIONARY.map((e) => `${e.entityName}.${e.fieldName}`));
  const missing = production.filter((f) => !have.has(`${f.entityName}.${f.fieldName}`));
  return {
    totalProductionFields: production.length,
    withEntry: production.length - missing.length,
    missing,
    contradictions: dictionaryContradictions(),
    asOf,
  };
}

export async function dictionaryCoverage(db: Queryable, migrationsDir: string): Promise<DictionaryCoverageReport> {
  await ensureDictionary(db);
  return coverageFromCatalogue(migrationsDir);
}

export function writeCommittedDictionaryJson(targetPath: string): void {
  writeFileSync(targetPath, `${JSON.stringify(FIELD_DICTIONARY, null, 2)}\n`, "utf8");
}

export function committedDictionaryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../data/dictionary/fields.json");
}
