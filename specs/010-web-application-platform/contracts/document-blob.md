# Contract: Private Document / Blob Access

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Consumers**: WS-W7, calibration workflows (US4), recovery reconciliation.

## Rules

1. Production documents live in **private** Azure Blob containers.
2. Metadata, hash, scan state, retention class, and replacement chain live in **PostgreSQL**.
3. The browser **never** receives a storage account key, connection string, or broad SAS.
4. Upload/download authorization uses the AMS API identity + role/office checks.
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

export interface DocumentMetadata {
  id: string;
  blobContainer: string;       // server-known; not necessarily returned to FieldUser
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
```

## Upload initiation

```http
POST /api/documents/upload-sessions
```

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
export interface DocumentDownloadAuthorization {
  documentId: string;
  mode: "userDelegationSas" | "proxyGet";
  downloadUrl?: string;
  expiresAt: string;
}
```

Field User without permission → `document.error.forbidden` (no existence leak beyond policy).

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
