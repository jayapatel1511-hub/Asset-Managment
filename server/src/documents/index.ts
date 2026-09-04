/**
 * The documents lane's public surface, and the factory that chooses a store.
 *
 * `createDocumentStore()` is the A-DOC switch (specs/_planning/BUILD-FREEZE.md § Assumptions):
 *
 *   AMS_DOCUMENT_STORE=local   (default) `LocalDocumentStore` under `server/data/documents/`
 *   AMS_DOCUMENT_STORE=blob              `BlobDocumentStore`, which needs a `BlobContainerClient`
 *                                        composed for it and FAILS LOUDLY without one
 *
 * The failure is deliberate and is the same correction CLAUDE.md records for the parked
 * Dataverse adapter — "`VITE_AMS_BACKEND=dataverse` now throws instead of silently falling back
 * to mock". A production server configured for Blob that quietly writes certificates to a
 * container app's ephemeral local disk is exactly the outcome rule 11 exists to prevent.
 */
export { ensureDocumentSchema, DOCUMENT_SCHEMA_SQL } from "./schema";
export {
  assertSafePath,
  buildBlobPath,
  DocumentStoreError,
  extensionFor,
  ObjectNotFoundError,
  type DocumentStore,
  type ObjectHead,
  type StoredObject,
} from "./store";
export { defaultDocumentRoot, LocalDocumentStore, sha256Of } from "./localStore";
export { BlobDocumentStore, unconfiguredBlobClient, type BlobContainerClient } from "./blobStore";
export {
  canTransitionScanState,
  DeferredScanner,
  ExternalQueueScanner,
  isDownloadable,
  MarkerScanner,
  scanRefusalReason,
  scanRequired,
  type MalwareScanner,
  type ScanInput,
  type ScanOutcome,
} from "./scan";
export {
  canReadContent,
  canReadMetadata,
  canReconcile,
  canWriteDocument,
  contentMatchesDeclaredType,
  DOCUMENT_LIMITS,
  FORBIDDEN_REASON,
  isAllowedMediaType,
  officeScopeAllows,
  type DocumentSubject,
} from "./policy";
export {
  DOCUMENT_REFERENCE_PREFIX,
  DocumentService,
  type DocumentServiceOptions,
  type DownloadAuthorization,
  type UploadSessionRequest,
  type UploadSessionResponse,
} from "./service";
export { reconcileDocuments, reconciliationCounts, type ReconciliationReport } from "./reconcile";
export {
  refuseDocument,
  toClientMetadata,
  type CalibrationCertificateSummary,
  type ClientDocumentMetadata,
  type DocumentErrorCode,
  type DocumentMetadata,
  type DocumentRefusal,
  type DocumentResult,
  type DocumentScanState,
  type DocumentType,
  type DocumentUploadState,
  type LinkedEntityType,
} from "./types";

import { BlobDocumentStore, unconfiguredBlobClient, type BlobContainerClient } from "./blobStore";
import { LocalDocumentStore } from "./localStore";
import type { DocumentStore } from "./store";

export function createDocumentStore(options: { blobClient?: BlobContainerClient; container?: string } = {}): DocumentStore {
  const selected = (process.env.AMS_DOCUMENT_STORE ?? "local").toLowerCase();
  if (selected === "local") return new LocalDocumentStore();
  if (selected === "blob") {
    const container = options.container ?? process.env.AMS_DOCUMENT_CONTAINER ?? "ams-documents";
    return new BlobDocumentStore(container, options.blobClient ?? unconfiguredBlobClient());
  }
  throw new Error(`Unknown AMS_DOCUMENT_STORE="${process.env.AMS_DOCUMENT_STORE}". Use "local" (default) or "blob".`);
}
