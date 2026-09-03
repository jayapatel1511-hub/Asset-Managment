/**
 * Opens the in-process PostgreSQL (PGlite) database and applies schema.sql.
 *
 * PGlite is single-connection: queries queue, and `db.transaction()` holds the connection for the
 * whole callback. That is what gives the command path its serialisation for free in this POC —
 * two overlapping checkouts are applied one after the other, each inside its own transaction,
 * and the second sees the first's result. On a networked PostgreSQL the same SQL would rely on
 * `SELECT ... FOR UPDATE` in deterministic order instead (docs/14 §5.3); nothing in the SQL
 * itself would change.
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = readFileSync(path.join(here, "schema.sql"), "utf8");

/** The subset of PGlite / PGlite Transaction that services depend on — so a service can run
 * against the database directly (reads) or inside a transaction (writes) with one signature. */
export interface Queryable {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** `dir` undefined = in-memory (tests). */
export async function openDatabase(dir?: string): Promise<PGlite> {
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  await db.exec(SCHEMA_SQL);
  return db;
}

export async function readMeta(db: Queryable, key: string): Promise<string | null> {
  const res = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
  return res.rows[0]?.value ?? null;
}

export async function writeMeta(db: Queryable, key: string, value: string): Promise<void> {
  await db.query("INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
}
