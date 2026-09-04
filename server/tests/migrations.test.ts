/**
 * The migration runner: does it apply, does it stop, and does it notice when someone rewrites
 * history?
 *
 * WS-W2's definition of done is three claims — "migrations apply to an empty database, schema
 * tests pass, and a second migration run makes no change" — and the third is the one that is easy
 * to assert badly. "Makes no change" is not "did not crash": it means no new ledger row, no
 * changed `applied_at`, and nothing re-executed. Those are asserted here by comparing the ledger
 * before and after, not by trusting the runner's own return value.
 *
 * The fourth claim is not in WS-W2 and is the reason a runner exists at all: an already-applied
 * migration whose file has since been edited must STOP the process. The old
 * apply-schema.sql-on-every-start approach could not detect that — an edited
 * `CREATE TABLE IF NOT EXISTS` is a silent no-op against an existing database — so the file said
 * one thing, the database held another, and every test still passed. Three shapes of that failure
 * are exercised below: an edited file, a deleted file, and a new file numbered underneath one
 * that is already applied.
 *
 * Temporary directories are used where a test needs migrations that do not exist in `db/`, so the
 * real, immutable migration set is never edited to make a test pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "../src/db/database";
import {
  MIGRATIONS_DIR,
  MigrationDriftError,
  checkMigrations,
  checksumOf,
  loadMigrations,
  migrate,
} from "../src/db/migrate";
import { openTestDatabase } from "../src/db/open";

const FILES = loadMigrations();

const tempDirs: string[] = [];
function tempMigrations(files: Array<{ name: string; sql: string }>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ams-migrations-"));
  tempDirs.push(dir);
  for (const f of files) writeFileSync(path.join(dir, f.name), f.sql, "utf8");
  return dir;
}

const openHandles: Database[] = [];
async function emptyDatabase(): Promise<Database> {
  const db = await openTestDatabase({ migrate: false });
  openHandles.push(db);
  return db;
}

afterAll(async () => {
  for (const db of openHandles) await db.close().catch(() => undefined);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ================================================================ the migration set itself

describe("db/migrations — the files", () => {
  it("is a contiguous, well-formed sequence starting at 0001", async () => {
    expect(FILES.length).toBeGreaterThan(0);
    FILES.forEach((f, i) => {
      expect(f.version, `${f.filename} is out of sequence`).toBe(i + 1);
      expect(f.filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    });
  });

  it("checksums the bytes on disk, so an edit anywhere in the file is visible", async () => {
    for (const f of FILES) {
      const bytes = readFileSync(path.join(MIGRATIONS_DIR, f.filename), "utf8");
      expect(f.checksum).toBe(createHash("sha256").update(bytes, "utf8").digest("hex"));
    }
  });

  it("refuses a directory with two files claiming the same version", async () => {
    const dir = tempMigrations([
      { name: "0001_alpha.sql", sql: "SELECT 1;" },
      { name: "0001_beta.sql", sql: "SELECT 1;" },
    ]);
    expect(() => loadMigrations(dir)).toThrow(/Duplicate migration version 1/);
  });

  it("refuses a directory with no migrations rather than silently doing nothing", async () => {
    const dir = tempMigrations([{ name: "notes.txt", sql: "ignored" }]);
    expect(() => loadMigrations(dir)).toThrow(/No migrations found/);
  });

  it("reports a missing directory by name", async () => {
    expect(() => loadMigrations(path.join(os.tmpdir(), "ams-does-not-exist-" + Date.now()))).toThrow(
      /Cannot read migrations directory/
    );
  });
});

// ================================================================ apply to an empty database

describe("applying to an empty database", () => {
  let db: Database;

  beforeAll(async () => {
    db = await emptyDatabase();
  }, 120_000);

  it("starts with no ledger at all, and checkMigrations says so without creating one", async () => {
    const status = await checkMigrations(db);
    expect(status.initialised).toBe(false);
    expect(status.upToDate).toBe(false);
    expect(status.pending.map((p) => p.filename)).toEqual(FILES.map((f) => f.filename));

    // The point of a separate read-only check: it is safe against production, so it must not have
    // created the table it was asked about.
    const reg = await db.query<{ reg: string | null }>("SELECT to_regclass('public.schema_migration') AS reg");
    expect(reg.rows[0].reg).toBeNull();
  });

  it("applies every migration in order and records each one", async () => {
    const result = await migrate(db);
    expect(result.applied).toEqual(FILES.map((f) => f.filename));
    expect(result.alreadyApplied).toBe(0);
    expect(result.upToDate).toBe(false);

    const ledger = await db.query<{ version: number; name: string; checksum: string }>(
      "SELECT version, name, checksum FROM schema_migration ORDER BY version"
    );
    expect(ledger.rows).toEqual(FILES.map((f) => ({ version: f.version, name: f.name, checksum: f.checksum })));
  });

  it("leaves every object the application depends on", async () => {
    const tables = [
      "meta", "location", "equipment_model", "project", "asset", "asset_transaction",
      "asset_transaction_line", "asset_relationship", "calibration_record", "id_sequence",
      "installation", "installation_component", "office_admin_assignment", "command_idempotency",
      "app_user", "app_user_role", "user_office_scope", "asset_identifier",
      "manufacturer", "equipment_category", "schema_migration",
    ];
    for (const t of tables) {
      const res = await db.query<{ reg: string | null }>("SELECT to_regclass($1) AS reg", [`public.${t}`]);
      expect(res.rows[0].reg, `table ${t} is missing`).not.toBeNull();
    }

    for (const v of ["asset_state", "v_asset_effective_status"]) {
      const view = await db.query<{ reg: string | null }>("SELECT to_regclass($1) AS reg", [`public.${v}`]);
      expect(view.rows[0].reg, `view ${v} is missing`).not.toBeNull();
    }

    const triggers = await db.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname"
    );
    const names = triggers.rows.map((t) => t.tgname);
    for (const t of [
      "asset_identity_immutable", "header_immutable", "header_truncate_immutable", "line_immutable",
      "line_truncate_immutable", "meta_refuses_synthetic_in_production", "relationship_acyclic",
      "manufacturer_no_delete", "equipment_category_no_delete", "location_no_delete",
      "equipment_model_no_delete", "project_no_delete",
    ]) {
      expect(names, `trigger ${t} is missing`).toContain(t);
    }

    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    );
    const ix = indexes.rows.map((r) => r.indexname);
    for (const i of ["rel_one_open_parent", "instcomp_one_open_per_asset", "installation_one_open_per_primary", "app_user_role_uniq", "asset_axes_idx"]) {
      expect(ix, `index ${i} is missing`).toContain(i);
    }
  });

  it("a SECOND run makes no change — not one row, not one timestamp", async () => {
    const before = await db.query<{ version: number; applied_at: string }>(
      "SELECT version, applied_at::text AS applied_at FROM schema_migration ORDER BY version"
    );

    const result = await migrate(db);
    expect(result.applied).toEqual([]);
    expect(result.upToDate).toBe(true);
    expect(result.alreadyApplied).toBe(FILES.length);

    const after = await db.query<{ version: number; applied_at: string }>(
      "SELECT version, applied_at::text AS applied_at FROM schema_migration ORDER BY version"
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("checkMigrations then reports a clean, initialised, up-to-date database", async () => {
    const status = await checkMigrations(db);
    expect(status.initialised).toBe(true);
    expect(status.pending).toEqual([]);
    expect(status.drift).toEqual([]);
    expect(status.upToDate).toBe(true);
    expect(status.applied).toHaveLength(FILES.length);
  });
});

// ================================================================ the upgrade path that exists today

describe("upgrading a database that already carries the baseline", () => {
  it("applies 0001 as a no-op over an existing schema rather than failing on it", async () => {
    // This is not hypothetical: the local `ams` container and every developer's PGlite directory
    // already hold exactly these objects, created by the old schema.sql. If 0001 could not be
    // applied to them, adopting migrations would have needed a hand-written reconciliation on
    // every machine. It is the reason 0001 is byte-identical and idempotent.
    const db = await emptyDatabase();
    await db.exec(FILES[0].sql);

    const status = await checkMigrations(db);
    expect(status.initialised).toBe(false);

    const result = await migrate(db);
    expect(result.applied).toEqual(FILES.map((f) => f.filename));

    const rows = await db.query<{ c: number }>("SELECT count(*)::int AS c FROM schema_migration");
    expect(rows.rows[0].c).toBe(FILES.length);
  }, 120_000);
});

// ================================================================ drift

describe("drift — history must not be rewritten", () => {
  it("refuses to run when an applied migration's checksum changed", async () => {
    const db = await emptyDatabase();
    await migrate(db);

    // Exactly what an in-place edit of 0003 looks like from the runner's side.
    await db.query("UPDATE schema_migration SET checksum = $1 WHERE version = 3", ["0".repeat(64)]);

    const status = await checkMigrations(db);
    expect(status.upToDate).toBe(false);
    expect(status.drift).toHaveLength(1);
    expect(status.drift[0]).toMatchObject({ version: 3, kind: "checksum" });

    await expect(migrate(db)).rejects.toThrow(MigrationDriftError);
    await expect(migrate(db)).rejects.toThrow(/immutable once applied/);
  }, 120_000);

  it("refuses to run when an applied migration's file has vanished", async () => {
    const db = await emptyDatabase();
    await migrate(db);
    await db.query("INSERT INTO schema_migration (version, name, checksum) VALUES (9999, 'ghost', $1)", ["a".repeat(64)]);

    const status = await checkMigrations(db);
    expect(status.drift[0]).toMatchObject({ version: 9999, kind: "missing-file" });
    await expect(migrate(db)).rejects.toThrow(MigrationDriftError);
  }, 120_000);

  it("refuses a new migration numbered UNDERNEATH one already applied", async () => {
    // Two branches both reach for the next number, one merges first, and the loser's file would
    // otherwise apply after migrations that were written assuming it had already run.
    const dir = tempMigrations([
      { name: "0001_base.sql", sql: "CREATE TABLE IF NOT EXISTS ooo_base (a int);" },
      { name: "0003_third.sql", sql: "CREATE TABLE IF NOT EXISTS ooo_third (a int);" },
    ]);
    const db = await emptyDatabase();
    await migrate(db, { dir });

    writeFileSync(path.join(dir, "0002_late.sql"), "CREATE TABLE IF NOT EXISTS ooo_late (a int);", "utf8");

    const status = await checkMigrations(db, { dir });
    expect(status.drift[0]).toMatchObject({ version: 2, kind: "out-of-order" });
    await expect(migrate(db, { dir })).rejects.toThrow(/out-of-order|renumber/);

    const late = await db.query<{ reg: string | null }>("SELECT to_regclass('public.ooo_late') AS reg");
    expect(late.rows[0].reg).toBeNull();
  }, 120_000);
});

// ================================================================ atomicity

describe("one transaction each", () => {
  it("a migration that fails half way leaves neither its objects nor its ledger row", async () => {
    const dir = tempMigrations([
      { name: "0001_good.sql", sql: "CREATE TABLE IF NOT EXISTS atomic_good (a int);" },
      // The DDL succeeds, then the statement after it fails — the case a non-transactional runner
      // gets wrong, leaving a half-applied migration nothing will ever retry.
      { name: "0002_bad.sql", sql: "CREATE TABLE IF NOT EXISTS atomic_bad (a int);\nSELECT 1 / 0;" },
    ]);
    const db = await emptyDatabase();

    await expect(migrate(db, { dir })).rejects.toThrow(/division by zero/i);

    const good = await db.query<{ reg: string | null }>("SELECT to_regclass('public.atomic_good') AS reg");
    const bad = await db.query<{ reg: string | null }>("SELECT to_regclass('public.atomic_bad') AS reg");
    expect(good.rows[0].reg, "the migration before the failure stays applied").not.toBeNull();
    expect(bad.rows[0].reg, "the failing migration leaves no object behind").toBeNull();

    const ledger = await db.query<{ version: number }>("SELECT version FROM schema_migration ORDER BY version");
    expect(ledger.rows.map((r) => r.version)).toEqual([1]);

    // And it is retried, not skipped, once the file is fixed.
    writeFileSync(path.join(dir, "0002_bad.sql"), "CREATE TABLE IF NOT EXISTS atomic_bad (a int);", "utf8");
    const result = await migrate(db, { dir });
    expect(result.applied).toEqual(["0002_bad.sql"]);
  }, 120_000);
});

// ================================================================ the drivers

describe("both drivers end up migrated", () => {
  it("openTestDatabase() returns a fully migrated database, as it always did", async () => {
    const db = await openTestDatabase();
    openHandles.push(db);
    const status = await checkMigrations(db);
    expect(status.upToDate).toBe(true);
    expect(status.applied.map((a) => a.version)).toEqual(FILES.map((f) => f.version));
  }, 120_000);

  it("checksumOf is stable and content-addressed", async () => {
    expect(checksumOf("SELECT 1;")).toBe(checksumOf("SELECT 1;"));
    expect(checksumOf("SELECT 1;")).not.toBe(checksumOf("SELECT 2;"));
  });
});
