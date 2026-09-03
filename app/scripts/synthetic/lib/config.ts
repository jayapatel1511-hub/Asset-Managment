/// <reference types="node" />
/**
 * Loads the committed inputs (data/synthetic/*.json — see its README), the real curated catalogue
 * and location hierarchy (migration/staged/), and resolves generation parameters and profiles
 * (FR-053). Also computes the hash of the inputs directory for the manifest.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EquipmentModel, Location } from "../../../src/api/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const SYNTHETIC_INPUTS = path.join(REPO_ROOT, "data", "synthetic");
export const STAGED_DIR = path.join(REPO_ROOT, "migration", "staged");
export const SOURCE_REGISTRY = path.join(REPO_ROOT, "data", "source", "registry_2026-09-02.csv");

export const GENERATOR_VERSION = "0.1.0";

export type Profile = "demo" | "standard" | "large";

export interface Params {
  seed: string;
  asOf: string; // YYYY-MM-DD
  historyYears: number;
  detailYears: number;
  deepRate: number; // fraction of detail-tier activity in the deep tier (FR-027)
  scale: number;
  profile: Profile;
  outDir: string;
}

export const PROFILE_SCALE: Record<Profile, number> = { demo: 0.25, standard: 1.0, large: 4.5 };

export interface OfficeConfig {
  name: string;
  activeFrom: string;
  share: number;
  lat: number;
  lon: number;
  areaCodes: string[];
  region: string;
}

export interface OfficeActivation {
  calLab: string;
  noAdminOffice: string;
  offices: OfficeConfig[];
}

export type ModelClass = "logger" | "sensor" | "mic" | "slm" | "modem" | "sim" | "standalone" | "component" | "static" | "accessory";
export type Hazard = "legacy" | "current" | "consumable" | "static";

export interface SerialRule {
  letters: string;
  digits: number;
  start: number;
}

export interface BundleRule {
  key: string;
  sameSerial?: boolean;
  component?: boolean;
  p: number;
}

export interface ModelWindow {
  from: number;
  to: number | null;
  target: number;
  class: ModelClass;
  family?: string;
  role?: "Sensor" | "Microphone" | "Modem";
  hazard: Hazard;
  serial: SerialRule | null;
  bundles?: BundleRule[];
  bundledOnly?: boolean;
  cycleMedianDays?: number;
}

export interface FamilyRule {
  sensorWeights: Record<string, number>;
  micProbability: number;
  modemProbability: number;
}

export interface ModelWindows {
  extensions: EquipmentModel[];
  models: Record<string, ModelWindow>;
  families: Record<string, FamilyRule>;
}

export interface RosterEntry {
  upn: string;
  displayName: string;
  office: string;
  role: "FieldUser" | "OfficeAdmin" | "SystemOwner";
  start: string;
  end: string | null;
}

export interface Discipline {
  key: string;
  label: string;
  regionWeights: Record<string, number>;
  templates: string[];
  durationMedianDays: number;
  durationSigma: number;
  stations: Record<string, number>;
  deployMedianDays: number;
  deploySigma: number;
  needsMic: number;
  standaloneTypes: string[];
}

export interface ProjectPool {
  numberPrefix: string;
  clients: string[];
  disciplines: Discipline[];
}

export interface SitePool {
  regions: Record<string, { streets: string[]; landmarks: string[] }>;
  positions: Array<string | null>;
}

export interface LoadedConfig {
  offices: OfficeActivation;
  windows: ModelWindows;
  roster: RosterEntry[];
  projects: ProjectPool;
  sites: SitePool;
  /** Real curated catalogue + synthetic-only extensions, in the app's EquipmentModel shape. */
  catalogue: EquipmentModel[];
  /** Real seeded hierarchy (offices, region, cal lab, storage). */
  locations: Location[];
  inputsHash: string;
}

export function modelKey(m: { manufacturer: string; model: string; equipmenttype: string }): string {
  return `${m.manufacturer}|${m.model}|${m.equipmenttype}`;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function hashInputs(): string {
  const h = createHash("sha256");
  for (const f of readdirSync(SYNTHETIC_INPUTS).sort()) {
    if (!f.endsWith(".json")) continue;
    h.update(f).update(readFileSync(path.join(SYNTHETIC_INPUTS, f)));
  }
  return h.digest("hex").slice(0, 16);
}

export function loadConfig(): LoadedConfig {
  const offices = readJson<OfficeActivation>(path.join(SYNTHETIC_INPUTS, "office_activation.json"));
  const windows = readJson<ModelWindows>(path.join(SYNTHETIC_INPUTS, "model_windows.json"));
  const roster = readJson<RosterEntry[]>(path.join(SYNTHETIC_INPUTS, "roster.json"));
  const projects = readJson<ProjectPool>(path.join(SYNTHETIC_INPUTS, "project_pool.json"));
  const sites = readJson<SitePool>(path.join(SYNTHETIC_INPUTS, "site_pool.json"));

  const realCatalogue = readJson<Array<EquipmentModel & { name?: string }>>(path.join(STAGED_DIR, "equipment_models.json"));
  const catalogue: EquipmentModel[] = [
    ...realCatalogue.map(({ name: _name, ...m }) => m),
    ...windows.extensions.map((e) => ({ ...e })),
  ];
  const locations = readJson<Location[]>(path.join(STAGED_DIR, "locations.json"));

  // Every catalogue row must have a window and vice versa (FR-032) — fail loudly, not silently.
  const catalogueKeys = new Set(catalogue.map(modelKey));
  for (const key of Object.keys(windows.models)) {
    if (!catalogueKeys.has(key)) throw new Error(`model_windows.json names a model not in the catalogue: ${key}`);
  }
  for (const key of catalogueKeys) {
    if (!windows.models[key]) throw new Error(`catalogue model has no window in model_windows.json: ${key}`);
  }
  for (const m of catalogue) {
    const w = windows.models[modelKey(m)];
    if (w.serial === null && m.isserialised && w.class !== "component") {
      throw new Error(`serialised model without a serial rule: ${modelKey(m)}`);
    }
  }
  const officeNames = new Set(locations.filter((l) => l.locationtype === "Office").map((l) => l.name));
  for (const o of offices.offices) {
    if (!officeNames.has(o.name)) throw new Error(`office_activation.json names an office not in the hierarchy: ${o.name}`);
  }

  return { offices, windows, roster, projects, sites, catalogue, locations, inputsHash: hashInputs() };
}

/** Parses CLI arguments into Params with the spec's defaults (FR-053). */
export function parseParams(argv: string[]): Params {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const profile = (get("profile") ?? "standard") as Profile;
  if (!(profile in PROFILE_SCALE)) throw new Error(`unknown profile ${profile}`);
  const seed = get("seed") ?? "englobe-ams-007";
  return {
    seed,
    asOf: get("as-of") ?? new Date().toISOString().slice(0, 10),
    historyYears: Number(get("history-years") ?? 20),
    detailYears: Number(get("detail-years") ?? 5),
    deepRate: Number(get("deep-rate") ?? 0.4),
    scale: Number(get("scale") ?? PROFILE_SCALE[profile]),
    profile,
    outDir: get("out") ?? path.join(REPO_ROOT, "migration", "synthetic", profile),
  };
}

/** Minimal RFC 4180 CSV reader — enough for the disjointness checks against the source export. */
export function readCsv(file: string): string[][] {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
