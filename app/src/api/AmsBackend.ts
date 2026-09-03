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
  CalibrationCounts,
  CalibrationRecord,
  Condition,
  CurrentUser,
  DatasetInfo,
  EquipmentModel,
  FleetCounts,
  HistoryEntry,
  Installation,
  InstallationSnapshot,
  KitRole,
  LocationType,
  Location,
  OfficeAdminAssignment,
  Orientation,
  PendingSubmission,
  PowerSource,
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

// ============================================================================
// Feature 005 — Deployment & Kits (WS-A) inputs. Fixed by
// specs/005-deployment-and-kits/contracts/ams-backend-deployment.md § Inputs. Style follows the
// existing interface exactly: clientSubmissionId for idempotency, SubmissionOutcome for every
// write, offendingAssetId on a refusal that names one asset. Do not renegotiate these shapes —
// WS-A (mock) and WS-E (dataverse) both implement against them independently and in parallel.
// ============================================================================

export interface DeploymentComponentInput {
  assetId: string;
  kitRole: KitRole;
  orientation?: Orientation | null;
}

export interface DeploymentInput {
  project: string; // required — FR-002
  primaryAssetId: string; // required, must be a data logger — FR-002, FR-009
  components: DeploymentComponentInput[]; // excludes the primary; may be empty
  site: string; // existing Site location name, or a new one to create
  locationtype: LocationType; // required — FR-005
  sitename: string; // required — FR-002
  position?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinatesource?: "Manual" | "Device" | null;
  powersource: PowerSource; // required — FR-005
  deploymentDate: string; // required — FR-002; defaults to now
  notes?: string | null;
  clientSubmissionId: string;
}

export interface RecoveryComponentInput {
  assetId: string;
  /** "Recovered" returns it to the recovering user's custody; "Missing" marks it missing in the
   * same action (FR-016) rather than falsely recovering it. */
  disposition: "Recovered" | "Missing";
  condition?: Condition; // FR-017 — Damaged/NeedsService keeps it out of the pool
  notes?: string | null;
}

export interface RecoveryInput {
  installationId: string;
  components: RecoveryComponentInput[]; // subset = partial recovery (FR-012, FR-015)
  /** FR-018: when the primary is recovered but components are left behind, the caller MUST say
   * what happens to them. Backend refuses if the primary is in `components` and any remaining
   * component is absent from both `components` and this field. */
  leaveBehind?: Array<{ assetId: string; reason: string }>;
  recoveryDate: string;
  notes?: string | null;
  clientSubmissionId: string;
}

export interface ComponentSwapInput {
  installationId: string;
  outgoingAssetId: string;
  incomingAssetId: string;
  kitRole: KitRole;
  orientation?: Orientation | null;
  /** FR-024: both changes carry the same effective date, and the installation does not end. */
  effectiveDate: string;
  reason: string;
  clientSubmissionId: string;
}

export interface ConfigurationChangeInput {
  installationId: string;
  /** At least one must be present. */
  orientationChanges?: Array<{ assetId: string; orientation: Orientation }>;
  powersource?: PowerSource;
  position?: string | null;
  /** FR-027: moving the whole station to another project. */
  toproject?: string;
  effectiveDate: string;
  reason: string;
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

  /** Feature 007 FR-007: what dataset is loaded — the real migrated data, or a synthetic one,
   * with the seed and as-of date the app must display on every screen. */
  getDatasetInfo(): Promise<DatasetInfo>;

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

  // ---- deployment (feature 005, WS-A) ----
  // Signatures fixed by specs/005-deployment-and-kits/contracts/ams-backend-deployment.md.
  // Phase 0 adds them throwing "not implemented" in both api/mock/deployment.ts and
  // api/dataverse/index.ts; WS-A and WS-E each implement independently.

  /** US1. Creates one Deploy transaction with a line per asset (primary + components), one
   * Installation, and one InstallationComponent per asset. Atomic — FR-010, FR-003.
   * Refuses when: no primary (FR-009); primary is not a data logger (FR-002); any asset is not
   * held by the caller and the caller is not an admin (FR-007); any asset is already deployed
   * (FR-008); a role requiring orientation has none (FR-004); the project is inactive.
   * Creates the Site location if `site` names a new one. */
  submitDeployment(input: DeploymentInput): Promise<SubmissionOutcome>;

  /** US2. Undeploy/Return per component, closes the InstallationComponent rows and — when
   * nothing remains installed — the Installation itself with an end date (FR-014).
   * Partial recovery leaves the Installation open and accurately reflects what remains
   * (FR-015). Refuses when FR-018's leave-behind decision is missing. */
  submitRecovery(input: RecoveryInput): Promise<SubmissionOutcome>;

  /** US4. Two paired transactions on one effective date: the outgoing asset recovered, the
   * incoming asset deployed. The Installation's `start` is NOT altered (FR-026) and it never
   * shows an interruption in service. */
  submitComponentSwap(input: ComponentSwapInput): Promise<SubmissionOutcome>;

  /** US4. A dated amendment — orientation, power, position, or the whole station's project.
   * Recorded as a transaction, never as an edit (FR-025). Previous values stay in history. */
  submitConfigurationChange(input: ConfigurationChangeInput): Promise<SubmissionOutcome>;

  /** US3. Sites that have, or have ever had, an installation. `onlyCurrent` filters to those
   * with an open one. */
  listSites(onlyCurrent?: boolean): Promise<Location[]>;

  /** US3. Every installation at a site, newest first, current and historical (FR-019, FR-023 —
   * readable after the project closes). */
  getSiteInstallations(site: string): Promise<Installation[]>;

  /** US3 / FR-020. What was installed, in which roles and orientations, as at `asOf`.
   * Pure reconstruction from dated rows — the aggregate form of acceptance question 7. */
  getInstallationSnapshot(installationId: string, asOf: string): Promise<InstallationSnapshot | null>;

  /** US1 support. An asset's installations, for the deployments section of its detail screen
   * (FR-021). */
  getAssetInstallations(assetId: string): Promise<Installation[]>;

  // ---- reporting (feature 006, WS-B) ----
  // specs/006-fleet-reporting/tasks.md T003 — no contract doc (only one implementer besides
  // Dataverse), specified inline there instead of in a separate contracts/ file.

  /** US1. Totals reconciling exactly with listAssets over the same filter (SC-003) — this
   * feature holds no separate copy of the operational data (FR-030). */
  getFleetCounts(filter?: AssetFilter): Promise<FleetCounts>;

  /** US1/US2. Calibration status counts by office — in-calibration, due-soon, overdue, unknown
   * counted explicitly rather than omitted (FR-013, FR-017). */
  getCalibrationCounts(horizonDays: number): Promise<CalibrationCounts>;

  // ---- offline queue (feature 003 US5, WS-C) ----
  // No contract doc for this workstream — orchestrator's own minimal design (types.ts's
  // PendingSubmission comment explains why this is the only AmsBackend addition; the queue
  // engine itself lives in api/queue/**, which WS-C also owns and which does not need to extend
  // this interface at all since it wraps calls to the existing submit* methods).

  /** FR-039/FR-040. What's queued or rejected right now, for a "pending" badge on affected
   * assets and a "needs attention" list that never silently drops a rejected replay. */
  listPendingSubmissions(): Promise<PendingSubmission[]>;

  // ---- office administrator assignment (feature 004 US4, WS-D) ----
  // No contract doc for this workstream either — orchestrator's own minimal design. Notification
  // delivery itself needs the tenant (solution/flows/F3); this is just the assignment data and
  // the FR-027a gap report that flow needs and that this session can build without one.

  /** FR-027. Every office from the location table, each with its assigned administrators —
   * derived, not a fixed file (data/reference/office_admins.csv is superseded, see its README).
   * An office with an empty adminUpns array is a gap (FR-027a), not omitted. */
  listOfficeAdminAssignments(): Promise<OfficeAdminAssignment[]>;

  /** Replaces the full admin list for one office. Reference data an admin maintains directly —
   * not asset current-state, so this is not a Principle I violation the way writing eng_asset
   * fields directly would be. */
  setOfficeAdmins(office: string, adminUpns: string[], clientSubmissionId: string): Promise<SubmissionOutcome>;
}

// ============================================================================
// Per-domain method subsets — the seam that lets api/mock/index.ts split into per-domain modules
// (AGENT-BRIEF.md §5) without splitting the AmsBackend interface itself. Each workstream owns
// exactly one of these factory shapes; api/mock/index.ts composes all of them into one
// MockAmsBackend and is otherwise a thin wiring file, frozen alongside this one after Phase 0.
// ============================================================================

export type DeploymentMethods = Pick<
  AmsBackend,
  | "submitDeployment"
  | "submitRecovery"
  | "submitComponentSwap"
  | "submitConfigurationChange"
  | "listSites"
  | "getSiteInstallations"
  | "getInstallationSnapshot"
  | "getAssetInstallations"
>;

export type ReportingMethods = Pick<AmsBackend, "getFleetCounts" | "getCalibrationCounts">;

export type OfflineMethods = Pick<AmsBackend, "listPendingSubmissions">;

export type AdminAssignmentMethods = Pick<AmsBackend, "listOfficeAdminAssignments" | "setOfficeAdmins">;
