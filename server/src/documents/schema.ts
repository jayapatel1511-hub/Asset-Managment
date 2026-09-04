/**
 * Document metadata DDL — `docs/15-postgres-data-model.md` § 10's `document` and
 * `calibration_document` tables, applied idempotently from this module.
 *
 * WHY IT LIVES HERE rather than in `server/src/db/schema.sql`: the same reason as
 * `outbox/schema.ts` — `server/src/db/**` is the database lane's exclusive write lane while it
 * converts the POC schema into `db/migrations/**` (specs/_planning/BUILD-FREEZE.md § File
 * ownership). Fold these statements into the migration set when that lands; nothing else moves,
 * because the table and column names are § 10's.
 *
 * CONVENTIONS FOLLOWED FROM THE POC SCHEMA, on purpose:
 *   - `text` primary keys holding UUID strings, so `document.linked_entity_id` joins
 *     `calibration_record.id` (text) and `asset.assetid` (text) without a cast;
 *   - business-effective dates stay text elsewhere; the machine timestamps here are
 *     `timestamptz`, exactly as § 10 and § 11 specify.
 *
 * ADDITIONS BEYOND § 10's column list, recorded rather than silently taken (needs a line in
 * `docs/08-decisions.md` — the integrator's file):
 *
 *   1. `upload_state` — § 10 has `scan_status` but nothing that distinguishes "metadata exists,
 *      bytes do not yet" from "bytes are stored" from "the upload FAILED". FR-033's whole
 *      requirement is that the third case is a first-class, survivable state rather than a
 *      missing row, and the reconciliation report cannot tell an expected absence from a
 *      restore gap without it.
 *   2. `replaces_document_id` + `superseded_reason` — § 10 has `replaced_by_document_id` only,
 *      which walks the chain forwards. WS-W7 § "replacement history" needs it read backwards
 *      too ("what did this certificate supersede?"), and the contract's `DocumentMetadata`
 *      names `replacesDocumentId` explicitly.
 *   3. `is_current`, `void_reason`, `voided_at`, `voided_by` — the contract's § Limits requires
 *      "New row; prior `is_current=false`", and voiding is listed in § 10's calibration rules
 *      with no column to record it on the document.
 *   4. `scan_detail` / `scanned_at` — a quarantine with no recorded reason or time cannot be
 *      triaged.
 *   5. `container` — § 10 has `blob_path` alone. A store has a container/root, and reconciliation
 *      has to know which one a row was written against or it will report every row as missing
 *      after a container change.
 *   6. `client_submission_id` — traceability to the command, matching
 *      `asset_transaction.client_submission_id`.
 */
import type { Tx } from "../db/database";

export const DOCUMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS document (
  id                      text PRIMARY KEY,
  document_type           text NOT NULL,
  container               text NOT NULL,
  blob_path               text NOT NULL,
  original_file_name      text NOT NULL,
  stored_file_name        text NOT NULL,
  media_type              text NOT NULL,
  size_bytes              bigint NOT NULL,
  sha256                  text,
  scan_status             text NOT NULL DEFAULT 'Pending',
  scan_detail             text,
  scanned_at              timestamptz,
  retention_class         text NOT NULL DEFAULT 'CalibrationEvidence',
  upload_state            text NOT NULL DEFAULT 'Pending',
  linked_entity_type      text NOT NULL,
  linked_entity_id        text NOT NULL,
  replaces_document_id    text,
  replaced_by_document_id text,
  superseded_reason       text,
  is_current              boolean NOT NULL DEFAULT true,
  void_reason             text,
  voided_at               timestamptz,
  voided_by               text,
  uploaded_by_user_id     text NOT NULL,
  uploaded_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  is_synthetic            boolean NOT NULL DEFAULT false,
  client_submission_id    text
);

-- One object per path. The path carries the document UUID, so this is belt and braces against a
-- generator bug rather than a collision anyone expects.
CREATE UNIQUE INDEX IF NOT EXISTS document_path_uniq ON document (container, blob_path);
CREATE INDEX IF NOT EXISTS document_entity_idx ON document (linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS document_sha_idx ON document (sha256);

-- The link, not a foreign key on calibration_record. A calibration FACT stands on its own; a
-- certificate is a separate object that may arrive later, be replaced, or never arrive at all.
CREATE TABLE IF NOT EXISTS calibration_document (
  calibration_record_id text NOT NULL,
  document_id           text NOT NULL,
  relationship_type     text NOT NULL DEFAULT 'Certificate',
  is_current            boolean NOT NULL DEFAULT true,
  linked_at             timestamptz NOT NULL DEFAULT now(),
  linked_by             text NOT NULL,
  unlinked_at           timestamptz,
  PRIMARY KEY (calibration_record_id, document_id)
);

-- At most ONE current certificate per calibration record, enforced by the database rather than
-- by the service that maintains it — the same discipline as the POC schema's
-- rel_one_open_parent partial unique index. A reissue must therefore demote the old row in the
-- same transaction as it promotes the new one, which is exactly what supersedes-not-overwrites
-- means.
CREATE UNIQUE INDEX IF NOT EXISTS caldoc_one_current
  ON calibration_document (calibration_record_id)
  WHERE is_current AND relationship_type = 'Certificate';
CREATE INDEX IF NOT EXISTS caldoc_document_idx ON calibration_document (document_id);
`;

export async function ensureDocumentSchema(db: Tx): Promise<void> {
  try {
    // `exec`, not `query` — multi-statement script; see outbox/schema.ts for the driver note.
    await db.exec(DOCUMENT_SCHEMA_SQL);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P07" || e?.code === "42710" || /already exists/i.test(e?.message ?? "");
}
