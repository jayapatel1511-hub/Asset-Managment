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
  classification: "Internal" | "Confidential" | "Restricted"; // OD-4 decided taxonomy
  allowedPurposes: string[];
  requiredCapabilities: string[];
  allowedWorkspace: "Reports" | "Administration";
  dataProjectionId: string;
  maxRows?: number | null;
  fieldAllowlist: string[]; // dictionary field names
  excludesRestrictedIdentifiers: boolean;
}

export interface ExportRequestInput {
  templateId: string;
  templateVersion: string;
  purposeCode: string; // must be one of the template/route's approved purposes
  filters: Record<string, unknown>; // office, project, dates — validated server-side
  clientSubmissionId: string;
}

/** Server/internal record. Never return this whole shape to the browser. */
export interface InternalExportArtifact {
  exportId: string;
  jobId: string;
  templateId: string;
  templateVersion: string;
  requestedBy: string;
  purposeCode: string;
  filters: Record<string, unknown>;
  columns: string[];
  rowCount: number;
  classification: string;
  createdAt: string;
  expiresAt: string;
  downloadPath: string; // server-only
  status: "Pending" | "Ready" | "Expired" | "Held" | "Deleted";
}

export interface ExportArtifactResponse {
  exportId: string;
  templateId: string;
  templateVersion: string;
  purposeCode: string;
  scopeLabel: "Office" | "Project" | "Case" | "Organization";
  columns: string[];
  rowCount: number;
  classification: "Internal" | "Confidential" | "Restricted";
  createdAt: string;
  expiresAt: string;
  status: "Pending" | "Ready" | "Expired" | "Held" | "Deleted";
  dataProjectionId: string;
}
```

The response carries no storage path or broad credential. Download is a separate authorization
operation requiring `governed.export.download` and the same purpose/scope/template policy.

---

## HTTP

```http
GET  /api/data-management/exports/templates
POST /api/data-management/exports/commands/request
GET  /api/data-management/exports/{exportId}
POST /api/data-management/exports/{exportId}/download
GET  /api/data-management/exports/{exportId}/audit
```

`GET templates` returns only templates whose workspace, approved purpose, required capability, row
scope, field policy, and current version all match the caller. A role label alone never lists a
template (FR-060). Field Work receives no export route or template; no fleet-wide raw export exists
(FR-067).

Generation is a `DataJobType: "Export"` — async when large; progress via job API.

---

## Server enforcement

1. Workspace, allowlisted purpose, named capability, office/row scope, and versioned field projection
   are enforced in SQL/API — never trust role alone or client-hidden columns.
2. Restricted identifiers are absent from general templates (FR-062) regardless of the actor's other
   roles; evidence/administrative exports need a distinct approved template and projection.
3. Record requester, purpose code, template/version, filters, columns, row count, classification, expiry (FR-063).
4. Artifact private; authenticated download; download events audited where policy requires.
5. After expiry: refuse download and delete per policy unless approved hold/exception (FR-064–065).
6. Large/restricted exports follow decided OD-3 separation of duties and OD-8 template scope.
7. Visible classification / export ID footer where format supports it (FR-066 / FR-068 area).
8. Never package DB credentials or internal storage account keys.
9. General report exports exclude certificate links/metadata, free-text notes, performer identity,
   maintenance cost, and secured network fields regardless of the actor's other roles.
10. Export artifacts, URLs, and metadata are online-only, non-cacheable, and removed from client
    state/history on workspace or authorization change.

Formula-injection protection on spreadsheet formats (FR-043).

---

## Refusal codes

| Code | When |
|---|---|
| `export.templateForbidden` | Workspace, purpose, capability, scope, or template policy does not allow it |
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
2. Report Reader may receive only Reports-owned read/export templates for an approved purpose and
   capability—never Administration/Data Management templates or write side effects merely by role.
3. Expired artifacts inaccessible (SC-014).
4. No client-side assembly of “full fleet CSV” from paged asset APIs as a substitute path.
