/**
 * Mock reference-data commands — same named operations the HTTP adapter sends to the server.
 * Deactivate, never delete. Manufacturer / category / model / location / project only;
 * people are not a reference table.
 */
import type { ReferenceMethods, SubmissionOutcome } from "../AmsBackend";
import type {
  CreateReferenceInput,
  DeactivateReferenceInput,
  EditReferenceInput,
  EquipmentCategory,
  EquipmentModel,
  Location,
  LocationType,
  Manufacturer,
  ReferenceDomain,
  ReferenceImpactPreview,
  ReparentLocationInput,
} from "../types";
import type { MockStore } from "./store";

const LOCATION_TYPES: readonly LocationType[] = ["Region", "Office", "Site", "Vehicle", "CalLab", "Client", "Storage"];
const IDENTIFIER_TYPES = ["Serial", "ICCID", "IMEI", "None"] as const;

function refuse(reason: string): SubmissionOutcome {
  return { ok: false, reason };
}

function accepted(id: string, name: string): SubmissionOutcome {
  return { ok: true, transactionId: id, transactionName: name };
}

function modelKey(m: Pick<EquipmentModel, "manufacturer" | "model" | "equipmenttype">): string {
  return `${m.manufacturer}|${m.model}|${m.equipmenttype}`;
}

export function deriveManufacturers(models: EquipmentModel[]): Manufacturer[] {
  const names = [...new Set(models.map((m) => m.manufacturer))].sort();
  return names.map((name) => ({ id: name, name, isactive: true, note: null }));
}

export function deriveCategories(models: EquipmentModel[]): EquipmentCategory[] {
  const groups = [...new Set(models.map((m) => m.assetgroup))].sort();
  const cats: EquipmentCategory[] = groups.map((name) => ({
    id: `grp:${name}`,
    name,
    parentId: null,
    sortorder: 0,
    isactive: true,
    note: null,
  }));
  const seen = new Set<string>();
  for (const m of models) {
    const id = `typ:${m.assetgroup}|${m.equipmenttype}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cats.push({
      id,
      name: m.equipmenttype,
      parentId: `grp:${m.assetgroup}`,
      sortorder: 0,
      isactive: true,
      note: null,
    });
  }
  return cats;
}

function text(value: unknown, field: string): string | SubmissionOutcome {
  if (typeof value !== "string" || !value.trim()) return refuse(`reference.invalidField: ${field} is required.`);
  return value.trim();
}

export function createReferenceMethods(store: MockStore): ReferenceMethods {
  function ensureDerived(): void {
    if (store.manufacturers.length === 0) store.manufacturers = deriveManufacturers(store.equipmentModels);
    if (store.categories.length === 0) store.categories = deriveCategories(store.equipmentModels);
  }

  function rowId(domain: ReferenceDomain, row: unknown): string {
    const r = row as Record<string, unknown>;
    if (domain === "EquipmentModel") return modelKey(r as unknown as EquipmentModel);
    return String(r.id);
  }

  function list(domain: ReferenceDomain): unknown[] {
    ensureDerived();
    switch (domain) {
      case "Manufacturer":
        return store.manufacturers;
      case "EquipmentCategory":
        return store.categories;
      case "EquipmentModel":
        return store.equipmentModels.map((m) => ({ ...m, isactive: m.isactive !== false }));
      case "Location":
        return store.locations;
      case "Project":
        return store.projects;
    }
  }

  return {
    async listManufacturers() {
      await store.ready;
      ensureDerived();
      return store.manufacturers;
    },
    async listEquipmentCategories() {
      await store.ready;
      ensureDerived();
      return store.categories;
    },
    async listReference(domain) {
      await store.ready;
      return list(domain);
    },
    async getReference(domain, id) {
      await store.ready;
      return list(domain).find((row) => rowId(domain, row) === id) ?? null;
    },
    async previewReferenceImpact(domain, id) {
      await store.ready;
      const assets = [...store.assets.values()];
      let affectedAssetCount = 0;
      if (domain === "Manufacturer") affectedAssetCount = assets.filter((a) => a.equipmentmodel.manufacturer === id).length;
      else if (domain === "EquipmentModel") {
        const [manufacturer, model, equipmenttype] = id.split("|");
        affectedAssetCount = assets.filter(
          (a) =>
            a.equipmentmodel.manufacturer === manufacturer &&
            a.equipmentmodel.model === model &&
            a.equipmentmodel.equipmenttype === equipmenttype
        ).length;
      } else if (domain === "Location") {
        const loc = store.locations.find((l) => l.id === id || l.name === id);
        const name = loc?.name ?? id;
        affectedAssetCount = assets.filter((a) => a.homeoffice === name || a.currentlocation === name).length;
      } else if (domain === "Project") {
        const proj = store.projects.find((p) => p.id === id || p.projectnumber === id);
        const number = proj?.projectnumber ?? id;
        affectedAssetCount = assets.filter((a) => a.currentproject === number).length;
      } else {
        const cat = store.categories.find((c) => c.id === id);
        if (cat?.parentId) {
          affectedAssetCount = assets.filter((a) => a.equipmentmodel.equipmenttype === cat.name).length;
        } else if (cat) {
          affectedAssetCount = assets.filter((a) => {
            const model = store.equipmentModels.find(
              (m) =>
                m.manufacturer === a.equipmentmodel.manufacturer &&
                m.model === a.equipmentmodel.model &&
                m.equipmenttype === a.equipmentmodel.equipmenttype
            );
            return model?.assetgroup === cat.name;
          }).length;
        }
      }
      const preview: ReferenceImpactPreview = { domain, id, affectedAssetCount, reversibleClass: "Reversible" };
      return preview;
    },
    async createReference(input: CreateReferenceInput) {
      await store.ready;
      ensureDerived();
      const outcome = create(store, input);
      if (outcome.ok) store.persist();
      return outcome;
    },
    async editReference(input: EditReferenceInput) {
      await store.ready;
      ensureDerived();
      const outcome = edit(store, input);
      if (outcome.ok) store.persist();
      return outcome;
    },
    async deactivateReference(input: DeactivateReferenceInput) {
      await store.ready;
      ensureDerived();
      const outcome = setActive(store, input.domain, input.id, false);
      if (outcome.ok) store.persist();
      return outcome;
    },
    async reactivateReference(input: DeactivateReferenceInput) {
      await store.ready;
      ensureDerived();
      const outcome = setActive(store, input.domain, input.id, true);
      if (outcome.ok) store.persist();
      return outcome;
    },
    async reparentLocation(input: ReparentLocationInput) {
      await store.ready;
      const loc = store.locations.find((l) => l.id === input.id || l.name === input.id);
      if (!loc) return refuse("reference.notFound: No such location.");
      let newParentName: string | null = null;
      if (input.newParentId) {
        const parent = store.locations.find((l) => l.id === input.newParentId || l.name === input.newParentId);
        if (!parent) return refuse("reference.notFound: New parent is not a known location.");
        if (wouldCycle(store.locations, loc.name, parent.name)) {
          return refuse("reference.cycle: That parent would create a location cycle.");
        }
        newParentName = parent.name;
      }
      loc.parentlocation = newParentName;
      store.persist();
      return accepted(loc.id, loc.name);
    },
  };
}

function create(store: MockStore, input: CreateReferenceInput): SubmissionOutcome {
  const a = input.attributes;
  if (input.domain === "Manufacturer") {
    const name = text(a.name, "name");
    if (typeof name !== "string") return name;
    if (store.manufacturers.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      return refuse(`reference.duplicateKey: A manufacturer named ${name} already exists.`);
    }
    store.manufacturers.push({ id: name, name, isactive: true, note: null });
    return accepted(name, name);
  }
  if (input.domain === "EquipmentCategory") {
    const name = text(a.name, "name");
    if (typeof name !== "string") return name;
    const parentId = typeof a.parentId === "string" && a.parentId.trim() ? a.parentId.trim() : null;
    if (parentId && !store.categories.some((c) => c.id === parentId)) {
      return refuse("reference.notFound: Parent category does not exist.");
    }
    if (
      store.categories.some(
        (c) => c.name.toLowerCase() === name.toLowerCase() && (c.parentId ?? null) === parentId
      )
    ) {
      return refuse(`reference.duplicateKey: A category named ${name} already exists under that parent.`);
    }
    const id = parentId ? `typ:${parentId.replace(/^grp:/, "")}|${name}` : `grp:${name}`;
    store.categories.push({
      id,
      name,
      parentId,
      sortorder: typeof a.sortorder === "number" ? a.sortorder : 0,
      isactive: true,
      note: null,
    });
    return accepted(id, name);
  }
  if (input.domain === "EquipmentModel") {
    const manufacturer = text(a.manufacturer, "manufacturer");
    const model = text(a.model, "model");
    const equipmenttype = text(a.equipmenttype, "equipmenttype");
    const assetgroup = text(a.assetgroup, "assetgroup");
    const idprefix = text(a.idprefix, "idprefix");
    if (typeof manufacturer !== "string") return manufacturer;
    if (typeof model !== "string") return model;
    if (typeof equipmenttype !== "string") return equipmenttype;
    if (typeof assetgroup !== "string") return assetgroup;
    if (typeof idprefix !== "string") return idprefix;
    const mfr = store.manufacturers.find((m) => m.name.toLowerCase() === manufacturer.toLowerCase());
    if (!mfr) return refuse("reference.notFound: Pick a manufacturer from the catalogue.");
    if (!mfr.isactive) return refuse("reference.inactiveNotSelectable: That manufacturer is deactivated.");
    const group = store.categories.find((c) => !c.parentId && c.name.toLowerCase() === assetgroup.toLowerCase());
    if (!group) return refuse("reference.notFound: Pick an asset group from the catalogue.");
    if (!group.isactive) return refuse("reference.inactiveNotSelectable: That asset group is deactivated.");
    const leaf = store.categories.find(
      (c) => c.parentId === group.id && c.name.toLowerCase() === equipmenttype.toLowerCase()
    );
    if (!leaf) return refuse("reference.notFound: Pick an equipment type from the catalogue.");
    if (!leaf.isactive) return refuse("reference.inactiveNotSelectable: That equipment type is deactivated.");
    if (typeof a.identifiertype !== "string" || !IDENTIFIER_TYPES.includes(a.identifiertype as (typeof IDENTIFIER_TYPES)[number])) {
      return refuse("reference.invalidField: identifiertype must be Serial, ICCID, IMEI or None.");
    }
    if (store.equipmentModels.some((m) => m.manufacturer === manufacturer && m.model === model && m.equipmenttype === equipmenttype)) {
      return refuse(`reference.duplicateKey: ${manufacturer} ${model} (${equipmenttype}) is already in the catalogue.`);
    }
    const row: EquipmentModel = {
      manufacturer,
      model,
      equipmenttype,
      assetgroup,
      idprefix,
      isserialised: a.isserialised === true,
      identifiertype: a.identifiertype as EquipmentModel["identifiertype"],
      defaultcalintervalmonths: typeof a.defaultcalintervalmonths === "number" ? a.defaultcalintervalmonths : null,
      isactive: true,
    };
    store.equipmentModels.push(row);
    return accepted(modelKey(row), `${manufacturer} ${model}`);
  }
  if (input.domain === "Location") {
    const name = text(a.name, "name");
    if (typeof name !== "string") return name;
    if (typeof a.locationtype !== "string" || !LOCATION_TYPES.includes(a.locationtype as LocationType)) {
      return refuse("reference.invalidField: locationtype is not a recognised location type.");
    }
    if (store.locations.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      return refuse(`reference.duplicateKey: A location named ${name} already exists.`);
    }
    const id = `loc-${name}`;
    store.locations.push({
      id,
      name,
      locationtype: a.locationtype as LocationType,
      parentlocation: typeof a.parentlocation === "string" ? a.parentlocation : null,
      isactive: true,
      note: null,
    });
    return accepted(id, name);
  }
  const projectnumber = text(a.projectnumber, "projectnumber");
  const name = text(a.name, "name");
  if (typeof projectnumber !== "string") return projectnumber;
  if (typeof name !== "string") return name;
  if (store.projects.some((p) => p.projectnumber.toLowerCase() === projectnumber.toLowerCase())) {
    return refuse(`reference.duplicateKey: Project ${projectnumber} already exists.`);
  }
  const id = `prj-${projectnumber}`;
  store.projects.push({
    id,
    projectnumber,
    name,
    status: "Active",
    office: typeof a.office === "string" ? a.office : null,
    pm: typeof a.pm === "string" ? a.pm : null,
  });
  return accepted(id, projectnumber);
}

function edit(store: MockStore, input: EditReferenceInput): SubmissionOutcome {
  const a = input.attributes;
  if (input.domain === "Manufacturer") {
    const row = store.manufacturers.find((m) => m.id === input.id);
    if (!row) return refuse("reference.notFound: No such manufacturer.");
    if (typeof a.name === "string" && a.name.trim()) row.name = a.name.trim();
    return accepted(row.id, row.name);
  }
  if (input.domain === "EquipmentCategory") {
    const row = store.categories.find((c) => c.id === input.id);
    if (!row) return refuse("reference.notFound: No such category.");
    if (typeof a.name === "string" && a.name.trim()) row.name = a.name.trim();
    return accepted(row.id, row.name);
  }
  if (input.domain === "EquipmentModel") {
    const row = store.equipmentModels.find((m) => modelKey(m) === input.id);
    if (!row) return refuse("reference.notFound: No such equipment model.");
    if (typeof a.idprefix === "string" && a.idprefix.trim()) row.idprefix = a.idprefix.trim();
    if (typeof a.isserialised === "boolean") row.isserialised = a.isserialised;
    if (typeof a.identifiertype === "string" && IDENTIFIER_TYPES.includes(a.identifiertype as (typeof IDENTIFIER_TYPES)[number])) {
      row.identifiertype = a.identifiertype as EquipmentModel["identifiertype"];
    }
    if (typeof a.defaultcalintervalmonths === "number" || a.defaultcalintervalmonths === null) {
      row.defaultcalintervalmonths = a.defaultcalintervalmonths as number | null;
    }
    return accepted(input.id, `${row.manufacturer} ${row.model}`);
  }
  if (input.domain === "Location") {
    const row = store.locations.find((l) => l.id === input.id || l.name === input.id);
    if (!row) return refuse("reference.notFound: No such location.");
    if (typeof a.name === "string" && a.name.trim()) row.name = a.name.trim();
    if (typeof a.locationtype === "string" && LOCATION_TYPES.includes(a.locationtype as LocationType)) {
      row.locationtype = a.locationtype as LocationType;
    }
    return accepted(row.id, row.name);
  }
  const row = store.projects.find((p) => p.id === input.id || p.projectnumber === input.id);
  if (!row) return refuse("reference.notFound: No such project.");
  if (typeof a.name === "string" && a.name.trim()) row.name = a.name.trim();
  if (a.office !== undefined) row.office = typeof a.office === "string" ? a.office : null;
  if (typeof a.pm === "string") row.pm = a.pm;
  return accepted(row.id, row.projectnumber);
}

function setActive(store: MockStore, domain: ReferenceDomain, id: string, active: boolean): SubmissionOutcome {
  if (domain === "Manufacturer") {
    const row = store.manufacturers.find((m) => m.id === id);
    if (!row) return refuse("reference.notFound: No such manufacturer.");
    row.isactive = active;
    return accepted(row.id, row.name);
  }
  if (domain === "EquipmentCategory") {
    const row = store.categories.find((c) => c.id === id);
    if (!row) return refuse("reference.notFound: No such category.");
    row.isactive = active;
    return accepted(row.id, row.name);
  }
  if (domain === "EquipmentModel") {
    const row = store.equipmentModels.find((m) => modelKey(m) === id);
    if (!row) return refuse("reference.notFound: No such equipment model.");
    row.isactive = active;
    return accepted(id, `${row.manufacturer} ${row.model}`);
  }
  if (domain === "Location") {
    const row = store.locations.find((l) => l.id === id || l.name === id);
    if (!row) return refuse("reference.notFound: No such location.");
    row.isactive = active;
    return accepted(row.id, row.name);
  }
  const row = store.projects.find((p) => p.id === id || p.projectnumber === id);
  if (!row) return refuse("reference.notFound: No such project.");
  row.status = active ? "Active" : "Closed";
  return accepted(row.id, row.projectnumber);
}

function wouldCycle(locations: Location[], movingName: string, newParentName: string): boolean {
  if (movingName.toLowerCase() === newParentName.toLowerCase()) return true;
  let current: string | null = newParentName;
  const seen = new Set<string>([movingName.toLowerCase()]);
  for (let i = 0; i < 32 && current; i += 1) {
    if (seen.has(current.toLowerCase())) return true;
    seen.add(current.toLowerCase());
    current = locations.find((l) => l.name.toLowerCase() === current!.toLowerCase())?.parentlocation ?? null;
  }
  return false;
}
