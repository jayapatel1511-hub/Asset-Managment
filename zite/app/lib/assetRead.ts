// MIRROR of apps/englobe-ams-field/src/lib/assetRead.ts — see zite/README.md.
//
// Backend-only read helpers. Never import this from frontend code — it pulls in zitejs/db.
//
// Why the typed client and not SQL joins: Zite gives BOTH "Home Office" and
// "Current Location" a single shared link table ("Assets__Locations"), because link
// tables are keyed by table PAIR, not by field. The two are distinguishable in SQL
// only through an undocumented internal `field_id` column. The typed client resolves
// them correctly, so reads go through it. See docs/18 2b.
import { zite } from 'zitejs/db';

/** Link fields come back as a string, an array of strings, or undefined. Take the first id. */
export function linkId(v: string | string[] | undefined | null): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export type RefMaps = {
  models: Map<string, { name: string; manufacturer: string; model: string; categoryId?: string; calMonths?: number }>;
  categories: Map<string, { name: string; parentId?: string }>;
  locations: Map<string, string>;
  projects: Map<string, { number: string; name: string; status: string }>;
};

/**
 * The reference tables are small (52 models, 26 categories, 699 locations, 260
 * projects) so this loads them whole rather than doing per-row lookups. That is a
 * deliberate simplification for a test environment; a production read model would
 * join in SQL. Recorded in docs/08-decisions.md.
 */
export async function loadRefMaps(): Promise<RefMaps> {
  const [models, categories, locations, projects] = await Promise.all([
    zite.equipmentModels.findAll({ limit: 500 }),
    zite.categories.findAll({ limit: 500 }),
    zite.locations.findAll({ limit: 2000 }),
    zite.projects.findAll({ limit: 2000 }),
  ]);
  return {
    models: new Map(models.records.map(m => [m.id, {
      name: m.name ?? '',
      manufacturer: m.manufacturer ?? '',
      model: m.model ?? '',
      categoryId: linkId(m.category),
      calMonths: m.defaultCalIntervalMonths,
    }])),
    categories: new Map(categories.records.map(c => [c.id, {
      name: c.name ?? '', parentId: linkId(c.parentCategory),
    }])),
    locations: new Map(locations.records.map(l => [l.id, l.name ?? ''])),
    projects: new Map(projects.records.map(p => [p.id, {
      number: p.projectNumber ?? '', name: p.projectName ?? '', status: p.status ?? '',
    }])),
  };
}

/** The leaf category name is the equipment type — what docs/12 5.1 groups search results by. */
export function equipmentType(modelId: string | undefined, m: RefMaps): string {
  const model = modelId ? m.models.get(modelId) : undefined;
  const cat = model?.categoryId ? m.categories.get(model.categoryId) : undefined;
  return cat?.name ?? 'Uncategorised';
}

/** Walking up one level gives the asset group, the way an office's region is derived. */
export function assetGroup(modelId: string | undefined, m: RefMaps): string {
  const model = modelId ? m.models.get(modelId) : undefined;
  const cat = model?.categoryId ? m.categories.get(model.categoryId) : undefined;
  const root = cat?.parentId ? m.categories.get(cat.parentId) : undefined;
  return root?.name ?? cat?.name ?? '';
}

export const TODAY = () => new Date().toISOString().slice(0, 10);

/** docs/12 C2: overdue is nextCalDue strictly before today. Null is "unknown", not overdue. */
export function isOverdue(nextCalDue: string | undefined): boolean {
  return !!nextCalDue && nextCalDue < TODAY();
}

export function daysOverdue(nextCalDue: string | undefined): number | undefined {
  if (!isOverdue(nextCalDue)) return undefined;
  const ms = Date.parse(TODAY()) - Date.parse(nextCalDue!);
  return Math.floor(ms / 86400000);
}

/** docs/12 5.3: a temporary tag is TMP-… or an ID that is prefix-only (ends with "-"). */
export function isTemporaryTag(assetId: string): boolean {
  return assetId.startsWith('TMP-') || assetId.endsWith('-');
}

/** The shape every screen reads. Note there is no ICCID / phone / static IP here — those
 *  columns do not exist in this database at all (docs/18 7a). */
export type AssetRow = {
  id: string;
  assetId: string;
  serialNumber: string;
  status: string;
  lifecycle: string;
  custodian: string;
  equipmentType: string;
  assetGroup: string;
  modelLabel: string;
  homeOffice: string;
  currentLocation: string;
  currentProject: string;
  parentAsset: string;
  lastCalDate: string;
  nextCalDue: string;
  notes: string;
  dataOrigin: string;
  overdue: boolean;
  daysOverdue?: number;
  temporaryTag: boolean;
};

export function shapeAsset(
  a: {
    id: string; assetId?: string; serialNumber?: string; status?: string; lifecycle?: string;
    custodian?: string; lastCalDate?: string; nextCalDue?: string; notes?: string; dataOrigin?: string;
    equipmentModel?: string | string[]; homeOffice?: string | string[];
    currentLocation?: string | string[]; currentProject?: string | string[];
    parentAsset?: string | string[];
  },
  m: RefMaps,
  parentAssetId?: string,
): AssetRow {
  const modelId = linkId(a.equipmentModel);
  const model = modelId ? m.models.get(modelId) : undefined;
  const proj = linkId(a.currentProject) ? m.projects.get(linkId(a.currentProject)!) : undefined;
  const assetId = a.assetId ?? '';
  return {
    id: a.id,
    assetId,
    serialNumber: a.serialNumber ?? '',
    status: a.status ?? '',
    lifecycle: a.lifecycle ?? '',
    custodian: a.custodian ?? '',
    equipmentType: equipmentType(modelId, m),
    assetGroup: assetGroup(modelId, m),
    modelLabel: model ? `${model.manufacturer} ${model.model}`.trim() : '',
    homeOffice: m.locations.get(linkId(a.homeOffice) ?? '') ?? '',
    currentLocation: m.locations.get(linkId(a.currentLocation) ?? '') ?? '',
    currentProject: proj ? `${proj.number} — ${proj.name}` : '',
    parentAsset: parentAssetId ?? '',
    lastCalDate: a.lastCalDate ?? '',
    nextCalDue: a.nextCalDue ?? '',
    notes: a.notes ?? '',
    dataOrigin: a.dataOrigin ?? '',
    overdue: isOverdue(a.nextCalDue),
    daysOverdue: daysOverdue(a.nextCalDue),
    temporaryTag: isTemporaryTag(assetId),
  };
}
