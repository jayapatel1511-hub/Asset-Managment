-- 0011 — document metadata, upload sessions and scan state.
--
-- FOLDED IN from `server/src/documents/schema.ts` for the reason given at the top of
-- `0010_outbox.sql`: this DDL was applied from a route module's `onReady` hook during the
-- parallel build, and schema belongs in the migration ledger.
--
-- The bytes themselves are NOT here and never will be. `documents/blobStore.ts` keeps them behind
-- a `DocumentStore` interface — a local directory today, Azure Blob later (assumption A-DOC) —
-- and that interface deliberately has no method capable of returning a URL or a credential, so no
-- SAS can leak to a browser (CLAUDE.md rule 11). What PostgreSQL holds is metadata plus the
-- integrity hash the reconciliation job compares against the object store.
--
-- The SQL below is `DOCUMENT_SCHEMA_SQL` verbatim.


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
