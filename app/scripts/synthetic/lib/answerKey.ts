/**
 * The answer key (FR-055) — expected answers to the seven acceptance questions, computed from the
 * simulation's OWN account of what happened (the ledger's tracked state and the snapshots it took
 * at the probe dates), not by replaying history through the app's code. verify.ts then computes
 * the same answers through domain/pointInTime.ts, domain/installation.ts and api/mock/reporting.ts
 * and reconciles the two (US2, SC-007).
 *
 * The counting rules restated here on purpose (byOffice = HOME office; Active only; calibration
 * buckets) are the rules api/mock/reporting.ts documents — if they disagree, the reconciliation
 * fails, which is the point.
 */
import type { Asset, EquipmentModel, InstallationComponent, TransactionHeader, TransactionLine } from "../../../src/api/types";
import { modelKey } from "./config";
import type { Ledger, TrackedState } from "./ledger";
import type { Simulation } from "./sim";
import { addDays } from "./time";

export interface CalibrationBucket {
  inCalibration: number;
  dueSoon: number;
  overdue: number;
  unknown: number;
}

export interface AnswerKey {
  asOf: string;
  probeDates: string[];
  fleet: {
    total: number;
    byOffice: Record<string, number>;
    byAssetGroup: Record<string, number>;
    byEquipmentType: Record<string, number>;
    temporaryTags: number;
    thirdPartyOwned: number;
  };
  available: { total: number; byOffice: Record<string, number>; byEquipmentType: Record<string, number> };
  calibration: Record<string, Record<string, CalibrationBucket>>; // horizon days -> office -> bucket
  probeAssets: Array<{ assetId: string; states: Record<string, TrackedState> }>;
  probeProjects: Array<{ projectnumber: string; assignedAtAsOf: string[]; everUsed: string[] }>;
  probeSites: Array<{ site: string; installationId: string; asOf: string; components: Array<{ asset: string; kitrole: string; orientation: string | null }> }>;
}

function bump(r: Record<string, number>, k: string): void {
  r[k] = (r[k] ?? 0) + 1;
}

export function buildAnswerKey(ledger: Ledger, sim: Simulation, catalogue: EquipmentModel[], asOf: string): AnswerKey {
  const models = new Map(catalogue.map((m) => [modelKey(m), m]));
  const active = [...ledger.assets.values()].filter((a) => a.lifecycle !== "Retired");

  const fleet: AnswerKey["fleet"] = { total: active.length, byOffice: {}, byAssetGroup: {}, byEquipmentType: {}, temporaryTags: 0, thirdPartyOwned: 0 };
  const available: AnswerKey["available"] = { total: 0, byOffice: {}, byEquipmentType: {} };
  for (const a of active) {
    bump(fleet.byOffice, a.homeoffice ?? "");
    bump(fleet.byEquipmentType, a.equipmentmodel.equipmenttype);
    bump(fleet.byAssetGroup, models.get(modelKey(a.equipmentmodel))?.assetgroup ?? "");
    if (a.assetid.startsWith("TMP-")) fleet.temporaryTags += 1;
    if (a.notes && /\bowned by\b/i.test(a.notes)) fleet.thirdPartyOwned += 1;
    if (a.status === "Available") {
      available.total += 1;
      bump(available.byOffice, a.homeoffice ?? "");
      bump(available.byEquipmentType, a.equipmentmodel.equipmenttype);
    }
  }

  const calibration: AnswerKey["calibration"] = {};
  for (const horizon of [30, 60, 90]) {
    const byOffice: Record<string, CalibrationBucket> = {};
    const horizonDate = addDays(asOf, horizon);
    for (const a of active) {
      const model = models.get(modelKey(a.equipmentmodel));
      const tracked = (model?.defaultcalintervalmonths ?? null) !== null || a.nextcaldue !== null || a.lastcaldate !== null;
      if (!tracked) continue;
      const office = a.homeoffice ?? "";
      const b = (byOffice[office] ??= { inCalibration: 0, dueSoon: 0, overdue: 0, unknown: 0 });
      if (a.status === "InCalibration") b.inCalibration += 1;
      else if (!a.nextcaldue) b.unknown += 1;
      else if (a.nextcaldue < asOf) b.overdue += 1;
      else if (a.nextcaldue <= horizonDate) b.dueSoon += 1;
    }
    calibration[String(horizon)] = byOffice;
  }

  // probe assets: the busiest loggers, some sensors, a retired asset, a component, a spare SIM, a TMP tag
  const byLines = [...ledger.assets.values()].sort((x, y) => ledger.lineCount(y.assetid) - ledger.lineCount(x.assetid) || (x.assetid < y.assetid ? -1 : 1));
  const chosen: Asset[] = [];
  const take = (pred: (a: Asset) => boolean, n: number) => {
    for (const a of byLines) {
      if (chosen.length >= 20) return;
      if (chosen.includes(a) || !pred(a)) continue;
      chosen.push(a);
      if (--n <= 0) return;
    }
  };
  take((a) => a.equipmentmodel.equipmenttype === "DataLogger" && a.lifecycle === "Active", 7);
  take((a) => a.equipmentmodel.equipmenttype === "Geophone", 3);
  take((a) => a.equipmentmodel.equipmenttype === "SoundLevelMeter", 2);
  take((a) => a.lifecycle === "Retired", 2);
  take((a) => ledger.isComponentChild(a.assetid) && a.equipmentmodel.equipmenttype !== "CellularService", 1);
  take((a) => a.equipmentmodel.equipmenttype === "CellularService" && !ledger.isComponentChild(a.assetid), 1);
  take((a) => a.assetid.startsWith("TMP-"), 1);
  take((a) => a.status === "Missing", 1);
  take(() => true, 20);
  const probeAssets = chosen.map((a) => {
    const states: Record<string, TrackedState> = {};
    for (const d of sim.probeDates) {
      const snap = sim.snapshots.get(d);
      const s = snap?.get(a.assetid);
      // an asset not yet acquired at a probe date has no state — recorded as absent
      if (s) states[d] = s;
    }
    return { assetId: a.assetid, states };
  });

  // probe projects: ten with something assigned at as-of, else the ten most used
  const txnById = new Map<string, TransactionHeader>(ledger.transactions.map((t) => [t.id, t]));
  const everUsed = new Map<string, Set<string>>();
  for (const line of ledger.lines as TransactionLine[]) {
    const h = txnById.get(line.transaction)!;
    if (h.toproject) {
      if (!everUsed.has(h.toproject)) everUsed.set(h.toproject, new Set());
      everUsed.get(h.toproject)!.add(line.asset);
    }
  }
  const assigned = new Map<string, string[]>();
  for (const a of active) if (a.currentproject) (assigned.get(a.currentproject) ?? assigned.set(a.currentproject, []).get(a.currentproject)!).push(a.assetid);
  const projectNumbers = [...new Set([...assigned.keys(), ...[...everUsed.entries()].sort((x, y) => y[1].size - x[1].size).map((e) => e[0])])].slice(0, 10);
  const probeProjects = projectNumbers.map((p) => ({ projectnumber: p, assignedAtAsOf: (assigned.get(p) ?? []).sort(), everUsed: [...(everUsed.get(p) ?? [])].sort() }));

  // probe sites: ten installations with the most component rows, as at their midpoint (or as-of if open)
  const rowsByInstallation = new Map<string, InstallationComponent[]>();
  for (const r of ledger.installationComponents) (rowsByInstallation.get(r.installation) ?? rowsByInstallation.set(r.installation, []).get(r.installation)!).push(r);
  const installations = [...ledger.installations].sort((x, y) => (rowsByInstallation.get(y.id)?.length ?? 0) - (rowsByInstallation.get(x.id)?.length ?? 0) || (x.id < y.id ? -1 : 1)).slice(0, 10);
  const probeSites = installations.map((inst) => {
    const end = inst.end ?? `${asOf}T23:59:59Z`;
    const mid = new Date((Date.parse(inst.start) + Date.parse(end)) / 2).toISOString().replace(/\.\d{3}Z$/, "Z");
    const components = (rowsByInstallation.get(inst.id) ?? [])
      .filter((r) => r.start <= mid && (r.end === null || r.end > mid))
      .map((r) => ({ asset: r.asset, kitrole: r.kitrole, orientation: r.orientation }))
      .sort((x, y) => (x.asset < y.asset ? -1 : 1));
    return { site: inst.site, installationId: inst.id, asOf: mid, components };
  });

  return { asOf, probeDates: sim.probeDates, fleet, available, calibration, probeAssets, probeProjects, probeSites };
}
