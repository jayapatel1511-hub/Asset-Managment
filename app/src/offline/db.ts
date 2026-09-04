/**
 * The IndexedDB wrapper — WS-W6's "IndexedDB schema and migrations".
 *
 * WHY HAND-ROLLED RATHER THAN `idb`:
 *   The whole surface used here is `open`, `transaction`, five stores and three indexes. Wrapping
 *   the raw request objects in promises is about eighty lines; a dependency would be more code to
 *   audit than it saves, and this layer is on the path where a technician's queued check-out
 *   lives. It stays legible.
 *
 * WHY A MIGRATION *LIST* AND NOT AN `onupgradeneeded` SWITCH:
 *   A phone that installed v1 six weeks ago and has three queued commands must reach the current
 *   version without losing one (CLAUDE.md: "Preserve queued commands across service-worker
 *   updates" — an update that changes the schema is the dangerous case). Expressing each version
 *   as its own function means the upgrade path from *any* old version is replay of the steps it
 *   missed, and `tests/offline/db.test.ts` can build a genuine v1 database and prove the v2
 *   upgrade keeps its rows. A switch that only ever ran in production would be asserted, not
 *   tested.
 *
 * SCHEMA VERSIONS
 *   v1  meta, projections, drafts, commands — the first offline slice.
 *   v2  + conflicts, + commands index `by-origin`. Added when the identity guard was specified
 *       (WS-W6 "no replay under another identity"): holding a command needs somewhere to record
 *       *why* it is held, and finding another identity's commands needs an index rather than a
 *       full scan on every boot.
 *
 * WHAT DOES NOT GO IN HERE: raw API rows. See projections.ts — every write of asset-shaped data
 * goes through an explicit allowlist, and `assertCacheSafe` refuses restricted SIM/network fields
 * and certificate bytes outright (CLAUDE.md rules 10 and 11).
 */
import { databaseNameFor, type CachePartition } from "./partition";

export type StoreName = "meta" | "projections" | "drafts" | "commands" | "conflicts";

export const STORE: Record<Uppercase<StoreName>, StoreName> = {
  META: "meta",
  PROJECTIONS: "projections",
  DRAFTS: "drafts",
  COMMANDS: "commands",
  CONFLICTS: "conflicts",
};

type Migration = (db: IDBDatabase, transaction: IDBTransaction) => void;

/**
 * Index `i` upgrades a database from version `i` to version `i + 1`. Never reorder, never edit a
 * shipped entry — append. A device in the field is the only authority on which of these it has
 * already run.
 */
export const MIGRATIONS: readonly Migration[] = [
  // → v1
  (db) => {
    db.createObjectStore(STORE.META, { keyPath: "key" });

    // Compound key: one row per (kind, id), so the asset projection and (later) a location
    // projection with the same id cannot overwrite each other.
    const projections = db.createObjectStore(STORE.PROJECTIONS, { keyPath: ["kind", "id"] });
    projections.createIndex("by-kind", "kind", { unique: false });

    const drafts = db.createObjectStore(STORE.DRAFTS, { keyPath: "id" });
    drafts.createIndex("by-workflow", "workflow", { unique: false });

    const commands = db.createObjectStore(STORE.COMMANDS, { keyPath: "id" });
    // Replay order is insertion order (SubmissionQueue.ts replays the array in the order the
    // technician made the submissions, FR-038), so the durable copy needs its own monotonic
    // sequence — a timestamp would tie at millisecond resolution on a fast double-tap.
    commands.createIndex("by-sequence", "sequence", { unique: true });
    commands.createIndex("by-status", "status", { unique: false });
    commands.createIndex("by-submission", "clientSubmissionId", { unique: true });
  },
  // → v2
  (db, transaction) => {
    db.createObjectStore(STORE.CONFLICTS, { keyPath: "id" });
    transaction.objectStore(STORE.COMMANDS).createIndex("by-origin", "originObjectId", { unique: false });
  },
];

export const OFFLINE_DB_VERSION = MIGRATIONS.length;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Thrown when the browser will not give us a database at all — Safari private browsing, a
 * corrupted profile, an origin over quota. The caller's job is to keep working in memory and say
 * so, never to pretend the write landed: "pending is not accepted" (WS-W6) cuts both ways.
 */
export class OfflineStorageUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super(`Offline storage is unavailable on this device: ${String(cause)}`);
    this.name = "OfflineStorageUnavailableError";
  }
}

export interface OfflineDb {
  readonly name: string;
  readonly version: number;
  close(): void;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]>;
  getAllFromIndex<T>(store: StoreName, index: string, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]>;
  put(store: StoreName, value: unknown): Promise<void>;
  /** Every value in one transaction — all of them land or none do. */
  putAll(store: StoreName, values: readonly unknown[]): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  deleteAll(store: StoreName, keys: readonly IDBValidKey[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
  count(store: StoreName): Promise<number>;
  /** Escape hatch for a multi-store atomic operation. Use `putAll` for the common case. */
  run<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T>;
}

class IndexedDbHandle implements OfflineDb {
  constructor(private readonly db: IDBDatabase) {}

  get name(): string {
    return this.db.name;
  }
  get version(): number {
    return this.db.version;
  }
  close(): void {
    this.db.close();
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readonly");
    const result = await promisify<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
    return result;
  }

  async getAll<T>(store: StoreName, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]> {
    const tx = this.db.transaction(store, "readonly");
    return promisify<T[]>(tx.objectStore(store).getAll(query ?? undefined) as IDBRequest<T[]>);
  }

  async getAllFromIndex<T>(store: StoreName, index: string, query?: IDBValidKey | IDBKeyRange | null): Promise<T[]> {
    const tx = this.db.transaction(store, "readonly");
    return promisify<T[]>(tx.objectStore(store).index(index).getAll(query ?? undefined) as IDBRequest<T[]>);
  }

  async put(store: StoreName, value: unknown): Promise<void> {
    await this.putAll(store, [value]);
  }

  async putAll(store: StoreName, values: readonly unknown[]): Promise<void> {
    if (values.length === 0) return;
    const tx = this.db.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    for (const value of values) objectStore.put(value);
    await awaitTransaction(tx);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await this.deleteAll(store, [key]);
  }

  async deleteAll(store: StoreName, keys: readonly IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return;
    const tx = this.db.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    for (const key of keys) objectStore.delete(key);
    await awaitTransaction(tx);
  }

  async clear(store: StoreName): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    await awaitTransaction(tx);
  }

  async count(store: StoreName): Promise<number> {
    const tx = this.db.transaction(store, "readonly");
    return promisify<number>(tx.objectStore(store).count());
  }

  async run<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
    const tx = this.db.transaction(stores, mode);
    const settled = awaitTransaction(tx);
    const result = await work(tx);
    await settled;
    return result;
  }
}

export interface OpenOfflineDbOptions {
  /** Injected in tests (`fake-indexeddb`) and when probing a specific factory. */
  readonly factory?: IDBFactory;
  /** Open at an older version deliberately — only tests/tooling should ever pass this. */
  readonly version?: number;
  /** Called when another tab holds an open connection at an older version and blocks the upgrade. */
  readonly onBlocked?: () => void;
}

/**
 * Open (creating or upgrading) the offline database for one cache partition.
 *
 * `onversionchange` matters more than it looks: two tabs of an installed PWA are ordinary, and if
 * one of them upgrades the schema while the other holds a connection, the upgrade blocks forever
 * and the *new* tab silently has no offline storage. Closing on version change hands the upgrade
 * through; the closed tab reopens on its next call.
 */
export async function openOfflineDb(partition: CachePartition, options: OpenOfflineDbOptions = {}): Promise<OfflineDb> {
  const factory = options.factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (!factory) throw new OfflineStorageUnavailableError("no IndexedDB factory in this environment");

  const name = databaseNameFor(partition);
  const target = options.version ?? OFFLINE_DB_VERSION;

  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, target);
      request.onupgradeneeded = (event) => {
        const upgraded = request.result;
        const tx = request.transaction;
        if (!tx) throw new Error("IndexedDB upgrade without a transaction");
        for (let version = event.oldVersion; version < event.newVersion!; version++) {
          MIGRATIONS[version]!(upgraded, tx);
        }
      };
      request.onblocked = () => options.onBlocked?.();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`Could not open ${name}`));
    });
    db.onversionchange = () => db.close();
    return new IndexedDbHandle(db);
  } catch (cause) {
    throw new OfflineStorageUnavailableError(cause);
  }
}

/** Drop a partition's database entirely — sign-out on a shared device, or a test tearing down. */
export async function deleteOfflineDb(partition: CachePartition, factory: IDBFactory = indexedDB): Promise<void> {
  const name = databaseNameFor(partition);
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve(); // another tab still holds it; it is deleted when that tab closes
    request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}`));
  });
}

/**
 * Ask the browser to make this origin's storage persistent, so eviction under pressure does not
 * take a queued command with it. Best effort by definition — Safari grants it only after an
 * install, Chrome uses engagement heuristics — which is exactly why queueStore.ts holds the
 * command rows *and* the localStorage snapshot and heals one from the other. This raises the odds;
 * it is not the mitigation.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export async function readMeta<T>(db: OfflineDb, key: string): Promise<T | undefined> {
  const row = await db.get<MetaRow>(STORE.META, key);
  return row?.value as T | undefined;
}

export async function writeMeta(db: OfflineDb, key: string, value: unknown, now = () => new Date().toISOString()): Promise<void> {
  await db.put(STORE.META, { key, value, updatedAt: now() } satisfies MetaRow);
}
