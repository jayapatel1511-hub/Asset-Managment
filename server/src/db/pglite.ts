/**
 * The in-process PGlite driver (PostgreSQL compiled to WebAssembly), behind the same `Database`
 * interface as the networked one.
 *
 * Kept working on purpose after the PostgreSQL transport landed. Two reasons:
 *
 *   1. It is the fallback when no database daemon is available — which is the situation this
 *      proof of concept was originally written under, and could be again on a locked-down
 *      machine.
 *   2. Keeping both drivers green against the same 64 tests is the evidence that nothing above
 *      this layer knows which one it has. The moment a service needs to care, the abstraction
 *      has leaked and we want a failing test to say so.
 *
 * What it cannot do is prove concurrency. PGlite is single-connection: queries queue, and
 * `transaction()` holds the one connection for the whole callback, so the command path
 * serialises for free and `SELECT ... FOR UPDATE` never has to work. Anything racing belongs on
 * the postgres driver (server/README.md § Concurrency).
 *
 * `Queryable` is re-exported here so the services that import it from this path keep compiling
 * unchanged — its home is now database.ts.
 */
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { Database, Tx } from "./database";
import { migrate } from "./migrate";

export { readMeta, writeMeta, type Database, type Queryable, type Tx } from "./database";

class PgliteTx implements Tx {
  constructor(private readonly tx: Transaction) {}

  async query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.tx.query<T>(query, params as unknown[] | undefined);
    return { rows: res.rows };
  }

  async exec(query: string): Promise<void> {
    await this.tx.exec(query);
  }
}

class PgliteDatabase implements Database {
  readonly driver = "pglite" as const;

  constructor(private readonly db: PGlite) {}

  async query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const res = await this.db.query<T>(query, params as unknown[] | undefined);
    return { rows: res.rows };
  }

  async exec(query: string): Promise<void> {
    await this.db.exec(query);
  }

  async transaction<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
    // PGlite types the callback's return as `T | undefined` because it resolves to undefined on
    // rollback; a rollback here throws instead, so the value is present whenever we return.
    const result = await this.db.transaction(async (tx) => body(new PgliteTx(tx)));
    return result as T;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/** `dir` undefined = in-memory. `migrate: false` returns an empty database — the migration tests
 * are the only caller that wants one. */
export async function openPglite(dir?: string, opts: { migrate?: boolean } = {}): Promise<Database> {
  if (dir) mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  const wrapped = new PgliteDatabase(db);
  if (opts.migrate !== false) await migrate(wrapped);
  return wrapped;
}
