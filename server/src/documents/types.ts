/**
 * Document metadata shapes — the frozen contract
 * `specs/010-web-application-platform/contracts/document-blob.md` § Metadata shape, plus the
 * `document` / `calibration_document` catalogue in `docs/15-postgres-data-model.md` § 10.
 *
 * THE ONE IDEA THIS WHOLE LANE IS BUILT AROUND. The contract's rule 5: *"Calibration **fact** and
 * certificate **bytes** are separable — upload failure must not erase the accepted calibration
 * record (FR-033)."* Every type below is shaped to make that separation structural rather than
 * careful. A `document` row has its own `upload_state`; a `calibration_record` has no foreign key
 * to it; the link is a join table with `is_current`. There is no code path in which a store
 * failure can reach a calibration record, because there is no field on a calibration record for
 * a store failure to reach — only `certificateurl`, which is RECALCULATED from whatever
 * certificates currently exist, and whose absence is the truthful statement "no readable
 * certificate", not a corruption.
 *
 * WHAT IS NOT HERE. A URL the browser can use. Contract rule 3: "The browser **never** receives a
 * storage account key, connection string, or broad SAS", and CLAUDE.md rule 11: "Production
 * documents and job artifacts are private. No broad storage credential reaches the browser." So
 * `blobPath` and `container` are server-side facts that `toClientMetadata` strips, and every
 * download is an authorized request against the API rather than a link that works on its own.
 */

/** Contract § Metadata shape. `Skipped` is the honest local value — see scan.ts. */
export type DocumentScanState = "Pending" | "Clean" | "Quarantined" | "Failed" | "Skipped";

/**
 * Where the bytes are, independently of whether they are wanted.
 *
 *   Pending   metadata exists, an upload session is open, no object yet
 *   Stored    bytes are in the store and their hash matched
 *   Failed    the store refused or the integrity check failed; the row is KEPT as the record
 *             that an attempt happened and did not succeed (this is the FR-033 case)
 *   Abandoned a session that was never completed and has been swept up
 */
export type DocumentUploadState = "Pending" | "Stored" | "Failed" | "Abandoned";

export type DocumentType = "CalibrationCertificate" | "Photo" | "Other";

export type LinkedEntityType = "Calibration" | "Asset" | "Transaction" | "Other";

export interface DocumentMetadata {
  id: string;
  documentType: DocumentType;
  /** SERVER-ONLY. Stripped by `toClientMetadata`. */
  container: string;
  /** SERVER-ONLY. Stripped by `toClientMetadata`. */
  blobPath: string;
  originalFileName: string;
  storedFileName: string;
  mediaType: string;
  byteSize: number;
  /** Null until content is committed — an open session has no bytes to hash. */
  sha256: string | null;
  scanState: DocumentScanState;
  scanDetail: string | null;
  scannedAt: string | null;
  retentionClass: string;
  uploadState: DocumentUploadState;
  linkedEntityType: LinkedEntityType;
  linkedEntityId: string;
  /** The document this one supersedes — a reissued certificate points at the one it replaces. */
  replacesDocumentId: string | null;
  /** Filled in on the OLD row when a replacement lands. The chain reads both ways. */
  replacedByDocumentId: string | null;
  supersededReason: string | null;
  /** False for a superseded or voided document. Never deleted (rule 5 — history is preserved). */
  isCurrent: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  uploadedByUserId: string;
  uploadedAt: string | null;
  createdAt: string;
  isSynthetic: boolean;
  clientSubmissionId: string | null;
}

/** What a browser is allowed to know: everything except where the bytes physically live. */
export type ClientDocumentMetadata = Omit<DocumentMetadata, "container" | "blobPath">;

export function toClientMetadata(doc: DocumentMetadata): ClientDocumentMetadata {
  const { container: _container, blobPath: _blobPath, ...rest } = doc;
  return rest;
}

// ---------------------------------------------------------------- results

/**
 * Document operations answer, they do not throw for business reasons — the same discipline
 * `transactionService.refuse` applies to commands, and for the same reason: a refusal is an
 * answer about policy, not a fault to retry. `code` is from
 * `specs/010-web-application-platform/contracts/error-codes.md` § Document.
 */
export type DocumentErrorCode =
  | "document.error.forbidden"
  | "document.error.typeOrSize"
  | "document.error.hashMismatch"
  | "document.error.quarantined"
  | "document.error.notFound"
  // Not in the catalogue: the store itself was unreachable or refused the write. Mapped to the
  // catalogue's platform class rather than invented under `document.*`.
  | "platform.error.dependency"
  // Not in the catalogue: the requested transition is not legal for this document's state
  // (replacing a voided document, re-scanning a Clean one). Reported to the integrator for the
  // catalogue; behaves as a business refusal in the meantime.
  | "document.error.stateConflict";

export interface DocumentRefusal {
  ok: false;
  code: DocumentErrorCode;
  reason: string;
  details?: Record<string, unknown>;
}

export type DocumentResult<T> = ({ ok: true } & T) | DocumentRefusal;

export function refuseDocument(
  code: DocumentErrorCode,
  reason: string,
  details?: Record<string, unknown>
): DocumentRefusal {
  return details ? { ok: false, code, reason, details } : { ok: false, code, reason };
}

// ---------------------------------------------------------------- calibration summary

/**
 * The recalculated view of one asset's calibration paperwork — WS-W7 § "calibration summary
 * recalculation".
 *
 * `certificateMissing` is the field the UI shows as "Certificate missing" (docs/15 § 10: "A
 * calibration record survives an upload failure. The UI shows `Certificate missing` and permits
 * later attachment."). `reason` says *why*, because "the lab never sent it" and "our upload
 * failed" are different jobs for different people.
 */
export interface CalibrationCertificateSummary {
  assetId: string;
  calibrationRecordId: string | null;
  calibrationDate: string | null;
  nextDueDate: string | null;
  result: string | null;
  certificateNumber: string | null;
  certificateDocumentId: string | null;
  certificateMissing: boolean;
  certificateScanState: DocumentScanState | null;
  reason: "NeverAttached" | "UploadFailed" | "Quarantined" | "Voided" | "Superseded" | null;
  /** Every calibration record for the asset, so "records exist but none has a certificate" is
   * distinguishable from "no calibration has ever been recorded". */
  recordCount: number;
}
