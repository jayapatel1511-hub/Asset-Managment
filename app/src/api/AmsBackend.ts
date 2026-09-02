/**
 * AmsBackend — the one interface every screen talks to. Two implementations exist:
 *   api/mock/       loads migration/staged/ (via public/data/), applies deriveState on write,
 *                    persists to localStorage. Zero Dataverse code paths.
 *   api/dataverse/  Power Apps SDK, every file marked // DATAVERSE-ONLY. Not reachable from this
 *                    session (no tenant access) — present as typed stubs so the seam is real.
 *
 * Selected by VITE_AMS_BACKEND (see api/index.ts). No screen imports api/mock or api/dataverse
 * directly — only api/index.ts does, which is what makes swapping the data source a config
 * change instead of a rewrite (constitution's SharePoint-Lists fallback depends on this seam
 * existing at the app layer too, not just in the schema).
 */
import type {
  Asset,
  AssetRelationship,
  CalibrationRecord,
  CurrentUser,
  EquipmentModel,
  HistoryEntry,
  Location,
  Project,
} from "./types";

export interface AssetFilter {
  office?: string;
  status?: string[];
  equipmenttype?: string;
  assetgroup?: string;
  custodian?: string; // upn
  project?: string; // project number
  includeRetired?: boolean;
}

export interface CartLine {
  assetId: string;
  kitRole?: string;
  orientation?: string;
  powerSource?: string;
  condition?: "Good" | "Damaged" | "NeedsService";
}

export interface CheckoutInput {
  lines: CartLine[];
  primaryAssetId?: string;
  project: string; // required — FR-008
  touser?: string; // defaults to current user
  expectedReturn?: string | null;
  notes?: string | null;
  clientSubmissionId: string; // idempotency key — FR-007
}

export interface ReturnInput {
  lines: CartLine[]; // condition set per line
  tolocation?: string; // defaults to current user's office — FR-010
  notes?: string | null;
  clientSubmissionId: string;
}

export interface TransferInput {
  assetIds: string[];
  touser?: string | null;
  tolocation?: string | null;
  toproject?: string | null;
  reason: string; // required — FR-009
  notes?: string | null;
  clientSubmissionId: string;
}

export interface FaultReportInput {
  assetId: string;
  notes: string;
  clientSubmissionId: string;
}

export interface RegisterAssetInput {
  manufacturer: string;
  model: string;
  /** manufacturer+model alone does not always identify one catalogue row — e.g. "Instantel
   * Micromate" is a data logger, its geophone sibling AND its microphone accessory. */
  equipmenttype: string;
  serial?: string | null;
  homeoffice: string;
  notes?: string | null;
  clientSubmissionId: string;
}

export interface RecordCalibrationInput {
  assetId: string;
  calibrationdate: string;
  nextduedate?: string | null; // required only when the model has no interval — FR-010 (004)
  lab?: string | null;
  certificatenumber?: string | null;
  cost?: string | null;
  result?: "Pass" | "Fail" | "Adjusted" | null;
  clientSubmissionId: string;
}

export interface SubmissionResult {
  ok: true;
  transactionId: string;
  transactionName: string;
}

export interface SubmissionError {
  ok: false;
  reason: string;
  /** Set when the refusal is "an asset in the cart changed since it was added" (FR-023) — names
   * exactly which asset, so the UI can point at it rather than show a generic error. */
  offendingAssetId?: string;
}

export type SubmissionOutcome = SubmissionResult | SubmissionError;

export interface AmsBackend {
  getCurrentUser(): Promise<CurrentUser>;

  // ---- read model (feature 001) ----
  searchAssets(query: string): Promise<Asset[]>;
  listAssets(filter?: AssetFilter): Promise<Asset[]>;
  getAsset(assetId: string): Promise<Asset | null>;
  getAssetHistory(assetId: string): Promise<HistoryEntry[]>;
  getAssetRelationships(assetId: string): Promise<AssetRelationship[]>;
  listLocations(): Promise<Location[]>;
  listEquipmentModels(): Promise<EquipmentModel[]>;
  listProjects(): Promise<Project[]>;

  // ---- calibration (feature 004) ----
  listCalibrationDue(horizonDays: number): Promise<Asset[]>;
  getCalibrationHistory(assetId: string): Promise<CalibrationRecord[]>;
  recordCalibration(input: RecordCalibrationInput): Promise<SubmissionOutcome>;
  /** FR-021/FR-022: despatch one or more assets to a lab in a single action, through the same
   * transaction mechanism as every other state change (FR-026) — not a status edit. */
  sendToCalibration(assetIds: string[], lab: string, clientSubmissionId: string): Promise<SubmissionOutcome>;

  // ---- transactions (feature 003) ----
  submitCheckout(input: CheckoutInput): Promise<SubmissionOutcome>;
  submitReturn(input: ReturnInput): Promise<SubmissionOutcome>;
  submitTransfer(input: TransferInput): Promise<SubmissionOutcome>;
  reportFault(input: FaultReportInput): Promise<SubmissionOutcome>;
  markMissing(assetId: string, notes: string, clientSubmissionId: string): Promise<SubmissionOutcome>;
  markFound(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome>;
  completeRepair(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome>;

  // ---- admin (feature 001 US3/US5) ----
  previewNextAssetId(manufacturer: string, model: string, equipmenttype: string, serial?: string | null): Promise<string>;
  registerAsset(input: RegisterAssetInput): Promise<SubmissionOutcome>;
  retireAsset(assetId: string, reason: string, clientSubmissionId: string): Promise<SubmissionOutcome>;
}
