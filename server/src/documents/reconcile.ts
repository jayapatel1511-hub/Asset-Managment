/**
 * Database ↔ object-store reconciliation — WS-W7 § owns "database/object reconciliation", and
 * its required test list ends with "database restore/document mismatch report".
 *
 * WHY THIS EXISTS AT ALL. PostgreSQL and the object store are two systems with two backup
 * schedules and two restore procedures, and no transaction spans them. Restore the database to
 * 09:00 and the store is ahead of it; restore the store and the database is ahead. Either way
 * the two disagree, and the disagreement is silent until somebody clicks a certificate that is
 * not there. This report is how the disagreement becomes visible before that.
 *
 * FOUR FINDINGS, because four different things go wrong and each needs a different person:
 *
 *   metadataWithoutObject  A `Stored` row whose object is gone. THE DATABASE-RESTORE CASE, and
 *                          the serious one: the system believes it holds a certificate it cannot
 *                          produce. Chased by restoring the object or voiding the document.
 *   objectWithoutMetadata  An object no row points at. The STORAGE-RESTORE case, and the reason
 *                          the store is never authoritative: bytes with no metadata have no
 *                          asset, no hash and no scan verdict, so they are not evidence of
 *                          anything until a human matches them up.
 *   hashMismatch           A `Stored` row whose object's SHA-256 no longer matches the one
 *                          recorded when it was accepted. Corruption, or a certificate swapped
 *                          underneath the metadata. Never auto-repaired.
 *   incompleteUpload       A `Pending` or `Failed` row WITH an object. Expected and harmless —
 *                          `service.putContent` writes bytes before it commits `Stored`, so a
 *                          crash in that window leaves exactly this. Reported so it can be swept,
 *                          and separated from the three real findings so it never inflates them.
 *
 * WHAT IT NEVER DOES: repair anything. Rule 20 — "No general-purpose delete path exists for
 * production business history" — and rule 16's instinct that automated matching on weak evidence
 * is how records get destroyed. The report names rows and paths; a human decides.
 *
 * COST. Hash verification reads every object, so it is off by default (`verifyHashes`). The
 * existence sweep is one `list()` plus one query and is cheap enough to schedule.
 */
import type { Database } from "../db/database";
import { sha256Of } from "./localStore";
import { ObjectNotFoundError, type DocumentStore } from "./store";

export interface MetadataWithoutObject {
  documentId: string;
  container: string;
  blobPath: string;
  linkedEntityType: string;
  linkedEntityId: string;
  uploadedAt: string | null;
  originalFileName: string;
}

export interface HashMismatch {
  documentId: string;
  blobPath: string;
  expectedSha256: string;
  actualSha256: string;
  expectedBytes: number;
  actualBytes: number;
}

export interface IncompleteUpload {
  documentId: string;
  blobPath: string;
  uploadState: string;
}

export interface ReconciliationReport {
  checkedAt: string;
  store: { kind: string; container: string };
  checkedMetadataRows: number;
  checkedObjects: number;
  hashesVerified: boolean;
  metadataWithoutObject: MetadataWithoutObject[];
  objectWithoutMetadata: string[];
  hashMismatch: HashMismatch[];
  incompleteUpload: IncompleteUpload[];
  /** True when none of the three real findings fired. `incompleteUpload` does not count. */
  clean: boolean;
}

interface Row {
  id: string;
  container: string;
  blob_path: string;
  upload_state: string;
  sha256: string | null;
  size_bytes: string | number;
  linked_entity_type: string;
  linked_entity_id: string;
  uploaded_at: Date | string | null;
  original_file_name: string;
}

export interface ReconcileOptions {
  /** Read every object and re-hash it. Off by default — see this file's header § COST. */
  verifyHashes?: boolean;
  /** Restrict to one container; defaults to the store's own. A row written against a DIFFERENT
   * container is skipped rather than reported missing, because "we moved containers" is not the
   * same finding as "the object is gone". */
  container?: string;
}

export async function reconcileDocuments(
  db: Database,
  store: DocumentStore,
  opts: ReconcileOptions = {}
): Promise<ReconciliationReport> {
  const container = opts.container ?? store.container;
  const verifyHashes = opts.verifyHashes ?? false;

  const rows = (
    await db.query<Row>(
      `SELECT id, container, blob_path, upload_state, sha256, size_bytes,
              linked_entity_type, linked_entity_id, uploaded_at, original_file_name
         FROM document
        WHERE container = $1
        ORDER BY created_at, id`,
      [container]
    )
  ).rows;

  const objectPaths = new Set(await store.list());
  const knownPaths = new Set(rows.map((r) => r.blob_path));

  const metadataWithoutObject: MetadataWithoutObject[] = [];
  const incompleteUpload: IncompleteUpload[] = [];
  const hashMismatch: HashMismatch[] = [];

  for (const row of rows) {
    const present = objectPaths.has(row.blob_path);

    if (row.upload_state === "Stored") {
      if (!present) {
        metadataWithoutObject.push({
          documentId: row.id,
          container: row.container,
          blobPath: row.blob_path,
          linkedEntityType: row.linked_entity_type,
          linkedEntityId: row.linked_entity_id,
          uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : (row.uploaded_at ?? null),
          originalFileName: row.original_file_name,
        });
        continue;
      }
      if (verifyHashes && row.sha256) {
        try {
          const bytes = await store.get(row.blob_path);
          const actual = sha256Of(bytes);
          if (actual !== row.sha256) {
            hashMismatch.push({
              documentId: row.id,
              blobPath: row.blob_path,
              expectedSha256: row.sha256,
              actualSha256: actual,
              expectedBytes: Number(row.size_bytes),
              actualBytes: bytes.byteLength,
            });
          }
        } catch (err) {
          // A read that fails between the listing and here is the same finding as an absence.
          if (err instanceof ObjectNotFoundError) {
            metadataWithoutObject.push({
              documentId: row.id,
              container: row.container,
              blobPath: row.blob_path,
              linkedEntityType: row.linked_entity_type,
              linkedEntityId: row.linked_entity_id,
              uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : (row.uploaded_at ?? null),
              originalFileName: row.original_file_name,
            });
          } else throw err;
        }
      }
    } else if (present) {
      incompleteUpload.push({ documentId: row.id, blobPath: row.blob_path, uploadState: row.upload_state });
    }
  }

  const objectWithoutMetadata = [...objectPaths].filter((p) => !knownPaths.has(p)).sort();

  return {
    checkedAt: new Date().toISOString(),
    store: { kind: store.kind, container },
    checkedMetadataRows: rows.length,
    checkedObjects: objectPaths.size,
    hashesVerified: verifyHashes,
    metadataWithoutObject,
    objectWithoutMetadata,
    hashMismatch,
    incompleteUpload,
    clean: metadataWithoutObject.length === 0 && objectWithoutMetadata.length === 0 && hashMismatch.length === 0,
  };
}

/** The three real findings as counts — the shape `outbox/jobs.publishReconciliationResult` takes. */
export function reconciliationCounts(report: ReconciliationReport): {
  metadataWithoutObject: number;
  objectWithoutMetadata: number;
  hashMismatch: number;
  checkedAt: string;
} {
  return {
    metadataWithoutObject: report.metadataWithoutObject.length,
    objectWithoutMetadata: report.objectWithoutMetadata.length,
    hashMismatch: report.hashMismatch.length,
    checkedAt: report.checkedAt,
  };
}
