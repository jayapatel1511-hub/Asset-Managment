/**
 * The mock AmsBackend. Loads migration/staged/ (via public/data/), applies deriveState on every
 * write through MockStore.applyTransaction, persists to localStorage. No Dataverse code path is
 * reachable from here — see api/dataverse/ for the // DATAVERSE-ONLY implementation this one
 * stands in for.
 */
import { mintAssetId, mintTemporaryId } from "../../domain/assetId";
import type {
  AmsBackend,
  AssetFilter,
  CheckoutInput,
  FaultReportInput,
  RecordCalibrationInput,
  RegisterAssetInput,
  ReturnInput,
  SubmissionOutcome,
  TransferInput,
} from "../AmsBackend";
import type { Asset, AssetRelationship, CalibrationRecord, CurrentUser, EquipmentModel, HistoryEntry, Location, Project } from "../types";
import { getMockStore, type MockStore } from "./store";

const MOCK_ROLE_KEY = "ams-mock-current-user";

const DEMO_USERS: Record<string, CurrentUser> = {
  field: { upn: "tech@englobecorp.com", displayName: "Sam Tech (demo Field User)", homeoffice: "Ottawa", roles: ["FieldUser"] },
  admin: { upn: "admin@englobecorp.com", displayName: "Alex Admin (demo Office Admin)", homeoffice: "Ottawa", roles: ["FieldUser", "OfficeAdmin"] },
  owner: { upn: "svc-ams@englobecorp.com", displayName: "System Owner (demo)", homeoffice: "Ottawa", roles: ["FieldUser", "OfficeAdmin", "SystemOwner"] },
};

export function getMockCurrentUserKey(): keyof typeof DEMO_USERS {
  const stored = window.localStorage.getItem(MOCK_ROLE_KEY);
  return (stored as keyof typeof DEMO_USERS) ?? "field";
}

export function setMockCurrentUserKey(key: keyof typeof DEMO_USERS): void {
  window.localStorage.setItem(MOCK_ROLE_KEY, key);
}

export const MOCK_DEMO_USERS = DEMO_USERS;

function matchesQuery(asset: Asset, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  if (asset.assetid.toLowerCase().includes(needle)) return true;
  if (asset.serialnumber?.toLowerCase().includes(needle)) return true;
  if (asset.identifiervalue?.toLowerCase().includes(needle)) return true;
  const modelName = `${asset.equipmentmodel.manufacturer} ${asset.equipmentmodel.model}`.toLowerCase();
  if (modelName.includes(needle)) return true;
  return false;
}

function applySensitiveFieldSecurity(asset: Asset, user: CurrentUser): Asset {
  if (user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner")) return asset;
  // FR-030: ICCID, phone number and static IP are hidden from Field Users, enforced here in the
  // data layer (not merely by a UI control the field user could bypass via devtools/export).
  return { ...asset, identifiervalue: null, phonenumber: null, staticip: null };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export class MockAmsBackend implements AmsBackend {
  constructor(private store: MockStore = getMockStore()) {}

  private async ready(): Promise<MockStore> {
    await this.store.ready;
    return this.store;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    return DEMO_USERS[getMockCurrentUserKey()];
  }

  async searchAssets(query: string): Promise<Asset[]> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    const results = [...store.assets.values()].filter((a) => matchesQuery(a, query));
    return results.map((a) => applySensitiveFieldSecurity(a, user));
  }

  async listAssets(filter: AssetFilter = {}): Promise<Asset[]> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    let results = [...store.assets.values()];
    if (!filter.includeRetired) results = results.filter((a) => a.lifecycle !== "Retired"); // FR-016
    if (filter.office) results = results.filter((a) => a.currentlocation === filter.office || (!a.currentlocation && a.homeoffice === filter.office));
    if (filter.status?.length) results = results.filter((a) => filter.status!.includes(a.status));
    if (filter.equipmenttype) results = results.filter((a) => a.equipmentmodel.equipmenttype === filter.equipmenttype);
    if (filter.custodian) results = results.filter((a) => a.custodian === filter.custodian);
    if (filter.project) results = results.filter((a) => a.currentproject === filter.project);
    return results.map((a) => applySensitiveFieldSecurity(a, user));
  }

  async getAsset(assetId: string): Promise<Asset | null> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    const asset = store.assets.get(assetId.trim().toUpperCase()) ?? store.assets.get(assetId.trim());
    return asset ? applySensitiveFieldSecurity(asset, user) : null;
  }

  async getAssetHistory(assetId: string): Promise<HistoryEntry[]> {
    const store = await this.ready();
    const lines = store.transactionLines.filter((l) => l.asset === assetId);
    const byTxn = new Map(store.transactions.map((t) => [t.id, t]));
    const entries: HistoryEntry[] = lines.map((line) => {
      const txn = byTxn.get(line.transaction);
      return {
        ...line,
        transactiondate: txn?.transactiondate ?? "",
        transactiontype: txn?.transactiontype ?? "",
        performedby: txn?.performedby ?? "",
        fromlocation: txn?.fromlocation ?? null,
        tolocation: txn?.tolocation ?? null,
        fromuser: txn?.fromuser ?? null,
        touser: txn?.touser ?? null,
        fromproject: txn?.fromproject ?? null,
        toproject: txn?.toproject ?? null,
      };
    });
    return entries.sort((a, b) => (a.transactiondate < b.transactiondate ? 1 : -1)); // newest first — FR-033
  }

  async getAssetRelationships(assetId: string): Promise<AssetRelationship[]> {
    const store = await this.ready();
    return store.relationships.filter((r) => r.parentasset === assetId || r.childasset === assetId);
  }

  async listLocations(): Promise<Location[]> {
    return (await this.ready()).locations;
  }

  async listEquipmentModels(): Promise<EquipmentModel[]> {
    return (await this.ready()).equipmentModels;
  }

  async listProjects(): Promise<Project[]> {
    return (await this.ready()).projects;
  }

  async listCalibrationDue(horizonDays: number): Promise<Asset[]> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + horizonDays);
    const horizonIso = horizon.toISOString().slice(0, 10);
    const results = [...store.assets.values()].filter((a) => {
      if (a.lifecycle === "Retired") return false; // FR-004
      const model = store.equipmentModels.find(
        (m) => m.manufacturer === a.equipmentmodel.manufacturer && m.model === a.equipmentmodel.model && m.equipmenttype === a.equipmentmodel.equipmenttype
      );
      const isCalibrated = (model?.defaultcalintervalmonths ?? null) !== null || a.nextcaldue !== null || a.lastcaldate !== null;
      if (!isCalibrated) return false; // FR-004: models that never require calibration never appear
      if (!a.nextcaldue) return true; // unknown-status group — FR-003, never omitted
      return a.nextcaldue <= horizonIso;
    });
    return results.map((a) => applySensitiveFieldSecurity(a, user));
  }

  async getCalibrationHistory(assetId: string): Promise<CalibrationRecord[]> {
    const store = await this.ready();
    return store.calibrationRecords
      .filter((r) => r.asset === assetId)
      .sort((a, b) => (a.calibrationdate < b.calibrationdate ? 1 : -1));
  }

  async recordCalibration(input: RecordCalibrationInput): Promise<SubmissionOutcome> {
    const store = await this.ready();
    if (input.calibrationdate > todayIso()) {
      return { ok: false, reason: "Calibration date cannot be in the future." }; // FR-011 (004)
    }
    const asset = store.assets.get(input.assetId);
    if (!asset) return { ok: false, reason: `Unknown asset ${input.assetId}.` };

    const model = store.equipmentModels.find(
      (m) => m.manufacturer === asset.equipmentmodel.manufacturer && m.model === asset.equipmentmodel.model && m.equipmenttype === asset.equipmentmodel.equipmenttype
    );
    let nextduedate = input.nextduedate ?? null;
    if (!nextduedate && model?.defaultcalintervalmonths) {
      const d = new Date(input.calibrationdate);
      d.setMonth(d.getMonth() + model.defaultcalintervalmonths);
      nextduedate = d.toISOString().slice(0, 10);
    }
    if (!nextduedate) {
      return { ok: false, reason: "This model has no default calibration interval — a next-due date is required." }; // FR-010 (004)
    }

    const duplicate = store.calibrationRecords.some((r) => r.asset === input.assetId && r.calibrationdate === input.calibrationdate);

    store.calibrationRecords.push({
      asset: input.assetId,
      calibrationdate: input.calibrationdate,
      nextduedate,
      lab: input.lab ?? null,
      certificatenumber: input.certificatenumber ?? null,
      certificateurl: null,
      cost: input.cost ?? null,
      result: input.result ?? null,
    });

    // FR-012/FR-013 (004): asset's last-cal/next-due reflect the most recent record by cal date,
    // not the most recently entered — recompute from the full set every time.
    const allForAsset = store.calibrationRecords.filter((r) => r.asset === input.assetId);
    const mostRecent = allForAsset.reduce((a, b) => (a.calibrationdate > b.calibrationdate ? a : b));
    const updated: Asset = { ...asset, lastcaldate: mostRecent.calibrationdate, nextcaldue: mostRecent.nextduedate };
    store.assets.set(asset.assetid, updated);

    // F2: if the asset was sent to the lab, recording its calibration brings it back to
    // Available at its home office automatically — never by an admin setting status directly.
    if (updated.status === "InCalibration") {
      const currentUser = await this.getCurrentUser();
      const result = store.applyTransaction({
        clientSubmissionId: `${input.clientSubmissionId}-return-from-cal`,
        transactiontype: "ReturnFromCalibration",
        performedby: currentUser.upn,
        date: new Date().toISOString(),
        lines: [{ assetId: asset.assetid }],
      });
      if (!result.ok) return result;
    } else {
      store.persist();
    }

    return duplicate
      ? { ok: true, transactionId: "calibration-duplicate-date-flagged", transactionName: "recorded (duplicate date flagged for review)" }
      : { ok: true, transactionId: "calibration-recorded", transactionName: "recorded" };
  }

  async submitCheckout(input: CheckoutInput): Promise<SubmissionOutcome> {
    if (!input.project) return { ok: false, reason: "A project is required to check equipment out." }; // FR-008
    if (input.lines.length === 0) return { ok: false, reason: "Add at least one asset before submitting." };
    const store = await this.ready();
    // ASSUMPTION: the inactive-project rule (feature 003 FR-027) is open between "refuse
    // outright" and "warn and permit for legitimate late charges" — refuse outright is assumed
    // (docs/08-decisions.md), since it's the safe default and easily loosened later.
    const project = store.projects.find((p) => p.projectnumber === input.project);
    if (project && project.status !== "Active") {
      return { ok: false, reason: `Project ${input.project} is ${project.status}, not Active — checkout refused.` };
    }
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "Checkout",
      performedby: user.upn,
      date: new Date().toISOString(),
      touser: input.touser ?? user.upn,
      toproject: input.project,
      primaryAssetId: input.primaryAssetId,
      expectedreturn: input.expectedReturn ?? null,
      notes: input.notes ?? null,
      lines: input.lines.map((l) => ({ assetId: l.assetId, kitRole: l.kitRole as never })),
    });
  }

  async submitReturn(input: ReturnInput): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    // FR-025: restrict returning an asset to its custodian or an administrator
    const isAdmin = user.roles.includes("OfficeAdmin") || user.roles.includes("SystemOwner");
    if (!isAdmin) {
      for (const line of input.lines) {
        const asset = store.assets.get(line.assetId);
        if (asset && asset.custodian !== user.upn) {
          return { ok: false, reason: `${line.assetId} is held by someone else — only its custodian or an administrator can return it.`, offendingAssetId: line.assetId };
        }
      }
    }
    const tolocation = input.tolocation ?? user.homeoffice ?? undefined; // FR-010: defaults to returning user's office
    // condition NeedsService maps to statusafter NeedsRepair — handled by running a second,
    // separate ReportFault-style pass would be wrong (it's one Return transaction); instead we
    // special-case per line: a damaged/needs-service item still goes through Return's matrix
    // transition to Available and then immediately to NeedsRepair in the same submission, kept
    // as two lines sharing one transaction date so the history reads as one event.
    const goodLines = input.lines.filter((l) => (l.condition ?? "Good") === "Good");
    const badLines = input.lines.filter((l) => (l.condition ?? "Good") !== "Good");

    const returnResult = store.applyTransaction({
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "Return",
      performedby: user.upn,
      date: new Date().toISOString(),
      tolocation,
      notes: input.notes ?? null,
      lines: input.lines.map((l) => ({ assetId: l.assetId, condition: l.condition })),
    });
    if (!returnResult.ok) return returnResult;

    if (badLines.length > 0) {
      const faultResult = store.applyTransaction({
        clientSubmissionId: `${input.clientSubmissionId}-fault`,
        transactiontype: "ReportFault",
        performedby: user.upn,
        date: new Date().toISOString(),
        notes: "Reported damaged/needs-service on return.",
        lines: badLines.map((l) => ({ assetId: l.assetId, condition: l.condition })),
      });
      if (!faultResult.ok) return faultResult;
    }
    void goodLines;
    return returnResult;
  }

  async sendToCalibration(assetIds: string[], lab: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId,
      transactiontype: "SendToCalibration",
      performedby: user.upn,
      date: new Date().toISOString(),
      tolocation: lab,
      lines: assetIds.map((assetId) => ({ assetId })),
    });
  }

  async submitTransfer(input: TransferInput): Promise<SubmissionOutcome> {
    if (!input.reason?.trim()) return { ok: false, reason: "A reason is required to transfer equipment." }; // FR-009
    const store = await this.ready();
    // ASSUMPTION: inactive-project rule, see submitCheckout's identical note.
    if (input.toproject) {
      const project = store.projects.find((p) => p.projectnumber === input.toproject);
      if (project && project.status !== "Active") {
        return { ok: false, reason: `Project ${input.toproject} is ${project.status}, not Active — transfer refused.` };
      }
    }
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "Transfer",
      performedby: user.upn,
      date: new Date().toISOString(),
      touser: input.touser ?? undefined,
      tolocation: input.tolocation ?? undefined,
      toproject: input.toproject ?? undefined,
      notes: input.reason,
      lines: input.assetIds.map((assetId) => ({ assetId })),
    });
  }

  async reportFault(input: FaultReportInput): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "ReportFault",
      performedby: user.upn,
      date: new Date().toISOString(),
      notes: input.notes,
      lines: [{ assetId: input.assetId }],
    });
  }

  async markMissing(assetId: string, notes: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId,
      transactiontype: "MarkMissing",
      performedby: user.upn,
      date: new Date().toISOString(),
      notes,
      lines: [{ assetId }],
    });
  }

  async markFound(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId,
      transactiontype: "Found",
      performedby: user.upn,
      date: new Date().toISOString(),
      lines: [{ assetId }],
    });
  }

  async completeRepair(assetId: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    return store.applyTransaction({
      clientSubmissionId,
      transactiontype: "RepairComplete",
      performedby: user.upn,
      date: new Date().toISOString(),
      lines: [{ assetId }],
    });
  }

  async previewNextAssetId(manufacturer: string, model: string, equipmenttype: string, serial?: string | null): Promise<string> {
    const store = await this.ready();
    const found = store.equipmentModels.find((m) => m.manufacturer === manufacturer && m.model === model && m.equipmenttype === equipmenttype);
    if (!found) throw new Error(`Unknown model ${manufacturer} ${model} (${equipmenttype}) — pick one from the catalogue.`);
    if (found.isserialised) {
      return mintAssetId(found, serial ?? "", 0);
    }
    const peek = store.idSequence[found.idprefix]?.nextvalue ?? 1;
    return mintAssetId(found, null, peek);
  }

  async registerAsset(input: RegisterAssetInput): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    const model = store.equipmentModels.find(
      (m) => m.manufacturer === input.manufacturer && m.model === input.model && m.equipmenttype === input.equipmenttype
    );
    if (!model) return { ok: false, reason: "Pick a model from the catalogue — free-text models are not permitted (Principle IV)." };

    let assetid: string;
    if (model.isserialised) {
      if (!input.serial?.trim()) return { ok: false, reason: "This model requires a serial number." };
      assetid = mintAssetId(model, input.serial, 0);
    } else {
      assetid = mintAssetId(model, null, store.nextSequence(model.idprefix));
    }

    if (store.assets.has(assetid)) {
      return { ok: false, reason: `${assetid} already exists — this looks like a re-registration, not a new asset.`, offendingAssetId: assetid };
    }

    const newAsset: Asset = {
      id: `mock-asset-${crypto.randomUUID()}`,
      assetid,
      migrationsource: null,
      equipmentmodel: { manufacturer: model.manufacturer, model: model.model, equipmenttype: model.equipmenttype },
      serialnumber: input.serial ?? null,
      homeoffice: input.homeoffice,
      lifecycle: "Active",
      status: "Available",
      currentlocation: input.homeoffice,
      custodian: null,
      currentproject: null,
      parentasset: null,
      lastcaldate: null,
      nextcaldue: null,
      retirementreason: null,
      notes: input.notes ?? null,
      carrier: null,
      identifiervalue: null,
      phonenumber: null,
      staticip: null,
    };
    store.assets.set(assetid, newAsset);

    const result = store.applyTransaction({
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "AddToInventory",
      performedby: user.upn,
      date: new Date().toISOString(),
      tolocation: input.homeoffice,
      lines: [{ assetId: assetid }],
    });
    if (!result.ok) {
      store.assets.delete(assetid); // roll back the asset if even AddToInventory's own line is somehow refused
      return result;
    }
    return { ok: true, transactionId: result.transactionId, transactionName: assetid };
  }

  async retireAsset(assetId: string, reason: string, clientSubmissionId: string): Promise<SubmissionOutcome> {
    const store = await this.ready();
    const user = await this.getCurrentUser();
    if (!reason) return { ok: false, reason: "A retirement reason is required." }; // FR-024
    return store.applyTransaction({
      clientSubmissionId,
      transactiontype: "Retire",
      performedby: user.upn,
      date: new Date().toISOString(),
      lines: [{ assetId, retirementReason: reason }],
    });
  }
}

export { mintTemporaryId };
