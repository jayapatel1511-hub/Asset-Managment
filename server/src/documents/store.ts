/**
 * `DocumentStore` — the seam assumption **A-DOC** (specs/_planning/BUILD-FREEZE.md § Assumptions
 * taken to unblock) names as the reversible place:
 *
 *   > Documents go through a `DocumentStore` interface. Local implementation writes to
 *   > `server/data/documents/` (gitignored) with the same private-by-default, hash-verified,
 *   > metadata-in-PostgreSQL contract. Azure Blob is a second implementation of the same
 *   > interface.
 *
 * The interface is deliberately five methods and no more. Everything a document needs that is
 * NOT storage — authorization, integrity, scan state, replacement history, calibration linkage —
 * lives in `service.ts` and in PostgreSQL, so swapping local for Blob changes where bytes sit and
 * nothing else. That is the same shape `db/database.ts` uses for the two database drivers, and
 * it is why that swap did not touch a single service.
 *
 * WHAT IS ABSENT FROM THE INTERFACE, ON PURPOSE:
 *
 *   - No "get me a URL". A store hands back BYTES, never a link. Contract § Rules 3 and 4 and
 *     CLAUDE.md rule 11 both say the browser never receives a storage credential, and the surest
 *     way to keep that true is to have no method that could return one. When Azure lands, a
 *     user-delegation SAS is minted by the *service* under an explicit authorization decision —
 *     it is not something a caller can ask the store for.
 *   - No `update`. An object is written once at a UUID path; a reissued certificate is a NEW
 *     object and a new row (WS-W7 § replacement history). There is no in-place overwrite to get
 *     wrong.
 *   - No `deleteAll` / prefix delete. Rule 20: "No general-purpose delete path exists for
 *     production business history." `delete` takes one exact path and exists for the
 *     abandoned-session sweep and for tests.
 */

export interface StoredObject {
  container: string;
  path: string;
  byteSize: number;
  sha256: string;
}

export interface ObjectHead {
  path: string;
  byteSize: number;
}

export interface DocumentStore {
  /** Which implementation this is — reported in health output and stamped on metadata rows. */
  readonly kind: string;
  /** The container/root a path is relative to. Recorded per document so reconciliation after a
   * container change reports a MOVE rather than a thousand missing objects. */
  readonly container: string;

  /** Writes bytes at `path`. Refuses to overwrite an existing object. */
  put(path: string, bytes: Buffer): Promise<StoredObject>;
  get(path: string): Promise<Buffer>;
  head(path: string): Promise<ObjectHead | null>;
  delete(path: string): Promise<void>;
  /** Every object under the container, as container-relative paths. Used only by
   * reconciliation — it is the "object with no metadata" half of the report. */
  list(prefix?: string): Promise<string[]>;
}

/**
 * Thrown by a store when the STORAGE fails — unreachable, out of space, permission denied. The
 * service turns it into `platform.error.dependency`, which is a fault the caller may retry,
 * never a business refusal and never a reason to touch a calibration record.
 */
export class DocumentStoreError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "DocumentStoreError";
  }
}

/** Thrown when the object simply is not there. Distinct from a store fault: a missing object is
 * a reconciliation finding, not an outage. */
export class ObjectNotFoundError extends DocumentStoreError {
  constructor(readonly path: string) {
    super(`No object at "${path}".`);
    this.name = "ObjectNotFoundError";
  }
}

// ---------------------------------------------------------------- path construction

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates a container-relative path before it reaches any filesystem or blob API.
 *
 * Every segment must be a plain name: no `..`, no absolute prefix, no separators of the other
 * platform's flavour, no leading dot. Paths in this system are SERVER-GENERATED from a UUID
 * (`buildBlobPath`), so this can only fail if something is wrong — which is precisely when a
 * check is worth having, because the one input that ever reaches it from outside is a stored
 * `blob_path` read back from the database after a restore.
 */
export function assertSafePath(path: string): void {
  if (!path || path.length > 400) throw new DocumentStoreError(`Refusing object path of length ${path.length}.`);
  if (path.includes("\\") || path.includes("\0")) throw new DocumentStoreError(`Refusing object path "${path}".`);
  const segments = path.split("/");
  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment)) throw new DocumentStoreError(`Refusing object path segment "${segment}".`);
  }
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tif",
  "image/heic": "heic",
};

export function extensionFor(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "bin";
}

/**
 * The stored path for a document: `<entity>/<yyyy>/<mm>/<uuid>.<ext>`.
 *
 * Contract § Limits, "Naming: Server UUID path; original name metadata only". The original file
 * name never reaches the filesystem — it is display metadata, it is user input, and it is the
 * classic vector for traversal, case-collision and encoding bugs. Date segments keep any one
 * directory listable; the UUID makes collision a non-question.
 */
export function buildBlobPath(params: {
  linkedEntityType: string;
  documentId: string;
  mediaType: string;
  now?: Date;
}): string {
  const now = params.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const path = `${params.linkedEntityType}/${yyyy}/${mm}/${params.documentId}.${extensionFor(params.mediaType)}`;
  assertSafePath(path);
  return path;
}
