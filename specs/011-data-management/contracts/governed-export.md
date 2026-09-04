# Contract: Governed Export

**Feature**: 011 | **Date**: 2026-09-03  
**Consumers**: exports module; reporting may list templates but 011 owns governance  
**Depends on**: **Blocked on 010 WS-W3/W4 foundations** for request/approve; WS-W7 private Blob; OD-8 initial templates  
**Rule**: Approved templates only. Server-side row/field scope. Private short-lived artifact. Audited. Not a Download All button.

---

## Types

```ts
export interface ExportTemplate {
  id: string;
  name: string;
  version: string;
  classification: string; // OD-4 taxonomy when approved
  allowedRoles: string[];
  maxRows?: number | null;
  fieldAllowlist: string[]; // dictionary field names
  excludesRestrictedIdentifiers: boolean;
}

export interface ExportRequestInput {
  templateId: string;
  templateVersion: string;
  purpose: string;
  filters: Record<string, unknown>; // office, project, dates — validated server-side
  clientSubmissionId: string;
}

export interface ExportArtifact {
  exportId: string;
  jobId: string;
  templateId: string;
  templateVersion: string;
  requestedBy: string;
  purpose: string;
  filters: Record<string, unknown>;
  columns: string[];
  rowCount: number;
  classification: string;
  createdAt: string;
  expiresAt: string;
  downloadPath: string; // server-authorized only — never a broad storage credential
  status: "Pending" | "Ready" | "Expired" | "Held" | "Deleted";
}
```

---

## HTTP

```http
GET  /api/data-management/exports/templates
POST /api/data-management/exports/commands/request
GET  /api/data-management/exports/{exportId}
POST /api/data-management/exports/{exportId}/download
GET  /api/data-management/exports/{exportId}/audit
```

`GET templates` returns only templates permitted to the caller’s role (FR-060).  
Field Users: **no** fleet-wide raw export (FR-067).

Generation is a `DataJobType: "Export"` — async when large; progress via job API.

---

## Server enforcement

1. Office scope and row filters applied in SQL/API — never trust client-hidden columns.
2. Restricted identifiers absent from general templates (FR-062) — not merely UI-hidden.
3. Record requester, purpose, template/version, filters, columns, row count, classification, expiry (FR-063).
4. Artifact private; authenticated download; download events audited where policy requires.
5. After expiry: refuse download and delete per policy unless approved hold/exception (FR-064–065).
6. Large/restricted exports: approval + separation of duties (**STOP**: OD-3, OD-8).
7. Visible classification / export ID footer where format supports it (FR-066 / FR-068 area).
8. Never package DB credentials or internal storage account keys.

Formula-injection protection on spreadsheet formats (FR-043).

---

## Refusal codes

| Code | When |
|---|---|
| `export.templateForbidden` | Role not allowed |
| `export.fieldForbidden` | Field not in allowlist / restricted |
| `export.scopeForbidden` | Cross-office |
| `export.approvalRequired` | |
| `export.selfApprovalForbidden` | |
| `export.expired` | |
| `export.notReady` | |
| `export.held` | Legal hold / exception path |

---

## Invariants

1. Export is a governed data product, not an unrestricted query dump.
2. Report Reader may receive read templates only — no write side effects.
3. Expired artifacts inaccessible (SC-014).
4. No client-side assembly of “full fleet CSV” from paged asset APIs as a substitute path.
