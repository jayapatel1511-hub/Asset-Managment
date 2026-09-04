/**
 * Governed exports, client side — CLAUDE.md rule 19 and
 * `specs/011-data-management/contracts/governed-export.md`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `CompliancePage` and `TimelinePage` each built their CSV in the browser: read rows through the
 * ordinary asset APIs, pick the columns in JavaScript, join them with commas, hand the result to a
 * blob download. That is precisely what `governed-export.md`'s fourth invariant names as the
 * substitute path to close — "no client-side assembly of a full fleet CSV from paged asset APIs" —
 * because every one of rule 19's four requirements is unenforceable there:
 *
 *   approved template          the columns were whatever the component's array said this week;
 *   server-side row/field scope the rows were whatever the client had already fetched;
 *   private short-lived artifact the file existed only in the browser, so nothing expires;
 *   audit                       nobody recorded that a client-facing pack had been produced.
 *
 * So when the HTTP backend is live, both exports now go through `/api/reports/exports`: the server
 * picks the columns from the approved template, cuts the rows to the caller's own office scope,
 * writes an audit record naming the requester, purpose, template version and row count, and hands
 * back a private artifact that expires in fifteen minutes. The browser's only remaining job is to
 * save bytes it did not compose.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Why the local path is still here
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `VITE_AMS_BACKEND` defaults to `mock`, and the mock is not a server — it has no templates, no
 * office scope and no audit log, and pretending otherwise would be worse than not offering the
 * button. So on the mock the old in-browser assembly is kept, unchanged, for UI development and
 * for the deterministic tests that run against it. `governedExportsAvailable()` is the switch, and
 * it is deliberately a build-time backend check rather than a feature flag: an export that is
 * "governed except when something failed" is not governed.
 *
 * Identity travels the same way `api/http/index.ts` sends it — the `x-ams-dev-user` header fed
 * from the key the existing RoleSwitcher stored. When Entra replaces the dev provider this becomes
 * a session cookie and nothing else here changes. The browser still asserts no authority: the
 * server resolves the caller, the caller's roles and the caller's office scope, and refuses a
 * request that tries to name any of them.
 */
import { getMockCurrentUserKey } from "../../api/mock";

/** The approved templates this screen may ask for, at the versions the server has approved. The
 * version is sent explicitly and the server refuses a mismatch, so a client left running against a
 * newer server is told its request is stale rather than silently handed different columns. */
export const GOVERNED_TEMPLATES = {
  "calibration-compliance": "1.0.0",
  "asset-timeline": "1.0.0",
} as const;

export type GovernedTemplateId = keyof typeof GOVERNED_TEMPLATES;

export interface GovernedArtifact {
  exportId: string;
  templateId: string;
  templateVersion: string;
  rowCount: number;
  columns: string[];
  classification: string;
  createdAt: string;
  expiresAt: string;
  downloadPath: string;
  scopeOffices: string[] | null;
}

export type GovernedExportResult =
  | { ok: true; artifact: GovernedArtifact }
  | { ok: false; code: string; message: string };

const DEV_USER_HEADER = "x-ams-dev-user";

/** True when a real API is behind the app. See the header for why this is not a soft fallback. */
export function governedExportsAvailable(): boolean {
  return (import.meta.env.VITE_AMS_BACKEND ?? "mock") === "http";
}

/** Saves text the caller did not compose. Shared by both the governed and the local paths so a
 * change to how a file reaches the user is one edit, not two. */
export function saveTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8;"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** RFC 4180 escaping for the mock-only local path. Kept identical to what the two screens did
 * before, so nothing about mock-mode behaviour changes. */
export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * Requests a governed artifact and saves it.
 *
 * Note what is NOT sent: no column list, no row scope, no role, no user id. The server refuses a
 * body carrying any of them (`server/src/routes/reports.ts#refuseClientAuthority`), which is the
 * point — a request that cannot express those things cannot be the place they are decided.
 *
 * `purpose` is recorded in the audit entry and is required. It is derived from what the user was
 * looking at rather than typed, which is the honest limit of this pass: a typed purpose needs an
 * input and an i18n key, and is a small, separate change when Jay wants one.
 */
export async function runGovernedExport(
  templateId: GovernedTemplateId,
  filters: Record<string, string>,
  purpose: string
): Promise<GovernedExportResult> {
  const headers: Record<string, string> = {
    [DEV_USER_HEADER]: getMockCurrentUserKey(),
    "content-type": "application/json",
  };

  const requested = await fetch("/api/reports/exports", {
    method: "POST",
    headers,
    body: JSON.stringify({
      templateId,
      templateVersion: GOVERNED_TEMPLATES[templateId],
      purpose,
      filters,
      clientSubmissionId: newSubmissionId(),
    }),
  });

  if (requested.status !== 201) {
    return refusalFrom(requested, await requested.text());
  }
  const artifact = (await requested.json()) as GovernedArtifact;

  const downloaded = await fetch(artifact.downloadPath, { headers: { [DEV_USER_HEADER]: getMockCurrentUserKey() } });
  if (!downloaded.ok) {
    return refusalFrom(downloaded, await downloaded.text());
  }

  saveTextFile(filenameFor(artifact), await downloaded.text());
  return { ok: true, artifact };
}

/** The artifact's own id goes in the filename, so a file found on a desk months later can still be
 * traced to the audit entry that produced it — and so two exports of the same project never
 * silently overwrite one another in a downloads folder. */
function filenameFor(artifact: GovernedArtifact): string {
  return `${artifact.templateId}-${artifact.exportId.slice(0, 8)}.csv`;
}

function refusalFrom(res: Response, body: string): GovernedExportResult {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return { ok: false, code: parsed.error ?? String(res.status), message: parsed.message ?? res.statusText };
  } catch {
    return { ok: false, code: String(res.status), message: res.statusText || body.slice(0, 200) };
  }
}

/** Rule 3: an export is an external write, so it carries an idempotency key. A repeat of the same
 * request returns the original artifact rather than producing a second one; a different request
 * under the same key is refused. */
function newSubmissionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
