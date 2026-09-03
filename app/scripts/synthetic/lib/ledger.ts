/**
 * The Ledger — every row the generator emits, written only through the same rules the app's
 * write path enforces.
 *
 * This is deliberately a re-statement of `api/mock/store.ts`'s `applyTransaction` (validate every
 * line with domain/deriveState BEFORE writing anything; write header + one line per asset; apply
 * the relationship ops deriveState returns; mirror permanent Component children — F1 step 5),
 * with three differences that exist only because a 140,000-line simulation is not an interactive
 * session: relationship lookups are indexed rather than array scans; ids come from
 * `IdFactory` rather than `crypto.randomUUID()` (FR-052 determinism); and nothing is persisted to
 * localStorage. It never sets a derived field except through deriveState's result (Principle I —
 * the generator is a simulated user plus a simulated F1, not a row writer).
 *
 * Per-asset timestamp spacing (FR-016) is enforced here: a transaction's timestamp is pushed
 * forward until every asset on it is at least 60 s past its previous line. The sim never has to
 * think about it.
 */
import { deriveState, type AssetSnapshot, type RelationshipOp, type TransactionLineInput } from "../../../src/domain/deriveState";
import type { AssetStatus, TransactionType } from "../../../src/domain/stateMachine";
import { mintAssetId, mintTemporaryId } from "../../../src/domain/assetId";
import type {
  Asset,
  AssetRelationship,
  CalibrationRecord,
  EquipmentModel,
  Installation,
  InstallationComponent,
  KitRole,
  Location,
  Orientation,
  PowerSource,
  Project,
  TransactionHeader,
  TransactionLine,
} from "../../../src/api/types";
import type { IdFactory } from "./ids";
import { maxIso, plusSeconds, type UtcIso } from "./time";

export const MIN_SPACING_SECONDS = 60;

export interface LineRequest {
  assetId: string;
  kitRole?: KitRole | null;
  orientation?: Orientation | null;
  powersource?: PowerSource | null;
  condition?: TransactionLine["condition"];
  retirementReason?: string | null;
}

export interface TxRequest {
  type: TransactionType;
  /** Desired UTC timestamp; may be pushed later for spacing. */
  ts: UtcIso;
  performedby: string;
  fromlocation?: string | null;
  tolocation?: string | null | undefined;
  fromuser?: string | null;
  touser?: string | null | undefined;
  fromproject?: string | null;
  toproject?: string | null | undefined;
  primaryAssetId?: string | null;
  expectedreturn?: string | null;
  notes?: string | null;
  lines: LineRequest[];
}

export interface TxResult {
  transactionId: string;
  transactionName: string;
  ts: UtcIso;
}

export interface RegisterRequest {
  model: EquipmentModel;
  serial: string | null;
  homeoffice: string;
  ts: UtcIso;
  performedby: string;
  notes?: string | null;
  carrier?: string | null;
  identifiervalue?: string | null;
  phonenumber?: string | null;
  staticip?: string | null;
  temporaryTag?: boolean;
}

export interface CalibrationRequest {
  assetId: string;
  calibrationdate: string; // Toronto calendar date
  nextduedate?: string | null;
  lab: string | null;
  certificatenumber: string | null;
  cost: string | null;
  result: CalibrationRecord["result"];
  /** When the asset is InCalibration, the ReturnFromCalibration is recorded at this instant. */
  ts: UtcIso;
  performedby: string;
}

/** A per-asset state record the answer key reads — the sim's own account, not a replay. */
export interface TrackedState {
  status: AssetStatus;
  lifecycle: Asset["lifecycle"];
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  parentasset: string | null;
}

export class Ledger {
  readonly assets = new Map<string, Asset>();
  readonly transactions: TransactionHeader[] = [];
  readonly lines: TransactionLine[] = [];
  readonly relationships: AssetRelationship[] = [];
  readonly calibrationRecords: CalibrationRecord[] = [];
  readonly installations: Installation[] = [];
  readonly installationComponents: InstallationComponent[] = [];
  readonly locations: Location[];
  readonly projects: Project[] = [];
  readonly idSequence: Record<string, { nextvalue: number }> = {};
  readonly cellCounts = new Map<string, number>();
  readonly lastTs = new Map<string, UtcIso>();
  readonly acquiredOn = new Map<string, string>(); // assetid -> first line ts

  private txnSeq = 0;
  private openKitByChild = new Map<string, AssetRelationship>();
  private openKitsByParent = new Map<string, Set<AssetRelationship>>();
  private componentParent = new Map<string, AssetRelationship>(); // child -> Component rel
  private componentChildren = new Map<string, Set<string>>(); // parent -> child ids
  private linesByAsset = new Map<string, number>();
  private installationById = new Map<string, Installation>();
  private openComponentRowsByInstallation = new Map<string, InstallationComponent[]>();

  constructor(
    private readonly ids: IdFactory,
    private readonly catalogue: EquipmentModel[],
    baseLocations: Location[],
    private readonly noteMarker: string,
    private readonly sourceMarker: string,
    /** Non-serialised sequences start here so no synthetic tag can equal a real one (FR-002). */
    private readonly sequenceStart = 5001
  ) {
    this.locations = baseLocations.map((l) => ({ ...l }));
  }

  // ---------------------------------------------------------------- reference data

  findModel(m: { manufacturer: string; model: string; equipmenttype: string }): EquipmentModel | undefined {
    return this.catalogue.find((c) => c.manufacturer === m.manufacturer && c.model === m.model && c.equipmenttype === m.equipmenttype);
  }

  addProject(p: Omit<Project, "id">): Project {
    const project: Project = { id: this.ids.keyed("project", p.projectnumber), ...p };
    this.projects.push(project);
    return project;
  }

  /** Sites are created the way api/mock/deployment.ts creates them: flat, no parent, on first use. */
  ensureSite(name: string, note: string | null): Location {
    let site = this.locations.find((l) => l.name === name && l.locationtype === "Site");
    if (!site) {
      site = { id: this.ids.keyed("location", `Site:${name}`), name, locationtype: "Site", parentlocation: null, isactive: true, note };
      this.locations.push(site);
    }
    return site;
  }

  // ---------------------------------------------------------------- assets

  private nextSequence(prefix: string): number {
    const entry = this.idSequence[prefix] ?? { nextvalue: this.sequenceStart };
    const value = entry.nextvalue;
    this.idSequence[prefix] = { nextvalue: value + 1 };
    return value;
  }

  /** Registers a new asset exactly as api/mock/index.ts registerAsset does: Available at its home
   * office, one AddToInventory transaction with one line (feature 001 FR-022/FR-023). */
  registerAsset(req: RegisterRequest): Asset {
    const assetid = req.temporaryTag
      ? mintTemporaryId(this.nextSequence("TMP"))
      : mintAssetId(req.model, req.serial, req.model.isserialised ? 0 : this.nextSequence(req.model.idprefix));
    if (this.assets.has(assetid)) throw new Error(`duplicate asset id minted: ${assetid}`);
    const asset: Asset = {
      id: this.ids.keyed("asset", assetid),
      assetid,
      migrationsource: this.sourceMarker,
      equipmentmodel: { manufacturer: req.model.manufacturer, model: req.model.model, equipmenttype: req.model.equipmenttype },
      serialnumber: req.serial,
      homeoffice: req.homeoffice,
      lifecycle: "Active",
      status: "Available",
      currentlocation: req.homeoffice,
      custodian: null,
      currentproject: null,
      parentasset: null,
      lastcaldate: null,
      nextcaldue: null,
      retirementreason: null,
      notes: req.notes ?? null,
      carrier: req.carrier ?? null,
      identifiervalue: req.identifiervalue ?? null,
      phonenumber: req.phonenumber ?? null,
      staticip: req.staticip ?? null,
    };
    this.assets.set(assetid, asset);
    this.apply({
      type: "AddToInventory",
      ts: req.ts,
      performedby: req.performedby,
      tolocation: req.homeoffice,
      notes: "Registered in the asset register.",
      lines: [{ assetId: assetid }],
    });
    this.acquiredOn.set(assetid, this.lastTs.get(assetid)!);
    return asset;
  }

  /** Office Admin "Attach component" (docs/01-data-model.md): a standing Component relationship,
   * not a transaction. The child mirrors its parent from now on (F1 step 5). */
  attachComponent(parentId: string, childId: string, ts: UtcIso, createdByTransactionId: string | null): AssetRelationship {
    if (this.componentParent.has(childId) || this.openKitByChild.has(childId)) throw new Error(`${childId} already has an open attachment`);
    const rel: AssetRelationship = {
      id: this.ids.next("rel"),
      parentasset: parentId,
      childasset: childId,
      relationshiptype: "Component",
      start: ts,
      end: null,
      createdbyline: createdByTransactionId,
      closedbyline: null,
    };
    this.relationships.push(rel);
    this.componentParent.set(childId, rel);
    if (!this.componentChildren.has(parentId)) this.componentChildren.set(parentId, new Set());
    this.componentChildren.get(parentId)!.add(childId);
    const child = this.assets.get(childId)!;
    child.parentasset = parentId;
    this.mirrorComponentChildren(this.assets.get(parentId)!);
    return rel;
  }

  isComponentChild(assetId: string): boolean {
    return this.componentParent.has(assetId);
  }

  componentParentOf(assetId: string): string | null {
    return this.componentParent.get(assetId)?.parentasset ?? null;
  }

  componentChildrenOf(parentId: string): string[] {
    return [...(this.componentChildren.get(parentId) ?? [])];
  }

  openKitParentOf(childId: string): string | null {
    return this.openKitByChild.get(childId)?.parentasset ?? null;
  }

  openKitChildrenOf(parentId: string): string[] {
    return [...(this.openKitsByParent.get(parentId) ?? [])].map((r) => r.childasset);
  }

  lineCount(assetId: string): number {
    return this.linesByAsset.get(assetId) ?? 0;
  }

  status(assetId: string): AssetStatus {
    return this.assets.get(assetId)!.status;
  }

  // ---------------------------------------------------------------- transactions

  private snapshot(asset: Asset): AssetSnapshot {
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

  /** True when deriveState would accept `type` for every listed asset right now. */
  canApply(type: TransactionType, assetIds: string[]): boolean {
    for (const id of assetIds) {
      const a = this.assets.get(id);
      if (!a) return false;
      if ((type === "Checkout" || type === "Deploy") && this.componentParent.has(id)) return false;
      const r = deriveState(this.snapshot(a), { type, date: "2000-01-01T00:00:00Z" });
      if (!r.ok) return false;
    }
    return true;
  }

  apply(req: TxRequest): TxResult {
    if (req.lines.length === 0) throw new Error(`${req.type}: no lines`);
    if (req.type === "Transfer") {
      // The store collapses null to "unchanged" on read-back (domain/pointInTime.ts explains why),
      // so a Transfer can never clear a field. The sim must only ever SET fields via Transfer.
      if (req.tolocation === null || req.touser === null || req.toproject === null) {
        throw new Error("Transfer with an explicit null would not survive replay — set fields only");
      }
    }
    // pass 1: validate every line without mutating anything (FR-003 atomicity, mirrored)
    const plans: Array<{ asset: Asset; result: Extract<ReturnType<typeof deriveState>, { ok: true }> }> = [];
    let ts = req.ts;
    for (const line of req.lines) {
      const asset = this.assets.get(line.assetId);
      if (!asset) throw new Error(`Unknown asset ${line.assetId}`);
      if (this.componentParent.has(asset.assetid)) {
        // FR-026 (feature 003) refuses Checkout/Deploy of a component in the app; the spec's FR-019
        // goes further for generated data — a permanent component carries NO line of its own
        // after registration, its parent's line is its history (F1 step 5).
        throw new Error(`${asset.assetid} is a permanent component of ${this.componentParent.get(asset.assetid)!.parentasset} and cannot carry a ${req.type} line (FR-019)`);
      }
      const input: TransactionLineInput = {
        type: req.type,
        date: ts, // relationship start/end use the final ts — re-derived below after spacing
        tolocation: req.tolocation,
        touser: req.touser,
        toproject: req.toproject,
        primaryAssetId: req.primaryAssetId,
        retirementReason: line.retirementReason,
        isPrimary: req.primaryAssetId === asset.assetid,
      };
      const result = deriveState(this.snapshot(asset), input);
      if (!result.ok) throw new Error(`${result.reason} (ts ${ts})`);
      plans.push({ asset, result });
      const last = this.lastTs.get(asset.assetid);
      if (last) ts = maxIso(ts, plusSeconds(last, MIN_SPACING_SECONDS));
    }
    // relationship ops carry the timestamp; recompute them against the final spaced ts
    const finalPlans = ts === req.ts ? plans : plans.map(({ asset }) => {
      const result = deriveState(this.snapshot(asset), {
        type: req.type, date: ts, tolocation: req.tolocation, touser: req.touser, toproject: req.toproject,
        primaryAssetId: req.primaryAssetId, retirementReason: req.lines.find((l) => l.assetId === asset.assetid)?.retirementReason,
        isPrimary: req.primaryAssetId === asset.assetid,
      });
      if (!result.ok) throw new Error(result.reason);
      return { asset, result };
    });

    // pass 2: write
    this.txnSeq += 1;
    const transactionId = this.ids.next("txn");
    const transactionName = `TXN-${String(this.txnSeq).padStart(6, "0")}`;
    this.transactions.push({
      id: transactionId,
      name: transactionName,
      transactiontype: req.type,
      transactiondate: ts,
      performedby: req.performedby,
      fromlocation: req.fromlocation ?? null,
      tolocation: req.tolocation ?? null,
      fromuser: req.fromuser ?? null,
      touser: req.touser ?? null,
      fromproject: req.fromproject ?? null,
      toproject: req.toproject ?? null,
      primaryasset: req.primaryAssetId ?? null,
      notes: req.notes ? `${this.noteMarker} ${req.notes}` : this.noteMarker,
      expectedreturn: req.expectedreturn ?? null,
    });

    for (const line of req.lines) {
      const plan = finalPlans.find((p) => p.asset.assetid === line.assetId)!;
      const statusBefore = plan.asset.status;
      const fields = plan.result.fields;
      const asset = plan.asset;
      asset.status = fields.statusAfter;
      asset.lifecycle = fields.lifecycle;
      asset.custodian = fields.custodian;
      asset.currentlocation = fields.currentlocation;
      asset.currentproject = fields.currentproject;
      if (fields.retirementReason) asset.retirementreason = fields.retirementReason as Asset["retirementreason"];
      this.lines.push({
        id: this.ids.next("line"),
        transaction: transactionId,
        asset: asset.assetid,
        statusbefore: statusBefore,
        statusafter: fields.statusAfter,
        kitrole: line.kitRole ?? null,
        orientation: line.orientation ?? null,
        powersource: line.powersource ?? null,
        condition: line.condition ?? null,
        processed: true,
        notes: null,
      });
      this.linesByAsset.set(asset.assetid, (this.linesByAsset.get(asset.assetid) ?? 0) + 1);
      this.lastTs.set(asset.assetid, ts);
      const cell = `${statusBefore}|${req.type}`;
      this.cellCounts.set(cell, (this.cellCounts.get(cell) ?? 0) + 1);
      this.applyRelationshipOps(plan.result.relationshipOps, transactionId);
      this.mirrorComponentChildren(asset);
    }
    return { transactionId, transactionName, ts };
  }

  private applyRelationshipOps(ops: RelationshipOp[], transactionId: string): void {
    for (const op of ops) {
      if (op.op === "open") {
        // FR-030 (feature 003): at most one open attachment. store.ts pushes unconditionally; a
        // Checkout-with-kit followed by a Deploy-with-primary would double-open there. The sim
        // avoids that path (kits form at Deploy), and this guard makes the invariant structural.
        if (this.openKitByChild.has(op.childAssetId)) {
          const existing = this.openKitByChild.get(op.childAssetId)!;
          if (existing.parentasset === op.parentAssetId) continue;
          throw new Error(`${op.childAssetId} already attached to ${existing.parentasset}; cannot attach to ${op.parentAssetId}`);
        }
        if (this.componentParent.has(op.childAssetId)) throw new Error(`${op.childAssetId} is a permanent component; cannot open a Kit attachment`);
        const rel: AssetRelationship = {
          id: this.ids.next("rel"),
          parentasset: op.parentAssetId,
          childasset: op.childAssetId,
          relationshiptype: "Kit",
          start: op.start,
          end: null,
          createdbyline: transactionId,
          closedbyline: null,
        };
        this.relationships.push(rel);
        this.openKitByChild.set(op.childAssetId, rel);
        if (!this.openKitsByParent.has(op.parentAssetId)) this.openKitsByParent.set(op.parentAssetId, new Set());
        this.openKitsByParent.get(op.parentAssetId)!.add(rel);
        const child = this.assets.get(op.childAssetId);
        if (child) child.parentasset = op.parentAssetId;
      } else if (op.op === "closeAsChild") {
        const rel = this.openKitByChild.get(op.childAssetId);
        if (rel) this.closeKit(rel, op.end, transactionId);
      } else if (op.op === "closeAllAsParent") {
        for (const rel of [...(this.openKitsByParent.get(op.parentAssetId) ?? [])]) this.closeKit(rel, op.end, transactionId);
      }
    }
  }

  private closeKit(rel: AssetRelationship, end: string, transactionId: string): void {
    rel.end = end;
    rel.closedbyline = transactionId;
    this.openKitByChild.delete(rel.childasset);
    this.openKitsByParent.get(rel.parentasset)?.delete(rel);
    const child = this.assets.get(rel.childasset);
    if (child && child.parentasset === rel.parentasset) child.parentasset = null;
  }

  /** F1 step 5 — mirrored exactly from store.ts: status/location/custodian/project, nothing else
   * (not lifecycle, not retirement reason — see the build report's observations). */
  private mirrorComponentChildren(parent: Asset): void {
    const children = this.componentChildren.get(parent.assetid);
    if (!children) return;
    for (const childId of children) {
      const child = this.assets.get(childId);
      if (!child) continue;
      child.status = parent.status;
      child.currentlocation = parent.currentlocation;
      child.custodian = parent.custodian;
      child.currentproject = parent.currentproject;
    }
  }

  // ---------------------------------------------------------------- installations (feature 005)

  openInstallation(inst: Omit<Installation, "id">, components: Array<Omit<InstallationComponent, "id" | "installation">>): Installation {
    const installation: Installation = { id: this.ids.next("inst"), ...inst };
    this.installations.push(installation);
    this.installationById.set(installation.id, installation);
    const rows: InstallationComponent[] = [];
    for (const c of components) {
      const row: InstallationComponent = { id: this.ids.next("instcomp"), installation: installation.id, ...c };
      this.installationComponents.push(row);
      rows.push(row);
    }
    this.openComponentRowsByInstallation.set(installation.id, rows);
    return installation;
  }

  addInstallationComponent(installationId: string, c: Omit<InstallationComponent, "id" | "installation">): InstallationComponent {
    const row: InstallationComponent = { id: this.ids.next("instcomp"), installation: installationId, ...c };
    this.installationComponents.push(row);
    this.openComponentRowsByInstallation.get(installationId)!.push(row);
    return row;
  }

  installation(id: string): Installation {
    return this.installationById.get(id)!;
  }

  openComponentRows(installationId: string): InstallationComponent[] {
    return this.openComponentRowsByInstallation.get(installationId) ?? [];
  }

  /** Closes the named component rows and, when nothing remains open, the installation itself
   * (feature 005 FR-014/FR-015 — the same rule api/mock/deployment.ts applies). */
  closeInstallationComponents(installationId: string, assetIds: string[], end: UtcIso, closedByTransactionId: string | null): void {
    const open = this.openComponentRowsByInstallation.get(installationId) ?? [];
    const remaining: InstallationComponent[] = [];
    for (const row of open) {
      if (assetIds.includes(row.asset)) {
        row.end = end;
        row.closedbyline = closedByTransactionId;
      } else remaining.push(row);
    }
    this.openComponentRowsByInstallation.set(installationId, remaining);
    const installation = this.installationById.get(installationId)!;
    if (remaining.length === 0 && !installation.end) {
      installation.end = end;
      installation.closedbytransaction = closedByTransactionId;
    }
  }

  // ---------------------------------------------------------------- calibration (feature 004)

  /** Mirrors api/mock/index.ts recordCalibration: push the record, recompute the asset's
   * last/next dates from the most recent record BY CALIBRATION DATE, and if the asset is in the
   * lab, record its ReturnFromCalibration (F2) rather than setting status directly. */
  recordCalibration(req: CalibrationRequest): TxResult | null {
    const asset = this.assets.get(req.assetId);
    if (!asset) throw new Error(`Unknown asset ${req.assetId}`);
    const model = this.findModel(asset.equipmentmodel);
    let nextduedate = req.nextduedate ?? null;
    if (!nextduedate && model?.defaultcalintervalmonths) {
      const d = new Date(req.calibrationdate);
      d.setMonth(d.getMonth() + model.defaultcalintervalmonths);
      nextduedate = d.toISOString().slice(0, 10);
    }
    if (!nextduedate) throw new Error(`no next-due date for ${req.assetId} (model has no interval)`);
    this.calibrationRecords.push({
      id: this.ids.next("cal"),
      asset: req.assetId,
      calibrationdate: req.calibrationdate,
      nextduedate,
      lab: req.lab,
      certificatenumber: req.certificatenumber,
      certificateurl: null,
      cost: req.cost,
      result: req.result,
    });
    let mostRecent: CalibrationRecord | null = null;
    for (const r of this.calibrationRecords) {
      if (r.asset !== req.assetId) continue;
      if (!mostRecent || r.calibrationdate > mostRecent.calibrationdate) mostRecent = r;
    }
    asset.lastcaldate = mostRecent!.calibrationdate;
    asset.nextcaldue = mostRecent!.nextduedate;
    if (asset.status === "InCalibration") {
      return this.apply({ type: "ReturnFromCalibration", ts: req.ts, performedby: req.performedby, lines: [{ assetId: asset.assetid }] });
    }
    return null;
  }

  // ---------------------------------------------------------------- answer-key support

  track(assetId: string): TrackedState {
    const a = this.assets.get(assetId)!;
    return {
      status: a.status,
      lifecycle: a.lifecycle,
      currentlocation: a.currentlocation,
      custodian: a.custodian,
      currentproject: a.currentproject,
      parentasset: a.parentasset,
    };
  }

  trackAll(): Map<string, TrackedState> {
    const m = new Map<string, TrackedState>();
    for (const id of this.assets.keys()) m.set(id, this.track(id));
    return m;
  }
}
