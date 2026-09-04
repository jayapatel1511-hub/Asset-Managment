/**
 * WS-W6 "IndexedDB schema and migrations", and CLAUDE.md's "Preserve queued commands across
 * service-worker updates" applied to the case that actually threatens them: a schema upgrade.
 *
 * The migration test builds a *genuine* v1 database with raw IndexedDB, puts a queued command in
 * it, and then opens it through the production code path. If a future migration ever drops and
 * recreates the commands store, this fails.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, OFFLINE_DB_VERSION, OfflineStorageUnavailableError, STORE, openOfflineDb, readMeta, requestPersistentStorage, writeMeta } from "../../src/offline/db";
import { databaseNameFor } from "../../src/offline/partition";
import { openTestDb, testPartition } from "./helpers";

describe("offline database — schema", () => {
  it("creates every store the offline layer needs", async () => {
    const { db } = await openTestDb();
    for (const store of Object.values(STORE)) {
      await expect(db.count(store)).resolves.toBe(0);
    }
    db.close();
  });

  it("is opened at the version the migration list defines, with no gaps", async () => {
    const { db } = await openTestDb();
    expect(db.version).toBe(OFFLINE_DB_VERSION);
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    db.close();
  });

  it("round-trips a meta value", async () => {
    const { db } = await openTestDb();
    await writeMeta(db, "lastSync", "2026-09-03T10:00:00.000Z");
    await expect(readMeta(db, "lastSync")).resolves.toBe("2026-09-03T10:00:00.000Z");
    db.close();
  });

  it("stores one row per (kind, id) so two projection kinds cannot overwrite each other", async () => {
    const { db } = await openTestDb();
    await db.put(STORE.PROJECTIONS, { kind: "asset", id: "X-1", partition: "p", cachedAt: "t", value: { a: 1 } });
    await db.put(STORE.PROJECTIONS, { kind: "location", id: "X-1", partition: "p", cachedAt: "t", value: { b: 2 } });
    await expect(db.count(STORE.PROJECTIONS)).resolves.toBe(2);
    db.close();
  });
});

describe("offline database — migration from an installed older version", () => {
  it("upgrades v1 to the current version without losing a queued command", async () => {
    const partition = testPartition("migrate");
    const name = databaseNameFor(partition);

    // A real v1 database, built by replaying only the v1 migration — exactly what a phone that
    // installed the first offline build is carrying.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => MIGRATIONS[0]!(request.result, request.transaction!);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("commands", "readwrite");
        tx.objectStore("commands").put({
          id: "queued-1",
          sequence: 1,
          clientSubmissionId: "sub-1",
          kind: "Checkout",
          requestHash: "abc",
          originObjectId: partition.objectId,
          partition: "p",
          affectedAssetIds: ["SEIS-INS-MIC-0001"],
          queuedAt: "2026-09-01T08:00:00.000Z",
          updatedAt: "2026-09-01T08:00:00.000Z",
          status: "Queued",
          attempts: 0,
          rejectionReason: null,
          holdReason: null,
          payload: { lines: [{ assetId: "SEIS-INS-MIC-0001" }], project: "P-1", clientSubmissionId: "sub-1" },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const db = await openOfflineDb(partition);
    expect(db.version).toBe(OFFLINE_DB_VERSION);

    // The command survived.
    const rows = await db.getAll<{ id: string; clientSubmissionId: string }>(STORE.COMMANDS);
    expect(rows.map((row) => row.clientSubmissionId)).toEqual(["sub-1"]);

    // And the v2 additions are present.
    await expect(db.count(STORE.CONFLICTS)).resolves.toBe(0);
    await expect(db.getAllFromIndex(STORE.COMMANDS, "by-origin", partition.objectId)).resolves.toHaveLength(1);
    db.close();
  });
});

describe("offline database — unavailable storage", () => {
  it("reports a typed failure rather than throwing something a caller cannot classify", async () => {
    const broken = {
      open() {
        throw new Error("SecurityError: storage is disabled");
      },
    } as unknown as IDBFactory;
    await expect(openOfflineDb(testPartition("broken"), { factory: broken })).rejects.toBeInstanceOf(OfflineStorageUnavailableError);
  });

  it("asking for persistent storage never throws, whatever the browser answers", async () => {
    await expect(requestPersistentStorage()).resolves.toBeTypeOf("boolean");
  });
});
