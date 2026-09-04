/**
 * In-memory store for the mock backend. Hydrates from the loaded dataset (public/data/*.json,
 * copied from migration/staged/ — or from a synthetic dataset — by `npm run copy:staged-data`)
 * on every load, then persists only the DELTA a user has created on top of it to localStorage,
 * so a page reload doesn't lose what a technician just did — this is the local stand-in for
 * Dataverse's durability, not a replacement for it.
 *
 * Feature 007 FR-060/SC-014 changed this from a whole-snapshot persist. The base dataset is
 * served from static files and never written to localStorage: a synthetic 20-year history is
 * tens of megabytes against a ~5 MB quota, and the old code caught the resulting QuotaExceeded
 * error and carried on in memory, so the user's own transactions vanished on reload without a
 * word. The delta is a few kilobytes and always fits.
 *
 * The write path (`applyTransaction`) is this app's copy of F1 (docs/03-automation.md): it
 * calls the same domain/deriveState.ts the app's own pre-submit check calls (Principle V — one
 * definition of the rule, enforced twice, not two definitions that could drift), applies the
 * result, mirrors it onto any permanent Component children (F1 step 5), and appends one
 * immutable TransactionLine per asset. Nothing here bypasses deriveState — this file is
 * plumbing, not a second copy of the transition matrix.
 */
import { deriveState, type AssetSnapshot, type RelationshipOp, type TransactionLineInput } from "../../domain/deriveState";
import type { AssetStatus, TransactionType } from "../../domain/stateMachine";
import type {
  Asset,
  AssetRelationship,
  CalibrationRecord,
  EquipmentCategory,
  EquipmentModel,
  Installation,
  InstallationComponent,
  Location,
  Manufacturer,
  OfficeAdminAssignment,
  Project,
  TransactionHeader,
  TransactionLine,
} from "../types";

const LOCAL_STORAGE_KEY = "ams-mock-store-v2"; // v1 held the whole snapshot; see the header

/** Identity of the dataset in public/data/, from its manifest. Absent manifest = the real
 * migrated data (feature 007 FR-007: no manifest means real, never the other way round). */
export interface DatasetInfo {
  synthetic: boolean;
  seed?: string;
  profile?: string;
  asOf?: string;
  generatedAt?: string;
  verified?: boolean;
  counts?: Record<string, number>;
}

const REAL_DATASET: DatasetInfo = { synthetic: false };

interface StagedAsset {
  id: string;
  assetid: string;
  migrationsource: string | null;
  equipmentmodel: { manufacturer: string; model: string; equipmenttype: string };
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
}

interface StagedIdSequenceEntry {
  nextvalue: number;
}

/** What a user did on top of the base dataset — the only thing localStorage holds. */
export interface StoreDelta {
  datasetKey: string;
  /** Assets whose fields differ from the base dataset (derived state the user's own
   * transactions produced), keyed by assetid. */
  assets: Asset[];
  transactions: TransactionHeader[];
  transactionLines: TransactionLine[];
  relationships: AssetRelationship[];
  calibrationRecords: CalibrationRecord[];
  locations: Location[];
  idSequence: Record<string, StagedIdSequenceEntry>;
  processedClientSubmissionIds: string[];
  installations: Installation[];
  installationComponents: InstallationComponent[];
  officeAdminAssignments: OfficeAdminAssignment[];
  manufacturers?: Manufacturer[];
  categories?: EquipmentCategory[];
  equipmentModels?: EquipmentModel[];
  projects?: Project[];
}

export interface StoreSnapshot {
  assets: Asset[];
  locations: Location[];
  equipmentModels: EquipmentModel[];
  projects: Project[];
  transactions: TransactionHeader[];
  transactionLines: TransactionLine[];
  relationships: AssetRelationship[];
  calibrationRecords: CalibrationRecord[];
  idSequence: Record<string, StagedIdSequenceEntry>;
  processedClientSubmissionIds: string[];
  // Feature 005 (WS-A). No staged JSON for these — "site history begins at go-live" (the source
  // spreadsheet's own deployment sheet has 16 columns and zero rows), so they start empty rather
  // than being fetched from migration/staged/.
  installations: Installation[];
  installationComponents: InstallationComponent[];
  // Feature 004 US4 (WS-D). Starts empty — every office is an FR-027a gap until an admin
  // assigns someone, which is the honest default, not a migration omission.
  officeAdminAssignments: OfficeAdminAssignment[];
  manufacturers: Manufacturer[];
  categories: EquipmentCategory[];
}

let cached: MockStore | null = null;

export class MockStore {
  assets: Map<string, Asset> = new Map(); // keyed by assetid (the tag) — matches domain layer
  locations: Location[] = [];
  equipmentModels: EquipmentModel[] = [];
  projects: Project[] = [];
  transactions: TransactionHeader[] = [];
  transactionLines: TransactionLine[] = [];
  relationships: AssetRelationship[] = [];
  calibrationRecords: CalibrationRecord[] = [];
  idSequence: Record<string, StagedIdSequenceEntry> = {};
  processedClientSubmissionIds: Set<string> = new Set();
  /** Feature 005 (WS-A) — owned in the sense that only deployment.ts writes to these; the arrays
   * themselves live here because store.ts is the one file every write path (and persist/hydrate)
   * already goes through. See StoreSnapshot's comment for why they start empty. */
  installations: Installation[] = [];
  installationComponents: InstallationComponent[] = [];
  /** Feature 004 US4 (WS-D) — same ownership note as above, for admin.ts. */
  officeAdminAssignments: OfficeAdminAssignment[] = [];
  manufacturers: Manufacturer[] = [];
  categories: EquipmentCategory[] = [];
  private txnCounter = 0;
  ready: Promise<void>;
  /** Provenance of the loaded dataset (feature 007 FR-007). */
  dataset: DatasetInfo = REAL_DATASET;
  /** Base-dataset fingerprints, captured after hydration; everything beyond them is the delta. */
  private baseAssetJson = new Map<string, string>();
  private baseCounts = { transactions: 0, transactionLines: 0, relationships: 0, calibrationRecords: 0, locations: 0, installations: 0, installationComponents: 0 };
  private baseRelationshipJson = new Map<string, string>();
  private baseInstallationJson = new Map<string, string>();
  private baseInstallationComponentJson = new Map<string, string>();
  /** Read indexes over the append-only history. Built on first use and maintained on write —
   * never a second copy of the data, just a lookup into it. See `linesForAsset`. */
  private txnById: Map<string, TransactionHeader> | null = null;
  private linesByAsset: Map<string, TransactionLine[]> | null = null;

  constructor(options: { skipAutoLoad?: boolean } = {}) {
    this.ready = options.skipAutoLoad ? Promise.resolve() : this.load();
  }

  /** Test-only entry point: hydrate synchronously from in-memory fixture data, bypassing
   * fetch() and localStorage entirely so domain/api tests don't need a running dev server. */
  static forTesting(data: {
    assets: StagedAsset[];
    locations?: Location[];
    equipmentModels?: EquipmentModel[];
    projects?: Project[];
    transactions?: TransactionHeader[];
    transactionLines?: TransactionLine[];
    relationships?: AssetRelationship[];
    calibrationRecords?: CalibrationRecord[];
    idSequence?: Record<string, StagedIdSequenceEntry>;
    installations?: Installation[];
    installationComponents?: InstallationComponent[];
    officeAdminAssignments?: OfficeAdminAssignment[];
    manufacturers?: Manufacturer[];
    categories?: EquipmentCategory[];
  }): MockStore {
    const store = new MockStore({ skipAutoLoad: true });
    for (const a of data.assets) {
      store.assets.set(a.assetid, { ...a, retirementreason: a.retirementreason as Asset["retirementreason"] });
    }
    store.locations = data.locations ?? [];
    store.equipmentModels = data.equipmentModels ?? [];
    store.projects = data.projects ?? [];
    store.transactions = data.transactions ?? [];
    store.transactionLines = data.transactionLines ?? [];
    store.relationships = data.relationships ?? [];
    store.calibrationRecords = data.calibrationRecords ?? [];
    store.idSequence = data.idSequence ?? {};
    store.installations = data.installations ?? [];
    store.installationComponents = data.installationComponents ?? [];
    store.officeAdminAssignments = data.officeAdminAssignments ?? [];
    store.manufacturers = data.manufacturers ?? [];
    store.categories = data.categories ?? [];
    store.txnCounter = store.transactions.length;
    store.invalidateHistoryIndexes();
    return store;
  }

  private async load(): Promise<void> {
    // The base dataset always comes from the static files — never from localStorage, which could
    // not hold a synthetic history and, worse, would pin an old copy of the real one (FR-060).
    await this.hydrateFromStagedFiles();
    this.captureBaseline();
    const delta = readLocalStorage();
    if (delta && delta.datasetKey === this.datasetKey()) this.applyDelta(delta);
    else if (delta) window.localStorage.removeItem(LOCAL_STORAGE_KEY); // a different dataset is loaded
  }

  /** Stable identity of the loaded base data, so a delta recorded against one dataset is never
   * replayed onto another (switching real <-> synthetic, or regenerating with a new seed). */
  private datasetKey(): string {
    return this.dataset.synthetic ? `synthetic:${this.dataset.seed}:${this.dataset.profile}:${this.dataset.generatedAt}` : "real";
  }

  private captureBaseline(): void {
    this.baseAssetJson = new Map([...this.assets.values()].map((a) => [a.assetid, JSON.stringify(a)]));
    this.baseRelationshipJson = new Map(this.relationships.map((r) => [r.id, JSON.stringify(r)]));
    this.baseInstallationJson = new Map(this.installations.map((i) => [i.id, JSON.stringify(i)]));
    this.baseInstallationComponentJson = new Map(this.installationComponents.map((c) => [c.id, JSON.stringify(c)]));
    this.baseCounts = {
      transactions: this.transactions.length,
      transactionLines: this.transactionLines.length,
      relationships: this.relationships.length,
      calibrationRecords: this.calibrationRecords.length,
      locations: this.locations.length,
      installations: this.installations.length,
      installationComponents: this.installationComponents.length,
    };
  }

  private applyDelta(delta: StoreDelta): void {
    for (const a of delta.assets) this.assets.set(a.assetid, a);
    this.transactions.push(...delta.transactions);
    this.transactionLines.push(...delta.transactionLines);
    this.calibrationRecords.push(...delta.calibrationRecords);
    this.locations.push(...delta.locations);
    for (const r of delta.relationships) {
      const i = this.relationships.findIndex((x) => x.id === r.id);
      if (i >= 0) this.relationships[i] = r;
      else this.relationships.push(r);
    }
    for (const inst of delta.installations) {
      const i = this.installations.findIndex((x) => x.id === inst.id);
      if (i >= 0) this.installations[i] = inst;
      else this.installations.push(inst);
    }
    for (const c of delta.installationComponents) {
      const i = this.installationComponents.findIndex((x) => x.id === c.id);
      if (i >= 0) this.installationComponents[i] = c;
      else this.installationComponents.push(c);
    }
    this.officeAdminAssignments = delta.officeAdminAssignments;
    if (delta.manufacturers) this.manufacturers = delta.manufacturers;
    if (delta.categories) this.categories = delta.categories;
    if (delta.equipmentModels) {
      for (const m of delta.equipmentModels) {
        const i = this.equipmentModels.findIndex(
          (x) => x.manufacturer === m.manufacturer && x.model === m.model && x.equipmenttype === m.equipmenttype
        );
        if (i >= 0) this.equipmentModels[i] = m;
        else this.equipmentModels.push(m);
      }
    }
    if (delta.projects) {
      for (const p of delta.projects) {
        const i = this.projects.findIndex((x) => x.id === p.id);
        if (i >= 0) this.projects[i] = p;
        else this.projects.push(p);
      }
    }
    this.invalidateHistoryIndexes();
    this.idSequence = { ...this.idSequence, ...delta.idSequence };
    this.processedClientSubmissionIds = new Set(delta.processedClientSubmissionIds);
    this.txnCounter = this.transactions.length;
  }

  private async hydrateFromStagedFiles(): Promise<void> {
    // Feature 007: a synthetic dataset ships a manifest and two extra tables; the real migrated
    // data ships neither, and its absence is what identifies it as real (FR-007).
    this.dataset = (await fetchJsonOptional<DatasetInfo & { dataset?: string; seed?: string }>("/data/manifest.json").then((m) =>
      m ? { synthetic: m.dataset === "synthetic", seed: m.seed, profile: m.profile, asOf: m.asOf, generatedAt: m.generatedAt, verified: m.verified, counts: m.counts } : REAL_DATASET
    )) as DatasetInfo;
    const [assets, locations, models, projects, transactions, lines, relationships, calRecords, idSeq] =
      await Promise.all([
        fetchJson<StagedAsset[]>("/data/assets.json"),
        fetchJson<Location[]>("/data/locations.json"),
        fetchJson<EquipmentModel[]>("/data/equipment_models.json"),
        fetchJson<Project[]>("/data/projects.json"),
        fetchJson<TransactionHeader[]>("/data/transactions.json"),
        fetchJson<TransactionLine[]>("/data/transactionlines.json"),
        fetchJson<AssetRelationship[]>("/data/assetrelationships.json"),
        fetchJson<CalibrationRecord[]>("/data/calibrationrecords.json"),
        fetchJson<Record<string, StagedIdSequenceEntry>>("/data/idsequence.json"),
      ]);

    for (const a of assets) {
      this.assets.set(a.assetid, {
        id: a.id,
        assetid: a.assetid,
        migrationsource: a.migrationsource,
        equipmentmodel: a.equipmentmodel,
        serialnumber: a.serialnumber,
        homeoffice: a.homeoffice,
        lifecycle: a.lifecycle,
        status: a.status,
        currentlocation: a.currentlocation,
        custodian: a.custodian,
        currentproject: a.currentproject,
        parentasset: a.parentasset,
        lastcaldate: a.lastcaldate,
        nextcaldue: a.nextcaldue,
        retirementreason: a.retirementreason as Asset["retirementreason"],
        notes: a.notes,
        carrier: a.carrier,
        identifiervalue: a.identifiervalue,
        phonenumber: a.phonenumber,
        staticip: a.staticip,
      });
    }
    this.locations = locations;
    this.equipmentModels = models;
    this.projects = projects;
    this.transactions = transactions;
    this.transactionLines = lines;
    this.relationships = relationships;
    this.calibrationRecords = calRecords;
    this.idSequence = idSeq;
    this.txnCounter = transactions.length;
    this.invalidateHistoryIndexes();
    this.installations = (await fetchJsonOptional<Installation[]>("/data/installations.json")) ?? [];
    this.installationComponents = (await fetchJsonOptional<InstallationComponent[]>("/data/installationcomponents.json")) ?? [];
    this.officeAdminAssignments = (await fetchJsonOptional<OfficeAdminAssignment[]>("/data/officeadminassignments.json")) ?? [];
  }

  /** Test/utility entry point: replace everything from a full snapshot. Not used by load(),
   * which hydrates the base from static files and applies only the user delta (FR-060). */
  hydrateFromSnapshot(snap: StoreSnapshot): void {
    this.assets = new Map(snap.assets.map((a) => [a.assetid, a]));
    this.locations = snap.locations;
    this.equipmentModels = snap.equipmentModels;
    this.projects = snap.projects;
    this.transactions = snap.transactions;
    this.transactionLines = snap.transactionLines;
    this.relationships = snap.relationships;
    this.calibrationRecords = snap.calibrationRecords;
    this.idSequence = snap.idSequence;
    // ?? [] guards a localStorage snapshot persisted before these fields existed — an old
    // snapshot must still load cleanly, not throw on a missing key.
    this.installations = snap.installations ?? [];
    this.installationComponents = snap.installationComponents ?? [];
    this.officeAdminAssignments = snap.officeAdminAssignments ?? [];
    this.processedClientSubmissionIds = new Set(snap.processedClientSubmissionIds);
    this.invalidateHistoryIndexes();
    this.txnCounter = snap.transactions.length;
  }

  /** FR-060: writes only what the user added or changed. Never the base dataset. */
  buildDelta(): StoreDelta {
    const changedAssets: Asset[] = [];
    for (const a of this.assets.values()) {
      const base = this.baseAssetJson.get(a.assetid);
      if (base === undefined || base !== JSON.stringify(a)) changedAssets.push(a);
    }
    const changedRelationships = this.relationships.filter((r) => {
      const base = this.baseRelationshipJson.get(r.id);
      return base === undefined || base !== JSON.stringify(r);
    });
    const changedInstallations = this.installations.filter((i) => {
      const base = this.baseInstallationJson.get(i.id);
      return base === undefined || base !== JSON.stringify(i);
    });
    const changedInstallationComponents = this.installationComponents.filter((c) => {
      const base = this.baseInstallationComponentJson.get(c.id);
      return base === undefined || base !== JSON.stringify(c);
    });
    return {
      datasetKey: this.datasetKey(),
      assets: changedAssets,
      transactions: this.transactions.slice(this.baseCounts.transactions),
      transactionLines: this.transactionLines.slice(this.baseCounts.transactionLines),
      relationships: changedRelationships,
      calibrationRecords: this.calibrationRecords.slice(this.baseCounts.calibrationRecords),
      locations: this.locations.slice(this.baseCounts.locations),
      idSequence: this.idSequence,
      processedClientSubmissionIds: [...this.processedClientSubmissionIds],
      installations: changedInstallations,
      installationComponents: changedInstallationComponents,
      officeAdminAssignments: this.officeAdminAssignments,
      manufacturers: this.manufacturers,
      categories: this.categories,
      equipmentModels: this.equipmentModels,
      projects: this.projects,
    };
  }

  persist(): void {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.buildDelta()));
    } catch {
      // localStorage can throw (private browsing, quota). The delta is small enough that this is
      // now genuinely exceptional rather than the expected outcome it was for a whole snapshot.
    }
  }

  /** Dev/demo affordance: discard local writes and reload the loaded dataset as generated. */
  async resetToMigratedSnapshot(): Promise<void> {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    this.assets.clear();
    this.transactions = [];
    this.transactionLines = [];
    this.relationships = [];
    this.calibrationRecords = [];
    this.installations = [];
    this.installationComponents = [];
    this.officeAdminAssignments = [];
    this.processedClientSubmissionIds.clear();
    this.invalidateHistoryIndexes();
    await this.hydrateFromStagedFiles();
    this.captureBaseline();
  }

  nextTransactionName(): string {
    this.txnCounter += 1;
    return `TXN-${String(this.txnCounter).padStart(6, "0")}`;
  }

  nextSequence(prefix: string): number {
    const entry = this.idSequence[prefix] ?? { nextvalue: 1 };
    const value = entry.nextvalue;
    this.idSequence[prefix] = { nextvalue: value + 1 };
    return value;
  }

  /**
   * One asset's transaction lines, and one transaction by id.
   *
   * These exist because feature 007's synthetic history made an existing quadratic read path
   * unmissable: `getAssetHistory` filtered the whole line table and rebuilt a Map of every
   * transaction on EVERY call, and `features/reports/UtilisationPage.tsx` calls it once per
   * asset. Against the real migrated data (1,026 lines, 11 transactions) that is invisible;
   * against 91,616 lines and 62,969 transactions it is ~300 million operations and the page took
   * over two minutes. Indexing makes it linear once, then a lookup per asset. No behaviour
   * changes — same rows, same order.
   */
  linesForAsset(assetId: string): TransactionLine[] {
    if (!this.linesByAsset) {
      const index = new Map<string, TransactionLine[]>();
      for (const line of this.transactionLines) {
        const list = index.get(line.asset);
        if (list) list.push(line);
        else index.set(line.asset, [line]);
      }
      this.linesByAsset = index;
    }
    return this.linesByAsset.get(assetId) ?? [];
  }

  transactionById(id: string): TransactionHeader | undefined {
    if (!this.txnById) this.txnById = new Map(this.transactions.map((t) => [t.id, t]));
    return this.txnById.get(id);
  }

  /** Called wherever the history arrays are replaced wholesale (hydrate, delta, reset). Appends
   * during a write keep the indexes up to date incrementally instead — see applyTransaction. */
  private invalidateHistoryIndexes(): void {
    this.txnById = null;
    this.linesByAsset = null;
  }

  toSnapshot(asset: Asset): AssetSnapshot {
    return {
      assetId: asset.assetid,
      status: asset.status,
      lifecycle: asset.lifecycle,
      homeoffice: asset.homeoffice,
      currentlocation: asset.currentlocation,
      custodian: asset.custodian,
      currentproject: asset.currentproject,
      parentasset: asset.parentasset,
    };
  }

  openRelationshipsAsChild(assetid: string): AssetRelationship[] {
    return this.relationships.filter((r) => r.childasset === assetid && r.end === null);
  }

  openRelationshipsAsParent(assetid: string): AssetRelationship[] {
    return this.relationships.filter((r) => r.parentasset === assetid && r.end === null);
  }

  /** Permanent Component children of an asset (Q5/Q7): follow the parent automatically, never
   * get their own transaction line (F1 step 5). */
  openComponentChildren(parentAssetId: string): AssetRelationship[] {
    return this.relationships.filter(
      (r) => r.parentasset === parentAssetId && r.relationshiptype === "Component" && r.end === null
    );
  }

  /**
   * Applies one transaction across a set of asset lines atomically (FR-003): every line is
   * validated via deriveState BEFORE any is written; if any fails, nothing is written.
   * Permanent Component children of a touched asset are mirrored (F1 step 5) without their own
   * line. Idempotent on clientSubmissionId (FR-007).
   */
  applyTransaction(params: {
    clientSubmissionId: string;
    transactiontype: TransactionType;
    performedby: string;
    date: string;
    fromlocation?: string | null;
    tolocation?: string | null;
    fromuser?: string | null;
    touser?: string | null;
    fromproject?: string | null;
    toproject?: string | null;
    toLocationKind?: "Office" | "Site" | "CalibrationLab" | "Other" | null;
    calibrationResult?: "Pass" | "Fail" | "Adjusted" | null;
    primaryAssetId?: string | null;
    expectedreturn?: string | null;
    notes?: string | null;
    lines: Array<{
      assetId: string;
      condition?: TransactionLine["condition"];
      kitRole?: TransactionLine["kitrole"];
      retirementReason?: string | null;
      // Feature 005 (WS-A): Deploy lines carry orientation/powersource. Optional and unused by
      // every existing transaction type — added in Phase 0 because store.ts is frozen afterward
      // and this was the only place that could not otherwise be reached from api/mock/deployment.ts.
      orientation?: TransactionLine["orientation"];
      powersource?: TransactionLine["powersource"];
    }>;
  }): { ok: true; transactionId: string; transactionName: string } | { ok: false; reason: string; offendingAssetId?: string } {
    if (this.processedClientSubmissionIds.has(params.clientSubmissionId)) {
      // already applied — return success idempotently rather than reprocess (FR-007)
      const existing = this.transactions.find((t) => t.notes?.includes(params.clientSubmissionId));
      return { ok: true, transactionId: existing?.id ?? "already-processed", transactionName: existing?.name ?? "already-processed" };
    }

    // pass 1: validate every line without mutating anything
    const plans: Array<{ asset: Asset; result: ReturnType<typeof deriveState> }> = [];
    for (const line of params.lines) {
      const asset = this.assets.get(line.assetId);
      if (!asset) {
        return { ok: false, reason: `Unknown asset ${line.assetId}.`, offendingAssetId: line.assetId };
      }
      // FR-026: refuse to check out (or return/transfer) a permanent Component child alone
      if (
        (params.transactiontype === "Checkout" || params.transactiontype === "Deploy") &&
        this.openRelationshipsAsChild(asset.assetid).some((r) => r.relationshiptype === "Component")
      ) {
        return {
          ok: false,
          reason: `${asset.assetid} is a permanent component of another asset and cannot be transacted on its own.`,
          offendingAssetId: asset.assetid,
        };
      }
      const foundDefaultsToHome =
        params.transactiontype === "Found" && !params.tolocation && !params.touser && !params.toproject;
      const lineInput: TransactionLineInput = {
        type: params.transactiontype,
        date: params.date,
        tolocation: foundDefaultsToHome ? asset.homeoffice : params.tolocation,
        toLocationKind: foundDefaultsToHome ? "Office" : params.toLocationKind,
        touser: params.touser,
        toproject: params.toproject,
        calibrationResult: params.calibrationResult,
        primaryAssetId: params.primaryAssetId,
        retirementReason: line.retirementReason,
        isPrimary: params.primaryAssetId === asset.assetid,
      };
      const result = deriveState(this.toSnapshot(asset), lineInput);
      if (!result.ok) {
        return { ok: false, reason: result.reason, offendingAssetId: asset.assetid };
      }
      plans.push({ asset, result });
    }

    // pass 2: everything validated — write the transaction header, lines, asset updates,
    // relationship ops, and mirror onto Component children. All-or-nothing is guaranteed by
    // pass 1 having already returned on any failure.
    const transactionId = `mock-txn-${crypto.randomUUID()}`;
    const transactionName = this.nextTransactionName();
    const header: TransactionHeader = {
      id: transactionId,
      name: transactionName,
      transactiontype: params.transactiontype,
      transactiondate: params.date,
      performedby: params.performedby,
      fromlocation: params.fromlocation ?? null,
      tolocation: params.tolocation ?? null,
      fromuser: params.fromuser ?? null,
      touser: params.touser ?? null,
      fromproject: params.fromproject ?? null,
      toproject: params.toproject ?? null,
      primaryasset: params.primaryAssetId ?? null,
      notes: [params.notes, `[clientSubmissionId:${params.clientSubmissionId}]`].filter(Boolean).join(" "),
      expectedreturn: params.expectedreturn ?? null,
    };
    this.transactions.push(header);
    if (this.txnById) this.txnById.set(header.id, header);

    for (const line of params.lines) {
      const plan = plans.find((p) => p.asset.assetid === line.assetId)!;
      if (!plan.result.ok) continue; // unreachable, satisfies TS narrowing
      const statusBefore = plan.asset.status;
      const updated: Asset = {
        ...plan.asset,
        status: plan.result.fields.statusAfter,
        lifecycle: plan.result.fields.lifecycle,
        custodian: plan.result.fields.custodian,
        currentlocation: plan.result.fields.currentlocation,
        currentproject: plan.result.fields.currentproject,
        retirementreason: (plan.result.fields.retirementReason as Asset["retirementreason"]) ?? plan.asset.retirementreason,
      };
      this.assets.set(plan.asset.assetid, updated);
      const newLine: TransactionLine = {
        id: `mock-line-${crypto.randomUUID()}`,
        transaction: transactionId,
        asset: plan.asset.assetid,
        statusbefore: statusBefore,
        statusafter: plan.result.fields.statusAfter,
        kitrole: line.kitRole ?? null,
        orientation: line.orientation ?? null,
        powersource: line.powersource ?? null,
        condition: line.condition ?? null,
        processed: true,
        notes: null,
      };
      this.transactionLines.push(newLine);
      if (this.linesByAsset) {
        const list = this.linesByAsset.get(newLine.asset);
        if (list) list.push(newLine);
        else this.linesByAsset.set(newLine.asset, [newLine]);
      }
      this.applyRelationshipOps(plan.result.relationshipOps, transactionId);
      this.mirrorComponentChildren(updated);
    }

    this.processedClientSubmissionIds.add(params.clientSubmissionId);
    this.persist();
    return { ok: true, transactionId, transactionName };
  }

  private applyRelationshipOps(ops: RelationshipOp[], transactionId: string): void {
    for (const op of ops) {
      if (op.op === "open") {
        this.relationships.push({
          id: `mock-rel-${crypto.randomUUID()}`,
          parentasset: op.parentAssetId,
          childasset: op.childAssetId,
          relationshiptype: "Kit",
          start: op.start,
          end: null,
          createdbyline: transactionId,
          closedbyline: null,
        });
        const child = this.assets.get(op.childAssetId);
        if (child) this.assets.set(child.assetid, { ...child, parentasset: op.parentAssetId });
      } else if (op.op === "closeAsChild") {
        for (const rel of this.relationships) {
          if (rel.childasset === op.childAssetId && rel.end === null && rel.relationshiptype === "Kit") {
            rel.end = op.end;
            rel.closedbyline = transactionId;
          }
        }
        const child = this.assets.get(op.childAssetId);
        if (child && child.parentasset) this.assets.set(child.assetid, { ...child, parentasset: null });
      } else if (op.op === "closeAllAsParent") {
        for (const rel of this.relationships) {
          if (rel.parentasset === op.parentAssetId && rel.end === null && rel.relationshiptype === "Kit") {
            rel.end = op.end;
            rel.closedbyline = transactionId;
            const child = this.assets.get(rel.childasset);
            if (child) this.assets.set(child.assetid, { ...child, parentasset: null });
          }
        }
      }
    }
  }

  /** F1 step 5: permanent Component children mirror their parent's status/location/custodian —
   * no transaction line of their own; the parent's line IS their history. */
  private mirrorComponentChildren(parent: Asset): void {
    for (const rel of this.openComponentChildren(parent.assetid)) {
      const child = this.assets.get(rel.childasset);
      if (!child) continue;
      this.assets.set(child.assetid, {
        ...child,
        status: parent.status,
        currentlocation: parent.currentlocation,
        custodian: parent.custodian,
        currentproject: parent.currentproject,
      });
    }
  }
}

/** Returns null when the file is simply not part of this dataset (the real migrated data has no
 * manifest and no installation tables) — distinct from a genuine load failure of a required file. */
async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load ${url} (${res.status}). Run \`npm run copy:staged-data\` after the migration pipeline has produced migration/staged/.`
    );
  }
  return res.json() as Promise<T>;
}

function readLocalStorage(): StoreDelta | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoreDelta) : null;
  } catch {
    return null;
  }
}

export function getMockStore(): MockStore {
  if (!cached) cached = new MockStore();
  return cached;
}

/** Test-only: force a fresh store instance (vitest resets modules between files anyway, but this
 * makes intent explicit in tests that construct their own store rather than the singleton). */
export function createMockStore(): MockStore {
  return new MockStore();
}
