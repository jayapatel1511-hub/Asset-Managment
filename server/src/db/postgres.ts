/**
 * The networked PostgreSQL driver: a `pg` Pool behind the `Database` interface.
 *
 * This is the driver server/README.md § Swapping in networked PostgreSQL described and did not
 * have. Its three claims were tested against PostgreSQL 17.11 before this file was written
 * (docs/08-decisions.md, D-2026-09-03-PG):
 *
 *   - the schema applies unchanged, both statement-by-statement through psql and as one
 *     multi-statement `query()`, which is what each migration's `tx.exec` below does;
 *   - it is idempotent, so re-applying on every start-up changes nothing;
 *   - the plpgsql append-only triggers, the `rel_one_open_parent` partial unique index and the
 *     `ON CONFLICT ... RETURNING` sequence increment all behave as the POC assumed.
 *
 * What changes versus PGlite is not the SQL — it is that the SQL now has to be *right*. PGlite is
 * single-connection, so `transaction()` serialised the whole command path for free. A Pool hands
 * out N clients, so `SELECT ... FOR UPDATE` in deterministic assetid order and the atomic
 * sequence increment stop documenting intent and start doing work. See § Concurrency.
 */
import pg from "pg";
import type { Database, Tx } from "./database";
import { migrate } from "./migrate";

/** `text`-typed dates stay strings and every other type maps one-for-one, so no pg type parser
 * is overridden here. The two places a driver could have diverged — `count(*)` and `nextval`,
 * both bigint — were already written as `count(*)::int` and `Number(nextval)` in the POC. */

export interface PostgresOptions {
  connectionString: string;
  /** Pool size. Concurrency tests need more than one client, which is the entire point. */
  max?: number;
  applicationName?: string;
  /** Default true. False hands back an empty, unmigrated database — only the migration tests
   * want that. */
  migrate?: boolean;
}

class PgTx implements Tx {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.client.query(query, params as unknown[] | undefined);
    return { rows: res.rows as T[] };
  }

  async exec(query: string): Promise<void> {
    await this.client.query(query);
  }
}

class PostgresDatabase implements Database {
  readonly driver = "postgres" as const;

  constructor(
    private readonly pool: pg.Pool,
    /** Runs after the pool is drained — the isolated-test-database teardown hangs itself here,
     * because a database cannot be dropped while anything is connected to it. */
    private readonly onClose?: () => Promise<void>
  ) {}

  async query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.pool.query(query, params as unknown[] | undefined);
    return { rows: res.rows as T[] };
  }

  async exec(query: string): Promise<void> {
    await this.pool.query(query);
  }

  async transaction<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await body(new PgTx(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // Best-effort: if the connection itself died, ROLLBACK will fail too and the original
      // error is the one worth propagating.
      try {
        await client.query("ROLLBACK");
      } catch {
        /* the transaction is already gone; the throw below is the real answer */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.onClose?.();
  }
}

export async function openPostgres(opts: PostgresOptions): Promise<Database> {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "englobe-ams-server",
  });
  const db = new PostgresDatabase(pool);
  // Every open leaves a fully migrated database, which is what the old apply-schema.sql-on-start
  // behaviour promised and what every caller still assumes. The difference is that this one is
  // versioned, records what it did, and refuses to run against a database whose history has been
  // edited (src/db/migrate.ts). `migrate: false` exists for the migration tests themselves, which
  // need a database that has NOT been migrated yet.
  if (opts.migrate !== false) await migrate(db);
  return db;
}

// ---------------------------------------------------------------- isolated test databases

/**
 * Creates a fresh, uniquely-named database, applies the schema to it, and returns a handle whose
 * `close()` drops it again.
 *
 * WS-W1 asks for an "isolated integration-test database" so integration tests do not share
 * state. Each vitest file calls `createTestApp()` once in `beforeAll`, so this runs five times
 * per suite, in parallel worker processes — hence the pid and the random suffix in the name.
 *
 * `DROP DATABASE ... WITH (FORCE)` (PostgreSQL 13+) terminates any connection the test left
 * behind rather than failing the teardown and leaking a database into the next run.
 */
export async function createTestDatabase(adminUrl: string, opts: { max?: number; migrate?: boolean } = {}): Promise<Database> {
  const name = `ams_test_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const admin = new pg.Client({ connectionString: adminUrl, application_name: "englobe-ams-test-admin" });
  await admin.connect();
  try {
    // Identifiers cannot be parameterised; `name` is generated here from pid/time/random and
    // never from input, and the regex is belt and braces.
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing unsafe test database name: ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({
    connectionString: replaceDatabase(adminUrl, name),
    max: opts.max ?? 10,
    application_name: `englobe-ams-test:${name}`,
  });

  const db = new PostgresDatabase(pool, async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl, application_name: "englobe-ams-test-admin" });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  });

  if (opts.migrate !== false) await migrate(db);
  return db;
}

/** Swaps the database name in a connection URL, preserving credentials, host and query string. */
export function replaceDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
