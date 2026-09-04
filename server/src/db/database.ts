/**
 * The database interface every service and test depends on, and the factory that chooses a
 * driver behind it.
 *
 * Two drivers satisfy it:
 *
 *   postgres.ts  a `pg` Pool against a networked PostgreSQL server (docker-compose.yml, and
 *                the shape Azure Database for PostgreSQL Flexible Server takes). Selected by
 *                AMS_DB=postgres, which is the default.
 *   pglite.ts    the original in-process PGlite. Selected by AMS_DB=pglite. Kept working
 *                deliberately: it is the fallback when no daemon is available, and keeping both
 *                green is the evidence that nothing above this layer knows which one it has.
 *
 * `Queryable` is unchanged from the PGlite proof of concept — one method, `query(sql, params)`.
 * That is the whole surface every service depends on, which is why swapping the driver did not
 * touch a single service. `Tx` and `Database` are supersets of it, not modifications: the extra
 * members are only ever used by the seed loader (`exec`) and the command wrapper
 * (`transaction`), both of which need a root handle rather than a mere `Queryable`.
 *
 * There is no `SCHEMA_SQL` here any more. The schema used to be one file re-executed on every
 * start-up; it is now `db/migrations/`, applied by `migrate.ts` through the same two drivers.
 * The export was removed rather than kept pointing at a copy, because two files that both
 * describe the schema is the drift the migration ledger exists to prevent.
 */
/** The subset services depend on — so a service can run against the database directly (reads)
 * or inside a transaction (writes) with one signature. Unchanged since the PGlite POC. */
export interface Queryable {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** A handle inside an open transaction. `exec` runs statements with no parameters and no result
 * (the seed loader's TRUNCATE); everything else goes through `query`. */
export interface Tx extends Queryable {
  exec(query: string): Promise<void>;
}

/** A root handle: queries, multi-statement execution, transactions, and shutdown. */
export interface Database extends Tx {
  /**
   * Runs `body` inside BEGIN / COMMIT, rolling back if it throws. On PostgreSQL this checks one
   * client out of the pool and holds it for the whole callback, so every statement inside runs
   * on the same connection — which is what makes `SELECT ... FOR UPDATE` mean anything.
   */
  transaction<T>(body: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Which driver is behind this handle. Reported at start-up; used by tests to skip what a
   * driver structurally cannot do. */
  readonly driver: "postgres" | "pglite";
}

export type DriverName = Database["driver"];

export function resolveDriver(raw = process.env.AMS_DB): DriverName {
  const name = (raw ?? "postgres").toLowerCase();
  if (name === "postgres" || name === "pglite") return name;
  throw new Error(`Unknown AMS_DB="${raw}". Use "postgres" (default) or "pglite".`);
}

export async function readMeta(db: Queryable, key: string): Promise<string | null> {
  const res = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
  return res.rows[0]?.value ?? null;
}

export async function writeMeta(db: Queryable, key: string, value: string): Promise<void> {
  await db.query("INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
}

/**
 * Which environment this process believes it is. Lower-cased, `"development"` when nothing says
 * otherwise.
 *
 * It lives beside the `meta` helpers because that is what it is for: the seed loader stamps it
 * into `meta.environment`, and `db/migrations/0007_environment_guard.sql` reads that marker
 * alongside the dataset marker to refuse synthetic data in production (CLAUDE.md rule 12).
 * `server/src/db/identity.ts` reads it for the same reason — demo identities are fixtures too.
 *
 * NODE_ENV is honoured as a fallback deliberately. A deployment that sets only NODE_ENV=production
 * and forgets AMS_ENV should still refuse a synthetic load; the failure mode of guessing
 * "production" too eagerly is a refused seed with a clear message, and the failure mode of
 * guessing it too rarely is fabricated fleet history in front of a client.
 */
export function resolveEnvironment(): string {
  return (process.env.AMS_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
}
