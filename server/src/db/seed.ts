/**
 * Seeds the database from a dataset directory under migration/ — the same JSON files
 * app/scripts/copy-staged-data.mjs copies into app/public/data/ for the mock backend, read here
 * straight from migration/ instead.
 *
 * Idempotent by dataset key: the manifest-derived key (or "real:<dir>" for the migrated data) is
 * stored in meta; a start-up against an already-seeded database does nothing, so the user's own
 * transactions survive restarts. `--reseed` (main.ts) forces a reload, which is the local
 * equivalent of the mock's "reset to migrated snapshot".
 *
 * Feature 007 FR-056 carries over: a synthetic dataset whose manifest says verified:false is
 * refused, never loaded.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import type {
  Asset,
  AssetRelationship,
  CalibrationRecord,
  DatasetInfo,
  EquipmentModel,
  Installation,
  InstallationComponent,
  Location,
  OfficeAdminAssignment,
  Project,
  TransactionHeader,
  TransactionLine,
} from "../../../app/src/api/types";
import { readMeta, writeMeta } from "./pglite";
import {
  ASSET_COLUMNS, assetToValues,
  CALIBRATION_COLUMNS, calibrationToValues,
  COMPONENT_COLUMNS, componentToValues,
  HEADER_COLUMNS, headerToValues,
  INSTALLATION_COLUMNS, installationToValues,
  LINE_COLUMNS, lineToValues,
  LOCATION_COLUMNS, locationToValues,
  MODEL_COLUMNS, modelToValues,
  PROJECT_COLUMNS, projectToValues,
  RELATIONSHIP_COLUMNS, relationshipToValues,
  insertRows,
} from "./rows";

interface Manifest {
  dataset?: string;
  seed?: string;
  profile?: string;
  asOf?: string;
  generatedAt?: string;
  verified?: boolean;
  counts?: Record<string, number>;
}

export interface SeedResult {
  seeded: boolean;
  dataset: DatasetInfo;
  datasetKey: string;
}

function readJson<T>(dir: string, file: string): T | null {
  const p = path.join(dir, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function requireJson<T>(dir: string, file: string): T {
  const v = readJson<T>(dir, file);
  if (v === null) {
    throw new Error(
      `${file} not found in ${dir}. For the real data run the migration pipeline (migration/01..05); ` +
        `for a synthetic profile run the generator (app: npm run synthetic -- --profile <name>).`
    );
  }
  return v;
}

/** Identical mapping to app/src/api/mock/store.ts: no manifest = the real migrated data. */
export function datasetInfoFrom(manifest: Manifest | null): DatasetInfo {
  if (!manifest) return { synthetic: false };
  return {
    synthetic: manifest.dataset === "synthetic",
    seed: manifest.seed,
    profile: manifest.profile,
    asOf: manifest.asOf,
    generatedAt: manifest.generatedAt,
    verified: manifest.verified,
    counts: manifest.counts,
  };
}

export function datasetKeyFor(info: DatasetInfo, dir: string): string {
  return info.synthetic ? `synthetic:${info.seed}:${info.profile}:${info.generatedAt}` : `real:${path.resolve(dir)}`;
}

/** Truncated together so foreign keys never block the reload. */
const TABLES = [
  "asset_transaction_line", "asset_transaction", "asset_relationship", "calibration_record",
  "installation_component", "installation", "office_admin_assignment", "command_idempotency",
  "asset", "location", "equipment_model", "project", "id_sequence",
];

export async function seedIfNeeded(db: PGlite, datasetDir: string, opts: { force?: boolean } = {}): Promise<SeedResult> {
  const manifest = readJson<Manifest>(datasetDir, "manifest.json");
  if (manifest?.verified === false) {
    throw new Error(`Refusing to load ${datasetDir}: its manifest says verified: false — the generator's own checks failed (feature 007 FR-056).`);
  }
  const dataset = datasetInfoFrom(manifest);
  const datasetKey = datasetKeyFor(dataset, datasetDir);

  if (!opts.force && (await readMeta(db, "dataset_key")) === datasetKey) {
    return { seeded: false, dataset, datasetKey };
  }

  const assets = requireJson<Asset[]>(datasetDir, "assets.json");
  const locations = requireJson<Location[]>(datasetDir, "locations.json");
  const models = requireJson<Array<EquipmentModel & { name?: string }>>(datasetDir, "equipment_models.json");
  const projects = requireJson<Project[]>(datasetDir, "projects.json");
  const transactions = requireJson<TransactionHeader[]>(datasetDir, "transactions.json");
  const lines = requireJson<TransactionLine[]>(datasetDir, "transactionlines.json");
  const relationships = requireJson<AssetRelationship[]>(datasetDir, "assetrelationships.json");
  const calibrations = requireJson<Array<CalibrationRecord & { source_row?: number }>>(datasetDir, "calibrationrecords.json");
  const idSequence = requireJson<Record<string, { nextvalue: number }>>(datasetDir, "idsequence.json");
  // Optional in the real data ("site history begins at go-live"); present in synthetic profiles.
  const installations = readJson<Installation[]>(datasetDir, "installations.json") ?? [];
  const components = readJson<InstallationComponent[]>(datasetDir, "installationcomponents.json") ?? [];
  const officeAdmins = readJson<OfficeAdminAssignment[]>(datasetDir, "officeadminassignments.json") ?? [];

  // line_number: deterministic order within each transaction, in file order.
  const perTxn = new Map<string, number>();
  const lineValues = lines.map((l) => {
    const n = (perTxn.get(l.transaction) ?? 0) + 1;
    perTxn.set(l.transaction, n);
    return lineToValues(l, n);
  });

  await db.transaction(async (tx: Transaction) => {
    await tx.exec(`TRUNCATE ${TABLES.join(", ")}`);
    await insertRows(tx, "location", LOCATION_COLUMNS, locations.map(locationToValues));
    await insertRows(tx, "equipment_model", MODEL_COLUMNS, models.map(modelToValues));
    await insertRows(tx, "project", PROJECT_COLUMNS, projects.map(projectToValues));
    await insertRows(tx, "asset", ASSET_COLUMNS, assets.map(assetToValues));
    await insertRows(tx, "asset_transaction", HEADER_COLUMNS, transactions.map((h) => headerToValues(h, null, h.transactiondate)));
    await insertRows(tx, "asset_transaction_line", LINE_COLUMNS, lineValues);
    await insertRows(tx, "asset_relationship", RELATIONSHIP_COLUMNS, relationships.map(relationshipToValues));
    await insertRows(
      tx,
      "calibration_record",
      CALIBRATION_COLUMNS,
      calibrations.map((c) => calibrationToValues({ ...c, id: c.id ?? randomUUID() }))
    );
    await insertRows(tx, "installation", INSTALLATION_COLUMNS, installations.map(installationToValues));
    await insertRows(tx, "installation_component", COMPONENT_COLUMNS, components.map(componentToValues));
    await insertRows(
      tx,
      "id_sequence",
      ["prefix", "nextvalue"],
      Object.entries(idSequence).map(([prefix, e]) => [prefix, e.nextvalue])
    );
    for (const oa of officeAdmins) {
      await tx.query("INSERT INTO office_admin_assignment (office, admin_upns) VALUES ($1, $2::jsonb)", [oa.office, JSON.stringify(oa.adminUpns)]);
    }
    // Mock parity: the human transaction counter continues from the number of migrated headers.
    if (transactions.length > 0) {
      await tx.query("SELECT setval('transaction_name_seq', $1, true)", [transactions.length]);
    } else {
      await tx.query("SELECT setval('transaction_name_seq', 1, false)");
    }
    await writeMeta(tx, "dataset_key", datasetKey);
    await writeMeta(tx, "dataset_info", JSON.stringify(dataset));
    await writeMeta(tx, "seeded_at", new Date().toISOString());
  });

  return { seeded: true, dataset, datasetKey };
}

/** Dataset provenance for a database seeded earlier (used when start-up skips seeding). */
export async function loadDatasetInfo(db: PGlite): Promise<DatasetInfo> {
  const raw = await readMeta(db, "dataset_info");
  return raw ? (JSON.parse(raw) as DatasetInfo) : { synthetic: false };
}
