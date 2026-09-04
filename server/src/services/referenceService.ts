/**
 * Named reference-data commands (Rule 7 second clause, FR-018–FR-021).
 *
 * Create / edit / deactivate / reactivate — never ordinary delete. Field-specific validation
 * lives with each domain; there is no generic row editor. The browser may propose attributes;
 * this file decides whether they are valid and whether the caller may apply them.
 *
 * People are not a reference table (docs/08 Q22, specs/011). Manufacturer and EquipmentCategory
 * are the curated lists that make manufacturer / asset group / equipment type selected, not typed.
 */
import { randomUUID } from "node:crypto";
import type { SubmissionOutcome } from "../../../packages/contracts/src/backend";
import type {
  CreateReferenceInput,
  DeactivateReferenceInput,
  EditReferenceInput,
  EquipmentCategory,
  EquipmentModel,
  Location,
  Manufacturer,
  Project,
  ReferenceDomain,
  ReferenceImpactPreview,
  ReparentLocationInput,
} from "../../../packages/contracts/src/types";
import type { CurrentUser, LocationType } from "../../../app/src/api/types";
import type { Queryable } from "../db/pglite";
import { refuse } from "./transactionService";

const LOCATION_TYPES: readonly LocationType[] = ["Region", "Office", "Site", "Vehicle", "CalLab", "Client", "Storage"];
const IDENTIFIER_TYPES = ["Serial", "ICCID", "IMEI", "None"] as const;

export const REFERENCE_DOMAINS: readonly ReferenceDomain[] = [
  "Manufacturer",
  "EquipmentCategory",
  "EquipmentModel",
  "Location",
  "Project",
];

export function isReferenceDomain(value: string): value is ReferenceDomain {
  return (REFERENCE_DOMAINS as readonly string[]).includes(value);
}

function text(value: unknown, field: string): string | SubmissionOutcome {
  if (typeof value !== "string" || !value.trim()) {
    return refuse(`reference.invalidField: ${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function accepted(id: string, name: string): SubmissionOutcome {
  return { ok: true, transactionId: id, transactionName: name };
}

function modelId(manufacturer: string, model: string, equipmenttype: string): string {
  return `${manufacturer}|${model}|${equipmenttype}`;
}

function parseModelId(id: string): { manufacturer: string; model: string; equipmenttype: string } | null {
  const parts = id.split("|");
  if (parts.length < 3) return null;
  return { manufacturer: parts[0], model: parts.slice(1, -1).join("|"), equipmenttype: parts[parts.length - 1] };
}

async function officeOfLocation(tx: Queryable, name: string): Promise<string | null> {
  const res = await tx.query<{ name: string; locationtype: string }>(
    "SELECT name, locationtype FROM location WHERE lower(name) = lower($1) LIMIT 1",
    [name]
  );
  const row = res.rows[0];
  if (!row) return null;
  return row.locationtype === "Office" ? row.name : null;
}

function refuseIfOutOfScope(user: CurrentUser, office: string | null): SubmissionOutcome | null {
  if (!office) return null;
  if (user.roles.includes("SystemOwner")) return null;
  const scoped = user.scopedOffices;
  const allowed = scoped === undefined || scoped === null
    ? user.homeoffice
      ? [user.homeoffice]
      : null
    : scoped;
  if (allowed === null) return null;
  if (allowed.some((o) => o.toLowerCase() === office.toLowerCase())) return null;
  return refuse(`reference.forbidden: This account is not scoped to administer ${office}.`);
}

// ---------------------------------------------------------------- reads

export async function listManufacturers(tx: Queryable): Promise<Manufacturer[]> {
  const res = await tx.query<Manufacturer>(
    "SELECT id, name, isactive, note FROM manufacturer ORDER BY name"
  );
  return res.rows.map((r) => ({ ...r, note: r.note ?? null }));
}

export async function listEquipmentCategories(tx: Queryable): Promise<EquipmentCategory[]> {
  const res = await tx.query<{
    id: string;
    name: string;
    parent_id: string | null;
    sortorder: number;
    isactive: boolean;
    note: string | null;
  }>("SELECT id, name, parent_id, sortorder, isactive, note FROM equipment_category ORDER BY sortorder, name");
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    sortorder: r.sortorder,
    isactive: r.isactive,
    note: r.note ?? null,
  }));
}

export async function listReference(tx: Queryable, domain: ReferenceDomain): Promise<unknown[]> {
  switch (domain) {
    case "Manufacturer":
      return listManufacturers(tx);
    case "EquipmentCategory":
      return listEquipmentCategories(tx);
    case "EquipmentModel": {
      const res = await tx.query<EquipmentModel & { name: string | null; isactive: boolean }>(
        "SELECT manufacturer, model, equipmenttype, assetgroup, idprefix, isserialised, identifiertype, defaultcalintervalmonths, name, isactive FROM equipment_model ORDER BY manufacturer, model, equipmenttype"
      );
      return res.rows.map((r) => ({ ...r, isactive: r.isactive !== false }));
    }
    case "Location": {
      const res = await tx.query<Location>("SELECT id, name, locationtype, parentlocation, isactive, note FROM location ORDER BY name");
      return res.rows;
    }
    case "Project": {
      const res = await tx.query<Project>("SELECT id, projectnumber, name, status, office, pm FROM project ORDER BY projectnumber");
      return res.rows;
    }
  }
}

export async function getReference(tx: Queryable, domain: ReferenceDomain, id: string): Promise<unknown | null> {
  const rows = await listReference(tx, domain);
  return rows.find((row) => referenceId(domain, row) === id) ?? null;
}

export function referenceId(domain: ReferenceDomain, row: unknown): string {
  const r = row as Record<string, unknown>;
  if (domain === "EquipmentModel") {
    return modelId(String(r.manufacturer), String(r.model), String(r.equipmenttype));
  }
  if (domain === "Project") return String(r.id ?? r.projectnumber);
  return String(r.id);
}

export async function previewImpact(tx: Queryable, domain: ReferenceDomain, id: string): Promise<ReferenceImpactPreview> {
  let affectedAssetCount = 0;
  if (domain === "Manufacturer") {
    const res = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM asset WHERE manufacturer = $1", [id]);
    affectedAssetCount = Number(res.rows[0]?.n ?? 0);
  } else if (domain === "EquipmentCategory") {
    const cat = await tx.query<{ name: string; parent_id: string | null }>(
      "SELECT name, parent_id FROM equipment_category WHERE id = $1",
      [id]
    );
    const row = cat.rows[0];
    if (row?.parent_id) {
      const res = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM asset WHERE equipmenttype = $1", [row.name]);
      affectedAssetCount = Number(res.rows[0]?.n ?? 0);
    } else if (row) {
      const res = await tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM asset a JOIN equipment_model m ON m.manufacturer = a.manufacturer AND m.model = a.model AND m.equipmenttype = a.equipmenttype WHERE m.assetgroup = $1",
        [row.name]
      );
      affectedAssetCount = Number(res.rows[0]?.n ?? 0);
    }
  } else if (domain === "EquipmentModel") {
    const key = parseModelId(id);
    if (key) {
      const res = await tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM asset WHERE manufacturer = $1 AND model = $2 AND equipmenttype = $3",
        [key.manufacturer, key.model, key.equipmenttype]
      );
      affectedAssetCount = Number(res.rows[0]?.n ?? 0);
    }
  } else if (domain === "Location") {
    const loc = await tx.query<{ name: string }>("SELECT name FROM location WHERE id = $1 OR name = $1 LIMIT 1", [id]);
    const name = loc.rows[0]?.name ?? id;
    const res = await tx.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM asset WHERE homeoffice = $1 OR currentlocation = $1",
      [name]
    );
    affectedAssetCount = Number(res.rows[0]?.n ?? 0);
  } else if (domain === "Project") {
    const proj = await tx.query<{ projectnumber: string }>(
      "SELECT projectnumber FROM project WHERE id = $1 OR projectnumber = $1 LIMIT 1",
      [id]
    );
    const number = proj.rows[0]?.projectnumber ?? id;
    const res = await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM asset WHERE currentproject = $1", [number]);
    affectedAssetCount = Number(res.rows[0]?.n ?? 0);
  }
  return {
    domain,
    id,
    affectedAssetCount,
    reversibleClass: "Reversible",
  };
}

// ---------------------------------------------------------------- commands

export async function createReference(
  tx: Queryable,
  user: CurrentUser,
  input: CreateReferenceInput
): Promise<SubmissionOutcome> {
  switch (input.domain) {
    case "Manufacturer":
      return createManufacturer(tx, input.attributes);
    case "EquipmentCategory":
      return createCategory(tx, input.attributes);
    case "EquipmentModel":
      return createModel(tx, input.attributes);
    case "Location":
      return createLocation(tx, user, input.attributes);
    case "Project":
      return createProject(tx, user, input.attributes);
  }
}

export async function editReference(
  tx: Queryable,
  user: CurrentUser,
  input: EditReferenceInput
): Promise<SubmissionOutcome> {
  switch (input.domain) {
    case "Manufacturer":
      return editManufacturer(tx, input.id, input.attributes);
    case "EquipmentCategory":
      return editCategory(tx, input.id, input.attributes);
    case "EquipmentModel":
      return editModel(tx, input.id, input.attributes);
    case "Location":
      return editLocation(tx, user, input.id, input.attributes);
    case "Project":
      return editProject(tx, user, input.id, input.attributes);
  }
}

export async function deactivateReference(
  tx: Queryable,
  user: CurrentUser,
  input: DeactivateReferenceInput
): Promise<SubmissionOutcome> {
  return setActive(tx, user, input.domain, input.id, false);
}

export async function reactivateReference(
  tx: Queryable,
  user: CurrentUser,
  input: DeactivateReferenceInput
): Promise<SubmissionOutcome> {
  return setActive(tx, user, input.domain, input.id, true);
}

export async function reparentLocation(
  tx: Queryable,
  user: CurrentUser,
  input: ReparentLocationInput
): Promise<SubmissionOutcome> {
  const loc = await tx.query<{ id: string; name: string; locationtype: string; parentlocation: string | null }>(
    "SELECT id, name, locationtype, parentlocation FROM location WHERE id = $1 OR name = $1 LIMIT 1",
    [input.id]
  );
  const row = loc.rows[0];
  if (!row) return refuse("reference.notFound: No such location.");
  const scoped = refuseIfOutOfScope(user, row.locationtype === "Office" ? row.name : null);
  if (scoped) return scoped;

  let newParentName: string | null = null;
  if (input.newParentId) {
    const parent = await tx.query<{ id: string; name: string }>(
      "SELECT id, name FROM location WHERE id = $1 OR name = $1 LIMIT 1",
      [input.newParentId]
    );
    if (!parent.rows[0]) return refuse("reference.notFound: New parent is not a known location.");
    newParentName = parent.rows[0].name;
    if (await wouldCycle(tx, row.name, newParentName)) {
      return refuse("reference.cycle: That parent would create a location cycle.");
    }
  }

  await tx.query("UPDATE location SET parentlocation = $1 WHERE id = $2", [newParentName, row.id]);
  return accepted(row.id, row.name);
}

export function deleteForbidden(): SubmissionOutcome {
  return refuse("reference.deleteForbidden: Referenced records are deactivated, not deleted.");
}

// ---------------------------------------------------------------- per-domain create / edit

async function createManufacturer(tx: Queryable, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const name = text(attributes.name, "name");
  if (typeof name !== "string") return name;
  const existing = await tx.query<{ id: string }>("SELECT id FROM manufacturer WHERE lower(name) = lower($1)", [name]);
  if (existing.rows[0]) return refuse(`reference.duplicateKey: A manufacturer named ${name} already exists.`);
  const id = name;
  await tx.query("INSERT INTO manufacturer (id, name, note) VALUES ($1, $2, $3)", [id, name, optionalText(attributes.note)]);
  return accepted(id, name);
}

async function editManufacturer(tx: Queryable, id: string, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const row = await tx.query<{ id: string; name: string }>("SELECT id, name FROM manufacturer WHERE id = $1", [id]);
  if (!row.rows[0]) return refuse("reference.notFound: No such manufacturer.");
  const name = attributes.name !== undefined ? text(attributes.name, "name") : row.rows[0].name;
  if (typeof name !== "string") return name;
  const clash = await tx.query<{ id: string }>(
    "SELECT id FROM manufacturer WHERE lower(name) = lower($1) AND id <> $2",
    [name, id]
  );
  if (clash.rows[0]) return refuse(`reference.duplicateKey: A manufacturer named ${name} already exists.`);
  await tx.query("UPDATE manufacturer SET name = $1, note = COALESCE($2, note) WHERE id = $3", [
    name,
    optionalText(attributes.note),
    id,
  ]);
  return accepted(id, name);
}

async function createCategory(tx: Queryable, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const name = text(attributes.name, "name");
  if (typeof name !== "string") return name;
  const parentId = optionalText(attributes.parentId);
  if (parentId) {
    const parent = await tx.query<{ id: string; isactive: boolean }>(
      "SELECT id, isactive FROM equipment_category WHERE id = $1",
      [parentId]
    );
    if (!parent.rows[0]) return refuse("reference.notFound: Parent category does not exist.");
    if (!parent.rows[0].isactive) return refuse("reference.inactiveNotSelectable: Parent category is deactivated.");
  }
  const clash = parentId
    ? await tx.query<{ id: string }>(
        "SELECT id FROM equipment_category WHERE parent_id = $1 AND lower(name) = lower($2)",
        [parentId, name]
      )
    : await tx.query<{ id: string }>(
        "SELECT id FROM equipment_category WHERE parent_id IS NULL AND lower(name) = lower($1)",
        [name]
      );
  if (clash.rows[0]) return refuse(`reference.duplicateKey: A category named ${name} already exists under that parent.`);
  const id = parentId ? `typ:${parentId.replace(/^grp:/, "")}|${name}` : `grp:${name}`;
  const sortorder = typeof attributes.sortorder === "number" ? attributes.sortorder : 0;
  await tx.query(
    "INSERT INTO equipment_category (id, name, parent_id, sortorder, note) VALUES ($1, $2, $3, $4, $5)",
    [id, name, parentId, sortorder, optionalText(attributes.note)]
  );
  return accepted(id, name);
}

async function editCategory(tx: Queryable, id: string, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const row = await tx.query<{ id: string; name: string; parent_id: string | null }>(
    "SELECT id, name, parent_id FROM equipment_category WHERE id = $1",
    [id]
  );
  if (!row.rows[0]) return refuse("reference.notFound: No such category.");
  const name = attributes.name !== undefined ? text(attributes.name, "name") : row.rows[0].name;
  if (typeof name !== "string") return name;
  const clash = await tx.query<{ id: string }>(
    `SELECT id FROM equipment_category
     WHERE lower(name) = lower($1) AND id <> $2
       AND ((parent_id IS NULL AND $3::text IS NULL) OR parent_id = $3)`,
    [name, id, row.rows[0].parent_id]
  );
  if (clash.rows[0]) return refuse(`reference.duplicateKey: A category named ${name} already exists under that parent.`);
  const sortorder = typeof attributes.sortorder === "number" ? attributes.sortorder : null;
  await tx.query(
    "UPDATE equipment_category SET name = $1, note = COALESCE($2, note), sortorder = COALESCE($3, sortorder) WHERE id = $4",
    [name, optionalText(attributes.note), sortorder, id]
  );
  return accepted(id, name);
}

async function createModel(tx: Queryable, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const manufacturer = text(attributes.manufacturer, "manufacturer");
  const model = text(attributes.model, "model");
  const equipmenttype = text(attributes.equipmenttype, "equipmenttype");
  const assetgroup = text(attributes.assetgroup, "assetgroup");
  const idprefix = text(attributes.idprefix, "idprefix");
  if (typeof manufacturer !== "string") return manufacturer;
  if (typeof model !== "string") return model;
  if (typeof equipmenttype !== "string") return equipmenttype;
  if (typeof assetgroup !== "string") return assetgroup;
  if (typeof idprefix !== "string") return idprefix;

  const mfr = await tx.query<{ isactive: boolean }>("SELECT isactive FROM manufacturer WHERE lower(name) = lower($1)", [
    manufacturer,
  ]);
  if (!mfr.rows[0]) return refuse("reference.notFound: Pick a manufacturer from the catalogue.");
  if (!mfr.rows[0].isactive) return refuse("reference.inactiveNotSelectable: That manufacturer is deactivated.");

  const group = await tx.query<{ id: string; isactive: boolean }>(
    "SELECT id, isactive FROM equipment_category WHERE parent_id IS NULL AND lower(name) = lower($1)",
    [assetgroup]
  );
  if (!group.rows[0]) return refuse("reference.notFound: Pick an asset group from the catalogue.");
  if (!group.rows[0].isactive) return refuse("reference.inactiveNotSelectable: That asset group is deactivated.");

  const leaf = await tx.query<{ id: string; isactive: boolean }>(
    "SELECT id, isactive FROM equipment_category WHERE parent_id = $1 AND lower(name) = lower($2)",
    [group.rows[0].id, equipmenttype]
  );
  if (!leaf.rows[0]) return refuse("reference.notFound: Pick an equipment type from the catalogue.");
  if (!leaf.rows[0].isactive) return refuse("reference.inactiveNotSelectable: That equipment type is deactivated.");

  const identifiertype = attributes.identifiertype;
  if (typeof identifiertype !== "string" || !IDENTIFIER_TYPES.includes(identifiertype as (typeof IDENTIFIER_TYPES)[number])) {
    return refuse("reference.invalidField: identifiertype must be Serial, ICCID, IMEI or None.");
  }

  const existing = await tx.query<{ model: string }>(
    "SELECT model FROM equipment_model WHERE manufacturer = $1 AND model = $2 AND equipmenttype = $3",
    [manufacturer, model, equipmenttype]
  );
  if (existing.rows[0]) {
    return refuse(`reference.duplicateKey: ${manufacturer} ${model} (${equipmenttype}) is already in the catalogue.`);
  }

  const cal =
    attributes.defaultcalintervalmonths === null || attributes.defaultcalintervalmonths === undefined
      ? null
      : typeof attributes.defaultcalintervalmonths === "number"
        ? attributes.defaultcalintervalmonths
        : null;

  await tx.query(
    `INSERT INTO equipment_model
       (manufacturer, model, equipmenttype, assetgroup, idprefix, isserialised, identifiertype, defaultcalintervalmonths, name, isactive)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
    [
      manufacturer,
      model,
      equipmenttype,
      assetgroup,
      idprefix,
      asBool(attributes.isserialised, true),
      identifiertype,
      cal,
      optionalText(attributes.name) ?? `${manufacturer} ${model}`,
    ]
  );
  return accepted(modelId(manufacturer, model, equipmenttype), `${manufacturer} ${model}`);
}

async function editModel(tx: Queryable, id: string, attributes: Record<string, unknown>): Promise<SubmissionOutcome> {
  const key = parseModelId(id);
  if (!key) return refuse("reference.notFound: No such equipment model.");
  const row = await tx.query<{ manufacturer: string; model: string; equipmenttype: string }>(
    "SELECT manufacturer, model, equipmenttype FROM equipment_model WHERE manufacturer = $1 AND model = $2 AND equipmenttype = $3",
    [key.manufacturer, key.model, key.equipmenttype]
  );
  if (!row.rows[0]) return refuse("reference.notFound: No such equipment model.");

  const idprefix = attributes.idprefix !== undefined ? text(attributes.idprefix, "idprefix") : null;
  if (idprefix && typeof idprefix !== "string") return idprefix;
  const identifiertype = attributes.identifiertype;
  if (identifiertype !== undefined) {
    if (typeof identifiertype !== "string" || !IDENTIFIER_TYPES.includes(identifiertype as (typeof IDENTIFIER_TYPES)[number])) {
      return refuse("reference.invalidField: identifiertype must be Serial, ICCID, IMEI or None.");
    }
  }
  const cal =
    attributes.defaultcalintervalmonths === undefined
      ? undefined
      : attributes.defaultcalintervalmonths === null || typeof attributes.defaultcalintervalmonths === "number"
        ? attributes.defaultcalintervalmonths
        : undefined;

  await tx.query(
    `UPDATE equipment_model SET
       idprefix = COALESCE($1, idprefix),
       isserialised = COALESCE($2, isserialised),
       identifiertype = COALESCE($3, identifiertype),
       defaultcalintervalmonths = COALESCE($4, defaultcalintervalmonths),
       name = COALESCE($5, name)
     WHERE manufacturer = $6 AND model = $7 AND equipmenttype = $8`,
    [
      typeof idprefix === "string" ? idprefix : null,
      typeof attributes.isserialised === "boolean" ? attributes.isserialised : null,
      typeof identifiertype === "string" ? identifiertype : null,
      cal === undefined ? null : cal,
      optionalText(attributes.name),
      key.manufacturer,
      key.model,
      key.equipmenttype,
    ]
  );
  return accepted(id, `${key.manufacturer} ${key.model}`);
}

async function createLocation(
  tx: Queryable,
  _user: CurrentUser,
  attributes: Record<string, unknown>
): Promise<SubmissionOutcome> {
  const name = text(attributes.name, "name");
  if (typeof name !== "string") return name;
  const locationtype = attributes.locationtype;
  if (typeof locationtype !== "string" || !LOCATION_TYPES.includes(locationtype as LocationType)) {
    return refuse("reference.invalidField: locationtype is not a recognised location type.");
  }
  const existing = await tx.query<{ id: string }>("SELECT id FROM location WHERE lower(name) = lower($1)", [name]);
  if (existing.rows[0]) return refuse(`reference.duplicateKey: A location named ${name} already exists.`);

  let parentName: string | null = optionalText(attributes.parentlocation);
  if (parentName) {
    const parent = await tx.query<{ name: string; isactive: boolean }>(
      "SELECT name, isactive FROM location WHERE id = $1 OR lower(name) = lower($1) LIMIT 1",
      [parentName]
    );
    if (!parent.rows[0]) return refuse("reference.notFound: Parent location does not exist.");
    if (!parent.rows[0].isactive) return refuse("reference.inactiveNotSelectable: Parent location is deactivated.");
    parentName = parent.rows[0].name;
  }

  const id = randomUUID();
  await tx.query(
    "INSERT INTO location (id, name, locationtype, parentlocation, isactive, note) VALUES ($1, $2, $3, $4, true, $5)",
    [id, name, locationtype, parentName, optionalText(attributes.note)]
  );
  return accepted(id, name);
}

async function editLocation(
  tx: Queryable,
  user: CurrentUser,
  id: string,
  attributes: Record<string, unknown>
): Promise<SubmissionOutcome> {
  const row = await tx.query<{ id: string; name: string; locationtype: string }>(
    "SELECT id, name, locationtype FROM location WHERE id = $1 OR name = $1 LIMIT 1",
    [id]
  );
  if (!row.rows[0]) return refuse("reference.notFound: No such location.");
  const scoped = refuseIfOutOfScope(user, row.rows[0].locationtype === "Office" ? row.rows[0].name : null);
  if (scoped) return scoped;

  const name = attributes.name !== undefined ? text(attributes.name, "name") : row.rows[0].name;
  if (typeof name !== "string") return name;
  const clash = await tx.query<{ id: string }>(
    "SELECT id FROM location WHERE lower(name) = lower($1) AND id <> $2",
    [name, row.rows[0].id]
  );
  if (clash.rows[0]) return refuse(`reference.duplicateKey: A location named ${name} already exists.`);

  let locationtype = row.rows[0].locationtype;
  if (attributes.locationtype !== undefined) {
    if (typeof attributes.locationtype !== "string" || !LOCATION_TYPES.includes(attributes.locationtype as LocationType)) {
      return refuse("reference.invalidField: locationtype is not a recognised location type.");
    }
    locationtype = attributes.locationtype;
  }

  await tx.query("UPDATE location SET name = $1, locationtype = $2, note = COALESCE($3, note) WHERE id = $4", [
    name,
    locationtype,
    optionalText(attributes.note),
    row.rows[0].id,
  ]);
  return accepted(row.rows[0].id, name);
}

async function createProject(
  tx: Queryable,
  user: CurrentUser,
  attributes: Record<string, unknown>
): Promise<SubmissionOutcome> {
  const projectnumber = text(attributes.projectnumber, "projectnumber");
  const name = text(attributes.name, "name");
  if (typeof projectnumber !== "string") return projectnumber;
  if (typeof name !== "string") return name;
  const office = optionalText(attributes.office);
  if (office) {
    const loc = await officeOfLocation(tx, office);
    if (!loc) return refuse("reference.notFound: office must be a known Office location.");
    const scoped = refuseIfOutOfScope(user, loc);
    if (scoped) return scoped;
  }
  const existing = await tx.query<{ id: string }>(
    "SELECT id FROM project WHERE lower(projectnumber) = lower($1)",
    [projectnumber]
  );
  if (existing.rows[0]) return refuse(`reference.duplicateKey: Project ${projectnumber} already exists.`);
  const id = randomUUID();
  await tx.query(
    "INSERT INTO project (id, projectnumber, name, status, office, pm) VALUES ($1, $2, $3, 'Active', $4, $5)",
    [id, projectnumber, name, office, optionalText(attributes.pm)]
  );
  return accepted(id, projectnumber);
}

async function editProject(
  tx: Queryable,
  user: CurrentUser,
  id: string,
  attributes: Record<string, unknown>
): Promise<SubmissionOutcome> {
  const row = await tx.query<{ id: string; projectnumber: string; name: string; office: string | null }>(
    "SELECT id, projectnumber, name, office FROM project WHERE id = $1 OR projectnumber = $1 LIMIT 1",
    [id]
  );
  if (!row.rows[0]) return refuse("reference.notFound: No such project.");
  const scoped = refuseIfOutOfScope(user, row.rows[0].office);
  if (scoped) return scoped;

  const name = attributes.name !== undefined ? text(attributes.name, "name") : row.rows[0].name;
  if (typeof name !== "string") return name;
  let office = row.rows[0].office;
  if (attributes.office !== undefined) {
    office = optionalText(attributes.office);
    if (office) {
      const loc = await officeOfLocation(tx, office);
      if (!loc) return refuse("reference.notFound: office must be a known Office location.");
      const nextScope = refuseIfOutOfScope(user, loc);
      if (nextScope) return nextScope;
      office = loc;
    }
  }
  await tx.query("UPDATE project SET name = $1, office = $2, pm = COALESCE($3, pm) WHERE id = $4", [
    name,
    office,
    optionalText(attributes.pm),
    row.rows[0].id,
  ]);
  return accepted(row.rows[0].id, row.rows[0].projectnumber);
}

async function setActive(
  tx: Queryable,
  user: CurrentUser,
  domain: ReferenceDomain,
  id: string,
  active: boolean
): Promise<SubmissionOutcome> {
  if (domain === "Manufacturer") {
    const row = await tx.query<{ id: string; name: string }>("SELECT id, name FROM manufacturer WHERE id = $1", [id]);
    if (!row.rows[0]) return refuse("reference.notFound: No such manufacturer.");
    await tx.query("UPDATE manufacturer SET isactive = $1 WHERE id = $2", [active, id]);
    return accepted(id, row.rows[0].name);
  }
  if (domain === "EquipmentCategory") {
    const row = await tx.query<{ id: string; name: string }>("SELECT id, name FROM equipment_category WHERE id = $1", [id]);
    if (!row.rows[0]) return refuse("reference.notFound: No such category.");
    await tx.query("UPDATE equipment_category SET isactive = $1 WHERE id = $2", [active, id]);
    return accepted(id, row.rows[0].name);
  }
  if (domain === "EquipmentModel") {
    const key = parseModelId(id);
    if (!key) return refuse("reference.notFound: No such equipment model.");
    const row = await tx.query<{ model: string }>(
      "SELECT model FROM equipment_model WHERE manufacturer = $1 AND model = $2 AND equipmenttype = $3",
      [key.manufacturer, key.model, key.equipmenttype]
    );
    if (!row.rows[0]) return refuse("reference.notFound: No such equipment model.");
    await tx.query(
      "UPDATE equipment_model SET isactive = $1 WHERE manufacturer = $2 AND model = $3 AND equipmenttype = $4",
      [active, key.manufacturer, key.model, key.equipmenttype]
    );
    return accepted(id, `${key.manufacturer} ${key.model}`);
  }
  if (domain === "Location") {
    const row = await tx.query<{ id: string; name: string; locationtype: string }>(
      "SELECT id, name, locationtype FROM location WHERE id = $1 OR name = $1 LIMIT 1",
      [id]
    );
    if (!row.rows[0]) return refuse("reference.notFound: No such location.");
    const scoped = refuseIfOutOfScope(user, row.rows[0].locationtype === "Office" ? row.rows[0].name : null);
    if (scoped) return scoped;
    await tx.query("UPDATE location SET isactive = $1 WHERE id = $2", [active, row.rows[0].id]);
    return accepted(row.rows[0].id, row.rows[0].name);
  }
  const row = await tx.query<{ id: string; projectnumber: string; office: string | null }>(
    "SELECT id, projectnumber, office FROM project WHERE id = $1 OR projectnumber = $1 LIMIT 1",
    [id]
  );
  if (!row.rows[0]) return refuse("reference.notFound: No such project.");
  const scoped = refuseIfOutOfScope(user, row.rows[0].office);
  if (scoped) return scoped;
  await tx.query("UPDATE project SET status = $1 WHERE id = $2", [active ? "Active" : "Closed", row.rows[0].id]);
  return accepted(row.rows[0].id, row.rows[0].projectnumber);
}

async function parentOf(tx: Queryable, name: string): Promise<string | null> {
  const found = await tx.query<{ parentlocation: string | null }>(
    "SELECT parentlocation FROM location WHERE lower(name) = lower($1) LIMIT 1",
    [name]
  );
  return found.rows[0]?.parentlocation ?? null;
}

async function wouldCycle(tx: Queryable, movingName: string, newParentName: string): Promise<boolean> {
  if (movingName.toLowerCase() === newParentName.toLowerCase()) return true;
  const seen = new Set<string>([movingName.toLowerCase()]);
  let cursor: string | null = newParentName;
  for (let i = 0; i < 32 && cursor; i += 1) {
    const key = cursor.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    cursor = await parentOf(tx, cursor);
  }
  return false;
}

/** Rebuild manufacturer and category rows from the catalogue. Called after seed TRUNCATE. */
export async function refreshCatalogueReferences(tx: Queryable): Promise<void> {
  await tx.query(`
    INSERT INTO manufacturer (id, name)
    SELECT DISTINCT manufacturer, manufacturer FROM equipment_model
    ON CONFLICT (id) DO NOTHING
  `);
  await tx.query(`
    INSERT INTO equipment_category (id, name, parent_id)
    SELECT DISTINCT 'grp:' || assetgroup, assetgroup, NULL
    FROM equipment_model
    ON CONFLICT (id) DO NOTHING
  `);
  await tx.query(`
    INSERT INTO equipment_category (id, name, parent_id)
    SELECT DISTINCT 'typ:' || assetgroup || '|' || equipmenttype, equipmenttype, 'grp:' || assetgroup
    FROM equipment_model
    ON CONFLICT (id) DO NOTHING
  `);
}
