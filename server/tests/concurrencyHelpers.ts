/**
 * Instrumentation and fault injection for the WS-W4 first proof (tests/concurrency.test.ts).
 *
 * Everything here exists to answer one objection: *"is your concurrent test actually
 * concurrent?"* A test that fires two `app.inject()` calls and happens to serialise proves
 * nothing at all, and would pass just as happily against the single-connection PGlite driver.
 * So this file provides three things, none of which touch a file outside tests/:
 *
 *   1. `Observer` — a DEDICATED PostgreSQL connection, outside the application's pool, that can
 *      read `pg_stat_activity` while requests are in flight. It reports how many backends are
 *      inside a transaction and how many are blocked on a lock. That is direct evidence of
 *      overlap rather than an assumption about it.
 *   2. `holdRowLocks` — a barrier. A dedicated connection takes `SELECT … FOR UPDATE` on the
 *      contested assets and holds it. Racers fired afterwards all block at the same point; once
 *      the observer confirms N backends are waiting on a lock, both racers are PROVABLY inside
 *      their transactions at the same instant. Releasing the barrier then starts a race whose
 *      simultaneity is a measurement, not a hope.
 *   3. `injectLineFault` — a test-owned `AFTER INSERT` trigger on `asset_transaction_line` that
 *      raises on the Nth line. This is how WS-W4 item 3 ("an exception after the third material
 *      step rolls back everything") is exercised without editing the service under test: the
 *      fault happens inside the real command, after a real header and real lines and real asset
 *      updates, and it is a genuine PostgreSQL error rather than a `Refusal`.
 *
 * The dedicated connections matter. Using `db.query()` for the observer would take a client out
 * of the same pool the racers need, so a saturated pool would stall the instrument that is
 * supposed to be watching it. `Observer` therefore opens its own `pg.Client` against the same
 * uniquely-named test database, found by asking the pool for `current_database()`.
 *
 * All of this is PostgreSQL-only by construction. PGlite has one connection, so there is nothing
 * to observe, nothing to block and no race to arbitrate — see concurrency.test.ts's header for
 * why the tests skip rather than pretend.
 */
import pg from "pg";
import type { Database } from "../src/db/database";
import { databaseUrl } from "../src/db/open";
import { replaceDatabase } from "../src/db/postgres";

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A countdown that resolves once `n` participants have arrived — used to force N transactions
 * to all complete their READ before any of them writes, which is how the negative controls
 * demonstrate the unprotected pattern actually losing an update. */
export function latch(n: number): { arrive(): void; all: Promise<void> } {
  let remaining = n;
  let resolveAll!: () => void;
  const all = new Promise<void>((r) => (resolveAll = r));
  if (n <= 0) resolveAll();
  return {
    arrive() {
      remaining -= 1;
      if (remaining <= 0) resolveAll();
    },
    all,
  };
}

export interface ActivitySample {
  /** Backends other than the observer that are currently inside a transaction. */
  inTransaction: number;
  /** Backends other than the observer currently blocked waiting for a lock. */
  lockWaiters: number;
}

export interface SamplerHandle {
  stop(): Promise<{ maxInTransaction: number; maxLockWaiters: number; samples: number }>;
}

/** A dedicated connection to the same test database as `db`, used only to watch. */
export class Observer {
  private constructor(
    private readonly client: pg.Client,
    readonly database: string,
    private readonly url: string
  ) {}

  static async open(db: Database): Promise<Observer> {
    const res = await db.query<{ d: string }>("SELECT current_database() AS d");
    const database = res.rows[0].d;
    const url = replaceDatabase(databaseUrl(), database);
    const client = new pg.Client({ connectionString: url, application_name: "ams-concurrency-observer" });
    await client.connect();
    return new Observer(client, database, url);
  }

  async sample(): Promise<ActivitySample> {
    const res = await this.client.query<{ in_tx: string; waiting: string }>(
      `SELECT count(*) FILTER (WHERE xact_start IS NOT NULL)::int AS in_tx,
              count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`
    );
    return { inTransaction: Number(res.rows[0].in_tx), lockWaiters: Number(res.rows[0].waiting) };
  }

  /**
   * Blocks until at least `n` backends in this database are waiting on a lock, proving that many
   * requests are simultaneously in flight and stalled at the same point. Throws with the highest
   * count actually seen rather than timing out silently — a proof that cannot demonstrate its own
   * overlap is worth reporting as a failure, not as a pass.
   */
  async waitForLockWaiters(n: number, timeoutMs = 15_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let best = 0;
    for (;;) {
      const { lockWaiters } = await this.sample();
      best = Math.max(best, lockWaiters);
      if (lockWaiters >= n) return lockWaiters;
      if (Date.now() > deadline) {
        throw new Error(`Expected ${n} backends blocked on a lock within ${timeoutMs}ms; the most ever seen was ${best}.`);
      }
      await delay(10);
    }
  }

  /**
   * The SQL each currently-blocked backend is stalled on. Reading a waiter's own statement out of
   * `pg_stat_activity` is how the lock-ordering claim is checked directly rather than inferred
   * from the absence of deadlocks.
   */
  async blockedQueries(): Promise<string[]> {
    const res = await this.client.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
    );
    return res.rows.map((r) => r.query);
  }

  /** Polls in the background for the duration of a burst, reporting peak overlap. */
  startSampler(intervalMs = 5): SamplerHandle {
    let stop = false;
    let maxInTransaction = 0;
    let maxLockWaiters = 0;
    let samples = 0;
    const loop = (async () => {
      while (!stop) {
        try {
          const s = await this.sample();
          maxInTransaction = Math.max(maxInTransaction, s.inTransaction);
          maxLockWaiters = Math.max(maxLockWaiters, s.lockWaiters);
          samples += 1;
        } catch {
          /* the observer is an instrument, never a reason to fail the run */
        }
        await delay(intervalMs);
      }
    })();
    return {
      async stop() {
        stop = true;
        await loop;
        return { maxInTransaction, maxLockWaiters, samples };
      },
    };
  }

  /**
   * Takes and holds `SELECT … FOR UPDATE` on the given assets on its own connection. Returns a
   * release function; nothing the barrier holds is ever written, so committing it changes no row.
   */
  async holdRowLocks(assetIds: string[]): Promise<() => Promise<void>> {
    const client = new pg.Client({ connectionString: this.url, application_name: "ams-concurrency-barrier" });
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT assetid FROM asset WHERE assetid = ANY($1) ORDER BY assetid FOR UPDATE", [assetIds]);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await client.query("COMMIT");
      await client.end();
    };
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

// ---------------------------------------------------------------- fault injection

const FAULT_MARKER = "AMS_TEST_INJECTED_FAULT";

export { FAULT_MARKER };

/**
 * Arms a fault that raises when the Nth transaction line of any command is inserted.
 *
 * `AFTER INSERT` rather than `BEFORE`, deliberately: by the time it fires, the header, the first
 * N lines and the first N-1 derived asset updates are all already written inside the open
 * transaction. That is what makes the rollback assertion meaningful — there is genuinely
 * something to roll back.
 */
export async function injectLineFault(db: Database, lineNumber: number): Promise<void> {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`injectLineFault needs a positive integer line number, got ${lineNumber}`);
  }
  await db.query(
    `CREATE OR REPLACE FUNCTION ams_test_line_fault() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION '${FAULT_MARKER} while writing line %', NEW.line_number; END;
     $fn$ LANGUAGE plpgsql`
  );
  await db.query("DROP TRIGGER IF EXISTS ams_test_line_fault ON asset_transaction_line");
  await db.query(
    `CREATE TRIGGER ams_test_line_fault AFTER INSERT ON asset_transaction_line
       FOR EACH ROW WHEN (NEW.line_number = ${lineNumber})
       EXECUTE FUNCTION ams_test_line_fault()`
  );
}

export async function removeLineFault(db: Database): Promise<void> {
  await db.query("DROP TRIGGER IF EXISTS ams_test_line_fault ON asset_transaction_line");
}
