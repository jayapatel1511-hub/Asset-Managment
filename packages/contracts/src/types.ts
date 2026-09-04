/**
 * Shape of every entity the app reads or writes, mirroring docs/01-data-model.md's eng_* tables
 * one for one. Both api/mock/ and api/dataverse/ implement AmsBackend against these same types —
 * that is the seam that lets the mock run with zero Dataverse code paths reachable (build-order
 * Phase C DoD) and lets a real Dataverse connection replace it later with no screen changes.
 */
import type { AssetStatus, Lifecycle } from "./stateMachine";
export type { Lifecycle };
export type LocationType = "Region" | "Office" | "Site" | "Vehicle" | "CalLab" | "Client" | "Storage";
export type RetirementReason = "Sold" | "Lost" | "Damaged" | "Obsolete";
export type Condition = "Good" | "Damaged" | "NeedsService";
export type KitRole =
  | "Primary"
  | "Sensor1"
  | "Sensor2"
  | "Sensor3"
  | "Sensor4"
  | "Microphone"
  | "Modem"
  | "Cellular"
  | "Router"
  | "Accessory";
export type CalibrationResult = "Pass" | "Fail" | "Adjusted";

export interface EquipmentModel {
  manufacturer: string;
  model: string;
  equipmenttype: string;
  assetgroup: string;
  idprefix: string;
  isserialised: boolean;
  identifiertype: "Serial" | "ICCID" | "IMEI" | "None";
  defaultcalintervalmonths: number | null;
  /** Absent on staged JSON loaded before 0013 — treat as active. */
  isactive?: boolean;
}

/** Curated manufacturer — selected when creating a catalogue row (Rule 7). */
export interface Manufacturer {
  id: string;
  name: string;
  isactive: boolean;
  note?: string | null;
}

/**
 * Hierarchical equipment category (docs/08 Q21 / specs/011 EquipmentCategory).
 * Roots are the former asset groups; children are the former equipment types.
 */
export interface EquipmentCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortorder: number;
  isactive: boolean;
  note?: string | null;
}

/** Domains an administrator may maintain. People are not a reference table (docs/08 Q22). */
export type ReferenceDomain =
  | "Manufacturer"
  | "EquipmentCategory"
  | "EquipmentModel"
  | "Location"
  | "Project";

export interface ReferenceCommandBase {
  domain: ReferenceDomain;
  clientSubmissionId: string;
  reason: string;
}

export interface CreateReferenceInput extends ReferenceCommandBase {
  attributes: Record<string, unknown>;
}

export interface EditReferenceInput extends ReferenceCommandBase {
  id: string;
  attributes: Record<string, unknown>;
}

export interface DeactivateReferenceInput extends ReferenceCommandBase {
  id: string;
}

export interface ReparentLocationInput extends ReferenceCommandBase {
  id: string;
  newParentId: string | null;
}

export interface ReferenceImpactPreview {
  domain: ReferenceDomain;
  id: string;
  affectedAssetCount: number;
  reversibleClass: "Reversible" | "Compensatable" | "Irreversible";
}

export interface Location {
  id: string;
  name: string;
  locationtype: LocationType;
  parentlocation: string | null; // location NAME (not id) — matches data/reference/locations.csv
  isactive: boolean;
  note?: string | null;
}

export interface Project {
  id: string;
  projectnumber: string;
  name: string;
  status: "Active" | "Closed";
  office: string | null;
  pm: string | null;
}

export interface Asset {
  id: string; // Dataverse GUID (or staged pseudo-GUID) — the real primary key
  assetid: string; // the human-readable, immutable tag — Principle III
  migrationsource?: string | null;
  equipmentmodel: { manufacturer: string; model: string; equipmenttype: string };
  serialnumber: string | null;
  homeoffice: string | null;
  lifecycle: Lifecycle;
  status: AssetStatus;
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  parentasset: string | null;
  lastcaldate: string | null;
  nextcaldue: string | null;
  retirementreason: RetirementReason | null;
  notes: string | null;
  carrier: string | null;
  identifiervalue: string | null; // ICCID — field-secured, Office Admin+
  phonenumber: string | null; // field-secured
  staticip: string | null; // field-secured
  /** client-side only: true while a submission touching this asset is queued offline (FR-040). */
  pendingSync?: boolean;
}

export interface TransactionHeader {
  id: string;
  name: string;
  transactiontype: string;
  transactiondate: string;
  performedby: string;
  fromlocation: string | null;
  tolocation: string | null;
  fromuser: string | null;
  touser: string | null;
  fromproject: string | null;
  toproject: string | null;
  primaryasset: string | null;
  notes: string | null;
  expectedreturn: string | null;
}

export interface TransactionLine {
  id: string;
  transaction: string; // transaction id
  asset: string; // assetid (human-readable tag)
  statusbefore: AssetStatus;
  statusafter: AssetStatus;
  kitrole: KitRole | null;
  orientation: string | null;
  powersource: string | null;
  condition: Condition | null;
  processed: boolean;
  notes: string | null;
}

/** A transaction line joined back to its header, for history views (FR-033). */
export interface HistoryEntry extends TransactionLine {
  transactiondate: string;
  transactiontype: string;
  performedby: string;
  fromlocation: string | null;
  tolocation: string | null;
  fromuser: string | null;
  touser: string | null;
  fromproject: string | null;
  toproject: string | null;
}

export interface AssetRelationship {
  id: string;
  parentasset: string;
  childasset: string;
  relationshiptype: "Component" | "Kit";
  start: string;
  end: string | null;
  createdbyline: string | null;
  closedbyline: string | null;
}

export interface CalibrationRecord {
  id?: string;
  asset: string;
  calibrationdate: string;
  nextduedate: string;
  lab: string | null;
  certificatenumber: string | null;
  certificateurl: string | null;
  cost: string | null;
  result: CalibrationResult | null;
  correctedBy?: string | null;
  correctedAt?: string | null;
}

/** Feature 007 FR-007. `synthetic: false` is the safe default: the real migrated data ships no
 * manifest, so anything that cannot prove it is synthetic is treated as real. */
export interface DatasetInfo {
  synthetic: boolean;
  seed?: string;
  profile?: string;
  asOf?: string;
  generatedAt?: string;
  verified?: boolean;
  counts?: Record<string, number>;
}

/**
 * The authenticated caller, as the server resolved them. Never as the browser asserted them —
 * this shape is *received*, never sent (CLAUDE.md rule 1).
 *
 * `ReportReader` joins the three original roles for WS-W3's read-only reporting audience. The two
 * optional fields carry what Entra supplies and the dev header shortcut fakes:
 *
 *   objectId       the stable directory identity. Not the UPN — a person's UPN changes when they
 *                  marry or move office, and a cache keyed on it would silently follow them into
 *                  someone else's data. The offline partition uses this (A-TENANT).
 *   scopedOffices  which offices this caller may act in; null or absent means global. Advisory
 *                  only, for showing the right UI — the API enforces scope on every request and
 *                  does not consult anything the browser sends back.
 *
 * Both are optional so every existing construction site — `api/mock/index.ts`'s three demo users,
 * and every test fixture — stays valid without change.
 */
export interface CurrentUser {
  upn: string;
  displayName: string;
  homeoffice: string | null;
  roles: Array<"FieldUser" | "OfficeAdmin" | "SystemOwner" | "ReportReader">;
  objectId?: string;
  scopedOffices?: string[] | null;
}

export function isAdmin(user: CurrentUser): boolean {
  return user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner");
}

// ============================================================================
// Feature 005 — Deployment & Kits (WS-A). Entity shapes per
// specs/005-deployment-and-kits/contracts/ams-backend-deployment.md § Types.
// DEVIATION recorded in docs/08-decisions.md: Installation and InstallationComponent are two
// tables beyond docs/01-data-model.md's nine — a request for Jay's agreement, not a decision
// made unilaterally (CLAUDE.md § Ask before doing: "Adding a table not in
// docs/01-data-model.md"). See plan.md's Complexity Tracking for why eng_transaction +
// eng_assetrelationship alone cannot answer acceptance question 7 for a partially-recovered site.
// ============================================================================

export type Orientation = "H" | "V" | "BH" | "N" | "E" | "S" | "W";
export type PowerSource = "Battery" | "Solar" | "AC" | "External";

/** One station at one site for one project over one span of time. Dated, not current-only —
 *  acceptance question 7 asks what was installed where on a PAST date, which the source
 *  spreadsheet's current-only design could never answer. */
export interface Installation {
  id: string;
  site: string; // location NAME, locationtype "Site"
  project: string; // project number
  primaryasset: string; // assetid of the data logger — FR-009 requires one
  locationtype: LocationType;
  sitename: string;
  position: string | null; // free text by explicit decision: "POR-403", "Pier 3"
  latitude: number | null;
  longitude: number | null;
  coordinatesource: "Manual" | "Device" | null; // ASSUMPTION: FR-006
  powersource: PowerSource;
  start: string; // ISO
  end: string | null; // null = currently installed
  openedbytransaction: string;
  closedbytransaction: string | null;
  notes: string | null;
}

/** An asset's dated membership of an installation, and the role it played. Separate from
 *  AssetRelationship because a component can be swapped mid-installation (US4) — the
 *  installation continues while this row ends and a replacement row begins. */
export interface InstallationComponent {
  id: string;
  installation: string; // Installation.id
  asset: string; // assetid
  kitrole: KitRole;
  orientation: Orientation | null; // required where the role requires it — FR-004
  start: string;
  end: string | null;
  openedbyline: string | null;
  closedbyline: string | null;
}

/** Reconstruction result for US3 / FR-020 — what was on site, as at a date. */
export interface InstallationSnapshot {
  installation: Installation;
  components: Array<{ asset: string; kitrole: KitRole; orientation: Orientation | null }>;
  asOf: string;
}

// ============================================================================
// Feature 006 — Fleet Reporting (WS-B). specs/006-fleet-reporting/tasks.md T003.
// ============================================================================

export interface FleetCounts {
  byOffice: Record<string, number>;
  byAssetGroup: Record<string, number>;
  byEquipmentType: Record<string, number>;
  total: number;
  temporaryTags: number; // FR-011 — distinct from fully catalogued
  thirdPartyOwned: number; // FR-012
}

export interface CalibrationCounts {
  byOffice: Record<string, { inCalibration: number; dueSoon: number; overdue: number; unknown: number }>;
  asOf: string;
}

// ============================================================================
// Feature 003 US5 — offline queueing (WS-C). No contract doc exists for this workstream (unlike
// 005/006) — this shape is the orchestrator's own minimal design, made in Phase 0 so WS-C has a
// fixed target. `PendingSubmission` describes queue state for the UI (a "pending" badge per
// FR-040, a "needs attention" list per FR-039) — it does NOT imply the queue itself is stored in
// MockStore; api/queue/** almost certainly keeps its own persistence (its own localStorage key),
// separate from the Dataverse-mirroring MockStore, and api/mock/offline.ts's implementation of
// listPendingSubmissions() reads from there. See AmsBackend.ts for the one new method.
// ============================================================================

export type PendingSubmissionKind = "Checkout" | "Return" | "Transfer";
export type PendingSubmissionStatus = "Queued" | "Sending" | "Rejected";

export interface PendingSubmission {
  id: string;
  kind: PendingSubmissionKind;
  queuedAt: string;
  status: PendingSubmissionStatus;
  affectedAssetIds: string[];
  /** Set only when status is "Rejected" — FR-039 requires this be shown, never silently dropped. */
  rejectionReason?: string | null;
}

// ============================================================================
// Feature 004 US4 — office → administrator assignment (WS-D). No contract doc exists for this
// workstream either — orchestrator's own minimal design. FR-027a requires an office with no
// administrator to be reported as a gap rather than skipped; modelling admins as a plain array
// per office (empty = gap) makes that a query, not a separate flag to keep in sync.
// DEVIATION recorded in docs/08-decisions.md, same footing as Installation/InstallationComponent:
// this needs a table beyond docs/01-data-model.md's nine (or a column on eng_location) — a
// request for Jay's agreement, not a decision.
// ============================================================================

export interface OfficeAdminAssignment {
  office: string; // location name, locationtype "Office"
  adminUpns: string[]; // empty = FR-027a gap
}
