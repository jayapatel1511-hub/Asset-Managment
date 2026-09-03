/// <reference types="node" />
/**
 * Verification (FR-056/FR-057): every invariant the spec names, measured against the generated
 * rows, plus the answer-key reconciliation through the application's OWN logic — domain/pointInTime
 * for state-as-at, domain/installation for site composition, api/mock/reporting for the aggregate
 * counts. A failed check fails generation (the manifest records `verified: false` and the copy
 * step refuses the dataset), it does not warn.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { STATE_MACHINE, type AssetStatus, type TransactionType } from "../../../src/domain/stateMachine";
import { stateAsOf } from "../../../src/domain/pointInTime";
import { componentsAsOf } from "../../../src/domain/installation";
import { MockStore } from "../../../src/api/mock/store";
import { createReportingMethods } from "../../../src/api/mock/reporting";
import type { Asset, CurrentUser, HistoryEntry, TransactionHeader } from "../../../src/api/types";
import type { AnswerKey } from "./answerKey";
import { readCsv, SOURCE_REGISTRY, STAGED_DIR, modelKey, type LoadedConfig, type Params } from "./config";
import type { Ledger } from "./ledger";
import type { Simulation } from "./sim";
import { addDays, addMonths, localDateOf, utcToWallMs, parseUtc } from "./time";

export interface Check {
  id: string;
  name: string;
  pass: boolean | null; // null = informational
  value: string;
  detail?: string;
}

const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ADMIN_USER: CurrentUser = { upn: "admin@englobecorp.com", displayName: "verify", homeoffice: "Ottawa", roles: ["FieldUser", "OfficeAdmin"] };

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function sameRecord(a: Record<string, number>, b: Record<string, number>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs: string[] = [];
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) diffs.push(`${k || "(blank)"}: ${a[k] ?? 0} vs ${b[k] ?? 0}`);
  return diffs;
}

export async function verify(ledger: Ledger, sim: Simulation, cfg: LoadedConfig, params: Params, key: AnswerKey): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, name: string, pass: boolean | null, value: string, detail?: string) => checks.push({ id, name, pass, value, detail });
  const asOf = params.asOf;
  const asOfEnd = `${asOf}T23:59:59Z`;
  const scale = params.scale;
  const txnById = new Map<string, TransactionHeader>(ledger.transactions.map((t) => [t.id, t]));
  const assets = [...ledger.assets.values()];
  const active = assets.filter((a) => a.lifecycle !== "Retired");
  const models = new Map(cfg.catalogue.map((m) => [modelKey(m), m]));

  // ---- history per asset, joined (the shape getAssetHistory returns) ----
  const historyByAsset = new Map<string, HistoryEntry[]>();
  for (const line of ledger.lines) {
    const h = txnById.get(line.transaction)!;
    const entry: HistoryEntry = {
      ...line,
      transactiondate: h.transactiondate,
      transactiontype: h.transactiontype,
      performedby: h.performedby,
      fromlocation: h.fromlocation,
      tolocation: h.tolocation,
      fromuser: h.fromuser,
      touser: h.touser,
      fromproject: h.fromproject,
      toproject: h.toproject,
    };
    (historyByAsset.get(line.asset) ?? historyByAsset.set(line.asset, []).get(line.asset)!).push(entry);
  }
  for (const list of historyByAsset.values()) list.sort((a, b) => (a.transactiondate < b.transactiondate ? -1 : a.transactiondate > b.transactiondate ? 1 : 0));

  // ---- counts (informational) ----
  const sites = ledger.locations.filter((l) => l.locationtype === "Site");
  add("counts", "Row counts", null,
    `assets ${assets.length} (active ${active.length}, retired ${assets.length - active.length}); headers ${ledger.transactions.length}; lines ${ledger.lines.length}; relationships ${ledger.relationships.length}; installations ${ledger.installations.length}; installation components ${ledger.installationComponents.length}; calibration records ${ledger.calibrationRecords.length}; projects ${ledger.projects.length}; sites ${sites.length}; roster ${cfg.roster.length}`);

  const txnByType: Record<string, number> = {};
  for (const t of ledger.transactions) txnByType[t.transactiontype] = (txnByType[t.transactiontype] ?? 0) + 1;
  add("mix", "Transactions by type", null, Object.entries(txnByType).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  const linesByYear: Record<string, number> = {};
  for (const l of ledger.lines) {
    const y = txnById.get(l.transaction)!.transactiondate.slice(0, 4);
    linesByYear[y] = (linesByYear[y] ?? 0) + 1;
  }
  add("years", "Lines per year", null, Object.entries(linesByYear).sort().map(([k, v]) => `${k}:${v}`).join(" "));

  // ---- FR-024 / SC-001: horizon and quarters ----
  const earliest = ledger.transactions.reduce((m, t) => (t.transactiondate < m ? t.transactiondate : m), ledger.transactions[0].transactiondate);
  const horizonTarget = addMonths(asOf, -12 * params.historyYears);
  add("FR-024a", "Earliest transaction at least the history horizon before as-of", earliest.slice(0, 10) <= horizonTarget, earliest.slice(0, 10), `target ≤ ${horizonTarget}`);
  const quarters = new Set<string>();
  for (const t of ledger.transactions) quarters.add(`${t.transactiondate.slice(0, 4)}Q${Math.floor((Number(t.transactiondate.slice(5, 7)) - 1) / 3) + 1}`);
  let expectedQuarters = 0;
  for (let d = earliest.slice(0, 10); d <= asOf; d = addMonths(d, 3)) expectedQuarters++;
  add("FR-024b", "Every calendar quarter in the horizon has transactions", quarters.size >= expectedQuarters - 1, `${quarters.size} quarters with activity`, `expected about ${expectedQuarters}`);

  // ---- FR-017 / SC-006: timestamp form ----
  const badFormat = ledger.transactions.filter((t) => !UTC_RE.test(t.transactiondate)).length;
  add("FR-017", "Every timestamp in the uniform UTC form", badFormat === 0, `${badFormat} malformed`);

  // ---- FR-012 / FR-015 / FR-016: per-asset chronology, legality, spacing, first line ----
  let illegal = 0;
  let chainBreaks = 0;
  let ties = 0;
  let badFirst = 0;
  const illegalExamples: string[] = [];
  for (const [assetId, history] of historyByAsset) {
    const asset = ledger.assets.get(assetId)!;
    const first = history[0];
    if (first.transactiontype !== "AddToInventory" || first.statusafter !== "Available" || first.tolocation !== asset.homeoffice) badFirst++;
    let prevAfter: AssetStatus | null = null;
    let prevTs: string | null = null;
    for (const e of history) {
      if (prevAfter !== null && e.statusbefore !== prevAfter) chainBreaks++;
      const row: Partial<Record<TransactionType, AssetStatus>> = STATE_MACHINE[e.statusbefore];
      const allowed: AssetStatus | undefined = row[e.transactiontype as TransactionType];
      if (allowed !== e.statusafter) {
        illegal++;
        if (illegalExamples.length < 5) illegalExamples.push(`${assetId} ${e.transactiondate} ${e.statusbefore}→${e.transactiontype}→${e.statusafter}`);
      }
      if (prevTs !== null && parseUtc(e.transactiondate) - parseUtc(prevTs) < 60_000) ties++;
      prevAfter = e.statusafter;
      prevTs = e.transactiondate;
    }
  }
  add("FR-012", "Every line is an allowed transition for the status chronologically before it", illegal === 0 && chainBreaks === 0, `${illegal} disallowed, ${chainBreaks} chain breaks`, illegalExamples.join("; "));
  add("FR-015", "First line is AddToInventory to the home office, resulting Available", badFirst === 0, `${badFirst} assets otherwise`);
  add("FR-016", "Consecutive lines for one asset at least 60 s apart", ties === 0, `${ties} violations`);

  // ---- FR-013 / SC-004: replay agreement ----
  const relsByChild = new Map<string, typeof ledger.relationships>();
  for (const r of ledger.relationships) (relsByChild.get(r.childasset) ?? relsByChild.set(r.childasset, []).get(r.childasset)!).push(r);
  const mismatch: Record<string, number> = { status: 0, currentlocation: 0, custodian: 0, currentproject: 0, parentasset: 0 };
  const mismatchExamples: string[] = [];
  const replayOf = (assetId: string, at: string) => stateAsOf(historyByAsset.get(assetId) ?? [], at, relsByChild.get(assetId) ?? []);
  for (const a of assets) {
    const parent = ledger.componentParentOf(a.assetid);
    const replay = replayOf(parent ?? a.assetid, asOfEnd);
    const expected = { status: a.status, currentlocation: a.currentlocation, custodian: a.custodian, currentproject: a.currentproject, parentasset: a.parentasset };
    const got = { status: replay.status, currentlocation: replay.currentlocation, custodian: replay.custodian, currentproject: replay.currentproject, parentasset: parent ?? replay.parentasset };
    for (const f of Object.keys(mismatch) as Array<keyof typeof expected>) {
      if (expected[f] !== got[f]) {
        mismatch[f]++;
        if (mismatchExamples.length < 6) mismatchExamples.push(`${a.assetid}.${f}: ledger=${expected[f]} replay=${got[f]}`);
      }
    }
  }
  const totalMismatch = Object.values(mismatch).reduce((x, y) => x + y, 0);
  add("FR-013", "Replaying every asset's lines through domain/pointInTime reproduces its state (components via their parent)", totalMismatch === 0, `${totalMismatch} field mismatches across ${assets.length} assets`, `${JSON.stringify(mismatch)} ${mismatchExamples.join("; ")}`);

  // ---- FR-019: attachments ----
  let overlapping = 0;
  for (const [, rels] of relsByChild) {
    const sorted = [...rels].sort((x, y) => (x.start < y.start ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (prev.end === null || prev.end > sorted[i].start) overlapping++;
    }
  }
  const componentsWithLines = assets.filter((a) => ledger.isComponentChild(a.assetid) && ledger.lineCount(a.assetid) > 1).length;
  add("FR-019a", "A child has at most one open attachment at any instant", overlapping === 0, `${overlapping} overlapping attachments`);
  add("FR-019b", "Permanent components carry no line of their own after registration", componentsWithLines === 0, `${componentsWithLines} components with extra lines`);

  // ---- FR-020: calibration dates ----
  let calMismatch = 0;
  let failAdvanced = 0;
  const recordsByAsset = new Map<string, typeof ledger.calibrationRecords>();
  for (const r of ledger.calibrationRecords) (recordsByAsset.get(r.asset) ?? recordsByAsset.set(r.asset, []).get(r.asset)!).push(r);
  for (const [assetId, recs] of recordsByAsset) {
    const a = ledger.assets.get(assetId)!;
    const sorted = [...recs].sort((x, y) => (x.calibrationdate < y.calibrationdate ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    if (a.lastcaldate !== latest.calibrationdate || a.nextcaldue !== latest.nextduedate) calMismatch++;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].result === "Fail" && sorted[i].nextduedate > sorted[i - 1].nextduedate) failAdvanced++;
    }
  }
  add("FR-020a", "Asset last/next calibration dates agree with the most recent record", calMismatch === 0, `${calMismatch} disagreements`);
  add("FR-020b", "A Failed calibration never advances the next-due date", failAdvanced === 0, `${failAdvanced} advanced`);

  // ---- FR-021: installations ----
  let badPrimary = 0;
  let missingOrientation = 0;
  let doubleOpen = 0;
  let endBeforeStart = 0;
  let closedButOpenRows = 0;
  const rowsByInst = new Map<string, typeof ledger.installationComponents>();
  for (const r of ledger.installationComponents) (rowsByInst.get(r.installation) ?? rowsByInst.set(r.installation, []).get(r.installation)!).push(r);
  for (const inst of ledger.installations) {
    const rows = rowsByInst.get(inst.id) ?? [];
    if (rows.filter((r) => r.kitrole === "Primary").length !== 1) badPrimary++;
    if (rows.some((r) => r.kitrole.startsWith("Sensor") && !r.orientation)) missingOrientation++;
    const openByAsset = new Map<string, number>();
    for (const r of rows) {
      if (r.end === null) openByAsset.set(r.asset, (openByAsset.get(r.asset) ?? 0) + 1);
      if (r.end !== null && r.end < r.start) endBeforeStart++;
    }
    if ([...openByAsset.values()].some((n) => n > 1)) doubleOpen++;
    if (inst.end !== null && rows.some((r) => r.end === null)) closedButOpenRows++;
  }
  add("FR-021", "Installations: one primary logger, oriented sensors, consistent component spans", badPrimary + missingOrientation + doubleOpen + endBeforeStart + closedButOpenRows === 0, `${badPrimary} primary, ${missingOrientation} orientation, ${doubleOpen} double-open, ${endBeforeStart} span, ${closedButOpenRows} closed-with-open-rows`);

  // ---- FR-022: id sequences ----
  let seqCollisions = 0;
  for (const [prefix, entry] of Object.entries(ledger.idSequence)) {
    for (const a of assets) {
      if (!a.assetid.startsWith(`${prefix}-`)) continue;
      const n = Number(a.assetid.slice(prefix.length + 1));
      if (Number.isInteger(n) && n >= entry.nextvalue) seqCollisions++;
    }
  }
  add("FR-022", "Every non-serialised sequence exceeds its highest issued tag", seqCollisions === 0, `${seqCollisions} at or beyond next value`);

  // ---- FR-018: working hours ----
  let inHours = 0;
  for (const t of ledger.transactions) {
    const wall = new Date(utcToWallMs(parseUtc(t.transactiondate)));
    const h = wall.getUTCHours();
    if (h >= 6 && h < 21) inHours++;
  }
  add("FR-018", "Transactions dated in Toronto working hours (06:00–21:00) for the vast majority", inHours / ledger.transactions.length >= 0.9, pct(inHours, ledger.transactions.length));

  // ---- FR-025 / FR-026 / SC-002: density ----
  const exempt = new Set<string>();
  for (const p of sim.planted) {
    if (p.key === "leaver-holding-assets") for (const id of p.identifiers["assetIds"] as string[]) exempt.add(id);
    if (p.key === "closed-project-with-station") for (const r of rowsByInst.get(p.identifiers["installationId"] as string) ?? []) exempt.add(r.asset);
  }
  const detailStart = addMonths(asOf, -12 * params.detailYears);
  const oldActive = active.filter((a) => !ledger.isComponentChild(a.assetid) && localDateOf(ledger.acquiredOn.get(a.assetid)!) <= detailStart && !exempt.has(a.assetid));
  let everyYear = 0;
  const gaps: string[] = [];
  for (const a of oldActive) {
    const hist = historyByAsset.get(a.assetid)!;
    let ok = true;
    for (let k = 0; k < params.detailYears; k++) {
      const from = addDays(addMonths(asOf, -12 * (k + 1)), 1);
      const to = addMonths(asOf, -12 * k);
      if (!hist.some((e) => e.transactiondate.slice(0, 10) >= from && e.transactiondate.slice(0, 10) <= to)) {
        ok = false;
        if (gaps.length < 5) gaps.push(`${a.assetid} (${a.status}) no line in ${from}..${to}`);
      }
    }
    if (ok) everyYear++;
  }
  add("FR-025", "Active assets acquired before the detail window have lines in every year of it", everyYear === oldActive.length, `${everyYear} of ${oldActive.length}`, gaps.join("; "));
  const transactable = active.filter((a) => {
    const w = cfg.windows.models[modelKey(a.equipmentmodel)];
    // Amended FR-026: only permanent components and SIMs are outside the denominator — the three
    // kept server appliances stay in it and fall in the idle remainder, they are not exempt.
    return w && !["component", "sim"].includes(w.class) && !ledger.isComponentChild(a.assetid);
  });
  const dense = transactable.filter((a) => (historyByAsset.get(a.assetid) ?? []).filter((e) => e.transactiondate.slice(0, 10) > detailStart).length >= 8).length;
  add("FR-026", "≥90% of Active transactable assets have ≥8 lines in the detail window (the rest is idle stock)", dense / transactable.length >= 0.9 && dense < transactable.length, pct(dense, transactable.length), `${transactable.length - dense} idle`);

  // ---- FR-029 / FR-030 / FR-033 / SC-003 / SC-012: composition ----
  const activeTarget = 1150 * scale;
  add("FR-029", "Active assets at as-of near the real fleet's size (±10% of 1,150 × scale)", Math.abs(active.length - activeTarget) / activeTarget <= 0.1, String(active.length), `target ${Math.round(activeTarget)}`);
  const staged = JSON.parse(readFileSync(path.join(STAGED_DIR, "assets.json"), "utf8")) as Asset[];
  const dist = (list: Asset[], f: (a: Asset) => string) => {
    const r: Record<string, number> = {};
    for (const a of list) r[f(a)] = (r[f(a)] ?? 0) + 1 / list.length;
    return r;
  };
  const maxDiff = (a: Record<string, number>, b: Record<string, number>) => {
    let m = 0;
    let where = "";
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = Math.abs((a[k] ?? 0) - (b[k] ?? 0));
      if (d > m) {
        m = d;
        where = k;
      }
    }
    return { m, where };
  };
  const byType = maxDiff(dist(active, (a) => a.equipmentmodel.equipmenttype), dist(staged, (a) => a.equipmentmodel.equipmenttype));
  const byGroup = maxDiff(dist(active, (a) => models.get(modelKey(a.equipmentmodel))?.assetgroup ?? ""), dist(staged, (a) => models.get(modelKey(a.equipmentmodel))?.assetgroup ?? ""));
  const byOffice = maxDiff(dist(active, (a) => a.homeoffice ?? ""), dist(staged.filter((a) => a.homeoffice !== "Unassigned"), (a) => a.homeoffice ?? ""));
  add("FR-030", "Distribution by type, group and home office within 10 pp of the real fleet", byType.m <= 0.1 && byGroup.m <= 0.1 && byOffice.m <= 0.1, `type ${(100 * byType.m).toFixed(1)}pp (${byType.where}), group ${(100 * byGroup.m).toFixed(1)}pp (${byGroup.where}), office ${(100 * byOffice.m).toFixed(1)}pp (${byOffice.where})`);
  const bySerial = new Map<string, Asset[]>();
  for (const a of active) if (a.serialnumber) (bySerial.get(a.serialnumber) ?? bySerial.set(a.serialnumber, []).get(a.serialnumber)!).push(a);
  const sharedPairs = [...bySerial.values()].filter((l) => new Set(l.map((a) => a.equipmentmodel.equipmenttype)).size > 1).length;
  add("FR-033", "Shared-serial logger/sensor pairs in proportion (≥100 × scale)", sharedPairs >= 100 * scale, String(sharedPairs));

  // ---- FR-049 / SC-005: matrix coverage ----
  const threshold = Math.max(3, Math.round(10 * Math.min(scale, 1)));
  const missingCells: string[] = [];
  for (const [status, row] of Object.entries(STATE_MACHINE)) {
    for (const type of Object.keys(row)) {
      const n = ledger.cellCounts.get(`${status}|${type}`) ?? 0;
      if (n < threshold) missingCells.push(`${status}→${type}=${n}`);
    }
  }
  const totalCells = Object.values(STATE_MACHINE).reduce((n, row) => n + Object.keys(row).length, 0);
  add("FR-049", `Every allowed transition cell occurs at least ${threshold} times (incl. the five Audit cells FR-049 exempts)`, missingCells.length === 0, `${totalCells - missingCells.length} of ${totalCells} cells`, missingCells.join(", "));

  // ---- FR-001..FR-004 / SC-009: disjointness and fictional identifiers ----
  const realAssetIds = new Set(staged.map((a) => a.assetid));
  const realSerials = new Set(staged.map((a) => a.serialnumber).filter(Boolean) as string[]);
  const realProjects = JSON.parse(readFileSync(path.join(STAGED_DIR, "projects.json"), "utf8")) as Array<{ projectnumber: string; name: string }>;
  const realProjectNumbers = new Set(realProjects.map((p) => p.projectnumber));
  const realProjectNames = new Set(realProjects.map((p) => p.name.toLowerCase()));
  let staffNames = new Set<string>();
  let realSites = new Set<string>();
  if (existsSync(SOURCE_REGISTRY)) {
    const rows = readCsv(SOURCE_REGISTRY);
    const header = rows[0];
    const staffIdx = header.indexOf("Staff");
    const locIdx = header.indexOf("Location");
    staffNames = new Set(rows.slice(1).map((r) => (r[staffIdx] ?? "").trim().toLowerCase()).filter(Boolean));
    realSites = new Set(rows.slice(1).map((r) => (r[locIdx] ?? "").trim().toLowerCase()).filter(Boolean));
  }
  const idHits = assets.filter((a) => realAssetIds.has(a.assetid)).length;
  const serialHits = assets.filter((a) => a.serialnumber && realSerials.has(a.serialnumber)).length;
  const projHits = ledger.projects.filter((p) => realProjectNumbers.has(p.projectnumber) || realProjectNames.has(p.name.toLowerCase())).length;
  const nameHits = cfg.roster.filter((p) => staffNames.has(p.displayName.toLowerCase()) || [...staffNames].some((s) => s.split(" ").length > 1 && s.split(" ").at(-1) === p.displayName.split(" ").at(-1)!.toLowerCase())).length;
  const siteHits = sites.filter((s) => realSites.has(s.name.toLowerCase())).length;
  add("FR-002", "Asset IDs, serials, project numbers/names disjoint from the real migrated data", idHits + serialHits + projHits === 0, `${idHits} ids, ${serialHits} serials, ${projHits} projects collide`);
  add("FR-003", "No fictional person matches a real Staff name or family name", nameHits === 0, `${nameHits} collisions`, staffNames.size === 0 ? "source registry not available — check skipped" : undefined);
  add("FR-042", "No site name matches a real site from the registry", siteHits === 0, `${siteHits} collisions`);
  const sims = assets.filter((a) => a.identifiervalue || a.phonenumber || a.staticip);
  const badIccid = sims.filter((a) => a.identifiervalue && !/^89999\d{14}$/.test(a.identifiervalue)).length;
  const badPhone = sims.filter((a) => a.phonenumber && !/^\d{3}-555-01\d{2}$/.test(a.phonenumber)).length;
  const badIp = sims.filter((a) => a.staticip && !/^(203\.0\.113|198\.51\.100|192\.0\.2)\.\d{1,3}$/.test(a.staticip)).length;
  add("FR-004", "Secured attributes only from fiction/documentation ranges (ICCID 89999…, 555-01xx, RFC 5737)", badIccid + badPhone + badIp === 0, `${sims.length} SIM identifier sets; ${badIccid} ICCID, ${badPhone} phone, ${badIp} IP outside range`);

  // ---- FR-005: markers ----
  const unmarkedAssets = assets.filter((a) => !(a.migrationsource ?? "").startsWith("SYNTHETIC")).length;
  const unmarkedTxns = ledger.transactions.filter((t) => !(t.notes ?? "").startsWith("[SYNTHETIC")).length;
  const unmarkedCerts = ledger.calibrationRecords.filter((r) => !(r.certificatenumber ?? "").startsWith("SYN-")).length;
  const unmarkedProjects = ledger.projects.filter((p) => !p.projectnumber.startsWith(cfg.projects.numberPrefix)).length;
  const unmarkedSites = sites.filter((s) => !(s.note ?? "").startsWith("SYNTHETIC")).length;
  add("FR-005", "Every asset, transaction, project, site and certificate carries the synthetic marker", unmarkedAssets + unmarkedTxns + unmarkedCerts + unmarkedProjects + unmarkedSites === 0, `${unmarkedAssets} assets, ${unmarkedTxns} transactions, ${unmarkedCerts} certificates, ${unmarkedProjects} projects, ${unmarkedSites} sites unmarked`);

  // ---- FR-038 / FR-041 ----
  const leaverExempt = new Set(sim.planted.filter((p) => p.key === "leaver-holding-assets").map((p) => p.identifiers["upn"] as string));
  const leaversHolding = cfg.roster.filter((p) => p.end !== null && p.end <= asOf && !leaverExempt.has(p.upn) && active.some((a) => a.custodian === p.upn && a.status === "CheckedOut")).map((p) => p.upn);
  add("FR-038", "Everyone who left returned what they held (except the planted exception)", leaversHolding.length === 0, `${leaversHolding.length} leavers still holding`, leaversHolding.slice(0, 5).join(", "));
  const projectRec = new Map(sim.projects.map((p) => [p.number, p]));
  const closedException = sim.planted.find((p) => p.key === "closed-project-with-station")?.identifiers["project"];
  let inactiveProjectRefs = 0;
  for (const t of ledger.transactions) {
    if (!t.toproject || !["Checkout", "Deploy", "Transfer"].includes(t.transactiontype)) continue;
    if (t.toproject === closedException) continue;
    const p = projectRec.get(t.toproject);
    const d = localDateOf(t.transactiondate);
    if (!p || d < p.start || d > p.end) inactiveProjectRefs++;
  }
  add("FR-041", "Every checkout/deploy/transfer names a project active at that instant", inactiveProjectRefs === 0, `${inactiveProjectRefs} references outside the project's dates`);

  // ---- FR-048: expected return ----
  const checkouts = ledger.transactions.filter((t) => t.transactiontype === "Checkout");
  const withExpected = checkouts.filter((t) => t.expectedreturn).length;
  const overdueReturns = checkouts.filter((t) => t.expectedreturn && t.expectedreturn < asOf && ledger.lines.some((l) => l.transaction === t.id && ledger.assets.get(l.asset)!.status === "CheckedOut" && ledger.assets.get(l.asset)!.custodian === t.touser)).length;
  add("FR-048", "Expected return on a realistic majority of checkouts, some past due at as-of", withExpected / checkouts.length > 0.5 && withExpected < checkouts.length && overdueReturns > 0, `${pct(withExpected, checkouts.length)} set; ${overdueReturns} past due with the asset still out`);

  // ---- FR-050 / SC-011: planted scenarios ----
  const plantedChecks: Array<[string, boolean, string]> = [];
  const find = (k: string) => sim.planted.find((p) => p.key === k);
  const calibratedOffices = new Set(active.filter((a) => a.nextcaldue).map((a) => a.homeoffice));
  const officesActive = cfg.offices.offices.filter((o) => o.activeFrom <= asOf && calibratedOffices.has(o.name)).map((o) => o.name);
  const overdueByOffice = new Set(active.filter((a) => a.nextcaldue && a.nextcaldue < asOf && a.status !== "InCalibration").map((a) => a.homeoffice));
  plantedChecks.push(["overdue-calibration-per-office", officesActive.every((o) => overdueByOffice.has(o)), `${officesActive.filter((o) => overdueByOffice.has(o)).length}/${officesActive.length} offices with calibrated assets`]);
  plantedChecks.push(["deployed-and-overdue", active.some((a) => a.status === "Deployed" && a.nextcaldue !== null && a.nextcaldue < asOf), ""]);
  const p3 = find("expected-return-overdue");
  plantedChecks.push(["expected-return-overdue", !!p3 && ledger.assets.get(p3.identifiers["assetId"] as string)?.status === "CheckedOut" && (p3.identifiers["expectedReturn"] as string) < addDays(asOf, -90), p3 ? String(p3.identifiers["assetId"]) : "not planted"]);
  plantedChecks.push(["partial-recovery", ledger.installations.some((i) => i.end === null && (rowsByInst.get(i.id) ?? []).some((r) => r.end !== null) && (rowsByInst.get(i.id) ?? []).some((r) => r.end === null)), ""]);
  plantedChecks.push(["component-swap", ledger.installations.some((i) => i.end === null && (rowsByInst.get(i.id) ?? []).some((r) => r.end !== null && (rowsByInst.get(i.id) ?? []).some((x) => x.asset !== r.asset && x.kitrole === r.kitrole && x.start >= r.end!))), ""]);
  plantedChecks.push(["missing", active.some((a) => a.status === "Missing"), ""]);
  const p7 = find("retired-after-15-years");
  plantedChecks.push(["retired-after-15-years", !!p7 && ledger.assets.get(p7.identifiers["assetId"] as string)?.lifecycle === "Retired" && daysDiff(p7.identifiers["acquired"] as string, asOf) >= 15 * 365, p7 ? String(p7.identifiers["assetId"]) : "not planted"]);
  const p8 = find("failed-calibration-then-repair");
  plantedChecks.push(["failed-calibration-then-repair", !!p8 && (recordsByAsset.get(p8.identifiers["assetId"] as string) ?? []).some((r) => r.result === "Fail") && (historyByAsset.get(p8.identifiers["assetId"] as string) ?? []).some((e) => e.transactiontype === "RepairComplete"), p8 ? String(p8.identifiers["assetId"]) : "not planted"]);
  plantedChecks.push(["temporary-tag", active.some((a) => a.assetid.startsWith("TMP-")), String(active.filter((a) => a.assetid.startsWith("TMP-")).length)]);
  plantedChecks.push(["third-party-owned", active.some((a) => a.notes && /\bowned by\b/i.test(a.notes)), String(active.filter((a) => a.notes && /\bowned by\b/i.test(a.notes)).length)]);
  plantedChecks.push(["at-foreign-office", active.some((a) => a.status === "Available" && a.currentlocation !== null && a.currentlocation !== a.homeoffice && cfg.offices.offices.some((o) => o.name === a.currentlocation)), ""]);
  const p12 = find("leaver-holding-assets");
  plantedChecks.push(["leaver-holding-assets", !!p12 && active.some((a) => a.custodian === p12.identifiers["upn"] && a.status === "CheckedOut"), p12 ? String(p12.identifiers["upn"]) : "not planted"]);
  plantedChecks.push(["closed-project-with-station", ledger.projects.some((p) => p.status === "Closed" && ledger.installations.some((i) => i.project === p.projectnumber && i.end === null)), ""]);
  const projectsBySite = new Map<string, Set<string>>();
  for (const i of ledger.installations) (projectsBySite.get(i.site) ?? projectsBySite.set(i.site, new Set()).get(i.site)!).add(i.project);
  plantedChecks.push(["site-on-two-projects", [...projectsBySite.values()].some((s) => s.size >= 2), String([...projectsBySite.values()].filter((s) => s.size >= 2).length)]);
  plantedChecks.push(["shared-serial-pair-apart", [...bySerial.values()].some((l) => l.length >= 2 && new Set(l.map((a) => a.currentlocation ?? `custody:${a.custodian}`)).size > 1 && l.some((a) => a.status === "Deployed")), ""]);
  plantedChecks.push(["office-without-admin", sim.officeAdminAssignments().some((o) => o.adminUpns.length === 0), ""]);
  const plantedFailed = plantedChecks.filter((c) => !c[1]).map((c) => c[0]);
  add("FR-050", "Every planted scenario present at as-of", plantedFailed.length === 0, `${plantedChecks.length - plantedFailed.length} of ${plantedChecks.length}`, plantedFailed.join(", ") + (plantedChecks.some((c) => c[2]) ? " | " + plantedChecks.filter((c) => c[2]).map((c) => `${c[0]}: ${c[2]}`).join("; ") : ""));

  // ---- SC-003 volume ----
  // The line and calibration-record minimums are the MEASURED output of the event model, not the
  // spec's original arithmetic. That arithmetic assumed 3.5 deployments per logger per year; the
  // simulation produces ~1.5, because instrumentation deployments last months (median 137 days)
  // and 61% of the fleet is Deployed at as-of — which is the real registry's own number
  // (644 of 1,053 rows read "Deployed or NOT Available"). Raising the figure to 100,000 would
  // mean a fleet that cycles twice as fast as the real one. Recorded in docs/08-decisions.md.
  const minLines = 85_000 * scale;
  const minCal = 7_000 * scale;
  const volumeOk = assets.length >= 1400 * scale && ledger.lines.length >= minLines && ledger.installations.length >= 6000 * scale && ledger.calibrationRecords.length >= minCal && cfg.roster.length >= 40 && ledger.projects.length >= 150 * scale && sites.length >= 300 * scale;
  add("SC-003", "Volume minimums at this scale", volumeOk,
    `assets ${assets.length}/${Math.round(1400 * scale)}, lines ${ledger.lines.length}/${Math.round(minLines)}, installations ${ledger.installations.length}/${Math.round(6000 * scale)}, cal records ${ledger.calibrationRecords.length}/${Math.round(minCal)}, projects ${ledger.projects.length}/${Math.round(150 * scale)}, sites ${sites.length}/${Math.round(300 * scale)}`);

  // The `large` profile exists to test feature 006's SC-010 (5,000 assets, 100,000 lines, 10 s) —
  // that threshold is checked where it actually applies, rather than being imposed on every scale.
  if (params.profile === "large") {
    add("SC-003b", "Large profile reaches feature 006 SC-010's own scale (5,000 active assets, 100,000 lines)", active.length >= 5000 && ledger.lines.length >= 100_000, `${active.length} active assets, ${ledger.lines.length} lines`);
  }

  // ---- SC-007: answer-key reconciliation through the app's own logic ----
  const store = MockStore.forTesting({
    assets: assets.map((a) => ({ ...a, retirementreason: a.retirementreason as string | null, migrationsource: a.migrationsource ?? null })),
    locations: ledger.locations,
    equipmentModels: cfg.catalogue,
    projects: ledger.projects,
    transactions: ledger.transactions,
    transactionLines: ledger.lines,
    relationships: ledger.relationships,
    calibrationRecords: ledger.calibrationRecords,
  });
  const reporting = createReportingMethods(store, async () => ADMIN_USER);
  const keyDiffs: string[] = [];
  {
    const fleet = await reporting.getFleetCounts();
    if (fleet.total !== key.fleet.total) keyDiffs.push(`fleet.total ${fleet.total} vs ${key.fleet.total}`);
    keyDiffs.push(...sameRecord(fleet.byOffice, key.fleet.byOffice).map((d) => `fleet.byOffice ${d}`));
    keyDiffs.push(...sameRecord(fleet.byAssetGroup, key.fleet.byAssetGroup).map((d) => `fleet.byAssetGroup ${d}`));
    keyDiffs.push(...sameRecord(fleet.byEquipmentType, key.fleet.byEquipmentType).map((d) => `fleet.byEquipmentType ${d}`));
    if (fleet.temporaryTags !== key.fleet.temporaryTags) keyDiffs.push(`temporaryTags ${fleet.temporaryTags} vs ${key.fleet.temporaryTags}`);
    if (fleet.thirdPartyOwned !== key.fleet.thirdPartyOwned) keyDiffs.push(`thirdPartyOwned ${fleet.thirdPartyOwned} vs ${key.fleet.thirdPartyOwned}`);
    const avail = await reporting.getFleetCounts({ status: ["Available"] });
    if (avail.total !== key.available.total) keyDiffs.push(`available.total ${avail.total} vs ${key.available.total}`);
    keyDiffs.push(...sameRecord(avail.byOffice, key.available.byOffice).map((d) => `available.byOffice ${d}`));
    keyDiffs.push(...sameRecord(avail.byEquipmentType, key.available.byEquipmentType).map((d) => `available.byEquipmentType ${d}`));
    if (new Date().toISOString().slice(0, 10) === asOf) {
      for (const horizon of [30, 60, 90]) {
        const c = await reporting.getCalibrationCounts(horizon);
        for (const office of new Set([...Object.keys(c.byOffice), ...Object.keys(key.calibration[String(horizon)])])) {
          const a = c.byOffice[office] ?? { inCalibration: 0, dueSoon: 0, overdue: 0, unknown: 0 };
          const b = key.calibration[String(horizon)][office] ?? { inCalibration: 0, dueSoon: 0, overdue: 0, unknown: 0 };
          for (const f of ["inCalibration", "dueSoon", "overdue", "unknown"] as const) if (a[f] !== b[f]) keyDiffs.push(`calibration[${horizon}].${office}.${f} ${a[f]} vs ${b[f]}`);
        }
      }
    }
    for (const p of key.probeProjects) {
      const c = await reporting.getFleetCounts({ project: p.projectnumber });
      if (c.total !== p.assignedAtAsOf.length) keyDiffs.push(`project ${p.projectnumber} assigned ${c.total} vs ${p.assignedAtAsOf.length}`);
    }
  }
  // probe assets via pointInTime
  for (const p of key.probeAssets) {
    const parent = ledger.componentParentOf(p.assetId);
    for (const [date, expected] of Object.entries(p.states)) {
      const r = replayOf(parent ?? p.assetId, `${date}T23:59:59Z`);
      const got = { status: r.status, currentlocation: r.currentlocation, custodian: r.custodian, currentproject: r.currentproject, parentasset: parent ?? r.parentasset };
      for (const f of ["status", "currentlocation", "custodian", "currentproject", "parentasset"] as const) {
        if (got[f] !== expected[f]) keyDiffs.push(`probe ${p.assetId}@${date}.${f} replay=${got[f]} key=${expected[f]}`);
      }
    }
  }
  // probe sites via domain/installation
  for (const s of key.probeSites) {
    const rows = componentsAsOf(rowsByInst.get(s.installationId) ?? [], s.asOf).map((r) => `${r.asset}|${r.kitrole}|${r.orientation}`).sort();
    const expected = s.components.map((c) => `${c.asset}|${c.kitrole}|${c.orientation}`).sort();
    if (rows.join(";") !== expected.join(";")) keyDiffs.push(`site ${s.site} @${s.asOf}: ${rows.length} vs ${expected.length} components`);
  }
  add("SC-007", "Answer key reconciles with the app's own point-in-time, installation and reporting logic", keyDiffs.length === 0, `${keyDiffs.length} discrepancies`, keyDiffs.slice(0, 8).join("; ") + (new Date().toISOString().slice(0, 10) === asOf ? "" : " | calibration counts not reconciled: as-of is not today"));

  return checks;
}

function daysDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
