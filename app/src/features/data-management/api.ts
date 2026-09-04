/**
 * HTTP client for the Data Management first proof. Separate from AmsBackend so
 * mock/dataverse adapters do not grow a generic table editor.
 */
import type {
  DataDictionaryEntry,
  DataQualityIssue,
  DataQualityRule,
  DictionaryCoverageReport,
  DictionaryPage,
  QualityCommandOutcome,
  QualityIssuePage,
  QualityOverviewCounts,
} from "../../../../packages/contracts/src/dataManagement";
import { getMockCurrentUserKey } from "../../api/mock";

const DEV_USER_HEADER = "x-ams-dev-user";
const CSRF_HEADER = "x-ams-csrf";
const CSRF_COOKIE = "ams_csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { [DEV_USER_HEADER]: getMockCurrentUserKey() };
  if (json) h["content-type"] = "application/json";
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) h[CSRF_HEADER] = csrf;
  return h;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: headers(false) });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin", headers: headers(true), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const dataManagementApi = {
  dictionary(params: { entityName?: string; page?: number; pageSize?: number } = {}): Promise<DictionaryPage> {
    return getJson(`/api/data-management/dictionary${qs(params)}`);
  },
  coverage(): Promise<DictionaryCoverageReport> {
    return getJson("/api/data-management/dictionary/coverage");
  },
  entry(entityName: string, fieldName: string): Promise<DataDictionaryEntry> {
    return getJson(`/api/data-management/dictionary/${encodeURIComponent(entityName)}/${encodeURIComponent(fieldName)}`);
  },
  overview(): Promise<QualityOverviewCounts> {
    return getJson("/api/data-management/quality/overview");
  },
  rules(): Promise<{ items: DataQualityRule[] }> {
    return getJson("/api/data-management/quality/rules");
  },
  issues(params: Record<string, string | number | undefined> = {}): Promise<QualityIssuePage> {
    return getJson(`/api/data-management/quality/issues${qs(params)}`);
  },
  issue(id: string): Promise<DataQualityIssue> {
    return getJson(`/api/data-management/quality/issues/${encodeURIComponent(id)}`);
  },
  runRules(clientSubmissionId: string): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/run-rules", { clientSubmissionId });
  },
  assign(body: { issueId: string; ownerUserId: string; dueAt?: string | null; clientSubmissionId: string; expectedRowVersion: number }): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/assign-issue", body);
  },
  setStatus(body: { issueId: string; status: string; clientSubmissionId: string; expectedRowVersion: number }): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/set-issue-status", body);
  },
  waive(body: { issueId: string; reason: string; approverUserId: string; waiverExpiresAt: string; clientSubmissionId: string; expectedRowVersion: number }): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/waive-issue", body);
  },
  markFalsePositive(body: { issueId: string; note: string; clientSubmissionId: string; expectedRowVersion: number }): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/mark-false-positive", body);
  },
  verify(body: { issueId: string; verificationType: "RuleReevaluation" | "ManualApproved"; note?: string; approverUserId?: string; clientSubmissionId: string; expectedRowVersion: number }): Promise<QualityCommandOutcome> {
    return postJson("/api/data-management/quality/commands/verify-resolution", body);
  },
};

export function newSubmissionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `dm-${Date.now()}`;
}
