/**
 * Chooses a driver and opens it. The one place in the server that knows both drivers exist.
 *
 * Database environment variables live here rather than in config.ts because they are the
 * connection layer's own concern, and config.ts documents the dataset/port/host set:
 *
 *   AMS_DB            "postgres" (default) or "pglite"
 *   AMS_DATABASE_URL  postgres:// connection string. Default matches docker-compose.yml.
 *   AMS_DB_POOL_MAX   pool size, default 10. Concurrency tests need more than one client.
 *
 * The PGlite path keeps AMS_DATA_DIR / DB_DIR semantics from config.ts: one database directory
 * per dataset, so switching real <-> synthetic never replays one dataset's writes onto the
 * other. PostgreSQL has no equivalent directory — it has a database name — so the same rule is
 * enforced by the seed loader's dataset key, which already refuses to mix.
 */
import { resolveDriver, type Database } from "./database";
import { openPglite } from "./pglite";
import { createTestDatabase, openPostgres } from "./postgres";

/** Matches docker-compose.yml's service. Loopback only, and a development password that is
 * deliberately not a secret — CLAUDE.md rule 10 is about credentials in source that reach
 * production or a browser bundle, and nothing here does either. */
export const DEFAULT_DATABASE_URL = "postgres://ams:ams@127.0.0.1:5433/ams";

export function databaseUrl(): string {
  return process.env.AMS_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function poolMax(): number {
  const raw = process.env.AMS_DB_POOL_MAX;
  if (!raw) return 10;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`AMS_DB_POOL_MAX must be a positive integer, got "${raw}".`);
  return n;
}

export interface OpenOptions {
  /** PGlite only: the directory to persist in. Undefined = in-memory. Ignored by postgres. */
  dir?: string;
  /**
   * Default true: an opened database is a MIGRATED database, on both drivers, exactly as it was
   * a fully-applied-schema database before `db/migrations/` existed. False is for the migration
   * tests, which need to observe an empty database becoming a migrated one.
   */
  migrate?: boolean;
}

export async function openDatabase(opts: OpenOptions = {}): Promise<Database> {
  const driver = resolveDriver();
  if (driver === "pglite") return openPglite(opts.dir, { migrate: opts.migrate });
  return openPostgres({ connectionString: databaseUrl(), max: poolMax(), migrate: opts.migrate });
}

/**
 * The integration-test handle. On postgres this is a fresh, uniquely-named database that is
 * dropped on close (WS-W1: "isolated integration-test database"); on pglite it is an in-memory
 * instance, which was already isolated per process.
 */
export async function openTestDatabase(opts: { migrate?: boolean } = {}): Promise<Database> {
  const driver = resolveDriver();
  if (driver === "pglite") return openPglite(undefined, { migrate: opts.migrate });
  return createTestDatabase(databaseUrl(), { max: poolMax(), migrate: opts.migrate });
}
