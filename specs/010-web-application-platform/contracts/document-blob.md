# Contract: Private Document / Blob Access

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Consumers**: WS-W7, calibration workflows (US4), recovery reconciliation.

**D18 amendment (2026-09-04):** document metadata and bytes are evidence-purpose projections, not
attributes inherited from asset read or an administrator role. See
[`docs/25-need-to-know-access-ux.md`](../../../docs/25-need-to-know-access-ux.md).

## Rules

1. Production documents live in **private** Azure Blob containers.
2. Metadata, hash, scan state, retention class, and replacement chain live in **PostgreSQL**.
3. The browser **never** receives a storage account key, connection string, or broad SAS.
4. Upload/download authorization uses AMS API identity + active Administration/evidence purpose +
   exact capability + row scope + document ACL + field policy. Role/office alone is insufficient.
5. Calibration **fact** and certificate **bytes** are separable — upload failure must not erase the
   accepted calibration record (FR-033).

## Metadata shape

```ts
export type DocumentScanState =
  | "Pending"
  | "Clean"
  | "Quarantined"
  | "Failed"
  | "Skipped"; // ASSUMPTION: malware-scan route open (010 Open Decision #10)

/** Server/internal record. Never serialize this whole shape to a browser. */
export interface InternalDocumentMetadata {
  id: string;
  blobContainer: string;       // server-only
  blobPath: string;            // collision-safe server-generated path
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFileName: string;    // display only
  scanState: DocumentScanState;
  retentionClass: string;
  linkedEntityType: "Calibration" | "Asset" | "Transaction" | "Other";
  linkedEntityId: string;
  replacesDocumentId: string | null;
  uploadedByUserId: string;
  uploadedAt: string;
  isCurrent: boolean;
}

/** Purpose-sized evidence list item; only fields allowlisted by the named projection are returned. */
export interface EvidenceDocumentItem {
  documentId: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  scanState: DocumentScanState;
  uploadedAt: string;
  isCurrent: boolean;
  dataProjectionId: "admin_maintenance_evidence_v1" | "audit_case_evidence_v1";
}
```

Work and general Reports receive neither `EvidenceDocumentItem` nor document-existence metadata.
Blob container/path, hash, uploader identity, retention internals, and replacement-chain IDs remain
server-side unless an approved audit projection explicitly requires them.

## Upload initiation

```http
POST /api/documents/upload-sessions
```

Requires an approved Administration evidence-management purpose, `maintenance.evidence.manage`,
matching row scope, and current document policy. The linked entity is resolved server-side before a
session is issued.

```ts
export interface DocumentUploadSessionRequest {
  clientSubmissionId: string;
  linkedEntityType: "Calibration" | "Asset" | "Transaction" | "Other";
  linkedEntityId: string;
  contentType: string;
  byteSize: number;
  originalFileName: string;
  sha256?: string; // if client pre-hashed; server re-verifies on complete
}

export interface DocumentUploadSessionResponse {
  documentId: string;
  /** Short-lived, single-blob, least-privilege write URL OR "put-through-api" marker */
  uploadMode: "userDelegationSas" | "proxyPut";
  uploadUrl?: string;          // only for userDelegationSas; expiry minutes-scale
  expiresAt: string;
  maxBytes: number;
  allowedContentTypes: string[];
}
```

Preferred: user-delegation SAS scoped to one blob path, minted with managed identity. Alternative:
`PUT /api/documents/:id/content` proxy to keep keys off the client entirely.
An upload URL is non-persistent and non-cacheable; it is discarded on completion, expiry, workspace
change, identity change, or capability revocation.

## Complete / attach

```http
POST /api/documents/:documentId/complete
```

Server verifies size, type, hash, scan disposition; links to calibration; sets `Certificate missing`
cleared when appropriate.

## Download

```http
POST /api/documents/:documentId/download-authorization
GET  /api/documents/:documentId/content   // optional proxy stream
```

```ts
export interface DocumentDownloadRequest {
  purposeId: string;          // approved purpose identifier, validated server-side
  evidenceCaseId?: string;    // required when the owning purpose is case-scoped
}

export interface DocumentDownloadAuthorization {
  documentId: string;
  dataProjectionId: "admin_maintenance_evidence_v1" | "audit_case_evidence_v1";
  mode: "userDelegationSas" | "proxyGet";
  downloadUrl?: string;
  expiresAt: string;
}
```

Work, general Report Reader, wrong-purpose, wrong-scope, missing-capability, and ACL-denied requests
return the same safe `document.error.forbidden` response without document-existence leakage. Every
successful authorization/download records actor, purpose, scope, document, recipient/case where
applicable, policy version, and time.
Download authorization URLs are single-document, short-lived, non-persistent, and non-cacheable.
Workspace/identity change or capability revocation removes them from client state and browser-history
restoration even if the server-side expiry has not elapsed.

## Limits (planning defaults — confirm in implementation)

| Rule | Draft value |
|---|---|
| Max size | 20 MiB certificates (`ASSUMPTION` until ops confirms) |
| Types | `application/pdf`, approved image types |
| Naming | Server UUID path; original name metadata only |
| Replacement | New row; prior `is_current=false`; chain via `replacesDocumentId` |

## Explicit non-goals

- Public containers
- Account keys in app settings shipped to browsers
- SharePoint as system of record (optional export later)
