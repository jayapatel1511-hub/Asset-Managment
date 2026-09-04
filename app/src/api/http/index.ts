/**
 * HTTP implementation of AmsBackend — the production-shaped adapter for the local POC.
 *
 * Talks only to same-origin `/api/*` (Vite proxies it to server/ on 127.0.0.1:3001). Every
 * screen keeps importing `backend` from api/index.ts, so this file replacing the mock is a
 * one-line config change (VITE_AMS_BACKEND=http), not a rewrite — the seam AGENT-BRIEF §3.1
 * exists for.
 *
 * Contract with the offline queue (api/queue/types.ts SubmissionTransport):
 *   - `{ ok: true }`  / `{ ok: false, reason }`   the server answered — accepted or refused
 *   - throw                                        the request never reliably completed
 * So a JSON body carrying `ok` (any status code) is returned as-is; only transport failures and
 * non-JSON responses throw.
 *
 * Identity: the dev server resolves the caller from `x-ams-dev-user` (server/src/auth/devAuth.ts),
 * fed from the same localStorage key the existing RoleSwitcher writes. When Entra replaces this,
 * the header goes and a session cookie does the job; nothing else here changes.
 */
import type {
  AmsBackend,
  AssetFilter,
  CheckoutInput,
  ComponentSwapInput,
  ConfigurationChangeInput,
  DeploymentInput,
  FaultReportInput,
  RecordCalibrationInput,
  RecoveryInput,
  RegisterAssetInput,
  ReturnInput,
  SubmissionOutcome,
  TransferInput,
} from "../AmsBackend";
import type {
  Asset,
  AssetRelationship,
  CalibrationCounts,
  CalibrationRecord,
  CurrentUser,
  DatasetInfo,
  EquipmentModel,
  FleetCounts,
  HistoryEntry,
  Installation,
  InstallationSnapshot,
  Location,
  OfficeAdminAssignment,
  PendingSubmission,
  Project,
  Manufacturer,
  EquipmentCategory,
  CreateReferenceInput,
  EditReferenceInput,
  DeactivateReferenceInput,
  ReparentLocationInput,
  ReferenceImpactPreview,
  ReferenceDomain,
} from "../types";
import { getMockCurrentUserKey } from "../mock";
import { getSubmissionQueue } from "../queue";

const DEV_USER_HEADER = "x-ams-dev-user";
const CSRF_HEADER = "x-ams-csrf";
const CSRF_COOKIE = "ams_csrf";

/**
 * Thrown when the API says 401. Distinct from a network failure **on purpose**: the offline queue
 * (api/queue/types.ts) treats a throw as "this never reliably reached the server, keep it and
 * retry", which is exactly right for a dead connection and exactly wrong for an expired session —
 * a queue that retries an unauthenticated write every few seconds forever is a busy loop that
 * never succeeds. The queue can test for this and hold the submission instead.
 */
export class AuthRequiredError extends Error {
  readonly authRequired = true;
  constructor(readonly path: string) {
    super(`Not signed in (401) for ${path}. The session has expired or was never established.`);
    this.name = "AuthRequiredError";
  }
}

/** Reads a cookie the server deliberately left readable. `ams_csrf` is not a secret from this
 * page — it is the double-submit mechanism: the value must be echoed in a header, which an
 * attacker's cross-origin page can read neither from the cookie nor from the response. */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

let cachedCsrf: string | null = null;

/**
 * The CSRF token for a write. Cheap path first: the cookie. Only if that is absent — a fresh tab
 * before any sign-in, or a cookie the browser has not surfaced yet — does this cost a round trip
 * to `GET /api/auth/session`, which is the endpoint that issues it.
 *
 * Returns null rather than throwing when there is no session at all. Under the dev identity
 * provider there is no session and no CSRF requirement (the header carries no ambient authority,
 * so there is nothing for a cross-origin page to ride on); sending no token there is correct, and
 * turning it into an error would break every existing local workflow.
 */
async function csrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie) {
    cachedCsrf = fromCookie;
    return fromCookie;
  }
  if (cachedCsrf) return cachedCsrf;
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin", headers: baseHeaders(false) });
    if (!res.ok) return null;
    const body = (await res.json()) as { csrfToken: string | null };
    cachedCsrf = body.csrfToken;
    return cachedCsrf;
  } catch {
    return null;
  }
}

function baseHeaders(json: boolean): Record<string, string> {
  // The dev header is still sent. The server ignores it entirely under the OIDC provider
  // (auth/providers/), so this costs nothing there and keeps local development working unchanged.
  const h: Record<string, string> = { [DEV_USER_HEADER]: getMockCurrentUserKey() };
  if (json) h["content-type"] = "application/json";
  return h;
}

/**
 * Sends the browser to sign-in, preserving where the user was.
 *
 * Guarded so a page issuing six parallel reads does not attempt six navigations, and skipped
 * outside a browser (tests) so a 401 there surfaces as the error it is instead of a redirect that
 * cannot happen.
 */
let redirecting = false;
function goToSignIn(): void {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const returnTo = window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
}

/** Every request goes through here: same-origin credentials, so the session cookie rides along. */
function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { credentials: "same-origin", ...init });
}

async function getJson<T>(path: string): Promise<T> {
  const res = await request(path, { headers: baseHeaders(false) });
  if (res.status === 401) {
    goToSignIn();
    throw new AuthRequiredError(path);
  }
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** GET that treats 404 as "no such thing" rather than a failure. */
async function getJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await request(path, { headers: baseHeaders(false) });
  if (res.status === 404) return null;
  if (res.status === 401) {
    goToSignIn();
    throw new AuthRequiredError(path);
  }
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function send(method: "POST" | "PUT", path: string, body: unknown): Promise<SubmissionOutcome> {
  const attempt = async (token: string | null): Promise<Response> => {
    const headers = baseHeaders(true);
    if (token) headers[CSRF_HEADER] = token;
    return request(path, { method, headers, body: JSON.stringify(body) });
  };

  let res = await attempt(await csrfToken());

  // One retry, and only for a CSRF refusal. A token can go stale legitimately — the session was
  // renewed in another tab, or the app was restored from the back/forward cache with an old
  // value — and making the user redo the work for that would be gratuitous. Retrying *once* with
  // a freshly fetched token is safe because the request is idempotent by construction: it carries
  // a clientSubmissionId, so if the first attempt somehow did land, the second returns the
  // original result rather than acting twice (CLAUDE.md rule 3).
  if (res.status === 403) {
    const text = await res.clone().text();
    if (text.includes("csrf_required")) {
      cachedCsrf = null;
      res = await attempt(await csrfToken());
    }
  }

  if (res.status === 401) {
    // Deliberately NOT a redirect here. A write may be a queued command replaying in the
    // background; navigating away mid-replay would lose the user's place for a submission the
    // queue is perfectly capable of holding onto. The error says what happened; the caller
    // decides.
    throw new AuthRequiredError(path);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && "ok" in (parsed as Record<string, unknown>)) {
    return parsed as SubmissionOutcome;
  }
  throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`);
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function filterQs(filter: AssetFilter = {}): string {
  return qs({
    office: filter.office,
    status: filter.status?.length ? filter.status.join(",") : undefined,
    equipmenttype: filter.equipmenttype,
    assetgroup: filter.assetgroup,
    custodian: filter.custodian,
    project: filter.project,
    includeRetired: filter.includeRetired,
  });
}

const enc = encodeURIComponent;

export class HttpAmsBackend implements AmsBackend {
  getCurrentUser(): Promise<CurrentUser> {
    return getJson("/api/me");
  }
  getDatasetInfo(): Promise<DatasetInfo> {
    return getJson("/api/dataset");
  }

  // ---- read model (feature 001) ----
  searchAssets(query: string): Promise<Asset[]> {
    if (!query.trim()) return Promise.resolve([]);
    return getJson(`/api/assets${qs({ query })}`);
  }
  listAssets(filter?: AssetFilter): Promise<Asset[]> {
    return getJson(`/api/assets${filterQs(filter)}`);
  }
  getAsset(assetId: string): Promise<Asset | null> {
    return getJsonOrNull(`/api/assets/${enc(assetId.trim())}`);
  }
  getAssetHistory(assetId: string): Promise<HistoryEntry[]> {
    return getJson(`/api/assets/${enc(assetId)}/history`);
  }
  getAssetRelationships(assetId: string): Promise<AssetRelationship[]> {
    return getJson(`/api/assets/${enc(assetId)}/relationships`);
  }
  listLocations(): Promise<Location[]> {
    return getJson("/api/locations");
  }
  listEquipmentModels(): Promise<EquipmentModel[]> {
    return getJson("/api/equipment-models");
  }
  listProjects(): Promise<Project[]> {
    return getJson("/api/projects");
  }
  listManufacturers(): Promise<Manufacturer[]> {
    return getJson("/api/data-management/reference/Manufacturer");
  }
  listEquipmentCategories(): Promise<EquipmentCategory[]> {
    return getJson("/api/data-management/reference/EquipmentCategory");
  }
  listReference(domain: ReferenceDomain): Promise<unknown[]> {
    return getJson(`/api/data-management/reference/${enc(domain)}`);
  }
  getReference(domain: ReferenceDomain, id: string): Promise<unknown | null> {
    return getJsonOrNull(`/api/data-management/reference/${enc(domain)}/${enc(id)}`);
  }
  createReference(input: CreateReferenceInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/data-management/reference/commands/create", input);
  }
  editReference(input: EditReferenceInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/data-management/reference/commands/edit", input);
  }
  deactivateReference(input: DeactivateReferenceInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/data-management/reference/commands/deactivate", input);
  }
  reactivateReference(input: DeactivateReferenceInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/data-management/reference/commands/reactivate", input);
  }
  reparentLocation(input: ReparentLocationInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/data-management/reference/commands/reparent-location", input);
  }
  previewReferenceImpact(domain: ReferenceDomain, id: string): Promise<ReferenceImpactPreview> {
    return getJson(`/api/data-management/reference/${enc(domain)}/${enc(id)}/impact`);
  }

  // ---- calibration (feature 004) ----
  listCalibrationDue(horizonDays: number): Promise<Asset[]> {
    return getJson(`/api/calibration/due${qs({ horizonDays })}`);
  }
  getCalibrationHistory(assetId: string): Promise<CalibrationRecord[]> {
    return getJson(`/api/assets/${enc(assetId)}/calibrations`);
  }
  recordCalibration(input: RecordCalibrationInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/calibrations", input);
  }
  sendToCalibration(assetIds: string[], lab: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/SendToCalibration", { assetIds, lab, clientSubmissionId });
  }

  // ---- transactions (feature 003) ----
  submitCheckout(input: CheckoutInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/Checkout", input);
  }
  submitReturn(input: ReturnInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/Return", input);
  }
  submitTransfer(input: TransferInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/Transfer", input);
  }
  reportFault(input: FaultReportInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/ReportFault", input);
  }
  markMissing(assetId: string, notes: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/MarkMissing", { assetId, notes, clientSubmissionId });
  }
  markFound(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/Found", { assetId, clientSubmissionId });
  }
  completeRepair(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/RepairComplete", { assetId, clientSubmissionId });
  }

  // ---- admin (feature 001 US3/US5) ----
  async previewNextAssetId(manufacturer: string, model: string, equipmenttype: string, serial?: string | null): Promise<string> {
    const res = await getJson<{ assetId: string }>(`/api/assets/next-id${qs({ manufacturer, model, equipmenttype, serial: serial ?? undefined })}`);
    return res.assetId;
  }
  registerAsset(input: RegisterAssetInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/assets", input);
  }
  retireAsset(assetId: string, reason: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("POST", "/api/commands/Retire", { assetId, reason, clientSubmissionId });
  }

  // ---- deployment (feature 005) ----
  submitDeployment(input: DeploymentInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/deployments", input);
  }
  submitRecovery(input: RecoveryInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/recoveries", input);
  }
  submitComponentSwap(input: ComponentSwapInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/component-swaps", input);
  }
  submitConfigurationChange(input: ConfigurationChangeInput): Promise<SubmissionOutcome> {
    return send("POST", "/api/configuration-changes", input);
  }
  listSites(onlyCurrent?: boolean): Promise<Location[]> {
    return getJson(`/api/sites${qs({ onlyCurrent })}`);
  }
  getSiteInstallations(site: string): Promise<Installation[]> {
    return getJson(`/api/sites/${enc(site)}/installations`);
  }
  getInstallationSnapshot(installationId: string, asOf: string): Promise<InstallationSnapshot | null> {
    return getJsonOrNull(`/api/installations/${enc(installationId)}/snapshot${qs({ asOf })}`);
  }
  getAssetInstallations(assetId: string): Promise<Installation[]> {
    return getJson(`/api/assets/${enc(assetId)}/installations`);
  }

  // ---- reporting (feature 006) ----
  getFleetCounts(filter?: AssetFilter): Promise<FleetCounts> {
    return getJson(`/api/reports/fleet-counts${filterQs(filter)}`);
  }
  getCalibrationCounts(horizonDays: number): Promise<CalibrationCounts> {
    return getJson(`/api/reports/calibration-counts${qs({ horizonDays })}`);
  }

  // ---- offline queue (feature 003 US5) — device-local state, same as api/mock/offline.ts ----
  async listPendingSubmissions(): Promise<PendingSubmission[]> {
    return getSubmissionQueue()
      .list()
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        queuedAt: entry.queuedAt,
        status: entry.status,
        affectedAssetIds: entry.affectedAssetIds,
        rejectionReason: entry.rejectionReason,
      }));
  }

  // ---- office administrator assignment (feature 004 US4) ----
  listOfficeAdminAssignments(): Promise<OfficeAdminAssignment[]> {
    return getJson("/api/office-admins");
  }
  setOfficeAdmins(office: string, adminUpns: string[], clientSubmissionId: string): Promise<SubmissionOutcome> {
    return send("PUT", `/api/office-admins/${enc(office)}`, { adminUpns, clientSubmissionId });
  }
}
