/**
 * The migration runner: versioned, forward-only, checksum-guarded.
 *
 * WHAT IT REPLACES. Until now the schema was one `schema.sql` full of `CREATE TABLE IF NOT
 * EXISTS`, re-executed on every start-up. That worked, and it is why 0001 is byte-identical to
 * it — but it has no answer to three questions a real database has to answer:
 *
 *   "what version is this database?"      There was no version. You inferred it by looking.
 *   "has someone edited the schema?"      Nothing noticed. An edited CREATE TABLE IF NOT EXISTS
 *                                         is a silent no-op against an existing database, which
 *                                         is the worst possible failure: the file says one thing,
 *                                         the database holds another, and the tests pass.
 *   "is this change safe to roll back?"   CLAUDE.md: "database migrations are forward-safe and
 *                                         include compatibility consequences for application
 *                                         rollback." A file that is rewritten in place has no
 *                                         forward and no back.
 *
 * The `schema_migration` ledger answers the first, the checksum answers the second, and
 * immutable numbered files answer the third.
 *
 * FORWARD-ONLY, NO DOWN MIGRATIONS. This is a decision, not an omission — WS-W2's deliverable is
 * "migration up/down **or forward-recovery** policy". Down migrations are a lie in a system whose
 * history is append-only: a down migration that drops a column drops business facts, and rule 5
 * has already settled that business facts are not deleted. Recovery is a new forward migration
 * plus, for a bad deploy, a restore. Each migration is written so an application rollback can
 * still read the database — additive columns, no renames, no drops of anything a previous release
 * reads.
 *
 * ONE TRANSACTION EACH. PostgreSQL has transactional DDL, so a migration either lands whole or
 * not at all — including its ledger row, which is inserted inside the same transaction. There is
 * no window in which a migration is applied but unrecorded, or recorded but unapplied. That is
 * the same guarantee CLAUDE.md rule 2 demands of a business event, applied to schema change.
 *
 * IDEMPOTENT. A second run finds every version in the ledger and does nothing. The individual
 * files are ALSO written idempotently (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF
 * EXISTS), which is belt and braces: the runner will not re-apply them, and if a human does, it
 * is harmless.
 *
 * CONCURRENCY. Two processes can start against the same database at once — `npm run dev` while a
 * test run creates databases, or two container replicas booting together. Each migration takes a
 * transaction-scoped advisory lock and then RE-CHECKS the ledger inside its own transaction, so
 * the loser of the race applies nothing rather than applying the same DDL twice.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database, Queryable } from "./database";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `db/migrations/` at the repository root — WS-W2 owns that path, and migrations are a property
 * of the database rather than of the Node server that happens to run them first. */
export const MIGRATIONS_DIR = path.resolve(here, "../../../db/migrations");

/** `0007_environment_guard.sql` — the number orders, the name documents. Anything else in the
 * directory (a README, an editor's backup) is ignored rather than half-applied. */
const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** An arbitrary but fixed pair: `pg_advisory_xact_lock(classid, objid)`. Only migration runs use
 * it, so it cannot collide with an application lock. */
const LOCK_KEY = [4919, 1] as const;

export interface MigrationFile {
  version: number;
  /** The descriptive half of the filename, e.g. `environment_guard`. */
  name: string;
  filename: string;
  /** sha256 of the file's bytes. The whole drift guarantee rests on this. */
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export type DriftKind = "checksum" | "missing-file" | "out-of-order";

export interface MigrationDrift {
  version: number;
  name: string;
  kind: DriftKind;
  detail: string;
}

export interface MigrationStatus {
  /** False when `schema_migration` does not exist yet — an untouched database. */
  initialised: boolean;
  applied: AppliedMigration[];
  pending: MigrationFile[];
  drift: MigrationDrift[];
  upToDate: boolean;
}

export interface MigrationResult {
  /** Filenames applied by THIS call, in order. Empty on an up-to-date database. */
  applied: string[];
  alreadyApplied: number;
  upToDate: boolean;
}

/**
 * Thrown instead of applying anything when the files on disk disagree with the ledger.
 *
 * Refusing to start is the point. The alternative — carry on and hope — is how a database ends up
 * holding objects no file describes, which is precisely the failure the old
 * apply-schema.sql-every-time approach could not detect.
 */
export class MigrationDriftError extends Error {
  constructor(readonly drift: MigrationDrift[]) {
    super(
      `Refusing to migrate: ${drift.length} migration(s) drifted from the ledger.\n` +
        drift.map((d) => `  ${String(d.version).padStart(4, "0")}_${d.name} [${d.kind}] ${d.detail}`).join("\n") +
        `\nMigrations are immutable once applied. Add a new numbered file in ${MIGRATIONS_DIR} instead of editing history.`
    );
    this.name = "MigrationDriftError";
  }
}

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Cached for the default directory only: those files are immutable by contract, and this runs
 * on every test-database creation. A caller-supplied directory is always re-read, because the
 * only reason to supply one is to vary its contents. */
let defaultCache: MigrationFile[] | null = null;

export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (dir === MIGRATIONS_DIR && defaultCache) return defaultCache;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`Cannot read migrations directory ${dir}: ${(err as Error).message}`);
  }

  const files = entries
    .map((filename) => ({ filename, match: FILENAME.exec(filename) }))
    .filter((e): e is { filename: string; match: RegExpExecArray } => e.match !== null)
    .map(({ filename, match }) => {
      const sql = readFileSync(path.join(dir, filename), "utf8");
      return { version: Number(match[1]), name: match[2], filename, checksum: checksumOf(sql), sql };
    })
    .sort((a, b) => a.version - b.version);

  if (files.length === 0) throw new Error(`No migrations found in ${dir}. Expected files named NNNN_name.sql.`);

  for (let i = 1; i < files.length; i += 1) {
    if (files[i].version === files[i - 1].version) {
      throw new Error(`Duplicate migration version ${files[i].version}: ${files[i - 1].filename} and ${files[i].filename}.`);
    }
  }

  if (dir === MIGRATIONS_DIR) defaultCache = files;
  return files;
}

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migration (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

async function ledgerExists(db: Queryable): Promise<boolean> {
  const res = await db.query<{ reg: string | null }>("SELECT to_regclass('public.schema_migration') AS reg");
  return res.rows[0]?.reg != null;
}

async function ensureLedger(db: Database): Promise<void> {
  try {
    await db.exec(LEDGER_DDL);
  } catch (err) {
    // Two processes racing on CREATE TABLE IF NOT EXISTS both pass the existence check and one
    // then hits a unique violation in the catalogue (23505 / 42P07). Both outcomes mean the table
    // is there, which is all the caller wanted.
    const code = (err as { code?: string }).code;
    if (code !== "23505" && code !== "42P07") throw err;
  }
}

async function readLedger(db: Queryable): Promise<AppliedMigration[]> {
  const res = await db.query<AppliedMigration>(
    "SELECT version, name, checksum, applied_at::text AS applied_at FROM schema_migration ORDER BY version"
  );
  return res.rows;
}

/**
 * Compares ledger against disk. Three kinds of disagreement, all refusals:
 *
 *   checksum      an applied file's bytes changed. Someone edited history. The database may or
 *                 may not contain what the file now says, and there is no way to tell from here.
 *   missing-file  the ledger records a version with no file. Usually a branch switch; sometimes a
 *                 deleted migration, which is the same crime as editing one.
 *   out-of-order  a NEW file numbered below an applied one. Two branches both claimed 0009 and
 *                 one merged first. Applying it would produce a database whose schema depends on
 *                 the order two developers happened to run their servers in.
 */
function diff(files: MigrationFile[], applied: AppliedMigration[]): { pending: MigrationFile[]; drift: MigrationDrift[] } {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  const drift: MigrationDrift[] = [];

  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (!file) {
      drift.push({
        version: row.version,
        name: row.name,
        kind: "missing-file",
        detail: `applied on ${row.applied_at} but no file defines it any more`,
      });
      continue;
    }
    if (file.checksum !== row.checksum) {
      drift.push({
        version: row.version,
        name: row.name,
        kind: "checksum",
        detail: `ledger has ${row.checksum.slice(0, 12)}…, ${file.filename} now hashes to ${file.checksum.slice(0, 12)}…`,
      });
    }
  }

  const appliedVersions = new Set(applied.map((a) => a.version));
  const highestApplied = applied.length > 0 ? Math.max(...applied.map((a) => a.version)) : 0;
  const pending: MigrationFile[] = [];

  for (const file of files) {
    if (appliedVersions.has(file.version)) continue;
    if (file.version < highestApplied) {
      drift.push({
        version: file.version,
        name: file.name,
        kind: "out-of-order",
        detail: `unapplied, but version ${highestApplied} is already applied — renumber it above ${highestApplied}`,
      });
      continue;
    }
    pending.push(file);
  }

  return { pending, drift };
}

/**
 * Reports what a migrate run WOULD do, and writes nothing — not even the ledger table. Safe
 * against a production database from a health check or a CI gate, which is the reason it exists
 * separately from `migrate`.
 */
export async function checkMigrations(db: Database, opts: { dir?: string } = {}): Promise<MigrationStatus> {
  const files = loadMigrations(opts.dir);

  if (!(await ledgerExists(db))) {
    return { initialised: false, applied: [], pending: files, drift: [], upToDate: false };
  }

  const applied = await readLedger(db);
  const { pending, drift } = diff(files, applied);
  return { initialised: true, applied, pending, drift, upToDate: pending.length === 0 && drift.length === 0 };
}

/**
 * Brings the database to the newest version. Idempotent: a second call reports `upToDate` and
 * touches nothing.
 *
 * Refuses on any drift BEFORE applying anything, so a database is never left half-migrated by a
 * run that was going to fail anyway.
 */
export async function migrate(db: Database, opts: { dir?: string } = {}): Promise<MigrationResult> {
  const files = loadMigrations(opts.dir);
  await ensureLedger(db);

  const applied = await readLedger(db);
  const { pending, drift } = diff(files, applied);
  if (drift.length > 0) throw new MigrationDriftError(drift);

  const done: string[] = [];
  for (const file of pending) {
    await db.transaction(async (tx) => {
      // Serialise concurrent migrators, then re-read: the winner may have applied this very
      // version while we were waiting, in which case there is nothing left to do.
      await tx.query(`SELECT pg_advisory_xact_lock($1, $2)`, [LOCK_KEY[0], LOCK_KEY[1]]);
      const already = await tx.query<{ c: number }>("SELECT count(*)::int AS c FROM schema_migration WHERE version = $1", [
        file.version,
      ]);
      if ((already.rows[0]?.c ?? 0) > 0) return;

      await tx.exec(file.sql);
      await tx.query("INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)", [
        file.version,
        file.name,
        file.checksum,
      ]);
      done.push(file.filename);
    });
  }

  return { applied: done, alreadyApplied: applied.length, upToDate: done.length === 0 };
}
