/**
 * `LocalDocumentStore` — the A-DOC local implementation. Bytes under `server/data/documents/`.
 *
 * `server/data/` is ALREADY gitignored (`server/.gitignore` line 2, `data/`), which is what
 * A-DOC's "(gitignored)" requires and why this lane needs no change to that file. Production
 * documents are private (CLAUDE.md rule 11); a certificate committed to git is the exact
 * failure that rule exists to prevent, so the check is worth stating rather than assuming.
 *
 * THREE THINGS THIS IMPLEMENTATION DOES THAT A NAÏVE `writeFile` WOULD NOT:
 *
 *   1. It writes to a temporary name and RENAMES into place. `rename` within a filesystem is
 *      atomic, so a crash mid-write leaves a stray temp file rather than a half-written
 *      certificate at the real path — and a half-written certificate is worse than no
 *      certificate, because its hash will not match and reconciliation will report a mismatch
 *      that nobody can explain.
 *   2. It REFUSES to overwrite. `wx` on the rename target's existence check plus the UUID path
 *      means a document object is written exactly once. Replacement is a new object and a new
 *      row (WS-W7 § replacement history) — never an overwrite of the bytes an earlier
 *      certificate was issued as.
 *   3. It RESOLVES and re-checks the final path against the root. `assertSafePath` already
 *      rejects traversal in the path string; this checks the resolved result too, because a
 *      symlink inside the data directory could otherwise redirect a write outside it.
 *
 * The hash is computed here, from the bytes actually written, and returned. The service compares
 * it against what the caller declared — see `service.ts` § integrity.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "../config";
import {
  assertSafePath,
  DocumentStoreError,
  ObjectNotFoundError,
  type DocumentStore,
  type ObjectHead,
  type StoredObject,
} from "./store";

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `server/data/documents` by default — under the already-gitignored `server/data/`. */
export function defaultDocumentRoot(): string {
  return process.env.AMS_DOCUMENT_DIR ?? path.join(DATA_ROOT, "documents");
}

export class LocalDocumentStore implements DocumentStore {
  readonly kind = "local";
  readonly container: string;

  constructor(private readonly root: string = defaultDocumentRoot()) {
    this.container = `local:${path.basename(root)}`;
  }

  /** The absolute path for a container-relative one, checked twice — see this file's header. */
  private resolve(objectPath: string): string {
    assertSafePath(objectPath);
    const absolute = path.resolve(this.root, objectPath);
    const rootWithSep = path.resolve(this.root) + path.sep;
    if (!absolute.startsWith(rootWithSep)) {
      throw new DocumentStoreError(`Refusing an object path that resolves outside the document root: "${objectPath}".`);
    }
    return absolute;
  }

  async put(objectPath: string, bytes: Buffer): Promise<StoredObject> {
    const absolute = this.resolve(objectPath);
    try {
      await mkdir(path.dirname(absolute), { recursive: true });
      if (await exists(absolute)) {
        throw new DocumentStoreError(`Refusing to overwrite the existing object "${objectPath}".`);
      }
      // A UUID, not pid+timestamp. Two writes of the same object from one process in the same
      // millisecond — a client double-submitting an upload — produced the SAME temp name, and
      // the second `wx` failed with EEXIST. That turned a duplicate request into a spurious
      // store failure whose recovery then depended on whether the first writer had finished its
      // rename yet: a race whose outcome changed with the database driver.
      //
      // With a unique temp name the only way `put` can refuse a duplicate is the `exists()`
      // check above, which by definition means the other writer's rename has ALREADY landed. So
      // `service.putContent`'s recovery is guaranteed to find the object and can decide from its
      // hash rather than from timing.
      const temp = `${absolute}.${randomUUID()}.part`;
      await writeFile(temp, bytes, { flag: "wx" });
      try {
        await rename(temp, absolute);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
      return { container: this.container, path: objectPath, byteSize: bytes.byteLength, sha256: sha256Of(bytes) };
    } catch (err) {
      if (err instanceof DocumentStoreError) throw err;
      throw new DocumentStoreError(`Storing "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async get(objectPath: string): Promise<Buffer> {
    const absolute = this.resolve(objectPath);
    try {
      return await readFile(absolute);
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError(objectPath);
      throw new DocumentStoreError(`Reading "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async head(objectPath: string): Promise<ObjectHead | null> {
    const absolute = this.resolve(objectPath);
    try {
      const info = await stat(absolute);
      return { path: objectPath, byteSize: info.size };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new DocumentStoreError(`Stat of "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async delete(objectPath: string): Promise<void> {
    const absolute = this.resolve(objectPath);
    try {
      await rm(absolute, { force: true });
    } catch (err) {
      throw new DocumentStoreError(`Deleting "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  /** Recursive walk, returning container-relative POSIX-style paths so the value round-trips
   * through `blob_path` unchanged on any platform. */
  async list(prefix?: string): Promise<string[]> {
    const start = prefix ? this.resolve(prefix) : path.resolve(this.root);
    const found: string[] = [];
    const root = path.resolve(this.root);
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (isNotFound(err)) return; // nothing has been stored yet
        throw new DocumentStoreError(`Listing "${dir}" failed: ${message(err)}`, err);
      }
      for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile() && !entry.name.endsWith(".part")) {
          found.push(path.relative(root, child).split(path.sep).join("/"));
        }
      }
    };
    await walk(start);
    return found.sort();
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: string })?.code === "ENOENT";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
