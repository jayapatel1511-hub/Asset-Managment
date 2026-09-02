/**
 * In-memory store for the mock backend. Hydrates from the migrated data (public/data/*.json,
 * copied from migration/staged/ by `npm run copy:staged-data`) on first load, then persists
 * every write to localStorage so a page reload doesn't lose what a technician just did — this
 * is the local stand-in for Dataverse's durability, not a replacement for it.
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
  EquipmentModel,
  Installation,
  InstallationComponent,
  Location,
  OfficeAdminAssignment,
  Project,
  TransactionHeader,
  TransactionLine,
} from "../types";

const LOCAL_STORAGE_KEY = "ams-mock-store-v1";

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
  private txnCounter = 0;
  ready: Promise<void>;

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
    store.txnCounter = store.transactions.length;
    return store;
  }

  private async load(): Promise<void> {
    const persisted = readLocalStorage();
    if (persisted) {
      this.hydrateFromSnapshot(persisted);
      return;
    }
    await this.hydrateFromStagedFiles();
    this.persist();
  }

  private async hydrateFromStagedFiles(): Promise<void> {
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
  }

  private hydrateFromSnapshot(snap: StoreSnapshot): void {
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
    this.txnCounter = snap.transactions.length;
  }

  persist(): void {
    const snap: StoreSnapshot = {
      assets: [...this.assets.values()],
      locations: this.locations,
      equipmentModels: this.equipmentModels,
      projects: this.projects,
      transactions: this.transactions,
      transactionLines: this.transactionLines,
      relationships: this.relationships,
      calibrationRecords: this.calibrationRecords,
      idSequence: this.idSequence,
      processedClientSubmissionIds: [...this.processedClientSubmissionIds],
      installations: this.installations,
      installationComponents: this.installationComponents,
      officeAdminAssignments: this.officeAdminAssignments,
    };
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snap));
    } catch {
      // localStorage can throw (private browsing, quota) — the in-memory store still works for
      // this session; a reload would just re-hydrate from the migrated snapshot.
    }
  }

  /** Dev/demo affordance: wipe local writes and reload the original migrated snapshot. */
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
    await this.hydrateFromStagedFiles();
    this.persist();
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
      const lineInput: TransactionLineInput = {
        type: params.transactiontype,
        date: params.date,
        tolocation: params.tolocation,
        touser: params.touser,
        toproject: params.toproject,
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
    this.transactions.push({
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
    });

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
      this.transactionLines.push({
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
      });
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load ${url} (${res.status}). Run \`npm run copy:staged-data\` after the migration pipeline has produced migration/staged/.`
    );
  }
  return res.json() as Promise<T>;
}

function readLocalStorage(): StoreSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoreSnapshot) : null;
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
