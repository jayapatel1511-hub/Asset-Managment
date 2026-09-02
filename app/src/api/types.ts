/**
 * Shape of every entity the app reads or writes, mirroring docs/01-data-model.md's eng_* tables
 * one for one. Both api/mock/ and api/dataverse/ implement AmsBackend against these same types —
 * that is the seam that lets the mock run with zero Dataverse code paths reachable (build-order
 * Phase C DoD) and lets a real Dataverse connection replace it later with no screen changes.
 */
import type { AssetStatus } from "../domain/stateMachine";

export type Lifecycle = "Active" | "Retired";
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

export interface CurrentUser {
  upn: string;
  displayName: string;
  homeoffice: string | null;
  roles: Array<"FieldUser" | "OfficeAdmin" | "SystemOwner">;
}

export function isAdmin(user: CurrentUser): boolean {
  return user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner");
}
