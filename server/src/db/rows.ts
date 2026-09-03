/**
 * Row <-> app type mapping. Column names equal the app's field names wherever PostgreSQL allows
 * (start/end are reserved words, so those two become start_at/end_at; a transaction line's
 * `transaction` becomes transaction_id). Keeping the mapping in one file means the SQL layer can
 * change without any screen noticing — the same seam discipline as api/index.ts.
 */
import type {
  Asset,
  AssetRelationship,
  CalibrationRecord,
  EquipmentModel,
  HistoryEntry,
  Installation,
  InstallationComponent,
  Location,
  Project,
  TransactionHeader,
  TransactionLine,
} from "../../../app/src/api/types";
import type { AssetStatus } from "../../../app/src/domain/stateMachine";

// ---------------------------------------------------------------- asset

export const ASSET_COLUMNS = [
  "id", "assetid", "migrationsource", "manufacturer", "model", "equipmenttype", "serialnumber", "homeoffice",
  "lifecycle", "status", "currentlocation", "custodian", "currentproject", "parentasset", "lastcaldate",
  "nextcaldue", "retirementreason", "notes", "carrier", "identifiervalue", "phonenumber", "staticip",
] as const;

export interface AssetRow {
  id: string;
  assetid: string;
  migrationsource: string | null;
  manufacturer: string;
  model: string;
  equipmenttype: string;
  serialnumber: string | null;
  homeoffice: string | null;
  lifecycle: "Active" | "Retired";
  status: AssetStatus;
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  parentasset: string | null;
  lastcaldate: string | null;
  nextcaldue: string | null;
  retirementreason: string | null;
  notes: string | null;
  carrier: string | null;
  identifiervalue: string | null;
  phonenumber: string | null;
  staticip: string | null;
  row_version?: number;
}

export function assetFromRow(r: AssetRow): Asset {
  return {
    id: r.id,
    assetid: r.assetid,
    migrationsource: r.migrationsource,
    equipmentmodel: { manufacturer: r.manufacturer, model: r.model, equipmenttype: r.equipmenttype },
    serialnumber: r.serialnumber,
    homeoffice: r.homeoffice,
    lifecycle: r.lifecycle,
    status: r.status,
    currentlocation: r.currentlocation,
    custodian: r.custodian,
    currentproject: r.currentproject,
    parentasset: r.parentasset,
    lastcaldate: r.lastcaldate,
    nextcaldue: r.nextcaldue,
    retirementreason: r.retirementreason as Asset["retirementreason"],
    notes: r.notes,
    carrier: r.carrier,
    identifiervalue: r.identifiervalue,
    phonenumber: r.phonenumber,
    staticip: r.staticip,
  };
}

export function assetToValues(a: Asset): unknown[] {
  return [
    a.id, a.assetid, a.migrationsource ?? null, a.equipmentmodel.manufacturer, a.equipmentmodel.model,
    a.equipmentmodel.equipmenttype, a.serialnumber, a.homeoffice, a.lifecycle, a.status, a.currentlocation,
    a.custodian, a.currentproject, a.parentasset, a.lastcaldate, a.nextcaldue, a.retirementreason, a.notes,
    a.carrier, a.identifiervalue, a.phonenumber, a.staticip,
  ];
}

// ---------------------------------------------------------------- transaction header + line

export const HEADER_COLUMNS = [
  "id", "name", "transactiontype", "transactiondate", "performedby", "fromlocation", "tolocation", "fromuser",
  "touser", "fromproject", "toproject", "primaryasset", "notes", "expectedreturn", "client_submission_id", "recorded_at",
] as const;

export interface HeaderRow extends TransactionHeader {
  client_submission_id: string | null;
  recorded_at: string;
}

export function headerFromRow(r: HeaderRow): TransactionHeader {
  return {
    id: r.id, name: r.name, transactiontype: r.transactiontype, transactiondate: r.transactiondate,
    performedby: r.performedby, fromlocation: r.fromlocation, tolocation: r.tolocation, fromuser: r.fromuser,
    touser: r.touser, fromproject: r.fromproject, toproject: r.toproject, primaryasset: r.primaryasset,
    notes: r.notes, expectedreturn: r.expectedreturn,
  };
}

export function headerToValues(h: TransactionHeader, clientSubmissionId: string | null, recordedAt: string): unknown[] {
  return [
    h.id, h.name, h.transactiontype, h.transactiondate, h.performedby, h.fromlocation, h.tolocation, h.fromuser,
    h.touser, h.fromproject, h.toproject, h.primaryasset, h.notes, h.expectedreturn, clientSubmissionId, recordedAt,
  ];
}

export const LINE_COLUMNS = [
  "id", "transaction_id", "asset", "statusbefore", "statusafter", "kitrole", "orientation", "powersource",
  "condition", "processed", "notes", "line_number",
] as const;

export interface LineRow {
  id: string;
  transaction_id: string;
  asset: string;
  statusbefore: AssetStatus;
  statusafter: AssetStatus;
  kitrole: string | null;
  orientation: string | null;
  powersource: string | null;
  condition: string | null;
  processed: boolean;
  notes: string | null;
  line_number: number;
}

export function lineFromRow(r: LineRow): TransactionLine {
  return {
    id: r.id, transaction: r.transaction_id, asset: r.asset, statusbefore: r.statusbefore, statusafter: r.statusafter,
    kitrole: r.kitrole as TransactionLine["kitrole"], orientation: r.orientation, powersource: r.powersource,
    condition: r.condition as TransactionLine["condition"], processed: r.processed, notes: r.notes,
  };
}

export function lineToValues(l: TransactionLine, lineNumber: number): unknown[] {
  return [
    l.id, l.transaction, l.asset, l.statusbefore, l.statusafter, l.kitrole, l.orientation, l.powersource,
    l.condition, l.processed, l.notes, lineNumber,
  ];
}

export type HistoryRow = LineRow &
  Pick<TransactionHeader, "transactiondate" | "transactiontype" | "performedby" | "fromlocation" | "tolocation" | "fromuser" | "touser" | "fromproject" | "toproject">;

export function historyFromRow(r: HistoryRow): HistoryEntry {
  return {
    ...lineFromRow(r),
    transactiondate: r.transactiondate,
    transactiontype: r.transactiontype,
    performedby: r.performedby,
    fromlocation: r.fromlocation,
    tolocation: r.tolocation,
    fromuser: r.fromuser,
    touser: r.touser,
    fromproject: r.fromproject,
    toproject: r.toproject,
  };
}

// ---------------------------------------------------------------- relationship

export const RELATIONSHIP_COLUMNS = [
  "id", "parentasset", "childasset", "relationshiptype", "start_at", "end_at", "createdbyline", "closedbyline",
] as const;

export interface RelationshipRow {
  id: string;
  parentasset: string;
  childasset: string;
  relationshiptype: "Component" | "Kit";
  start_at: string;
  end_at: string | null;
  createdbyline: string | null;
  closedbyline: string | null;
}

export function relationshipFromRow(r: RelationshipRow): AssetRelationship {
  return {
    id: r.id, parentasset: r.parentasset, childasset: r.childasset, relationshiptype: r.relationshiptype,
    start: r.start_at, end: r.end_at, createdbyline: r.createdbyline, closedbyline: r.closedbyline,
  };
}

export function relationshipToValues(r: AssetRelationship): unknown[] {
  return [r.id, r.parentasset, r.childasset, r.relationshiptype, r.start, r.end, r.createdbyline, r.closedbyline];
}

// ---------------------------------------------------------------- calibration

export const CALIBRATION_COLUMNS = [
  "id", "asset", "calibrationdate", "nextduedate", "lab", "certificatenumber", "certificateurl", "cost", "result",
  "corrected_by", "corrected_at",
] as const;

export interface CalibrationRow {
  id: string;
  asset: string;
  calibrationdate: string | null;
  nextduedate: string;
  lab: string | null;
  certificatenumber: string | null;
  certificateurl: string | null;
  cost: string | null;
  result: string | null;
  corrected_by: string | null;
  corrected_at: string | null;
}

export function calibrationFromRow(r: CalibrationRow): CalibrationRecord {
  return {
    id: r.id, asset: r.asset, calibrationdate: r.calibrationdate ?? "", nextduedate: r.nextduedate, lab: r.lab,
    certificatenumber: r.certificatenumber, certificateurl: r.certificateurl, cost: r.cost,
    result: r.result as CalibrationRecord["result"], correctedBy: r.corrected_by, correctedAt: r.corrected_at,
  };
}

export function calibrationToValues(c: CalibrationRecord & { id: string }): unknown[] {
  return [
    c.id, c.asset, c.calibrationdate || null, c.nextduedate, c.lab, c.certificatenumber, c.certificateurl, c.cost,
    c.result, c.correctedBy ?? null, c.correctedAt ?? null,
  ];
}

// ---------------------------------------------------------------- reference data

export const LOCATION_COLUMNS = ["id", "name", "locationtype", "parentlocation", "isactive", "note"] as const;
export type LocationRow = Location;
export function locationFromRow(r: LocationRow): Location {
  return { id: r.id, name: r.name, locationtype: r.locationtype, parentlocation: r.parentlocation, isactive: r.isactive, note: r.note ?? null };
}
export function locationToValues(l: Location): unknown[] {
  return [l.id, l.name, l.locationtype, l.parentlocation, l.isactive, l.note ?? null];
}

export const MODEL_COLUMNS = [
  "manufacturer", "model", "equipmenttype", "assetgroup", "idprefix", "isserialised", "identifiertype",
  "defaultcalintervalmonths", "name",
] as const;
export type ModelRow = EquipmentModel & { name: string | null };
/** The staged catalogue carries a display `name` beyond the EquipmentModel type; passed through
 * exactly as the mock does (it returns the JSON rows verbatim). */
export function modelFromRow(r: ModelRow): EquipmentModel & { name?: string } {
  return {
    manufacturer: r.manufacturer, model: r.model, equipmenttype: r.equipmenttype, assetgroup: r.assetgroup,
    idprefix: r.idprefix, isserialised: r.isserialised, identifiertype: r.identifiertype,
    defaultcalintervalmonths: r.defaultcalintervalmonths, ...(r.name ? { name: r.name } : {}),
  };
}
export function modelToValues(m: EquipmentModel & { name?: string }): unknown[] {
  return [
    m.manufacturer, m.model, m.equipmenttype, m.assetgroup, m.idprefix, m.isserialised, m.identifiertype,
    m.defaultcalintervalmonths, m.name ?? null,
  ];
}

export const PROJECT_COLUMNS = ["id", "projectnumber", "name", "status", "office", "pm"] as const;
export type ProjectRow = Project;
export function projectFromRow(r: ProjectRow): Project {
  return { id: r.id, projectnumber: r.projectnumber, name: r.name, status: r.status, office: r.office, pm: r.pm };
}
export function projectToValues(p: Project): unknown[] {
  return [p.id, p.projectnumber, p.name, p.status, p.office, p.pm];
}

// ---------------------------------------------------------------- installations

export const INSTALLATION_COLUMNS = [
  "id", "site", "project", "primaryasset", "locationtype", "sitename", "position", "latitude", "longitude",
  "coordinatesource", "powersource", "start_at", "end_at", "openedbytransaction", "closedbytransaction", "notes",
] as const;

export interface InstallationRow extends Omit<Installation, "start" | "end"> {
  start_at: string;
  end_at: string | null;
}

export function installationFromRow(r: InstallationRow): Installation {
  return {
    id: r.id, site: r.site, project: r.project, primaryasset: r.primaryasset, locationtype: r.locationtype,
    sitename: r.sitename, position: r.position, latitude: r.latitude, longitude: r.longitude,
    coordinatesource: r.coordinatesource, powersource: r.powersource, start: r.start_at, end: r.end_at,
    openedbytransaction: r.openedbytransaction, closedbytransaction: r.closedbytransaction, notes: r.notes,
  };
}

export function installationToValues(i: Installation): unknown[] {
  return [
    i.id, i.site, i.project, i.primaryasset, i.locationtype, i.sitename, i.position, i.latitude, i.longitude,
    i.coordinatesource, i.powersource, i.start, i.end, i.openedbytransaction, i.closedbytransaction, i.notes,
  ];
}

export const COMPONENT_COLUMNS = [
  "id", "installation", "asset", "kitrole", "orientation", "start_at", "end_at", "openedbyline", "closedbyline",
] as const;

export interface ComponentRow extends Omit<InstallationComponent, "start" | "end"> {
  start_at: string;
  end_at: string | null;
}

export function componentFromRow(r: ComponentRow): InstallationComponent {
  return {
    id: r.id, installation: r.installation, asset: r.asset, kitrole: r.kitrole, orientation: r.orientation,
    start: r.start_at, end: r.end_at, openedbyline: r.openedbyline, closedbyline: r.closedbyline,
  };
}

export function componentToValues(c: InstallationComponent): unknown[] {
  return [c.id, c.installation, c.asset, c.kitrole, c.orientation, c.start, c.end, c.openedbyline, c.closedbyline];
}

// ---------------------------------------------------------------- bulk insert helper

/** Multi-row INSERT in chunks (200 rows × ~20 columns stays far under PostgreSQL's 65,535
 * bind-parameter limit). Column lists come from the constants above so a schema change is a
 * one-place edit. */
export async function insertRows(
  db: { query<T>(q: string, params?: unknown[]): Promise<{ rows: T[] }> },
  table: string,
  columns: readonly string[],
  rows: unknown[][],
  chunk = 200
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = slice
      .map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`)
      .join(",");
    await db.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values}`, params);
  }
}
