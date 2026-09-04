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
 * refused, never loaded. Rule 12's OTHER half — a perfectly valid synthetic dataset loaded into a
 * production database — is no longer this file's job to catch: `meta.environment` is stamped here
 * and `db/migrations/0007_environment_guard.sql` refuses the pair in the database, where psql, a
 * restored dump and a future import job all have to pass too.
 *
 * Development identities are seeded on EVERY call, before the dataset-key short circuit, because
 * they are not dataset data — a restart that reloads nothing still needs its users
 * (`identity.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database, Tx } from "./database";
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
import { readMeta, resolveEnvironment, writeMeta } from "./database";
import { seedDevIdentities } from "./identity";
import { refreshCatalogueReferences } from "../services/referenceService";
import {
  ASSET_COLUMNS, assetToValues,
  IDENTIFIER_COLUMNS, identifierValuesForAsset,
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

/** RFC 4122 namespace for URLs — the same one Python's `uuid.NAMESPACE_URL` uses. */
const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/**
 * The TypeScript twin of `migration/04_load.py`'s `stable_guid`: uuid5 over `ams://<ns>/<key>`.
 * Byte-for-byte the same output for the same input, so an id derived here and an id staged by
 * the Python pipeline are the same id.
 */
export function stableGuid(namespace: string, key: string): string {
  const ns = Buffer.from(NAMESPACE_URL.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(`ams://${namespace}/${key}`, "utf8")])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A calibration record's id when the dataset does not carry one.
 *
 * This used to be `randomUUID()`, which made the REAL migrated dataset the one thing in the
 * pipeline that was not reproducible: all 164 records in `migration/staged/` have no `id`, so
 * every reload minted fresh ones and WS-W11's "second-run empty business diff" could never pass.
 * (Synthetic profiles were unaffected — their 34,914 records all carry uuid5 ids already, which
 * is exactly why the defect stayed hidden.)
 *
 * `05_calibrations.py` now stages an `id`, so this path should not fire for staged data any more.
 * It is kept, and made deterministic, because a loader that silently invents identity for ANY
 * input is the bug — not just for that one file.
 */
function calibrationId(c: CalibrationRecord & { source_row?: number }): string {
  if (c.id) return c.id;
  // source_row is unique per record where the migration provides it; the composite covers
  // anything that does not.
  const key = c.source_row !== undefined
    ? String(c.source_row)
    : [c.asset, c.calibrationdate ?? "", c.nextduedate, c.certificatenumber ?? ""].join("|");
  return stableGuid("calibration", key);
}

export function datasetKeyFor(info: DatasetInfo, dir: string): string {
  return info.synthetic ? `synthetic:${info.seed}:${info.profile}:${info.generatedAt}` : `real:${path.resolve(dir)}`;
}

/** Truncated together so foreign keys never block the reload. */
const TABLES = [
  "asset_transaction_line", "asset_transaction", "asset_relationship", "calibration_record",
  "installation_component", "installation", "office_admin_assignment", "command_idempotency",
  "asset_identifier", "asset", "location", "equipment_model", "project", "manufacturer", "equipment_category", "id_sequence",
  "data_quality_issue", "data_job",
];

export async function seedIfNeeded(db: Database, datasetDir: string, opts: { force?: boolean } = {}): Promise<SeedResult> {
  await seedDevIdentities(db);

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

  await db.transaction(async (tx: Tx) => {
    // Markers FIRST, before a single row is touched. Rule 12 says environment and seed markers are
    // "verified before any load", and the guard in 0007 fires on these writes — so stamping them
    // up front is what makes a refused load cost nothing instead of loading 6,626 synthetic assets
    // and rolling them back at the last statement. `meta` is not in TABLES, so the TRUNCATE below
    // does not undo this.
    await writeMeta(tx, "environment", resolveEnvironment());
    await writeMeta(tx, "dataset_key", datasetKey);
    await writeMeta(tx, "dataset_info", JSON.stringify(dataset));

    // The one sanctioned use of 0003's escape hatch. `TABLES` includes both history tables, and
    // TRUNCATE on either is refused outright without this — including by the statement-level
    // trigger that closed the hole a row trigger structurally cannot see. SET LOCAL dies with
    // this transaction, so it cannot leak onto the next command that borrows the connection.
    // An API route that copies this line is a bug: rule 5's correction path is a compensating
    // event, not an edit.
    await tx.exec("SET LOCAL ams.allow_history_write = 'on'");
    await tx.exec(`TRUNCATE ${TABLES.join(", ")}`);
    await insertRows(tx, "location", LOCATION_COLUMNS, locations.map(locationToValues));
    await insertRows(tx, "equipment_model", MODEL_COLUMNS, models.map(modelToValues));
    await refreshCatalogueReferences(tx);
    await insertRows(tx, "project", PROJECT_COLUMNS, projects.map(projectToValues));
    await insertRows(tx, "asset", ASSET_COLUMNS, assets.map(assetToValues));
    await insertRows(tx, "asset_identifier", IDENTIFIER_COLUMNS, assets.flatMap(identifierValuesForAsset));
    await insertRows(tx, "asset_transaction", HEADER_COLUMNS, transactions.map((h) => headerToValues(h, null, h.transactiondate)));
    await insertRows(tx, "asset_transaction_line", LINE_COLUMNS, lineValues);
    await insertRows(tx, "asset_relationship", RELATIONSHIP_COLUMNS, relationships.map(relationshipToValues));
    await insertRows(
      tx,
      "calibration_record",
      CALIBRATION_COLUMNS,
      calibrations.map((c) => calibrationToValues({ ...c, id: calibrationId(c) }))
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
    await writeMeta(tx, "seeded_at", new Date().toISOString());
  });

  return { seeded: true, dataset, datasetKey };
}

/** Dataset provenance for a database seeded earlier (used when start-up skips seeding). */
export async function loadDatasetInfo(db: Database): Promise<DatasetInfo> {
  const raw = await readMeta(db, "dataset_info");
  return raw ? (JSON.parse(raw) as DatasetInfo) : { synthetic: false };
}
