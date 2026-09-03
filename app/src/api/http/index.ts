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
} from "../types";
import { getMockCurrentUserKey } from "../mock";
import { getSubmissionQueue } from "../queue";

const DEV_USER_HEADER = "x-ams-dev-user";

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = { [DEV_USER_HEADER]: getMockCurrentUserKey() };
  if (json) h["content-type"] = "application/json";
  return h;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers(false) });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** GET that treats 404 as "no such thing" rather than a failure. */
async function getJsonOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(path, { headers: headers(false) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function send(method: "POST" | "PUT", path: string, body: unknown): Promise<SubmissionOutcome> {
  const res = await fetch(path, { method, headers: headers(true), body: JSON.stringify(body) });
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
