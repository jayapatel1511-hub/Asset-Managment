/// <reference types="node" />
/**
 * Writers: the per-table JSON the mock backend and the future Dataverse loader read (FR-058),
 * the CSV-per-table form the Power BI semantic model can bind to offline (FR-059), the manifest
 * (FR-006), the answer key (FR-055) and the verification report (FR-057).
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import type { AnswerKey } from "./answerKey";
import { GENERATOR_VERSION, REPO_ROOT, modelKey, type LoadedConfig, type Params } from "./config";
import type { Ledger } from "./ledger";
import type { Simulation } from "./sim";
import type { Check } from "./verify";

export interface Manifest {
  dataset: "synthetic";
  generatorVersion: string;
  seed: string;
  profile: string;
  params: Omit<Params, "outDir">;
  asOf: string;
  generatedAt: string;
  inputsHash: string;
  verified: boolean;
  counts: Record<string, number>;
  catalogueExtensions: Array<{ manufacturer: string; model: string; equipmenttype: string }>;
  markers: { asset: string; transaction: string; projectNumberPrefix: string; certificatePrefix: string; siteNote: string };
  probeDates: string[];
  planted: Simulation["planted"];
  files: string[];
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(columns: string[], rows: unknown[][]): string {
  return [columns.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function buildManifest(ledger: Ledger, sim: Simulation, cfg: LoadedConfig, params: Params, verified: boolean, files: string[], generatedAt: string): Manifest {
  const { outDir: _outDir, ...rest } = params;
  return {
    dataset: "synthetic",
    generatorVersion: GENERATOR_VERSION,
    seed: params.seed,
    profile: params.profile,
    params: rest,
    asOf: params.asOf,
    generatedAt,
    inputsHash: cfg.inputsHash,
    verified,
    counts: {
      assets: ledger.assets.size,
      activeAssets: [...ledger.assets.values()].filter((a) => a.lifecycle !== "Retired").length,
      transactions: ledger.transactions.length,
      transactionLines: ledger.lines.length,
      relationships: ledger.relationships.length,
      installations: ledger.installations.length,
      installationComponents: ledger.installationComponents.length,
      calibrationRecords: ledger.calibrationRecords.length,
      projects: ledger.projects.length,
      sites: ledger.locations.filter((l) => l.locationtype === "Site").length,
      roster: cfg.roster.length,
    },
    catalogueExtensions: cfg.windows.extensions.map((e) => ({ manufacturer: e.manufacturer, model: e.model, equipmenttype: e.equipmenttype })),
    markers: {
      asset: `migrationsource starts with "SYNTHETIC seed=${params.seed}"`,
      transaction: `notes start with "[SYNTHETIC s=${params.seed}]"`,
      projectNumberPrefix: cfg.projects.numberPrefix,
      certificatePrefix: "SYN-",
      siteNote: `note starts with "SYNTHETIC seed=${params.seed}"`,
    },
    probeDates: sim.probeDates,
    planted: sim.planted,
    files,
  };
}

/** Everything the dataset is made of, as JSON strings keyed by file name — the unit of
 * determinism comparison and of writing. */
export function serialiseDataset(ledger: Ledger, sim: Simulation, cfg: LoadedConfig, key: AnswerKey): Record<string, string> {
  const assets = [...ledger.assets.values()].sort((a, b) => (a.assetid < b.assetid ? -1 : 1));
  const compact = (v: unknown) => JSON.stringify(v);
  const pretty = (v: unknown) => JSON.stringify(v, null, 1);
  const catalogue = cfg.catalogue.map((m) => ({ ...m, name: `${m.manufacturer} ${m.model}` }));
  return {
    "assets.json": compact(assets),
    "locations.json": pretty(ledger.locations),
    "equipment_models.json": pretty(catalogue),
    "projects.json": pretty(ledger.projects),
    "transactions.json": compact(ledger.transactions),
    "transactionlines.json": compact(ledger.lines),
    "assetrelationships.json": compact(ledger.relationships),
    "calibrationrecords.json": compact(ledger.calibrationRecords),
    "idsequence.json": pretty(ledger.idSequence),
    "installations.json": compact(ledger.installations),
    "installationcomponents.json": compact(ledger.installationComponents),
    "officeadminassignments.json": pretty(sim.officeAdminAssignments()),
    "answer_key.json": pretty(key),
  };
}

export function writeDataset(params: Params, files: Record<string, string>, manifest: Manifest, powerbi: Record<string, string>): void {
  if (existsSync(params.outDir)) rmSync(params.outDir, { recursive: true, force: true });
  mkdirSync(path.join(params.outDir, "powerbi"), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(params.outDir, name), content, "utf8");
  writeFileSync(path.join(params.outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  for (const [name, content] of Object.entries(powerbi)) writeFileSync(path.join(params.outDir, "powerbi", name), content, "utf8");
}

/** CSV per Power BI table, columns named as in solution/powerbi/.../tables/*.tmdl (FR-059). */
export function powerBiTables(ledger: Ledger, sim: Simulation, cfg: LoadedConfig): Record<string, string> {
  const txnName = new Map(ledger.transactions.map((t) => [t.id, t.name]));
  const projectClient = new Map(sim.projects.map((p) => [p.number, p.client]));
  const siteCoords = new Map<string, { lat: number | null; lon: number | null }>();
  for (const i of ledger.installations) if (!siteCoords.has(i.site)) siteCoords.set(i.site, { lat: i.latitude, lon: i.longitude });
  return {
    "Asset.csv": csv(
      ["AssetId", "EquipmentModelKey", "SerialNumber", "IdentifierValue", "HomeOffice", "Lifecycle", "Status", "CurrentLocation", "Custodian", "CurrentProject", "ParentAsset", "LastCalDate", "NextCalDue", "RetirementReason", "Notes", "PhoneNumber", "StaticIp", "MigrationSource"],
      [...ledger.assets.values()].map((a) => [a.assetid, modelKey(a.equipmentmodel), a.serialnumber, a.identifiervalue, a.homeoffice, a.lifecycle, a.status, a.currentlocation, a.custodian, a.currentproject, a.parentasset, a.lastcaldate, a.nextcaldue, a.retirementreason, a.notes, a.phonenumber, a.staticip, a.migrationsource])
    ),
    "EquipmentModel.csv": csv(
      ["Manufacturer", "Model", "EquipmentType", "AssetGroup", "IdPrefix", "IsSerialised", "IdentifierType", "DefaultCalIntervalMonths"],
      cfg.catalogue.map((m) => [m.manufacturer, m.model, m.equipmenttype, m.assetgroup, m.idprefix, m.isserialised, m.identifiertype, m.defaultcalintervalmonths])
    ),
    "Location.csv": csv(
      ["LocationName", "LocationType", "ParentLocationName", "IsActive", "Latitude", "Longitude"],
      ledger.locations.map((l) => [l.name, l.locationtype, l.parentlocation, l.isactive, siteCoords.get(l.name)?.lat ?? null, siteCoords.get(l.name)?.lon ?? null])
    ),
    "Project.csv": csv(
      ["ProjectNumber", "ProjectName", "Client", "Status", "Office", "ProjectManager"],
      ledger.projects.map((p) => [p.projectnumber, p.name, projectClient.get(p.projectnumber) ?? null, p.status, p.office, p.pm])
    ),
    "Transaction.csv": csv(
      ["TransactionName", "TransactionType", "TransactionDate", "PerformedBy", "FromLocation", "ToLocation", "FromUser", "ToUser", "FromProject", "ToProject", "PrimaryAsset", "Notes", "ExpectedReturn"],
      ledger.transactions.map((t) => [t.name, t.transactiontype, t.transactiondate, t.performedby, t.fromlocation, t.tolocation, t.fromuser, t.touser, t.fromproject, t.toproject, t.primaryasset, t.notes, t.expectedreturn])
    ),
    "TransactionLine.csv": csv(
      ["LineId", "TransactionName", "AssetId", "StatusBefore", "StatusAfter", "KitRole", "Orientation", "PowerSource", "Condition", "Processed", "Notes"],
      ledger.lines.map((l) => [l.id, txnName.get(l.transaction), l.asset, l.statusbefore, l.statusafter, l.kitrole, l.orientation, l.powersource, l.condition, l.processed, l.notes])
    ),
    "AssetRelationship.csv": csv(
      ["RelationshipId", "ParentAsset", "ChildAsset", "RelationshipType", "Start", "End", "CreatedByLine", "ClosedByLine"],
      ledger.relationships.map((r) => [r.id, r.parentasset, r.childasset, r.relationshiptype, r.start, r.end, r.createdbyline, r.closedbyline])
    ),
    "CalibrationRecord.csv": csv(
      ["RecordId", "AssetId", "CalibrationDate", "NextDueDate", "Lab", "CertificateNumber", "CertificateUrl", "Cost", "Result"],
      ledger.calibrationRecords.map((r) => [r.id, r.asset, r.calibrationdate, r.nextduedate, r.lab, r.certificatenumber, r.certificateurl, r.cost, r.result])
    ),
    "Installation.csv": csv(
      ["InstallationId", "Site", "Project", "PrimaryAsset", "LocationType", "SiteName", "Position", "Latitude", "Longitude", "CoordinateSource", "PowerSource", "Start", "End", "OpenedByTransaction", "ClosedByTransaction", "Notes"],
      ledger.installations.map((i) => [i.id, i.site, i.project, i.primaryasset, i.locationtype, i.sitename, i.position, i.latitude, i.longitude, i.coordinatesource, i.powersource, i.start, i.end, i.openedbytransaction, i.closedbytransaction, i.notes])
    ),
    "InstallationComponent.csv": csv(
      ["InstallationComponentId", "InstallationId", "AssetId", "KitRole", "Orientation", "Start", "End", "OpenedByLine", "ClosedByLine"],
      ledger.installationComponents.map((c) => [c.id, c.installation, c.asset, c.kitrole, c.orientation, c.start, c.end, c.openedbyline, c.closedbyline])
    ),
  };
}

export function writeReport(params: Params, manifest: Manifest, checks: Check[], elapsedMs: number, determinism: Check | null): string {
  const reportsDir = path.join(REPO_ROOT, "migration", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `07_synthetic_${params.profile}_report.md`);
  const failed = checks.filter((c) => c.pass === false);
  const lines: string[] = [];
  lines.push(`# 07 — Synthetic fleet history: ${params.profile} profile`);
  lines.push("");
  lines.push(`Generated ${manifest.generatedAt} by \`app/scripts/synthetic/generate.ts\` v${manifest.generatorVersion} in ${(elapsedMs / 1000).toFixed(1)} s. Spec: \`specs/007-synthetic-data/spec.md\`.`);
  lines.push("");
  lines.push(`**Result: ${failed.length === 0 ? "PASS" : `FAIL — ${failed.length} check(s) failed`}.** ${failed.length === 0 ? "The manifest records `verified: true`; the dataset may be copied into the app." : "The manifest records `verified: false`; `scripts/copy-staged-data.mjs` refuses it."}`);
  lines.push("");
  lines.push("Every row in this dataset is fictional. Nothing in it describes a real asset, person, project or site. See `data/synthetic/README.md`.");
  lines.push("");
  lines.push("## Parameters");
  lines.push("");
  lines.push("| Parameter | Value |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(manifest.params)) lines.push(`| ${k} | ${v} |`);
  lines.push(`| inputs hash (data/synthetic) | ${manifest.inputsHash} |`);
  lines.push(`| output | \`${path.relative(REPO_ROOT, params.outDir).replace(/\\/g, "/")}/\` |`);
  lines.push("");
  lines.push("## Counts");
  lines.push("");
  lines.push("| Table | Rows |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(manifest.counts)) lines.push(`| ${k} | ${v.toLocaleString("en-CA")} |`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Id | Check | Result | Measured | Detail |");
  lines.push("|---|---|---|---|---|");
  const all = determinism ? [...checks, determinism] : checks;
  for (const c of all) {
    const result = c.pass === null ? "info" : c.pass ? "PASS" : "**FAIL**";
    lines.push(`| ${c.id} | ${c.name} | ${result} | ${c.value.replace(/\|/g, "\\|")} | ${(c.detail ?? "").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## Planted scenarios (FR-050)");
  lines.push("");
  lines.push("Stable for this seed. Open each identifier in the app to find the situation described.");
  lines.push("");
  lines.push("| Scenario | Description | Identifiers |");
  lines.push("|---|---|---|");
  for (const p of manifest.planted) lines.push(`| ${p.key} | ${p.description} | ${Object.entries(p.identifiers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ")} |`);
  lines.push("");
  lines.push("## Catalogue extensions (FR-031)");
  lines.push("");
  for (const e of manifest.catalogueExtensions) lines.push(`- ${e.manufacturer} ${e.model} (${e.equipmenttype}) — synthetic-only; not in \`data/reference/equipment_models.csv\`.`);
  lines.push("");
  lines.push("## Markers (FR-005)");
  lines.push("");
  for (const [k, v] of Object.entries(manifest.markers)) lines.push(`- ${k}: ${v}`);
  lines.push("");
  writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}
