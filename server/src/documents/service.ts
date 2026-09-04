/**
 * `DocumentService` — everything about a document that is not "where the bytes sit".
 *
 * READ `types.ts`'s header first: the single idea this file implements is that a calibration
 * FACT and a certificate's BYTES are separable, and that an upload failure must leave the fact
 * standing (contract § Rules 5, FR-033). Every method below is arranged around that.
 *
 * THE UPLOAD IS TWO STEPS, AND THAT IS THE WHOLE TRICK.
 *
 *   1. `createUploadSession` writes a `document` row in `upload_state = 'Pending'`. No bytes have
 *      moved. The row is the record that an attempt is under way.
 *   2. `putContent` sends the bytes to the store, and only then commits `upload_state = 'Stored'`
 *      with the hash and the scan verdict.
 *
 * If step 2's STORE call fails, the row goes to `Failed` — a real, queryable state — an outbox
 * event is enqueued IN THE SAME TRANSACTION as that state change (CLAUDE.md rule 2), and the
 * calibration record is not touched by any statement in this file. It cannot be: the only column
 * `recalculateCalibrationCertificate` ever writes on `calibration_record` is `certificateurl`,
 * and it writes it by RECOMPUTING from the certificates that currently exist. A failed upload
 * recomputes to NULL, which is the truthful statement "no readable certificate", not damage.
 *
 * ORDER OF OPERATIONS, and why bytes go first. The alternative — commit `Stored` and then write
 * the object — would produce a metadata row claiming bytes that do not exist, which is exactly
 * the "database restore / document mismatch" condition `reconcile.ts` reports as a fault. Bytes
 * first means the worst case is an orphan object with a `Pending` row, which reconciliation
 * reports as `incompleteUpload` and which costs disk, not truth.
 *
 * NOTHING IN THIS FILE WRITES ASSET STATE. Not status, lifecycle, custodian, location, project
 * or parent — CLAUDE.md rules 1 and 4 reserve those for accepted transaction events, and
 * `transactionService.applyTransaction` is their only writer. Not `asset.lastcaldate` or
 * `asset.nextcaldue` either: those are `commandService.recordCalibration`'s, derived from the
 * calibration records themselves, and a certificate arriving late does not change when a
 * calibration happened.
 *
 * REPLACEMENT SUPERSEDES, IT NEVER OVERWRITES (WS-W7 § replacement history). `replace` creates a
 * NEW document, points it at the old one, demotes the old one to `is_current = false`, and moves
 * the `calibration_document` link — in one transaction, guarded by the `caldoc_one_current`
 * partial unique index so the database refuses a state with two current certificates even if
 * this code were wrong. The old bytes stay exactly where they were.
 */
import { randomUUID } from "node:crypto";
import type { CurrentUser } from "../../../app/src/api/types";
import { isAdminUser } from "../auth/devAuth";
import type { Database, Queryable } from "../db/database";
import { enqueue } from "../outbox/enqueue";
import type { CalibrationCertificateMissingPayload } from "../outbox/types";
import { sha256Of } from "./localStore";
import {
  canReadContent,
  canReconcile,
  canWriteDocument,
  contentMatchesDeclaredType,
  DOCUMENT_LIMITS,
  FORBIDDEN_REASON,
  isAllowedMediaType,
  type DocumentSubject,
} from "./policy";
import { DeferredScanner, canTransitionScanState, isDownloadable, scanRefusalReason, type MalwareScanner } from "./scan";
import { buildBlobPath, DocumentStoreError, ObjectNotFoundError, type DocumentStore } from "./store";
import {
  refuseDocument,
  toClientMetadata,
  type CalibrationCertificateSummary,
  type ClientDocumentMetadata,
  type DocumentMetadata,
  type DocumentResult,
  type DocumentScanState,
  type DocumentType,
  type LinkedEntityType,
} from "./types";

// ---------------------------------------------------------------- row mapping

interface DocumentRow {
  id: string;
  document_type: string;
  container: string;
  blob_path: string;
  original_file_name: string;
  stored_file_name: string;
  media_type: string;
  size_bytes: string | number;
  sha256: string | null;
  scan_status: string;
  scan_detail: string | null;
  scanned_at: Date | string | null;
  retention_class: string;
  upload_state: string;
  linked_entity_type: string;
  linked_entity_id: string;
  replaces_document_id: string | null;
  replaced_by_document_id: string | null;
  superseded_reason: string | null;
  is_current: boolean;
  void_reason: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  uploaded_by_user_id: string;
  uploaded_at: Date | string | null;
  created_at: Date | string;
  is_synthetic: boolean;
  client_submission_id: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function documentFromRow(r: DocumentRow): DocumentMetadata {
  return {
    id: r.id,
    documentType: r.document_type as DocumentType,
    container: r.container,
    blobPath: r.blob_path,
    originalFileName: r.original_file_name,
    storedFileName: r.stored_file_name,
    mediaType: r.media_type,
    byteSize: Number(r.size_bytes),
    sha256: r.sha256,
    scanState: r.scan_status as DocumentScanState,
    scanDetail: r.scan_detail,
    scannedAt: iso(r.scanned_at),
    retentionClass: r.retention_class,
    uploadState: r.upload_state as DocumentMetadata["uploadState"],
    linkedEntityType: r.linked_entity_type as LinkedEntityType,
    linkedEntityId: r.linked_entity_id,
    replacesDocumentId: r.replaces_document_id,
    replacedByDocumentId: r.replaced_by_document_id,
    supersededReason: r.superseded_reason,
    isCurrent: r.is_current,
    voidReason: r.void_reason,
    voidedAt: iso(r.voided_at),
    voidedBy: r.voided_by,
    uploadedByUserId: r.uploaded_by_user_id,
    uploadedAt: iso(r.uploaded_at),
    createdAt: iso(r.created_at)!,
    isSynthetic: r.is_synthetic,
    clientSubmissionId: r.client_submission_id,
  };
}

// ---------------------------------------------------------------- requests

export interface UploadSessionRequest {
  clientSubmissionId: string;
  linkedEntityType: LinkedEntityType;
  linkedEntityId: string;
  documentType?: DocumentType;
  mediaType: string;
  byteSize: number;
  originalFileName: string;
  /** Optional client pre-hash. The server re-verifies against the bytes it actually receives. */
  sha256?: string | null;
  retentionClass?: string;
  /** Set only when this session is a reissue of an existing certificate. */
  replacesDocumentId?: string | null;
  supersededReason?: string | null;
}

export interface UploadSessionResponse {
  documentId: string;
  /** Always `proxyPut` in this implementation — see `blobStore.ts` § THE SAS QUESTION. */
  uploadMode: "proxyPut";
  uploadPath: string;
  expiresAt: string;
  maxBytes: number;
  allowedMediaTypes: readonly string[];
  metadata: ClientDocumentMetadata;
}

export interface DownloadAuthorization {
  documentId: string;
  mode: "proxyGet";
  /** An API path, NOT a storage link. Fetching it re-authorizes; this grant is a statement that
   * the caller was permitted at this instant, never a bearer capability (CLAUDE.md rule 11). */
  downloadPath: string;
  expiresAt: string;
  mediaType: string;
  byteSize: number;
  originalFileName: string;
  sha256: string | null;
}

const SESSION_TTL_MS = 15 * 60_000;

/**
 * The scheme written into `calibration_record.certificateurl`. NOT a URL anything can follow —
 * see `recalculateCalibrationCertificate`'s docstring on why a followable link in that column
 * would leak a capability past every check in `policy.ts`.
 */
export const DOCUMENT_REFERENCE_PREFIX = "ams-document:";

export interface DocumentServiceOptions {
  scanner?: MalwareScanner;
  now?: () => Date;
  log?: (payload: Record<string, unknown>, message: string) => void;
}

export class DocumentService {
  private readonly scanner: MalwareScanner;
  private readonly now: () => Date;
  private readonly log: (payload: Record<string, unknown>, message: string) => void;

  constructor(
    private readonly db: Database,
    readonly store: DocumentStore,
    options: DocumentServiceOptions = {}
  ) {
    this.scanner = options.scanner ?? new DeferredScanner();
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  // ---------------------------------------------------------------- subject resolution

  /**
   * The asset (and therefore the office) a document concerns, for the office-scope check.
   *
   * A `Calibration` link resolves through `calibration_record.asset`; an `Asset` link is the
   * asset itself. `Transaction` and `Other` have no single asset, so they scope by role alone —
   * see `policy.ts` § OFFICE SCOPE.
   */
  async resolveSubject(tx: Queryable, linkedEntityType: LinkedEntityType, linkedEntityId: string): Promise<DocumentSubject> {
    if (linkedEntityType === "Calibration") {
      const res = await tx.query<{ homeoffice: string | null; assetid: string }>(
        `SELECT a.assetid, a.homeoffice
           FROM calibration_record c JOIN asset a ON a.assetid = c.asset
          WHERE c.id = $1`,
        [linkedEntityId]
      );
      const row = res.rows[0];
      return { assetId: row?.assetid ?? null, homeoffice: row?.homeoffice ?? null };
    }
    if (linkedEntityType === "Asset") {
      const res = await tx.query<{ homeoffice: string | null }>("SELECT homeoffice FROM asset WHERE assetid = $1", [
        linkedEntityId,
      ]);
      return { assetId: linkedEntityId, homeoffice: res.rows[0]?.homeoffice ?? null };
    }
    return { assetId: null, homeoffice: null };
  }

  private async loadRow(tx: Queryable, documentId: string): Promise<DocumentMetadata | null> {
    const res = await tx.query<DocumentRow>("SELECT * FROM document WHERE id = $1", [documentId]);
    return res.rows[0] ? documentFromRow(res.rows[0]) : null;
  }

  // ---------------------------------------------------------------- 1. session

  /**
   * Opens an upload session: validates policy, writes the `Pending` metadata row, hands back the
   * proxy path.
   *
   * Idempotent on `clientSubmissionId` within this lane (CLAUDE.md rule 3): the same id with the
   * same request returns the original session; the same id with a DIFFERENT request is refused,
   * exactly as `transactionService.answerFromStore` decided for commands. INTEGRATION NOTE — this
   * is a lane-local implementation because `runCommand`'s result type is `SubmissionOutcome`,
   * which a document session is not; folding it into the shared idempotency store once that type
   * admits non-transaction commands is a follow-up recorded in this lane's report.
   */
  async createUploadSession(user: CurrentUser, req: UploadSessionRequest): Promise<DocumentResult<UploadSessionResponse>> {
    const subject = await this.resolveSubject(this.db, req.linkedEntityType, req.linkedEntityId);
    if (!canWriteDocument(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);

    if (!isAllowedMediaType(req.mediaType)) {
      return refuseDocument(
        "document.error.typeOrSize",
        `"${req.mediaType}" is not an accepted document type — accepted types are ${DOCUMENT_LIMITS.allowedMediaTypes.join(", ")}.`,
        { mediaType: req.mediaType }
      );
    }
    if (!Number.isInteger(req.byteSize) || req.byteSize <= 0 || req.byteSize > DOCUMENT_LIMITS.maxBytes) {
      return refuseDocument(
        "document.error.typeOrSize",
        `A document must be between 1 byte and ${DOCUMENT_LIMITS.maxBytes} bytes; this one declares ${req.byteSize}.`,
        { byteSize: req.byteSize, maxBytes: DOCUMENT_LIMITS.maxBytes }
      );
    }
    if (!req.originalFileName || req.originalFileName.length > DOCUMENT_LIMITS.maxFileNameChars) {
      return refuseDocument("document.error.typeOrSize", "A document needs a file name of 1–255 characters.");
    }

    // Rule 3 — same id, same request returns the original; same id, different request is refused.
    const prior = await this.db.query<DocumentRow>("SELECT * FROM document WHERE client_submission_id = $1", [
      req.clientSubmissionId,
    ]);
    if (prior.rows[0]) {
      const existing = documentFromRow(prior.rows[0]);
      const sameRequest =
        existing.linkedEntityType === req.linkedEntityType &&
        existing.linkedEntityId === req.linkedEntityId &&
        existing.mediaType === req.mediaType &&
        existing.byteSize === req.byteSize &&
        existing.originalFileName === req.originalFileName;
      if (!sameRequest) {
        return refuseDocument(
          "document.error.stateConflict",
          "This submission id was already used for a different document, so it was refused rather than applied twice."
        );
      }
      return { ok: true, ...this.sessionResponse(existing) };
    }

    if (req.replacesDocumentId) {
      const target = await this.loadRow(this.db, req.replacesDocumentId);
      if (!target) return refuseDocument("document.error.notFound", "The document being replaced does not exist.");
      if (!target.isCurrent) {
        return refuseDocument(
          "document.error.stateConflict",
          "That document has already been superseded or voided; replace the current one instead."
        );
      }
    }

    const documentId = randomUUID();
    const blobPath = buildBlobPath({
      linkedEntityType: req.linkedEntityType,
      documentId,
      mediaType: req.mediaType,
      now: this.now(),
    });
    const storedFileName = blobPath.split("/").pop()!;

    await this.db.query(
      `INSERT INTO document (id, document_type, container, blob_path, original_file_name, stored_file_name,
                             media_type, size_bytes, sha256, scan_status, retention_class, upload_state,
                             linked_entity_type, linked_entity_id, replaces_document_id, superseded_reason,
                             is_current, uploaded_by_user_id, client_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', $10, 'Pending', $11, $12, $13, $14, true, $15, $16)`,
      [
        documentId,
        req.documentType ?? (req.linkedEntityType === "Calibration" ? "CalibrationCertificate" : "Other"),
        this.store.container,
        blobPath,
        req.originalFileName,
        storedFileName,
        req.mediaType,
        req.byteSize,
        req.sha256 ?? null,
        req.retentionClass ?? "CalibrationEvidence",
        req.linkedEntityType,
        req.linkedEntityId,
        req.replacesDocumentId ?? null,
        req.supersededReason ?? null,
        user.upn,
        req.clientSubmissionId,
      ]
    );

    const created = (await this.loadRow(this.db, documentId))!;
    return { ok: true, ...this.sessionResponse(created) };
  }

  private sessionResponse(doc: DocumentMetadata): UploadSessionResponse {
    return {
      documentId: doc.id,
      uploadMode: "proxyPut",
      uploadPath: `/api/documents/${doc.id}/content`,
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS).toISOString(),
      maxBytes: DOCUMENT_LIMITS.maxBytes,
      allowedMediaTypes: DOCUMENT_LIMITS.allowedMediaTypes,
      metadata: toClientMetadata(doc),
    };
  }

  // ---------------------------------------------------------------- 2. content

  /**
   * Receives the bytes, verifies them, stores them, scans them and commits the result.
   *
   * The failure branches are the interesting part, and each one is a different answer:
   *
   *   policy      wrong size, wrong type, bytes that do not match the declared type →
   *               `document.error.typeOrSize`, row left `Pending`, nothing stored.
   *   integrity   declared hash ≠ computed hash → `document.error.hashMismatch`, nothing stored.
   *               Integrity is checked BEFORE the write, so a corrupted transfer never becomes an
   *               object anybody has to reconcile.
   *   store       the store threw → `platform.error.dependency`, row moves to `Failed`, and the
   *               "certificate missing" outbox event commits with that state change. THE
   *               CALIBRATION RECORD IS NOT TOUCHED. This is FR-033 and the headline WS-W7 test.
   *   scan        a `Quarantined` verdict still STORES the object and commits the metadata — the
   *               file exists, it is evidence, and rule 20 has no delete path — but it is never
   *               downloadable and it never becomes a calibration's current certificate.
   */
  async putContent(
    user: CurrentUser,
    documentId: string,
    bytes: Buffer
  ): Promise<DocumentResult<{ metadata: ClientDocumentMetadata }>> {
    const doc = await this.loadRow(this.db, documentId);
    if (!doc) return refuseDocument("document.error.notFound", "No such document.");

    const subject = await this.resolveSubject(this.db, doc.linkedEntityType, doc.linkedEntityId);
    if (!canWriteDocument(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);

    if (doc.uploadState === "Stored") {
      // Rule: an object is written once. A second PUT is either a retry of something that
      // already worked or an attempt to overwrite; both are answered by the existing row.
      return { ok: true, metadata: toClientMetadata(doc) };
    }
    if (doc.uploadState === "Abandoned") {
      return refuseDocument("document.error.stateConflict", "This upload session was abandoned; open a new one.");
    }

    if (bytes.byteLength === 0 || bytes.byteLength > DOCUMENT_LIMITS.maxBytes) {
      return refuseDocument(
        "document.error.typeOrSize",
        `Received ${bytes.byteLength} bytes; the limit is ${DOCUMENT_LIMITS.maxBytes}.`
      );
    }
    if (bytes.byteLength !== doc.byteSize) {
      return refuseDocument(
        "document.error.typeOrSize",
        `The session declared ${doc.byteSize} bytes and ${bytes.byteLength} arrived.`,
        { declared: doc.byteSize, received: bytes.byteLength }
      );
    }
    if (!contentMatchesDeclaredType(doc.mediaType, bytes)) {
      return refuseDocument(
        "document.error.typeOrSize",
        `The content does not look like ${doc.mediaType}.`,
        { mediaType: doc.mediaType }
      );
    }

    const computed = sha256Of(bytes);
    if (doc.sha256 && doc.sha256 !== computed) {
      return refuseDocument(
        "document.error.hashMismatch",
        "The uploaded content does not match the hash declared when the session was opened.",
        { declared: doc.sha256, computed }
      );
    }

    // ---- the store call, outside any transaction: see this file's header § ORDER OF OPERATIONS
    let storeFailure: unknown = null;
    try {
      await this.store.put(doc.blobPath, bytes);
    } catch (err) {
      storeFailure = err;
    }

    if (storeFailure !== null) {
      // NOT every store failure is a failed upload.
      //
      // The store refuses to overwrite (localStore.ts § 2), so a retry of this session, or a
      // second PUT racing the first, is refused for trying to write an object that is already
      // there. If what is there hashes to the bytes in hand, the write we wanted HAS happened —
      // by us, a moment ago — and calling that a failure would report a certificate sitting in
      // the store as missing.
      //
      // Checked against the OBJECT rather than against the metadata row, deliberately: the
      // racing writer may not have committed its row yet, and on a single-connection driver it
      // provably has not. The bytes are the fact that does not depend on transaction timing.
      const settled = await this.hashOfStoredObject(doc.blobPath);
      if (settled !== computed) {
        const concurrent = await this.loadRow(this.db, doc.id);
        if (concurrent?.uploadState === "Stored") return { ok: true, metadata: toClientMetadata(concurrent) };

        await this.markUploadFailed(doc, storeFailure instanceof Error ? storeFailure.message : String(storeFailure));
        return refuseDocument(
          "platform.error.dependency",
          "The document store could not accept the file. The calibration record is unaffected and the " +
            "certificate can be attached later.",
          { documentId: doc.id, store: this.store.kind }
        );
      }
      this.log(
        { documentId: doc.id, blobPath: doc.blobPath },
        "store refused a duplicate write but the object matches — treating the upload as complete"
      );
    }

    const verdict = await this.scanner.scan({
      documentId: doc.id,
      mediaType: doc.mediaType,
      byteSize: bytes.byteLength,
      sha256: computed,
      bytes,
    });
    if (!canTransitionScanState(doc.scanState, verdict.state)) {
      // Unreachable from `Pending`; asserted rather than assumed, because a scanner that reports
      // an illegal transition is a scanner nobody should trust silently.
      return refuseDocument(
        "document.error.stateConflict",
        `Scanner "${this.scanner.name}" reported ${verdict.state}, which is not reachable from ${doc.scanState}.`
      );
    }

    const stored = await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE document
            SET upload_state = 'Stored', sha256 = $2, scan_status = $3, scan_detail = $4,
                scanned_at = now(), uploaded_at = now()
          WHERE id = $1`,
        [doc.id, computed, verdict.state, verdict.detail]
      );

      if (doc.linkedEntityType === "Calibration") {
        // A quarantined file is stored evidence, never a certificate. Linking it would let the
        // `caldoc_one_current` index treat it as the current certificate for the record.
        if (verdict.state !== "Quarantined") {
          await this.linkToCalibration(tx, doc.linkedEntityId, doc.id, user.upn, doc.replacesDocumentId);
        }
        await this.recalculateCalibrationCertificate(tx, doc.linkedEntityId);
        if (verdict.state === "Quarantined") {
          await this.enqueueCertificateGap(tx, doc.linkedEntityId, "Quarantined");
        }
      }
      return (await this.loadRow(tx, doc.id))!;
    });

    this.log(
      { documentId: doc.id, scanState: verdict.state, bytes: bytes.byteLength, store: this.store.kind },
      "document content stored"
    );
    return { ok: true, metadata: toClientMetadata(stored) };
  }

  /** The stored object's hash, or null if it cannot be read at all. Never throws: this runs on a
   * failure path, and a second fault there must not mask the first. */
  private async hashOfStoredObject(blobPath: string): Promise<string | null> {
    try {
      return sha256Of(await this.store.get(blobPath));
    } catch {
      return null;
    }
  }

  /**
   * The FR-033 transition, and the one place in this lane that proves CLAUDE.md rule 2 from the
   * documents side: the state change and its outbox event are ONE commit.
   */
  private async markUploadFailed(doc: DocumentMetadata, detail: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE document SET upload_state = 'Failed', scan_detail = $2 WHERE id = $1", [
        doc.id,
        `store failure: ${detail}`.slice(0, 2_000),
      ]);
      if (doc.linkedEntityType === "Calibration") {
        await this.recalculateCalibrationCertificate(tx, doc.linkedEntityId);
        await this.enqueueCertificateGap(tx, doc.linkedEntityId, "UploadFailed");
      }
    });
    this.log({ documentId: doc.id, store: this.store.kind, detail }, "document upload failed — calibration record unaffected");
  }

  // ---------------------------------------------------------------- 3. download

  /**
   * Authorizes a download and describes how to fetch it.
   *
   * The returned `downloadPath` is an API route, not a storage link, and fetching it runs this
   * same check again. `expiresAt` bounds how long a client should consider the answer fresh; it
   * is NOT what protects the bytes, because nothing here is a bearer token. Contract § Rules 3
   * and CLAUDE.md rule 11.
   */
  async authorizeDownload(user: CurrentUser, documentId: string): Promise<DocumentResult<DownloadAuthorization>> {
    const gate = await this.gateContent(user, documentId);
    if (!gate.ok) return gate;
    const doc = gate.doc;
    return {
      ok: true,
      documentId: doc.id,
      mode: "proxyGet",
      downloadPath: `/api/documents/${doc.id}/content`,
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS).toISOString(),
      mediaType: doc.mediaType,
      byteSize: doc.byteSize,
      originalFileName: doc.originalFileName,
      sha256: doc.sha256,
    };
  }

  /**
   * The bytes, with the integrity hash re-verified on the way out.
   *
   * Re-hashing on read is not paranoia: it is the same check `reconcile.ts` runs in bulk, applied
   * to the one object somebody actually wants. A certificate whose bytes have drifted from the
   * hash recorded when it was accepted is not that certificate, and handing it over as though it
   * were is worse than refusing.
   */
  async getContent(
    user: CurrentUser,
    documentId: string
  ): Promise<DocumentResult<{ bytes: Buffer; metadata: ClientDocumentMetadata }>> {
    const gate = await this.gateContent(user, documentId);
    if (!gate.ok) return gate;
    const doc = gate.doc;

    let bytes: Buffer;
    try {
      bytes = await this.store.get(doc.blobPath);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        // Metadata says stored, the object is gone: the database-restore / storage-loss case.
        // Reported as a dependency fault rather than "not found", because the DOCUMENT exists —
        // only its bytes are missing, and reconcile.ts is where that is chased.
        return refuseDocument(
          "platform.error.dependency",
          "The document metadata exists but its stored object is missing. Run document reconciliation.",
          { documentId: doc.id }
        );
      }
      throw err;
    }

    const actual = sha256Of(bytes);
    if (doc.sha256 && actual !== doc.sha256) {
      return refuseDocument("document.error.hashMismatch", "The stored object no longer matches its recorded hash.", {
        documentId: doc.id,
        expected: doc.sha256,
        actual,
      });
    }
    return { ok: true, bytes, metadata: toClientMetadata(doc) };
  }

  /**
   * The shared gate for anything that yields bytes. Authorization runs BEFORE existence is
   * confirmed for an unauthorized caller, so a 403 never doubles as an id oracle (contract
   * § Download, "no existence leak beyond policy").
   */
  private async gateContent(
    user: CurrentUser,
    documentId: string
  ): Promise<{ ok: true; doc: DocumentMetadata } | ReturnType<typeof refuseDocument>> {
    // Role FIRST, before the row is even looked up. A caller who can never read any document's
    // bytes — every Field User — must get the identical answer for a real id and an invented
    // one, or the pair of responses is an existence oracle: guess ids, and 403-versus-404 tells
    // you which certificates exist (contract § Download, "no existence leak beyond policy").
    if (!isAdminUser(user)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);

    const doc = await this.loadRow(this.db, documentId);
    // Past the role gate, the caller is one who could legitimately be told the truth, so a
    // genuine absence is reported as an absence rather than as a refusal they cannot act on.
    if (!doc) return refuseDocument("document.error.notFound", "No such document.");

    const subject = await this.resolveSubject(this.db, doc.linkedEntityType, doc.linkedEntityId);
    if (!canReadContent(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);
    if (doc.uploadState !== "Stored") {
      return refuseDocument("document.error.notFound", "This document has no stored content.", {
        uploadState: doc.uploadState,
      });
    }
    if (!isDownloadable(doc.scanState)) {
      return refuseDocument("document.error.quarantined", scanRefusalReason(doc.scanState), { scanState: doc.scanState });
    }
    return { ok: true, doc };
  }

  // ---------------------------------------------------------------- 4. metadata reads

  async getMetadata(
    user: CurrentUser,
    documentId: string
  ): Promise<DocumentResult<{ metadata: ClientDocumentMetadata; canDownload: boolean }>> {
    const doc = await this.loadRow(this.db, documentId);
    if (!doc) return refuseDocument("document.error.notFound", "No such document.");
    const subject = await this.resolveSubject(this.db, doc.linkedEntityType, doc.linkedEntityId);
    // Metadata is readable by any authenticated caller (policy.ts § THE FIELD-USER RULE): a
    // technician may know a certificate exists. `canDownload` tells the UI whether to offer the
    // button at all, so a Field User is never shown an action that would 403.
    return { ok: true, metadata: toClientMetadata(doc), canDownload: canReadContent(user, subject) };
  }

  async listForEntity(
    _user: CurrentUser,
    linkedEntityType: LinkedEntityType,
    linkedEntityId: string
  ): Promise<ClientDocumentMetadata[]> {
    const res = await this.db.query<DocumentRow>(
      `SELECT * FROM document WHERE linked_entity_type = $1 AND linked_entity_id = $2
        ORDER BY created_at, id`,
      [linkedEntityType, linkedEntityId]
    );
    return res.rows.map((r) => toClientMetadata(documentFromRow(r)));
  }

  /** The full replacement chain for a document, oldest first — WS-W7 § replacement history. */
  async replacementChain(_user: CurrentUser, documentId: string): Promise<ClientDocumentMetadata[]> {
    const res = await this.db.query<DocumentRow>(
      `WITH RECURSIVE back AS (
         SELECT * FROM document WHERE id = $1
         UNION ALL
         SELECT d.* FROM document d JOIN back b ON d.id = b.replaces_document_id
       ), forward AS (
         SELECT * FROM document WHERE id = $1
         UNION ALL
         SELECT d.* FROM document d JOIN forward f ON d.id = f.replaced_by_document_id
       )
       SELECT DISTINCT ON (id) * FROM (SELECT * FROM back UNION ALL SELECT * FROM forward) AS chain
       ORDER BY id, created_at`,
      [documentId]
    );
    return res.rows
      .map((r) => documentFromRow(r))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(toClientMetadata);
  }

  // ---------------------------------------------------------------- 5. attach / replace / void

  /**
   * Attaches an already-stored document to a calibration record — WS-W7 § required tests, "later
   * attachment". This is the path for a certificate that arrives days after the calibration was
   * recorded, and for re-attaching after a failed upload was retried into a new document.
   */
  async attachToCalibration(
    user: CurrentUser,
    documentId: string,
    calibrationRecordId: string
  ): Promise<DocumentResult<{ summary: CalibrationCertificateSummary }>> {
    const doc = await this.loadRow(this.db, documentId);
    if (!doc) return refuseDocument("document.error.notFound", "No such document.");

    const subject = await this.resolveSubject(this.db, "Calibration", calibrationRecordId);
    if (!subject.assetId) return refuseDocument("document.error.notFound", "No such calibration record.");
    if (!canWriteDocument(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);

    if (doc.uploadState !== "Stored") {
      return refuseDocument("document.error.stateConflict", "That document has no stored content to attach.");
    }
    if (doc.scanState === "Quarantined") {
      return refuseDocument("document.error.quarantined", scanRefusalReason(doc.scanState));
    }
    if (!doc.isCurrent) {
      return refuseDocument("document.error.stateConflict", "That document has been superseded or voided.");
    }

    const summary = await this.db.transaction(async (tx) => {
      await this.linkToCalibration(tx, calibrationRecordId, doc.id, user.upn, null);
      await this.recalculateCalibrationCertificate(tx, calibrationRecordId);
      return this.readSummaryForCalibration(tx, calibrationRecordId);
    });
    return { ok: true, summary };
  }

  /**
   * Completes a reissue: the replacement is already stored (its session named
   * `replacesDocumentId`), and this promotes it.
   *
   * SUPERSEDES, NEVER OVERWRITES. The old row keeps its bytes, its hash and its history; it gains
   * `replaced_by_document_id` and loses `is_current`. The `caldoc_one_current` partial unique
   * index makes a two-current-certificate state impossible even if this code were wrong — the
   * demotion and the promotion are one transaction, so there is never an instant where both or
   * neither is current.
   */
  async completeReplacement(
    user: CurrentUser,
    replacementDocumentId: string,
    reason: string
  ): Promise<DocumentResult<{ summary: CalibrationCertificateSummary | null; replaced: ClientDocumentMetadata }>> {
    const replacement = await this.loadRow(this.db, replacementDocumentId);
    if (!replacement) return refuseDocument("document.error.notFound", "No such document.");
    if (!replacement.replacesDocumentId) {
      return refuseDocument("document.error.stateConflict", "That document was not opened as a replacement.");
    }
    if (replacement.uploadState !== "Stored") {
      return refuseDocument("document.error.stateConflict", "The replacement has no stored content.");
    }
    if (replacement.scanState === "Quarantined") {
      return refuseDocument("document.error.quarantined", scanRefusalReason(replacement.scanState));
    }

    const subject = await this.resolveSubject(this.db, replacement.linkedEntityType, replacement.linkedEntityId);
    if (!canWriteDocument(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);

    const outcome = await this.db.transaction(async (tx) => {
      const oldId = replacement.replacesDocumentId!;
      await tx.query(
        `UPDATE document SET is_current = false, replaced_by_document_id = $2, superseded_reason = $3
          WHERE id = $1`,
        [oldId, replacement.id, reason]
      );
      await tx.query(
        "UPDATE calibration_document SET is_current = false, unlinked_at = now() WHERE document_id = $1 AND is_current",
        [oldId]
      );
      if (replacement.linkedEntityType === "Calibration") {
        await this.linkToCalibration(tx, replacement.linkedEntityId, replacement.id, user.upn, oldId);
        await this.recalculateCalibrationCertificate(tx, replacement.linkedEntityId);
      }
      const replaced = (await this.loadRow(tx, oldId))!;
      const summary =
        replacement.linkedEntityType === "Calibration"
          ? await this.readSummaryForCalibration(tx, replacement.linkedEntityId)
          : null;
      return { replaced, summary };
    });

    return { ok: true, replaced: toClientMetadata(outcome.replaced), summary: outcome.summary };
  }

  /**
   * Voids a document — a certificate withdrawn by the lab, or one attached to the wrong asset.
   *
   * The row and the bytes both stay (rule 20: no general-purpose delete path for business
   * history). What changes is that it stops being current, stops being any calibration's
   * certificate, and the calibration summary recalculates to "missing" with reason `Voided` —
   * plus an outbox event so somebody is told, in the same commit.
   */
  async voidDocument(
    user: CurrentUser,
    documentId: string,
    reason: string
  ): Promise<DocumentResult<{ metadata: ClientDocumentMetadata; summary: CalibrationCertificateSummary | null }>> {
    if (!reason?.trim()) return refuseDocument("document.error.stateConflict", "A reason is required to void a document.");
    const doc = await this.loadRow(this.db, documentId);
    if (!doc) return refuseDocument("document.error.notFound", "No such document.");

    const subject = await this.resolveSubject(this.db, doc.linkedEntityType, doc.linkedEntityId);
    if (!canWriteDocument(user, subject)) return refuseDocument("document.error.forbidden", FORBIDDEN_REASON);
    if (doc.voidedAt) return refuseDocument("document.error.stateConflict", "That document is already void.");

    const outcome = await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE document SET is_current = false, void_reason = $2, voided_at = now(), voided_by = $3 WHERE id = $1",
        [doc.id, reason, user.upn]
      );
      await tx.query(
        "UPDATE calibration_document SET is_current = false, unlinked_at = now() WHERE document_id = $1 AND is_current",
        [doc.id]
      );
      let summary: CalibrationCertificateSummary | null = null;
      if (doc.linkedEntityType === "Calibration") {
        await this.recalculateCalibrationCertificate(tx, doc.linkedEntityId);
        await this.enqueueCertificateGap(tx, doc.linkedEntityId, "Voided");
        summary = await this.readSummaryForCalibration(tx, doc.linkedEntityId);
      }
      return { metadata: (await this.loadRow(tx, doc.id))!, summary };
    });

    return { ok: true, metadata: toClientMetadata(outcome.metadata), summary: outcome.summary };
  }

  // ---------------------------------------------------------------- 6. calibration linkage

  private async linkToCalibration(
    tx: Queryable,
    calibrationRecordId: string,
    documentId: string,
    byUpn: string,
    supersedesDocumentId: string | null
  ): Promise<void> {
    // Demote whatever is current first: `caldoc_one_current` permits exactly one, so promoting
    // before demoting would collide. Doing both here keeps the invariant inside one statement
    // pair inside one transaction.
    await tx.query(
      `UPDATE calibration_document SET is_current = false, unlinked_at = now()
        WHERE calibration_record_id = $1 AND is_current AND relationship_type = 'Certificate' AND document_id <> $2`,
      [calibrationRecordId, documentId]
    );
    if (supersedesDocumentId) {
      await tx.query(
        `UPDATE calibration_document SET is_current = false, unlinked_at = now()
          WHERE calibration_record_id = $1 AND document_id = $2`,
        [calibrationRecordId, supersedesDocumentId]
      );
    }
    await tx.query(
      `INSERT INTO calibration_document (calibration_record_id, document_id, relationship_type, is_current, linked_by)
       VALUES ($1, $2, 'Certificate', true, $3)
       ON CONFLICT (calibration_record_id, document_id)
       DO UPDATE SET is_current = true, unlinked_at = NULL, linked_at = now(), linked_by = EXCLUDED.linked_by`,
      [calibrationRecordId, documentId, byUpn]
    );
  }

  /**
   * WS-W7 § "calibration summary recalculation". Called on attach, replace, void, quarantine and
   * failed upload — every event that can change whether a readable certificate exists.
   *
   * `calibration_record.certificateurl` is the POC schema's one certificate column. It is set to
   * an INTERNAL reference `ams-document:<id>`, never to a URL a browser could follow, because a
   * followable URL in that column would be a capability leaking out of the database and past
   * every authorization check in `policy.ts` (CLAUDE.md rule 11). NULL means exactly "there is no
   * readable certificate right now", which is the truthful value after a failed upload and after
   * a void.
   *
   * The value is RECOMPUTED from the current link, never assigned from a caller's claim — the
   * same discipline `transactionService.refreshParentAsset` applies to `asset.parentasset`.
   */
  async recalculateCalibrationCertificate(tx: Queryable, calibrationRecordId: string): Promise<string | null> {
    const res = await tx.query<{ document_id: string }>(
      `SELECT cd.document_id
         FROM calibration_document cd
         JOIN document d ON d.id = cd.document_id
        WHERE cd.calibration_record_id = $1
          AND cd.is_current
          AND cd.relationship_type = 'Certificate'
          AND d.is_current
          AND d.voided_at IS NULL
          AND d.upload_state = 'Stored'
          AND d.scan_status <> 'Quarantined'
        LIMIT 1`,
      [calibrationRecordId]
    );
    const reference = res.rows[0] ? `${DOCUMENT_REFERENCE_PREFIX}${res.rows[0].document_id}` : null;
    await tx.query("UPDATE calibration_record SET certificateurl = $2 WHERE id = $1", [calibrationRecordId, reference]);
    return reference;
  }

  private async enqueueCertificateGap(
    tx: Queryable,
    calibrationRecordId: string,
    reason: CalibrationCertificateMissingPayload["reason"]
  ): Promise<void> {
    const res = await tx.query<{ asset: string; calibrationdate: string | null; nextduedate: string }>(
      "SELECT asset, calibrationdate, nextduedate FROM calibration_record WHERE id = $1",
      [calibrationRecordId]
    );
    const row = res.rows[0];
    if (!row) return;
    const payload: CalibrationCertificateMissingPayload = {
      schemaVersion: 1,
      assetId: row.asset,
      calibrationRecordId,
      calibrationDate: row.calibrationdate,
      nextDueDate: row.nextduedate,
      reason,
    };
    // CLAUDE.md rule 2 — this event commits with the state change that caused it, on the same
    // transaction handle, or not at all.
    await enqueue(tx, {
      eventType: "calibration.certificate_missing",
      aggregateType: "Calibration",
      aggregateId: calibrationRecordId,
      payload,
    });
  }

  // ---------------------------------------------------------------- 7. summaries

  /**
   * The asset's calibration paperwork as the screens need it.
   *
   * "Latest" is by CALIBRATION DATE, not by entry order — matching
   * `commandService.recordCalibration`'s own recomputation and WS-W7 § required tests, "older
   * historical record entry". Back-filling a 2019 certificate today must not make 2019 the
   * asset's current calibration.
   */
  async getCalibrationSummary(_user: CurrentUser, assetId: string): Promise<CalibrationCertificateSummary> {
    return this.readSummaryForAsset(this.db, assetId);
  }

  private async readSummaryForCalibration(tx: Queryable, calibrationRecordId: string): Promise<CalibrationCertificateSummary> {
    const res = await tx.query<{ asset: string }>("SELECT asset FROM calibration_record WHERE id = $1", [
      calibrationRecordId,
    ]);
    const assetId = res.rows[0]?.asset;
    if (!assetId) {
      return {
        assetId: "",
        calibrationRecordId,
        calibrationDate: null,
        nextDueDate: null,
        result: null,
        certificateNumber: null,
        certificateDocumentId: null,
        certificateMissing: true,
        certificateScanState: null,
        reason: "NeverAttached",
        recordCount: 0,
      };
    }
    return this.readSummaryForAsset(tx, assetId);
  }

  /**
   * Two queries, not one join, and the reason matters.
   *
   * A document that FAILED to upload or that was QUARANTINED is deliberately never written into
   * `calibration_document` — a quarantined file is not a certificate, and a failed upload has no
   * bytes to be one. So a join through that table can only ever see the certificates that
   * worked, and would report every interesting failure as `NeverAttached`, which is the one
   * answer that is definitely wrong: an attempt WAS made, and the person chasing the paperwork
   * needs to know which kind of gap they are looking at.
   *
   * Query 1 finds the calibration record. Query 2 asks the `document` table directly — which
   * records the attempt regardless of its outcome — for the most recent document linked to that
   * record, preferring a current certificate when one exists.
   */
  private async readSummaryForAsset(tx: Queryable, assetId: string): Promise<CalibrationCertificateSummary> {
    const latest = await tx.query<{
      id: string;
      calibrationdate: string | null;
      nextduedate: string;
      result: string | null;
      certificatenumber: string | null;
      certificateurl: string | null;
      record_count: number;
    }>(
      `SELECT c.id, c.calibrationdate, c.nextduedate, c.result, c.certificatenumber, c.certificateurl,
              (SELECT count(*)::int FROM calibration_record WHERE asset = $1) AS record_count
         FROM calibration_record c
        WHERE c.asset = $1
        ORDER BY c.calibrationdate DESC NULLS LAST, c.nextduedate DESC, c.id
        LIMIT 1`,
      [assetId]
    );
    const record = latest.rows[0];
    if (!record) {
      return {
        assetId,
        calibrationRecordId: null,
        calibrationDate: null,
        nextDueDate: null,
        result: null,
        certificateNumber: null,
        certificateDocumentId: null,
        certificateMissing: true,
        certificateScanState: null,
        reason: null,
        recordCount: 0,
      };
    }

    // Every document that has ever been linked to this calibration record — attempted, failed,
    // quarantined, voided or current — newest and most-current first.
    const attempts = await tx.query<{
      id: string;
      scan_status: string;
      upload_state: string;
      voided_at: Date | string | null;
      is_current: boolean;
    }>(
      `SELECT d.id, d.scan_status, d.upload_state, d.voided_at, d.is_current
         FROM document d
        WHERE d.linked_entity_type = 'Calibration' AND d.linked_entity_id = $1
        ORDER BY d.is_current DESC, d.created_at DESC, d.id
        LIMIT 1`,
      [record.id]
    );
    const attempt = attempts.rows[0] ?? null;

    // Only an internal `ams-document:` reference counts as a readable certificate. A legacy
    // value migrated into this column from the source inventory is evidence that paperwork
    // exists somewhere, not a document this system can serve — so it is reported as missing
    // rather than as a certificate nobody can open.
    const documentReference =
      record.certificateurl && record.certificateurl.startsWith(DOCUMENT_REFERENCE_PREFIX)
        ? record.certificateurl.slice(DOCUMENT_REFERENCE_PREFIX.length)
        : null;
    const hasCertificate = documentReference !== null;

    const reason: CalibrationCertificateSummary["reason"] = hasCertificate
      ? null
      : attempt === null
        ? "NeverAttached"
        : attempt.voided_at !== null
          ? "Voided"
          : attempt.scan_status === "Quarantined"
            ? "Quarantined"
            : attempt.upload_state === "Failed"
              ? "UploadFailed"
              : "Superseded";

    return {
      assetId,
      calibrationRecordId: record.id,
      calibrationDate: record.calibrationdate,
      nextDueDate: record.nextduedate,
      result: record.result,
      certificateNumber: record.certificatenumber,
      certificateDocumentId: documentReference,
      certificateMissing: !hasCertificate,
      certificateScanState: (attempt?.scan_status as DocumentScanState | undefined) ?? null,
      reason,
      recordCount: Number(record.record_count),
    };
  }

  // ---------------------------------------------------------------- 8. reconciliation gate

  /** Reconciliation is global (policy.ts § canReconcile); the comparison itself is
   * `reconcile.ts`'s. */
  assertMayReconcile(user: CurrentUser): boolean {
    return canReconcile(user);
  }

  /** Surfaced for diagnostics — an operator asking "which store is this server writing to?"
   * should not have to read the environment. */
  describeStore(): { kind: string; container: string } {
    return { kind: this.store.kind, container: this.store.container };
  }
}

export { DocumentStoreError };
