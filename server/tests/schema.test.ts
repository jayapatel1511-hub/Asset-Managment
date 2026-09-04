/**
 * The invariants the DATABASE enforces — not the service layer, not the routes.
 *
 * Every assertion here is of the form "the database itself refuses this", executed against a real
 * PostgreSQL (or PGlite) instance with no application code in the path. That distinction is the
 * whole point of the file. CLAUDE.md's rules 5, 6, 9 and 12 were true of `transactionService.ts`
 * and `seed.ts` and of nothing else: a `psql` session, a restored dump, a future import job, an
 * admin console or a bug in a service could each break them without meeting a single line of the
 * code that was supposedly enforcing them. A rule that only one caller obeys is a convention.
 *
 * So the tests are written the way an attacker would write them — raw SQL against the table,
 * deliberately bypassing every service — and each one names the rule it defends.
 *
 * The database is seeded from the real migrated dataset (1,026 assets) exactly as `helpers.ts`
 * does, but WITHOUT building the Fastify app: nothing here is about routes, and not depending on
 * `app.ts` keeps this file meaningful while the API lanes are still moving.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssetStatus } from "../../app/src/domain/stateMachine";
import { axesFromStatus, type Lifecycle } from "../../app/src/domain/stateAxes";
import type { Database, Tx } from "../src/db/database";
import { DATASET_DIR } from "../src/config";
import { DEMO_USERS } from "../src/auth/devAuth";
import { devIdentityRows, officeScopeFor } from "../src/db/identity";
import { openTestDatabase } from "../src/db/open";
import { seedIfNeeded } from "../src/db/seed";

let db: Database;

beforeAll(async () => {
  db = await openTestDatabase();
  await seedIfNeeded(db, DATASET_DIR);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------- fixtures
//
// Unique per call so one test's rows never collide with another's, and so a failure names the
// test that produced the row.

let n = 0;
const uid = (label: string) => `${label}-${process.pid}-${(n += 1)}-${Math.random().toString(36).slice(2, 8)}`;

async function insertAsset(
  q: Tx | Database,
  over: Partial<{ id: string; assetid: string; status: string; lifecycle: string; serialnumber: string | null }> = {}
): Promise<{ id: string; assetid: string }> {
  const id = over.id ?? uid("uuid");
  const assetid = over.assetid ?? uid("TEST").toUpperCase();
  const axes = axesFromStatus((over.status ?? "Available") as AssetStatus, (over.lifecycle ?? "Active") as Lifecycle);
  await q.query(
    `INSERT INTO asset (id, assetid, manufacturer, model, equipmenttype, serialnumber, lifecycle, disposition, serviceability)
     VALUES ($1, $2, 'TestCo', 'M1', 'Logger', $3, $4, $5, $6)`,
    [id, assetid, over.serialnumber ?? null, axes.lifecycle, axes.disposition, axes.serviceability]
  );
  return { id, assetid };
}

async function insertTransaction(q: Tx | Database): Promise<string> {
  const id = uid("txn");
  await q.query(
    `INSERT INTO asset_transaction (id, name, transactiontype, transactiondate, performedby, recorded_at)
     VALUES ($1, $2, 'Audit', '2026-01-01T00:00:00Z', 'test@englobecorp.com', '2026-01-01T00:00:00Z')`,
    [id, uid("TXN").toUpperCase()]
  );
  return id;
}

async function insertLine(q: Tx | Database, transactionId: string, asset: string, lineNumber = 1): Promise<string> {
  const id = uid("line");
  await q.query(
    `INSERT INTO asset_transaction_line (id, transaction_id, asset,
        lifecycle_before, lifecycle_after, disposition_before, disposition_after,
        serviceability_before, serviceability_after, line_number)
     VALUES ($1, $2, $3, 'Active', 'Active', 'AtOffice', 'AtOffice', 'Serviceable', 'Serviceable', $4)`,
    [id, transactionId, asset, lineNumber]
  );
  return id;
}

async function insertRelationship(
  q: Tx | Database,
  parent: string,
  child: string,
  opts: { end?: string | null; type?: string } = {}
): Promise<string> {
  const id = uid("rel");
  await q.query(
    `INSERT INTO asset_relationship (id, parentasset, childasset, relationshiptype, start_at, end_at)
     VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z', $5)`,
    [id, parent, child, opts.type ?? "Kit", opts.end ?? null]
  );
  return id;
}

async function insertInstallation(q: Tx | Database, primaryasset: string, end: string | null = null): Promise<string> {
  const id = uid("inst");
  await q.query(
    `INSERT INTO installation (id, site, project, primaryasset, locationtype, sitename, powersource, start_at, end_at, openedbytransaction)
     VALUES ($1, 'Site A', 'P-1', $2, 'Site', 'Site A', 'Mains', '2026-01-01T00:00:00Z', $3, $4)`,
    [id, primaryasset, end, uid("txn")]
  );
  return id;
}

async function insertComponent(q: Tx | Database, installation: string, asset: string, end: string | null = null): Promise<string> {
  const id = uid("comp");
  await q.query(
    `INSERT INTO installation_component (id, installation, asset, kitrole, start_at, end_at)
     VALUES ($1, $2, $3, 'Sensor1', '2026-01-01T00:00:00Z', $4)`,
    [id, installation, asset, end]
  );
  return id;
}

/**
 * Runs `body` in a transaction that is always rolled back.
 *
 * Needed for the handful of invariants whose PROOF is a successful destructive write — truncating
 * history through 0003's escape hatch, or stamping the database `production`. Rolling back keeps
 * the fixture intact for every test that follows, and the rollback is driven by a sentinel rather
 * than by an assertion failure so a genuine failure still propagates with its own message.
 */
async function rolledBack(body: (tx: Tx) => Promise<void>): Promise<void> {
  const sentinel = new Error("__rollback__");
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
}

// ================================================================ identity (rule 1, A-R5)

describe("identity tables — the role lookup has a server-side home (rule 1)", () => {
  it("app_user and app_user_role exist with the frozen BUILD-FREEZE shape", async () => {
    const cols = await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('app_user', 'app_user_role')
        ORDER BY table_name, ordinal_position`
    );
    const names = (t: string) => cols.rows.filter((c) => c.table_name === t).map((c) => c.column_name);

    expect(names("app_user")).toEqual([
      "upn", "object_id", "tenant_id", "display_name", "homeoffice", "is_active", "created_at", "updated_at",
    ]);
    expect(names("app_user_role")).toEqual(["upn", "role", "office"]);

    // `office` is the column A-R5 overloads with NULL = global. It must be nullable or the whole
    // scope model collapses.
    const office = cols.rows.find((c) => c.table_name === "app_user_role" && c.column_name === "office");
    expect(office?.is_nullable).toBe("YES");
  });

  it("every demo identity is seeded, keyed on the object id the auth provider actually sends", async () => {
    for (const row of devIdentityRows()) {
      const res = await db.query<{ upn: string; object_id: string; tenant_id: string; display_name: string; homeoffice: string | null; is_active: boolean }>(
        "SELECT upn, object_id, tenant_id, display_name, homeoffice, is_active FROM app_user WHERE object_id = $1",
        [row.objectId]
      );
      // Keyed on object_id on purpose: auth/directory.ts looks up on object_id FIRST, so a row
      // that only matches by UPN would leave every lookup falling through to the demo fallback.
      expect(res.rows, `no app_user row for ${row.upn} at object id ${row.objectId}`).toHaveLength(1);
      expect(res.rows[0].upn).toBe(row.upn);
      expect(res.rows[0].tenant_id).toBe("englobe.local");
      expect(res.rows[0].display_name).toBe(row.displayName);
      expect(res.rows[0].homeoffice).toBe(row.homeoffice);
      expect(res.rows[0].is_active).toBe(true);
    }
  });

  it("office scope follows A-R5: SystemOwner global, everything else at its home office", async () => {
    for (const [, user] of Object.entries(DEMO_USERS)) {
      const res = await db.query<{ role: string; office: string | null }>(
        "SELECT role, office FROM app_user_role WHERE upn = $1 ORDER BY role",
        [user.upn]
      );
      const expected = [...user.roles].sort().map((role) => ({ role: role as string, office: officeScopeFor(role, user.homeoffice) }));
      expect(res.rows).toEqual(expected);

      // The property that matters downstream: a principal is global if and ONLY if it owns the
      // system. Anything else with a NULL office would silently become a global administrator.
      const anyGlobal = res.rows.some((r) => r.office === null);
      expect(anyGlobal).toBe(user.roles.includes("SystemOwner"));
    }
  });

  it("refuses an unknown role — the CHECK constraint bounds the vocabulary", async () => {
    const upn = DEMO_USERS.field.upn;
    await expect(
      db.query("INSERT INTO app_user_role (upn, role, office) VALUES ($1, 'Superuser', NULL)", [upn])
    ).rejects.toThrow();
  });

  it("refuses the same global role twice — COALESCE(office,'*') closes the NULL-is-distinct hole", async () => {
    const upn = DEMO_USERS.owner.upn;
    // owner already holds SystemOwner globally; an ordinary unique index over (upn, role, office)
    // would allow this because every NULL is distinct.
    await expect(
      db.query("INSERT INTO app_user_role (upn, role, office) VALUES ($1, 'SystemOwner', NULL)", [upn])
    ).rejects.toThrow();
  });

  it("cascades role rows when a user is deleted", async () => {
    const upn = uid("cascade") + "@englobecorp.com";
    await db.query(
      "INSERT INTO app_user (upn, object_id, tenant_id, display_name, homeoffice) VALUES ($1, $2, 'englobe.local', 'Temp', 'Ottawa')",
      [upn, uid("oid")]
    );
    await db.query("INSERT INTO app_user_role (upn, role, office) VALUES ($1, 'FieldUser', 'Ottawa')", [upn]);
    await db.query("DELETE FROM app_user WHERE upn = $1", [upn]);
    const left = await db.query<{ c: number }>("SELECT count(*)::int AS c FROM app_user_role WHERE upn = $1", [upn]);
    expect(left.rows[0].c).toBe(0);
  });
});

// ================================================================ asset identity (rule 6)

describe("asset identity is stable (rule 6)", () => {
  it("refuses a duplicate canonical Asset ID", async () => {
    const a = await insertAsset(db);
    await expect(insertAsset(db, { assetid: a.assetid })).rejects.toThrow(/duplicate key|unique/i);
  });

  it("refuses a canonical Asset ID MUTATION — history is keyed on the tag", async () => {
    const a = await insertAsset(db);
    await expect(db.query("UPDATE asset SET assetid = $1 WHERE id = $2", [uid("RENAMED").toUpperCase(), a.id])).rejects.toThrow(
      /Asset ID is immutable/
    );
    const still = await db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE id = $1", [a.id]);
    expect(still.rows[0].assetid).toBe(a.assetid);
  });

  it("refuses an asset UUID mutation — a key that can be reassigned is not a key", async () => {
    const a = await insertAsset(db);
    await expect(db.query("UPDATE asset SET id = $1 WHERE id = $2", [uid("newuuid"), a.id])).rejects.toThrow(
      /UUID is the database key and is immutable/
    );
  });

  it("still allows an ordinary state write on the same row", async () => {
    const a = await insertAsset(db);
    await db.query("UPDATE asset SET disposition = 'CheckedOut', custodian = 'tech@englobecorp.com' WHERE id = $1", [a.id]);
    const res = await db.query<{ status: string; disposition: string }>(
      "SELECT status, disposition FROM asset WHERE id = $1",
      [a.id]
    );
    expect(res.rows[0].disposition).toBe("CheckedOut");
    expect(res.rows[0].status).toBe("CheckedOut");
  });

  it("ALLOWS shared serial numbers — rule 6 says serial is non-unique, and 132 assets share one", async () => {
    const serial = uid("SHARED-SERIAL");
    await insertAsset(db, { serialnumber: serial });
    await insertAsset(db, { serialnumber: serial });
    const res = await db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset WHERE serialnumber = $1", [serial]);
    expect(res.rows[0].c).toBe(2);
  });

  it("the migrated fleet itself contains shared serials, so a unique index would refuse real data", async () => {
    const res = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM (
         SELECT serialnumber FROM asset WHERE serialnumber IS NOT NULL
          GROUP BY serialnumber HAVING count(*) > 1
       ) dupes`
    );
    expect(res.rows[0].c).toBeGreaterThan(0);
  });

  it("has no unique index over serialnumber — the absence is the constraint", async () => {
    const res = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename = 'asset'");
    const offending = res.rows.filter((r) => /UNIQUE/i.test(r.indexdef) && /serialnumber/i.test(r.indexdef));
    expect(offending, `a unique index over asset.serialnumber would refuse the migrated fleet`).toEqual([]);
  });
});

// ================================================================ append-only history (rule 5)

describe("transaction history is append-only (rule 5)", () => {
  it("refuses UPDATE on a transaction header", async () => {
    const txn = await insertTransaction(db);
    await expect(db.query("UPDATE asset_transaction SET notes = 'edited' WHERE id = $1", [txn])).rejects.toThrow(/append-only/);
  });

  it("refuses DELETE on a transaction header", async () => {
    const txn = await insertTransaction(db);
    await expect(db.query("DELETE FROM asset_transaction WHERE id = $1", [txn])).rejects.toThrow(/append-only/);
  });

  it("refuses UPDATE on a transaction line", async () => {
    const txn = await insertTransaction(db);
    const asset = await insertAsset(db);
    const line = await insertLine(db, txn, asset.assetid);
    await expect(db.query("UPDATE asset_transaction_line SET notes = 'edited' WHERE id = $1", [line])).rejects.toThrow(/append-only/);
  });

  it("refuses DELETE on a transaction line", async () => {
    const txn = await insertTransaction(db);
    const asset = await insertAsset(db);
    const line = await insertLine(db, txn, asset.assetid);
    await expect(db.query("DELETE FROM asset_transaction_line WHERE id = $1", [line])).rejects.toThrow(/append-only/);
  });

  it("refuses TRUNCATE on the history tables — the hole a row trigger structurally cannot see", async () => {
    await expect(db.query("TRUNCATE asset_transaction_line")).rejects.toThrow(/append-only/);
    // The header alone is refused earlier, by the foreign key from the line table, so the form
    // asserted here is the one the seed loader actually issues — both tables together, which is
    // the only way to reach the trigger at all.
    await expect(db.query("TRUNCATE asset_transaction_line, asset_transaction")).rejects.toThrow(/append-only/);
    // And the header on its own is still refused, for its own reason.
    await expect(db.query("TRUNCATE asset_transaction")).rejects.toThrow();
  });

  it("the seed loader's escape hatch works, and ONLY inside its own transaction", async () => {
    const before = await db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset_transaction");
    expect(before.rows[0].c).toBeGreaterThan(0);

    await rolledBack(async (tx) => {
      await tx.exec("SET LOCAL ams.allow_history_write = 'on'");
      await tx.exec("TRUNCATE asset_transaction_line, asset_transaction");
      const emptied = await tx.query<{ c: number }>("SELECT count(*)::int AS c FROM asset_transaction");
      expect(emptied.rows[0].c).toBe(0);
    });

    // SET LOCAL died with that transaction. On the postgres driver the connection goes back to
    // the pool, so this is also the assertion that the hatch cannot be left ajar for whoever
    // borrows it next.
    const after = await db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset_transaction");
    expect(after.rows[0].c).toBe(before.rows[0].c);
    await expect(db.query("DELETE FROM asset_transaction")).rejects.toThrow(/append-only/);
  });
});

// ================================================================ relationships

describe("the open containment graph is a forest", () => {
  it("refuses a second OPEN parent for one child", async () => {
    const p1 = await insertAsset(db);
    const p2 = await insertAsset(db);
    const child = await insertAsset(db);
    await insertRelationship(db, p1.assetid, child.assetid);
    await expect(insertRelationship(db, p2.assetid, child.assetid)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("allows a new parent once the previous membership is closed", async () => {
    const p1 = await insertAsset(db);
    const p2 = await insertAsset(db);
    const child = await insertAsset(db);
    await insertRelationship(db, p1.assetid, child.assetid, { end: "2026-02-01T00:00:00Z" });
    await expect(insertRelationship(db, p2.assetid, child.assetid)).resolves.toBeTruthy();
  });

  it("refuses an asset containing itself", async () => {
    const a = await insertAsset(db);
    await expect(insertRelationship(db, a.assetid, a.assetid)).rejects.toThrow(/cannot contain itself/);
  });

  it("refuses a two-asset cycle A -> B -> A", async () => {
    const a = await insertAsset(db);
    const b = await insertAsset(db);
    await insertRelationship(db, a.assetid, b.assetid);
    await expect(insertRelationship(db, b.assetid, a.assetid)).rejects.toThrow(/containment cycle/);
  });

  it("refuses a three-asset cycle A -> B -> C -> A", async () => {
    const a = await insertAsset(db);
    const b = await insertAsset(db);
    const c = await insertAsset(db);
    await insertRelationship(db, a.assetid, b.assetid);
    await insertRelationship(db, b.assetid, c.assetid);
    await expect(insertRelationship(db, c.assetid, a.assetid)).rejects.toThrow(/containment cycle/);
  });

  it("leaves the cycle out of the table when it refuses one", async () => {
    const a = await insertAsset(db);
    const b = await insertAsset(db);
    await insertRelationship(db, a.assetid, b.assetid);
    await expect(insertRelationship(db, b.assetid, a.assetid)).rejects.toThrow();
    const res = await db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM asset_relationship WHERE parentasset = $1 AND childasset = $2",
      [b.assetid, a.assetid]
    );
    expect(res.rows[0].c).toBe(0);
  });

  it("ALLOWS a cycle in closed history — a kit's past is not a cycle", async () => {
    const a = await insertAsset(db);
    const b = await insertAsset(db);
    await insertRelationship(db, a.assetid, b.assetid, { end: "2026-02-01T00:00:00Z" });
    // b contained a last year; a contains b now. Ordinary history, refused by nothing.
    await expect(insertRelationship(db, b.assetid, a.assetid)).resolves.toBeTruthy();
  });

  it("the seeded fleet satisfies the invariant it now enforces", async () => {
    const res = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM (
         SELECT childasset FROM asset_relationship WHERE end_at IS NULL GROUP BY childasset HAVING count(*) > 1
       ) x`
    );
    expect(res.rows[0].c).toBe(0);
  });
});

// ================================================================ installation spans

describe("installation membership spans do not overlap", () => {
  it("refuses the same asset in two OPEN installation spans", async () => {
    const primary = await insertAsset(db);
    const sensor = await insertAsset(db);
    const i1 = await insertInstallation(db, primary.assetid);
    const i2 = await insertInstallation(db, (await insertAsset(db)).assetid);
    await insertComponent(db, i1, sensor.assetid);
    await expect(insertComponent(db, i2, sensor.assetid)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("allows the same asset in a second span once the first is closed", async () => {
    const sensor = await insertAsset(db);
    const i1 = await insertInstallation(db, (await insertAsset(db)).assetid);
    const i2 = await insertInstallation(db, (await insertAsset(db)).assetid);
    await insertComponent(db, i1, sensor.assetid, "2026-02-01T00:00:00Z");
    await expect(insertComponent(db, i2, sensor.assetid)).resolves.toBeTruthy();
  });

  it("refuses two open installations for the same primary asset", async () => {
    const primary = await insertAsset(db);
    await insertInstallation(db, primary.assetid);
    await expect(insertInstallation(db, primary.assetid)).rejects.toThrow(/duplicate key|unique/i);
  });
});

// ================================================================ synthetic in production (rule 12)

describe("synthetic data is refused in production (rule 12)", () => {
  const setMeta = (tx: Tx, key: string, value: string) =>
    tx.query("INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);

  it("refuses a synthetic dataset marker in a production-marked database", async () => {
    await expect(
      db.transaction(async (tx) => {
        await setMeta(tx, "environment", "production");
        await setMeta(tx, "dataset_key", "synthetic:1234:demo:2026-01-01T00:00:00Z");
      })
    ).rejects.toThrow(/rule 12/);
  });

  it("refuses it the other way round too — stamping a synthetic database as production", async () => {
    await expect(
      db.transaction(async (tx) => {
        await setMeta(tx, "dataset_key", "synthetic:1234:demo:2026-01-01T00:00:00Z");
        await setMeta(tx, "environment", "production");
      })
    ).rejects.toThrow(/rule 12/);
  });

  it("reads the DatasetInfo JSON marker as well as the dataset key", async () => {
    await expect(
      db.transaction(async (tx) => {
        await setMeta(tx, "environment", "prod");
        await setMeta(tx, "dataset_info", JSON.stringify({ synthetic: true, profile: "demo" }));
      })
    ).rejects.toThrow(/rule 12/);
  });

  it("allows synthetic data outside production", async () => {
    await rolledBack(async (tx) => {
      await setMeta(tx, "environment", "development");
      await setMeta(tx, "dataset_key", "synthetic:1234:demo:2026-01-01T00:00:00Z");
    });
  });

  it("allows REAL data in production — the guard is about the pair, not about production", async () => {
    await rolledBack(async (tx) => {
      await setMeta(tx, "environment", "production");
      await setMeta(tx, "dataset_key", "real:/srv/ams/migration/staged");
    });
  });

  it("leaves nothing behind: the test database is still marked non-production", async () => {
    const res = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'environment'");
    expect(res.rows[0]?.value).not.toMatch(/^prod/i);
  });
});

// ================================================================ four-axis state (rule 9, A-STATE)

/** docs/15 § 3, as a table. Every compatibility status must land on a coherent tuple. */
const AXIS_MAP: Array<{ status: string; lifecycle: string; expected: [string, string, string] }> = [
  { status: "Available", lifecycle: "Active", expected: ["Active", "AtOffice", "Serviceable"] },
  { status: "CheckedOut", lifecycle: "Active", expected: ["Active", "CheckedOut", "Serviceable"] },
  { status: "Deployed", lifecycle: "Active", expected: ["Active", "Deployed", "Serviceable"] },
  { status: "InCalibration", lifecycle: "Active", expected: ["Active", "AtCalibrationLab", "Serviceable"] },
  { status: "NeedsRepair", lifecycle: "Active", expected: ["Active", "AtOffice", "NeedsRepair"] },
  { status: "Missing", lifecycle: "Active", expected: ["Active", "Missing", "Serviceable"] },
  { status: "Retired", lifecycle: "Retired", expected: ["Retired", "AtOffice", "OutOfService"] },
];

describe("three stored axes; status is generated (rule 9, DC-22)", () => {
  it("maps all seven compatibility statuses to a coherent stored tuple", async () => {
    for (const row of AXIS_MAP) {
      const a = await insertAsset(db, { status: row.status, lifecycle: row.lifecycle });
      const res = await db.query<{ lifecycle: string; disposition: string; serviceability: string; status: string }>(
        "SELECT lifecycle, disposition, serviceability, status FROM asset WHERE id = $1",
        [a.id]
      );
      expect([res.rows[0].lifecycle, res.rows[0].disposition, res.rows[0].serviceability], row.status).toEqual(row.expected);
      expect(res.rows[0].status, row.status).toBe(row.status);
    }
  });

  it("stores lifecycle Retired when the compatibility pill is Retired, even if the caller passed Active", async () => {
    const a = await insertAsset(db, { status: "Retired", lifecycle: "Active" });
    const res = await db.query<{ lifecycle: string; status: string }>(
      "SELECT lifecycle, status FROM asset WHERE id = $1",
      [a.id]
    );
    expect(res.rows[0].lifecycle).toBe("Retired");
    expect(res.rows[0].status).toBe("Retired");
  });

  it("EVERY asset in the database has a complete, in-vocabulary tuple", async () => {
    const res = await db.query<{ total: number; bad: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE lifecycle IS NULL OR disposition IS NULL OR serviceability IS NULL
              )::int AS bad
         FROM asset`
    );
    expect(res.rows[0].total).toBeGreaterThan(1000);
    expect(res.rows[0].bad).toBe(0);
  });

  it("refuses a disposition the CHECK cannot map — no silent fallback bucket", async () => {
    await expect(
      db.query(
        `INSERT INTO asset (id, assetid, manufacturer, model, equipmenttype, lifecycle, disposition, serviceability)
         VALUES ($1, $2, 'TestCo', 'M1', 'Logger', 'Active', 'Teleported', 'Serviceable')`,
        [uid("uuid"), uid("TEST").toUpperCase()]
      )
    ).rejects.toThrow(/check|violates/i);
  });

  it("refuses a direct write to generated status", async () => {
    await expect(
      db.query(
        `INSERT INTO asset (id, assetid, manufacturer, model, equipmenttype, lifecycle, disposition, serviceability, status)
         VALUES ($1, $2, 'TestCo', 'M1', 'Logger', 'Active', 'AtOffice', 'Serviceable', 'Available')`,
        [uid("uuid"), uid("TEST").toUpperCase()]
      )
    ).rejects.toThrow(/generated|non-DEFAULT/i);
  });

  it("recomputes status when an axis changes, without a second write", async () => {
    const a = await insertAsset(db, { status: "Available" });
    await db.query("UPDATE asset SET serviceability = 'NeedsRepair' WHERE id = $1", [a.id]);
    const res = await db.query<{ status: string; serviceability: string }>(
      "SELECT status, serviceability FROM asset WHERE id = $1",
      [a.id]
    );
    expect(res.rows[0].serviceability).toBe("NeedsRepair");
    expect(res.rows[0].status).toBe("NeedsRepair");
  });

  it("stores six axis columns on every transaction line and generates the compatibility pair", async () => {
    const asset = await insertAsset(db);
    const txn = await insertTransaction(db);
    const line = await insertLine(db, txn, asset.assetid);
    const res = await db.query<{
      lifecycle_before: string;
      disposition_after: string;
      statusbefore: string;
      statusafter: string;
    }>(
      `SELECT lifecycle_before, disposition_after, statusbefore, statusafter
         FROM asset_transaction_line WHERE id = $1`,
      [line]
    );
    expect(res.rows[0].lifecycle_before).toBe("Active");
    expect(res.rows[0].disposition_after).toBe("AtOffice");
    expect(res.rows[0].statusbefore).toBe("Available");
    expect(res.rows[0].statusafter).toBe("Available");
  });

  it("refuses a direct write to generated line status columns", async () => {
    const asset = await insertAsset(db);
    const txn = await insertTransaction(db);
    await expect(
      db.query(
        `INSERT INTO asset_transaction_line (id, transaction_id, asset, statusbefore, statusafter, line_number)
         VALUES ($1, $2, $3, 'Available', 'CheckedOut', 1)`,
        [uid("line"), txn, asset.assetid]
      )
    ).rejects.toThrow(/generated|non-DEFAULT|not-null|violates/i);
  });
});

describe("asset_state — the fourth axis and the compatibility pill", () => {
  /**
   * A due date N days from the DATABASE's today, not from Node's.
   *
   * The view compares `nextcaldue` against `current_date`, which is the database's notion of the
   * day — and the two drivers do not agree on it: the container runs UTC while in-process PGlite
   * picks up the machine's zone, so a date computed in JS lands one side of midnight on one
   * driver and the other side on the other. Asking the database removes the ambiguity instead of
   * papering over it with a wider window. (0001's header already says the database does no
   * timezone arithmetic and display is a client concern; this is the test-side consequence.)
   */
  const iso = async (offsetDays: number): Promise<string> => {
    const res = await db.query<{ d: string }>(
      "SELECT to_char(current_date + ($1 || ' days')::interval, 'YYYY-MM-DD') AS d",
      [String(offsetDays)]
    );
    return res.rows[0].d;
  };

  async function calibratedAsset(opts: {
    status?: string;
    interval?: number | null;
    nextcaldue?: string | null;
    lastcaldate?: string | null;
    result?: string | null;
  }): Promise<string> {
    const model = uid("MOD");
    await db.query(
      `INSERT INTO equipment_model (manufacturer, model, equipmenttype, assetgroup, idprefix, isserialised, identifiertype, defaultcalintervalmonths)
       VALUES ('TestCo', $1, 'Logger', 'Loggers', 'TST', true, 'Serial', $2)`,
      [model, opts.interval ?? null]
    );
    const id = uid("uuid");
    const assetid = uid("CAL").toUpperCase();
    const axes = axesFromStatus((opts.status ?? "Available") as AssetStatus);
    await db.query(
      `INSERT INTO asset (id, assetid, manufacturer, model, equipmenttype, lifecycle, disposition, serviceability, nextcaldue, lastcaldate)
       VALUES ($1, $2, 'TestCo', $3, 'Logger', $4, $5, $6, $7, $8)`,
      [id, assetid, model, axes.lifecycle, axes.disposition, axes.serviceability, opts.nextcaldue ?? null, opts.lastcaldate ?? null]
    );
    if (opts.result) {
      await db.query(
        `INSERT INTO calibration_record (id, asset, calibrationdate, nextduedate, result)
         VALUES ($1, $2, $3, $4, $5)`,
        [uid("cal"), assetid, opts.lastcaldate ?? (await iso(-30)), opts.nextcaldue ?? (await iso(300)), opts.result]
      );
    }
    return assetid;
  }

  const currencyOf = async (assetid: string) => {
    const res = await db.query<{ calibration_currency: string }>(
      "SELECT calibration_currency FROM asset_state WHERE assetid = $1",
      [assetid]
    );
    return res.rows[0].calibration_currency;
  };

  it("NotRequired when the model has no interval and the asset has no calibration history", async () => {
    expect(await currencyOf(await calibratedAsset({ interval: null }))).toBe("NotRequired");
  });

  it("InCalibration beats every date test — an asset at the lab is not also overdue (FR-013)", async () => {
    expect(
      await currencyOf(await calibratedAsset({ interval: 12, status: "InCalibration", nextcaldue: await iso(-100) }))
    ).toBe("InCalibration");
  });

  it("Failed when the most recent calibration record says Fail", async () => {
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(300), result: "Fail" }))).toBe("Failed");
  });

  it("Unknown when tracked but with no due date (FR-017 — counted, never omitted)", async () => {
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: null }))).toBe("Unknown");
  });

  it("Overdue, DueSoon and Current follow the 30-day horizon the compliance screen uses", async () => {
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(-1) }))).toBe("Overdue");
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(7) }))).toBe("DueSoon");
    // Exactly on the horizon is still DueSoon, and one day past it is Current — the boundary the
    // compliance screen draws at 30 days.
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(30) }))).toBe("DueSoon");
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(31) }))).toBe("Current");
    expect(await currencyOf(await calibratedAsset({ interval: 12, nextcaldue: await iso(200) }))).toBe("Current");
  });

  it("exposes all four axes under their canonical docs/15 names", async () => {
    const cols = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_state'"
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const axis of ["lifecycle", "disposition", "serviceability", "calibration_currency"]) {
      expect(names).toContain(axis);
    }
  });

  it("exposes NO restricted field — SIM and network values never reach a report view (rule 10)", async () => {
    const cols = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='asset_state'"
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const restricted of ["identifiervalue", "phonenumber", "staticip", "carrier"]) {
      expect(names, `asset_state must not expose ${restricted}`).not.toContain(restricted);
    }
  });

  it("is published under the docs/15 § 12 catalogue name, from the same single derivation", async () => {
    const a = await insertAsset(db, { status: "Deployed" });
    const [direct, catalogued] = await Promise.all([
      db.query<{ disposition: string; calibration_currency: string }>(
        "SELECT disposition, calibration_currency FROM asset_state WHERE id = $1",
        [a.id]
      ),
      db.query<{ disposition: string; calibration_currency: string }>(
        "SELECT disposition, calibration_currency FROM v_asset_effective_status WHERE id = $1",
        [a.id]
      ),
    ]);
    expect(catalogued.rows[0]).toEqual(direct.rows[0]);
  });

  it("the catalogue view carries no restricted field either (rule 10)", async () => {
    const cols = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='v_asset_effective_status'"
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const restricted of ["identifiervalue", "phonenumber", "staticip", "carrier"]) {
      expect(names, `v_asset_effective_status must not expose ${restricted}`).not.toContain(restricted);
    }
  });

  it("renders the docs/15 § 3.5 compatibility pill for every status", async () => {
    const expected: Record<string, string> = {
      Available: "Available",
      CheckedOut: "Checked out",
      Deployed: "Deployed",
      InCalibration: "In calibration",
      NeedsRepair: "Needs repair",
      Missing: "Missing",
      Retired: "Retired",
    };
    for (const row of AXIS_MAP) {
      const a = await insertAsset(db, { status: row.status, lifecycle: row.lifecycle });
      const res = await db.query<{ display_status: string }>("SELECT display_status FROM asset_state WHERE id = $1", [a.id]);
      expect(res.rows[0].display_status, row.status).toBe(expected[row.status]);
    }
  });
});

// ================================================================ first-proof identity tables

describe("asset_identifier — aliases, not empty scaffolding (rule 6)", () => {
  it("every seeded asset has a current CanonicalAssetId or TemporaryTag", async () => {
    const res = await db.query<{ total: number; tagged: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM asset_identifier i
                   WHERE i.asset_uuid = a.id AND i.is_current
                     AND i.identifier_type IN ('CanonicalAssetId','TemporaryTag')
                )
              )::int AS tagged
         FROM asset a
        WHERE a.manufacturer <> 'TestCo'`
    );
    expect(res.rows[0].total).toBeGreaterThan(1000);
    expect(res.rows[0].tagged).toBe(res.rows[0].total);
  });

  it("refuses two current tag values that collide (Canonical / Temporary / Legacy)", async () => {
    const a = await insertAsset(db);
    await db.query(
      `INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current)
       VALUES ($1, $2, 'CanonicalAssetId', $3, lower($3), true)`,
      [uid("id"), a.id, a.assetid]
    );
    const b = await insertAsset(db);
    await expect(
      db.query(
        `INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current)
         VALUES ($1, $2, 'CanonicalAssetId', $3, lower($3), true)`,
        [uid("id"), b.id, a.assetid]
      )
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it("allows completing a TMP tag once a TemporaryTag alias exists, and does not rewrite history lines", async () => {
    const tmp = `TMP-${uid("T").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}`;
    const a = await insertAsset(db, { assetid: tmp });
    const txn = await insertTransaction(db);
    const line = await insertLine(db, txn, tmp);
    await db.query(
      `INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current)
       VALUES ($1, $2, 'TemporaryTag', $3, lower($3), true)`,
      [uid("id"), a.id, tmp]
    );
    const canon = uid("CANON").toUpperCase();
    await db.query("UPDATE asset SET assetid = $1 WHERE id = $2", [canon, a.id]);
    const asset = await db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE id = $1", [a.id]);
    expect(asset.rows[0].assetid).toBe(canon);
    const history = await db.query<{ asset: string }>("SELECT asset FROM asset_transaction_line WHERE id = $1", [line]);
    expect(history.rows[0].asset).toBe(tmp);
  });

  it("still refuses renaming a non-TMP asset even when an alias exists", async () => {
    const a = await insertAsset(db);
    await db.query(
      `INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current)
       VALUES ($1, $2, 'CanonicalAssetId', $3, lower($3), true)`,
      [uid("id"), a.id, a.assetid]
    );
    await expect(
      db.query("UPDATE asset SET assetid = $1 WHERE id = $2", [uid("RENAMED").toUpperCase(), a.id])
    ).rejects.toThrow(/Asset ID is immutable/);
  });
});

describe("user_office_scope — authorization reads office scope from its own table", () => {
  it("has an open scope row for every scoped demo role", async () => {
    for (const [, user] of Object.entries(DEMO_USERS)) {
      if (user.roles.includes("SystemOwner")) continue;
      const res = await db.query<{ office: string; scope_type: string }>(
        "SELECT office, scope_type FROM user_office_scope WHERE user_upn = $1 AND valid_to IS NULL ORDER BY scope_type",
        [user.upn]
      );
      expect(res.rows.length).toBeGreaterThan(0);
      expect(res.rows.every((r) => r.office === user.homeoffice)).toBe(true);
    }
  });
});
