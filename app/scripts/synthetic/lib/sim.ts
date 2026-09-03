/**
 * The simulation — feature 007's event model. A day loop from the history horizon to the as-of
 * date; each day enqueues what the fictional company intends to do (buy, audit, send to the lab,
 * start jobs, retire) as timestamped events, then drains the event heap in timestamp order so
 * that the order rows are RECORDED in is the order they HAPPENED in (FR-012 is checked
 * chronologically by the verifier, so out-of-order recording would fail generation).
 *
 * Every state change goes through `Ledger.apply`, which goes through domain/deriveState — the
 * sim decides WHAT happens; it never decides what a status becomes (Principle I).
 *
 * Tiers (spec § Interpretation of the brief): inside the detail window every rate is at full
 * strength; before it, job and cycle rates are multiplied by `deepRate` (default 0.4). Nothing
 * else changes between tiers — every status an asset ever held has the transaction that put it
 * there in both.
 */
import type { AssetStatus } from "../../../src/domain/stateMachine";
import type { EquipmentModel, KitRole, LocationType, Orientation, PowerSource } from "../../../src/api/types";
import type { Discipline, LoadedConfig, ModelWindow, OfficeConfig, Params, RosterEntry } from "./config";
import { modelKey } from "./config";
import { luhnCheckDigit } from "./ids";
import type { Ledger, TrackedState } from "./ledger";
import type { Rng } from "./rng";
import {
  addDays,
  addMonths,
  daysBetween,
  isWeekend,
  localDateOf,
  monthOf,
  plusSeconds,
  workingDayOnOrAfter,
  workingTime,
  yearOf,
  type DateStr,
  type UtcIso,
} from "./time";

// ------------------------------------------------------------------ sim entities

interface Event {
  ts: UtcIso;
  seq: number;
  run: () => void;
}

class EventHeap {
  private items: Event[] = [];
  private seq = 0;

  push(ts: UtcIso, run: () => void): void {
    const e: Event = { ts, seq: this.seq++, run };
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }

  peek(): Event | undefined {
    return this.items[0];
  }

  pop(): Event | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }

  private less(x: Event, y: Event): boolean {
    return x.ts < y.ts || (x.ts === y.ts && x.seq < y.seq);
  }
}

interface KitMember {
  assetId: string;
  role: "Sensor" | "Microphone" | "Modem";
}

interface Kit {
  loggerId: string;
  office: string;
  family: string;
  members: KitMember[];
  sensorSlots: number;
  heldBy: string | null;
  busy: boolean;
  nextJobDate: DateStr;
  lowDemand: boolean;
}

export interface ProjectRec {
  number: string;
  name: string;
  office: string;
  region: string;
  discipline: Discipline;
  start: DateStr;
  end: DateStr;
  closed: boolean;
  sites: string[];
  stationsTarget: number;
  openStations: number;
  client: string;
}

interface SiteRec {
  name: string;
  region: string;
  lat: number;
  lon: number;
  locationtype: LocationType;
  projects: Set<string>;
}

interface Job {
  kit: Kit;
  tech: string;
  project: ProjectRec;
  site: SiteRec;
  participants: Array<{ assetId: string; role: KitRole; orientation: Orientation | null }>;
  installationId: string | null;
  deployDate: DateStr;
  durationDays: number;
  powersource: PowerSource;
  forced: string | null;
}

interface JobOptions {
  durationDays?: number;
  substituteSensor?: boolean;
  project?: ProjectRec;
}

interface StandaloneRec {
  assetId: string;
  office: string;
  cycleMedianDays: number;
  nextCycleDate: DateStr;
  lowDemand: boolean;
}

export interface PlantedScenario {
  key: string;
  description: string;
  identifiers: Record<string, string | string[]>;
}

const SENSOR_ROLES: KitRole[] = ["Sensor1", "Sensor2", "Sensor3", "Sensor4"];
const ORIENTATIONS: Orientation[] = ["H", "V", "BH", "N", "E", "S", "W"];
const RETIRE_LEGACY: ReadonlyArray<readonly [string, number]> = [["Obsolete", 0.65], ["Sold", 0.3], ["Damaged", 0.05]];
const RETIRE_CURRENT: ReadonlyArray<readonly [string, number]> = [["Sold", 0.4], ["Obsolete", 0.3], ["Damaged", 0.3]];
const RETIRE_CONSUMABLE: ReadonlyArray<readonly [string, number]> = [["Obsolete", 0.6], ["Damaged", 0.4]];

const SIGMOID = (t: number): number => 1 / (1 + Math.exp(-8 * (t - 0.55)));

export class Simulation {
  private readonly heap = new EventHeap();
  private readonly kits = new Map<string, Kit>(); // by logger id
  private readonly kitByMember = new Map<string, Kit>();
  private readonly spares = new Map<string, string[]>(); // `${office}|${family}|${class}` -> asset ids
  private readonly standalone = new Map<string, StandaloneRec>();
  private readonly frozen = new Set<string>(); // assets no routine touches (planted holds)
  private readonly neglectCal = new Map<string, number>(); // assetId -> send probability multiplier
  private readonly windowOf = new Map<string, ModelWindow>(); // assetId -> its model window
  private readonly modelOf = new Map<string, EquipmentModel>();
  readonly projects: ProjectRec[] = [];
  private readonly sites = new Map<string, SiteRec>();
  private readonly serialCounters = new Map<string, number>();
  private readonly usedSerials = new Set<string>();
  private readonly usedPhones = new Set<string>();
  private readonly usedIps = new Set<string>();
  private readonly usedSiteNames = new Set<string>();
  private projectSeq = 0;
  private certSeq = 0;
  private taggableCount = 0;
  private today: DateStr = "";
  readonly planted: PlantedScenario[] = [];
  readonly snapshots = new Map<DateStr, Map<string, TrackedState>>();
  readonly probeDates: DateStr[];
  private leaverException: string | null = null;
  private closedProjectException: string | null = null;
  private readonly detailStart: DateStr;
  private readonly horizonStart: DateStr;
  private readonly rngs: Record<string, Rng>;
  private purchasePlan = new Map<string, Map<string, number>>(); // month -> modelKey -> count
  private auditDays = new Map<string, DateStr>(); // `${office}|${year}` -> date
  private officeState = new Map<string, { admins: RosterEntry[]; techs: RosterEntry[] }>();

  constructor(
    private readonly cfg: LoadedConfig,
    private readonly params: Params,
    rng: Rng,
    private readonly ledger: Ledger
  ) {
    this.rngs = {
      purchase: rng.fork("purchase"),
      jobs: rng.fork("jobs"),
      cal: rng.fork("cal"),
      hazard: rng.fork("hazard"),
      audit: rng.fork("audit"),
      retire: rng.fork("retire"),
      names: rng.fork("names"),
      time: rng.fork("time"),
      planted: rng.fork("planted"),
      ids: rng.fork("ids"),
    };
    // 45 days of margin: purchases fall anywhere in a month, and the earliest must still be at
    // least the full horizon before as-of (FR-024).
    this.horizonStart = addDays(addMonths(params.asOf, -12 * params.historyYears), -45);
    this.detailStart = addMonths(params.asOf, -12 * params.detailYears);
    this.probeDates = [addMonths(params.asOf, -120), addMonths(params.asOf, -60), addMonths(params.asOf, -12), params.asOf];
    for (const m of cfg.catalogue) this.modelOf.set(modelKey(m), m);
    this.planPurchases();
    this.planAudits();
    for (const o of cfg.offices.offices) {
      this.officeState.set(o.name, {
        admins: cfg.roster.filter((r) => r.role === "OfficeAdmin" && r.office === o.name),
        techs: cfg.roster.filter((r) => r.role === "FieldUser" && r.office === o.name),
      });
    }
  }

  // ================================================================ planning

  private hazardPerYear(h: ModelWindow["hazard"], age: number): number {
    switch (h) {
      case "legacy":
        return age < 8 ? 0.012 : 0.06;
      case "current":
        return age < 10 ? 0.008 : 0.025;
      case "consumable":
        return 0.03;
      case "static":
        return 0.003;
    }
  }

  private survival(h: ModelWindow["hazard"], ageYears: number): number {
    let s = 1;
    for (let a = 0; a < ageYears; a += 1 / 12) s *= 1 - (this.hazardPerYear(h, a) + 0.005) / 12;
    return s;
  }

  /** Monthly purchase counts per model so that expected survivors at as-of hit target x scale
   * (FR-028/FR-029), weighted toward the fleet's growth curve inside each model's window. */
  private planPurchases(): void {
    const months: DateStr[] = [];
    for (let d = this.horizonStart.slice(0, 7) + "-01"; d <= this.params.asOf; d = addMonths(d, 1)) months.push(d);
    const asOfMs = Date.parse(this.params.asOf);
    const horizonMs = Date.parse(this.horizonStart);
    const bundledInto = new Map<string, number>(); // key -> expected units arriving via bundles
    for (const w of Object.values(this.cfg.windows.models)) {
      for (const b of w.bundles ?? []) bundledInto.set(b.key, (bundledInto.get(b.key) ?? 0) + w.target * b.p);
    }
    for (const [key, w] of Object.entries(this.cfg.windows.models)) {
      if (w.bundledOnly) continue;
      const ownTarget = Math.max(0, w.target - (bundledInto.get(key) ?? 0)) * this.params.scale;
      if (ownTarget <= 0) continue;
      const eligible = months.filter((m) => {
        const y = yearOf(m);
        return y >= w.from && (w.to === null || y <= w.to) && m >= this.horizonStart.slice(0, 7) + "-01";
      });
      if (eligible.length === 0) continue;
      const weights = eligible.map((m) => {
        const t = (Date.parse(m) - horizonMs) / (asOfMs - horizonMs);
        const growth = SIGMOID(t + 0.05) - SIGMOID(t - 0.05);
        return 0.15 + 4 * growth;
      });
      const expectedSurvivorsPerUnitWeight = eligible.reduce((acc, m, i) => {
        const age = (asOfMs - Date.parse(m)) / (365.25 * 86_400_000);
        return acc + weights[i] * this.survival(w.hazard, age);
      }, 0);
      const perWeight = ownTarget / expectedSurvivorsPerUnitWeight;
      for (let i = 0; i < eligible.length; i++) {
        const n = this.rngs.purchase.round(weights[i] * perWeight);
        if (n <= 0) continue;
        if (!this.purchasePlan.has(eligible[i])) this.purchasePlan.set(eligible[i], new Map());
        this.purchasePlan.get(eligible[i])!.set(key, n);
      }
    }
  }

  private planAudits(): void {
    for (const o of this.cfg.offices.offices) {
      for (let y = yearOf(this.horizonStart) + 1; y <= yearOf(this.params.asOf); y++) {
        const date = workingDayOnOrAfter(this.rngs.audit, `${y}-0${this.rngs.audit.int(2, 3)}-${String(this.rngs.audit.int(2, 26)).padStart(2, "0")}`);
        this.auditDays.set(`${o.name}|${y}`, date);
      }
    }
  }

  // ================================================================ people & offices

  private officeActive(o: OfficeConfig, date: DateStr): boolean {
    return o.activeFrom <= date;
  }

  private activeOffices(date: DateStr): OfficeConfig[] {
    return this.cfg.offices.offices.filter((o) => this.officeActive(o, date));
  }

  private officeCfg(name: string): OfficeConfig {
    return this.cfg.offices.offices.find((o) => o.name === name)!;
  }

  private pickOffice(date: DateStr, rng: Rng): OfficeConfig {
    const active = this.activeOffices(date);
    return rng.weighted(active.map((o) => [o, o.share] as const));
  }

  private isActive(p: RosterEntry, date: DateStr): boolean {
    return p.start <= date && (p.end === null || p.end > date);
  }

  private admins(office: string, date: DateStr): RosterEntry[] {
    const st = this.officeState.get(office);
    const local = (st?.admins ?? []).filter((p) => this.isActive(p, date));
    if (local.length > 0) return local;
    return this.cfg.roster.filter((p) => p.role === "OfficeAdmin" && this.isActive(p, date));
  }

  private admin(office: string, date: DateStr, rng: Rng): string {
    const list = this.admins(office, date);
    return list.length > 0 ? rng.pick(list).upn : "svc-ams@englobecorp.com";
  }

  private techs(office: string, date: DateStr): RosterEntry[] {
    const st = this.officeState.get(office);
    const local = (st?.techs ?? []).filter((p) => this.isActive(p, date));
    if (local.length > 0) return local;
    return this.cfg.roster.filter((p) => p.role === "FieldUser" && this.isActive(p, date));
  }

  private holdings(): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of this.ledger.assets.values()) {
      if (a.custodian && (a.status === "CheckedOut" || a.status === "Deployed")) m.set(a.custodian, (m.get(a.custodian) ?? 0) + 1);
    }
    return m;
  }

  private pickTech(office: string, date: DateStr, rng: Rng): string | null {
    const list = this.techs(office, date);
    if (list.length === 0) return null;
    const held = this.holdings();
    return rng.weighted(list.map((p) => [p.upn, 1 / (1 + (held.get(p.upn) ?? 0))] as const));
  }

  // ================================================================ main loop

  run(): void {
    for (let day = this.horizonStart; day <= this.params.asOf; day = addDays(day, 1)) {
      this.today = day;
      this.dailyIntentions(day);
      this.drain(day);
      if (this.probeDates.includes(day)) this.snapshots.set(day, this.ledger.trackAll());
    }
    this.finalisePlanted();
  }

  private drain(day: DateStr): void {
    for (;;) {
      const next = this.heap.peek();
      if (!next || next.ts.slice(0, 10) > day) break;
      this.heap.pop()!.run();
    }
  }

  private at(date: DateStr, rng: Rng, opts: Parameters<typeof workingTime>[2] = {}): UtcIso {
    return workingTime(rng, date, opts);
  }

  private tier(day: DateStr): number {
    return day >= this.detailStart ? 1 : this.params.deepRate;
  }

  private dailyIntentions(day: DateStr): void {
    if (day.endsWith("-01")) {
      this.schedulePurchases(day);
      this.monthlyRetirements(day);
    }
    this.rosterMovements(day);
    this.projectLifecycle(day);
    if (new Date(day).getUTCDay() === 1) this.calibrationScan(day);
    this.dailyHazards(day);
    this.startJobs(day);
    this.standaloneCycles(day);
    for (const o of this.activeOffices(day)) {
      if (this.auditDays.get(`${o.name}|${yearOf(day)}`) === day) this.scheduleAudit(o.name, day);
    }
    this.plantedTriggers(day);
  }

  // ================================================================ purchases

  private mintSerial(w: ModelWindow): string {
    const rule = w.serial!;
    const counterKey = `${rule.letters}|${rule.start}`;
    let n = this.serialCounters.get(counterKey) ?? rule.start;
    let serial: string;
    do {
      serial = `${rule.letters}${String(n).padStart(rule.digits, "0")}`;
      n++;
    } while (this.usedSerials.has(serial));
    this.serialCounters.set(counterKey, n);
    this.usedSerials.add(serial);
    return serial;
  }

  private simIdentifiers(office: OfficeConfig, rng: Rng): { carrier: string; iccid: string; phone: string; ip: string | null } {
    let body = "89999";
    for (let i = 0; i < 13; i++) body += String(rng.int(0, 9));
    const iccid = body + luhnCheckDigit(body);
    let phone: string;
    let guard = 0;
    do {
      const area = rng.pick(office.areaCodes);
      phone = `${area}-555-01${String(rng.int(0, 99)).padStart(2, "0")}`;
      guard++;
      if (guard > 400) {
        phone = `${rng.pick(["613", "416", "705", "519", "905", "807"])}-555-01${String(rng.int(0, 99)).padStart(2, "0")}`;
      }
    } while (this.usedPhones.has(phone) && guard < 2000);
    this.usedPhones.add(phone);
    let ip: string | null = null;
    if (rng.chance(0.4)) {
      const blocks = ["203.0.113.", "198.51.100.", "192.0.2."];
      let g = 0;
      do {
        ip = `${rng.pick(blocks)}${rng.int(1, 254)}`;
        g++;
      } while (this.usedIps.has(ip) && g < 800);
      this.usedIps.add(ip);
    }
    return { carrier: rng.chance(0.75) ? "Bell" : "Rogers", iccid, phone, ip };
  }

  private schedulePurchases(monthStart: DateStr): void {
    const plan = this.purchasePlan.get(monthStart);
    if (!plan) return;
    const rng = this.rngs.purchase;
    for (const [key, count] of plan) {
      for (let i = 0; i < count; i++) {
        const date = workingDayOnOrAfter(rng, addDays(monthStart, rng.int(0, 27)));
        if (date > this.params.asOf) continue;
        const office = this.pickOffice(date, rng);
        const ts = this.at(date, this.rngs.time, { hourBias: "morning" });
        this.heap.push(ts, () => this.purchase(key, office, ts));
      }
    }
  }

  private purchase(key: string, office: OfficeConfig, ts: UtcIso): string {
    const w = this.cfg.windows.models[key];
    const model = this.modelOf.get(key)!;
    const rng = this.rngs.purchase;
    const date = localDateOf(ts);
    const performedby = this.admin(office.name, date, rng);
    const serial = w.serial ? this.mintSerial(w) : null;
    const taggable = !["sim", "component", "static"].includes(w.class);
    if (taggable) this.taggableCount += 1;
    const isTmp = taggable && (rng.chance(0.01) || this.taggableCount === 7);
    const thirdParty = taggable && !isTmp && (rng.chance(0.003) || this.taggableCount % 250 === 40);
    const notes = isTmp
      ? "Tag illegible on receipt — temporary tag issued, needs completion."
      : thirdParty
        ? `Owned by ${rng.pick(this.cfg.projects.clients)}; on loan to Englobe for the duration of their project.`
        : null;
    const asset = this.ledger.registerAsset({
      model,
      serial,
      homeoffice: office.name,
      ts,
      performedby,
      notes,
      temporaryTag: isTmp,
      ...(w.class === "sim" ? this.simFields(office, rng) : {}),
    });
    this.windowOf.set(asset.assetid, w);
    if (thirdParty) this.recordPlanted("third-party-owned", "Asset whose notes record third-party ownership (feature 006 FR-012)", { assetId: asset.assetid }, true);
    if (isTmp) this.recordPlanted("temporary-tag", "Temporary-tagged asset never completed (feature 006 FR-011)", { assetId: asset.assetid }, true);

    // factory calibration certificate on receipt
    if (model.defaultcalintervalmonths && w.class !== "component") {
      this.ledger.recordCalibration({
        assetId: asset.assetid,
        calibrationdate: date,
        lab: null,
        certificatenumber: `SYN-FACTORY-${String(++this.certSeq).padStart(6, "0")}`,
        cost: null,
        result: "Pass",
        ts,
        performedby,
      });
    }
    if (w.class === "standalone" || w.class === "accessory") {
      this.standalone.set(asset.assetid, {
        assetId: asset.assetid,
        office: office.name,
        cycleMedianDays: w.cycleMedianDays ?? 30,
        nextCycleDate: addDays(date, rng.int(3, 60)),
        lowDemand: rng.chance(0.08),
      });
    }
    if (w.class === "logger") this.createKit(asset.assetid, office.name, w.family!, date);
    if (w.class === "sensor" || w.class === "mic" || w.class === "slm" || w.class === "modem") this.placeMember(asset.assetid, office.name, w, date);
    if (this.neglectCandidate(w) && rng.chance(0.05)) this.neglectCal.set(asset.assetid, 0.15);

    // bundles: same-serial sibling, or permanent components (registered then attached)
    let lastTs = this.ledger.lastTs.get(asset.assetid)!;
    for (const b of w.bundles ?? []) {
      if (!rng.chance(b.p)) continue;
      const bw = this.cfg.windows.models[b.key];
      const bm = this.modelOf.get(b.key)!;
      lastTs = plusSeconds(lastTs, 60 + rng.int(0, 240));
      const bserial = b.sameSerial ? serial : bw.serial ? this.mintSerial(bw) : null;
      const child = this.ledger.registerAsset({
        model: bm,
        serial: bserial,
        homeoffice: office.name,
        ts: lastTs,
        performedby,
        ...(bw.class === "sim" ? this.simFields(office, rng) : {}),
      });
      this.windowOf.set(child.assetid, bw);
      lastTs = this.ledger.lastTs.get(child.assetid)!;
      if (bm.defaultcalintervalmonths) {
        this.ledger.recordCalibration({
          assetId: child.assetid,
          calibrationdate: date,
          lab: null,
          certificatenumber: `SYN-FACTORY-${String(++this.certSeq).padStart(6, "0")}`,
          cost: null,
          result: "Pass",
          ts: lastTs,
          performedby,
        });
      }
      if (b.component) {
        const regTxn = this.ledger.transactions[this.ledger.transactions.length - 1].id;
        this.ledger.attachComponent(asset.assetid, child.assetid, lastTs, regTxn);
      } else if (bw.class === "sensor") {
        this.placeMember(child.assetid, office.name, bw, date, asset.assetid);
      }
    }
    return asset.assetid;
  }

  private simFields(office: OfficeConfig, rng: Rng) {
    const s = this.simIdentifiers(office, rng);
    return { carrier: s.carrier, identifiervalue: s.iccid, phonenumber: s.phone, staticip: s.ip };
  }

  private neglectCandidate(w: ModelWindow): boolean {
    return w.class === "standalone" || w.class === "slm" || w.class === "sensor" || w.class === "logger" || w.class === "mic";
  }

  private createKit(loggerId: string, office: string, family: string, date: DateStr): void {
    const rule = this.cfg.windows.families[family];
    const rng = this.rngs.jobs;
    const kit: Kit = {
      loggerId,
      office,
      family,
      members: [],
      sensorSlots: Number(rng.weightedKey(rule.sensorWeights)),
      heldBy: null,
      busy: false,
      nextJobDate: addDays(date, rng.int(5, 45)),
      lowDemand: rng.chance(0.08),
    };
    this.kits.set(loggerId, kit);
    // adopt spares already waiting at this office
    for (const cls of ["sensor", "mic", "slm", "modem"] as const) this.adoptSpares(kit, cls);
  }

  private spareKey(office: string, family: string, cls: string): string {
    return `${office}|${family}|${cls}`;
  }

  private adoptSpares(kit: Kit, cls: "sensor" | "mic" | "slm" | "modem"): void {
    const key = this.spareKey(kit.office, kit.family, cls);
    const pool = this.spares.get(key) ?? [];
    while (pool.length > 0 && this.kitWants(kit, cls)) {
      const id = pool.shift()!;
      this.addMember(kit, id, cls);
    }
    this.spares.set(key, pool);
  }

  private kitWants(kit: Kit, cls: "sensor" | "mic" | "slm" | "modem"): boolean {
    const rule = this.cfg.windows.families[kit.family];
    const rng = this.rngs.jobs;
    if (cls === "sensor") return kit.members.filter((m) => m.role === "Sensor").length < kit.sensorSlots;
    if (cls === "mic" || cls === "slm") return rule.micProbability > 0 && !kit.members.some((m) => m.role === "Microphone") && rng.chance(rule.micProbability);
    return rule.modemProbability > 0 && !kit.members.some((m) => m.role === "Modem") && rng.chance(rule.modemProbability);
  }

  private addMember(kit: Kit, assetId: string, cls: "sensor" | "mic" | "slm" | "modem"): void {
    const role: KitMember["role"] = cls === "sensor" ? "Sensor" : cls === "modem" ? "Modem" : "Microphone";
    kit.members.push({ assetId, role });
    this.kitByMember.set(assetId, kit);
  }

  private placeMember(assetId: string, office: string, w: ModelWindow, date: DateStr, preferLogger?: string): void {
    const cls = w.class as "sensor" | "mic" | "slm" | "modem";
    if (preferLogger) {
      const kit = this.kits.get(preferLogger);
      if (kit && this.kitWants(kit, cls)) {
        this.addMember(kit, assetId, cls);
        return;
      }
    }
    for (const kit of this.kits.values()) {
      if (kit.office !== office || kit.family !== w.family) continue;
      if (this.ledger.status(kit.loggerId) === "Retired") continue;
      if (this.kitWants(kit, cls)) {
        this.addMember(kit, assetId, cls);
        return;
      }
    }
    const key = this.spareKey(office, w.family!, cls);
    if (!this.spares.has(key)) this.spares.set(key, []);
    this.spares.get(key)!.push(assetId);
    if (cls === "slm" || cls === "mic") {
      // an unpaired sound level meter is used standalone for noise surveys
      this.standalone.set(assetId, { assetId, office, cycleMedianDays: 18, nextCycleDate: addDays(date, this.rngs.jobs.int(5, 60)), lowDemand: false });
    }
  }

  private takeSpare(office: string, family: string, cls: "sensor" | "mic" | "slm" | "modem", exclude: Set<string>, anyOffice = false): string | null {
    const offices = anyOffice ? this.cfg.offices.offices.map((o) => o.name) : [office];
    for (const o of offices) {
      const pool = this.spares.get(this.spareKey(o, family, cls)) ?? [];
      for (const id of pool) {
        if (exclude.has(id) || this.frozen.has(id)) continue;
        if (this.ledger.status(id) === "Available" && this.ledger.assets.get(id)!.currentlocation === o) return id;
      }
    }
    return null;
  }

  // ================================================================ projects & sites

  private region(office: string): string {
    return this.officeCfg(office).region;
  }

  private newSiteName(region: string, rng: Rng): string {
    const pool = this.cfg.sites.regions[region] ?? this.cfg.sites.regions["Ottawa"];
    for (let i = 0; i < 200; i++) {
      const name = rng.chance(0.6) ? `${rng.int(12, 4890)} ${rng.pick(pool.streets)}` : rng.pick(pool.landmarks);
      if (!this.usedSiteNames.has(name)) {
        this.usedSiteNames.add(name);
        return name;
      }
    }
    const name = `${rng.int(5000, 9999)} ${rng.pick(pool.streets)}`;
    this.usedSiteNames.add(name);
    return name;
  }

  private newSite(office: string, rng: Rng): SiteRec {
    const o = this.officeCfg(office);
    const name = this.newSiteName(o.region, rng);
    const site: SiteRec = {
      name,
      region: o.region,
      lat: Math.round((o.lat + rng.normal(0, 0.25)) * 1e5) / 1e5,
      lon: Math.round((o.lon + rng.normal(0, 0.35)) * 1e5) / 1e5,
      locationtype: rng.chance(0.85) ? "Site" : "Client",
      projects: new Set(),
    };
    this.sites.set(name, site);
    return site;
  }

  private pickDiscipline(office: string, rng: Rng, needsKit: boolean): Discipline {
    const region = this.region(office);
    const items = this.cfg.projects.disciplines
      .filter((d) => !needsKit || Object.keys(d.stations).some((k) => k !== "0"))
      .map((d) => [d, d.regionWeights[region] ?? 0.2] as const);
    return rng.weighted(items);
  }

  private createProject(office: string, date: DateStr, rng: Rng, needsKit: boolean, opts: { site?: SiteRec; durationDays?: number } = {}): ProjectRec {
    const d = this.pickDiscipline(office, rng, needsKit);
    const site = opts.site ?? (rng.chance(0.15) ? this.existingSiteInRegion(office, rng) : null) ?? this.newSite(office, rng);
    const client = rng.pick(this.cfg.projects.clients);
    const template = rng.pick(d.templates);
    const name = template.replace("{site}", site.name).replace("{client}", client);
    const number = `${this.cfg.projects.numberPrefix}${String(++this.projectSeq).padStart(6, "0")}`;
    const duration = opts.durationDays ?? Math.round(rng.lognormal(d.durationMedianDays, d.durationSigma, 14, 3000));
    const project: ProjectRec = {
      number,
      name,
      office,
      region: this.region(office),
      discipline: d,
      start: date,
      end: addDays(date, duration),
      closed: false,
      sites: [site.name],
      stationsTarget: Number(rng.weightedKey(d.stations)),
      openStations: 0,
      client,
    };
    site.projects.add(number);
    this.projects.push(project);
    this.ledger.addProject({ projectnumber: number, name, status: "Active", office, pm: null });
    return project;
  }

  private existingSiteInRegion(office: string, rng: Rng): SiteRec | null {
    const region = this.region(office);
    const candidates = [...this.sites.values()].filter((s) => s.region === region);
    return candidates.length > 0 ? rng.pick(candidates) : null;
  }

  private activeProjects(office: string, date: DateStr): ProjectRec[] {
    return this.projects.filter((p) => !p.closed && p.start <= date && p.end >= date && (p.office === office || p.region === this.region(office)));
  }

  private pickProject(office: string, date: DateStr, rng: Rng, needsKit: boolean): ProjectRec {
    const candidates = this.activeProjects(office, date).filter((p) => (!needsKit || p.openStations < Math.max(1, p.stationsTarget)) && p.office === office);
    if (candidates.length > 0 && rng.chance(0.97)) return rng.pick(candidates);
    return this.createProject(office, date, rng, needsKit);
  }

  private pickSite(project: ProjectRec, rng: Rng): SiteRec {
    if (project.sites.length > 0 && rng.chance(0.75)) return this.sites.get(rng.pick(project.sites))!;
    const site = this.newSite(project.office, rng);
    project.sites.push(site.name);
    site.projects.add(project.number);
    return site;
  }

  private projectLifecycle(day: DateStr): void {
    for (const p of this.projects) {
      if (p.closed || p.end > day) continue;
      if (p.number === this.closedProjectException) continue;
      if (p.openStations > 0) {
        p.end = addDays(p.end, 30); // a project does not close while its stations are on site
        continue;
      }
      p.closed = true;
      const row = this.ledger.projects.find((x) => x.projectnumber === p.number)!;
      row.status = "Closed";
    }
    // FR-041: at least one active project per active office
    for (const o of this.activeOffices(day)) {
      if (this.activeProjects(o.name, day).some((p) => p.office === o.name)) continue;
      this.createProject(o.name, day, this.rngs.jobs, true);
    }
  }

  // ================================================================ jobs (the station cycle)

  private startJobs(day: DateStr): void {
    const rng = this.rngs.jobs;
    for (const kit of this.kits.values()) {
      if (kit.busy || kit.nextJobDate > day) continue;
      if (this.frozen.has(kit.loggerId)) continue;
      const status = this.ledger.status(kit.loggerId);
      if (status === "Retired") continue;
      if (status !== "Available" && !(status === "CheckedOut" && kit.heldBy)) {
        kit.nextJobDate = addDays(day, rng.int(7, 21));
        continue;
      }
      if (isWeekend(day) && rng.chance(0.85)) continue;
      const job = this.planJob(kit, day, rng, null);
      if (!job) {
        kit.nextJobDate = addDays(day, rng.int(7, 30));
        continue;
      }
      this.launchJob(job, day);
    }
  }

  private planJob(kit: Kit, day: DateStr, rng: Rng, forced: string | null, opts: JobOptions = {}): Job | null {
    const tech = kit.heldBy ?? this.pickTech(kit.office, day, rng);
    if (!tech) return null;
    const project = opts.project ?? this.pickProject(kit.office, day, rng, true);
    const site = this.pickSite(project, rng);
    const family = this.cfg.windows.families[kit.family];
    const participants: Job["participants"] = [{ assetId: kit.loggerId, role: "Primary", orientation: null }];
    const used = new Set<string>([kit.loggerId]);
    let sensorIdx = 0;
    const wantMic = rng.chance(project.discipline.needsMic) && family.micProbability > 0;
    for (const m of kit.members) {
      if (this.frozen.has(m.assetId)) continue;
      const a = this.ledger.assets.get(m.assetId)!;
      const usable = a.status === "Available" ? a.currentlocation === kit.office : a.status === "CheckedOut" && a.custodian === tech;
      let id: string | null = usable ? m.assetId : null;
      if (m.role === "Sensor" && opts.substituteSensor && sensorIdx === 0) id = null; // planted: leave own sensor at office
      if (!id && rng.chance(0.6)) {
        id = this.takeSpare(kit.office, kit.family, m.role === "Sensor" ? "sensor" : m.role === "Modem" ? "modem" : "slm", used) ??
          (m.role === "Microphone" ? this.takeSpare(kit.office, kit.family, "mic", used) : null);
      }
      if (!id) continue;
      if (m.role === "Microphone" && !wantMic && !opts.substituteSensor) continue;
      used.add(id);
      if (m.role === "Sensor") {
        if (sensorIdx >= SENSOR_ROLES.length) continue;
        participants.push({ assetId: id, role: SENSOR_ROLES[sensorIdx++], orientation: rng.pick(ORIENTATIONS) });
      } else participants.push({ assetId: id, role: m.role, orientation: null });
    }
    const d = project.discipline;
    const durationDays = opts.durationDays ?? Math.max(3, Math.round(rng.lognormal(d.deployMedianDays, d.deploySigma, 3, 900)));
    return {
      kit,
      tech,
      project,
      site,
      participants,
      installationId: null,
      deployDate: day,
      durationDays,
      powersource: rng.weighted([["Battery", 55], ["Solar", 20], ["AC", 20], ["External", 5]] as const),
      forced,
    };
  }

  private launchJob(job: Job, day: DateStr): void {
    const rng = this.rngs.jobs;
    const kit = job.kit;
    kit.busy = true;
    kit.heldBy = null;
    job.project.openStations += 1;
    const ids = job.participants.map((p) => p.assetId);
    const logger = this.ledger.assets.get(kit.loggerId)!;
    const checkoutFirst = logger.status === "Available" && rng.chance(0.7);
    const t0 = this.at(day, this.rngs.time);
    if (checkoutFirst) {
      const checkable = ids.filter((id) => this.ledger.canApply("Checkout", [id]));
      const expected = rng.chance(0.65) ? addDays(day, job.durationDays + rng.int(2, 10)) : null;
      this.ledger.apply({
        type: "Checkout",
        ts: t0,
        performedby: job.tech,
        touser: job.tech,
        toproject: job.project.number,
        expectedreturn: expected,
        notes: `Equipment for ${job.project.name}.`,
        lines: checkable.map((assetId) => ({ assetId })),
      });
      const deployDay = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 3)));
      job.deployDate = deployDay;
      const ts = plusSeconds(this.at(deployDay, this.rngs.time), 0);
      this.heap.push(ts > t0 ? ts : plusSeconds(t0, 3600), () => this.deploy(job));
    } else {
      // deployed straight from the office (or from the tech's held kit)
      if (kit.heldBy === null && logger.status === "CheckedOut" && logger.custodian !== job.tech) {
        // handover between technicians before the station goes out
        this.ledger.apply({ type: "Transfer", ts: t0, performedby: logger.custodian ?? job.tech, touser: job.tech, notes: "Kit handed over between technicians.", lines: ids.filter((id) => this.ledger.status(id) === "CheckedOut").map((assetId) => ({ assetId })) });
      }
      this.heap.push(plusSeconds(t0, 1800), () => this.deploy(job));
    }
  }

  private deploy(job: Job): void {
    const rng = this.rngs.jobs;
    const kit = job.kit;
    const ts = this.at(job.deployDate, this.rngs.time);
    const deployable = job.participants.filter((p) => this.ledger.canApply("Deploy", [p.assetId]) && this.ledger.componentParentOf(p.assetId) === null);
    if (!deployable.some((p) => p.role === "Primary")) {
      this.abandonJob(job);
      return;
    }
    job.participants = deployable;
    const site = this.ledger.ensureSite(job.site.name, `SYNTHETIC seed=${this.params.seed}`);
    const tx = this.ledger.apply({
      type: "Deploy",
      ts,
      performedby: job.tech,
      tolocation: site.name,
      toproject: job.project.number,
      primaryAssetId: kit.loggerId,
      notes: job.forced ? `Station deployed (${job.forced}).` : `Station deployed for ${job.project.name}.`,
      lines: job.participants.map((p) => ({ assetId: p.assetId, kitRole: p.role, orientation: p.orientation, powersource: job.powersource })),
    });
    const installation = this.ledger.openInstallation(
      {
        site: site.name,
        project: job.project.number,
        primaryasset: kit.loggerId,
        locationtype: job.site.locationtype,
        sitename: job.site.name,
        position: rng.pick(this.cfg.sites.positions),
        latitude: job.site.lat,
        longitude: job.site.lon,
        coordinatesource: rng.chance(0.8) ? "Manual" : "Device",
        powersource: job.powersource,
        start: tx.ts,
        end: null,
        openedbytransaction: tx.transactionId,
        closedbytransaction: null,
        notes: null,
      },
      job.participants.map((p) => ({ asset: p.assetId, kitrole: p.role, orientation: p.orientation, start: tx.ts, end: null, openedbyline: tx.transactionId, closedbyline: null }))
    );
    job.installationId = installation.id;
    const recoverDay = workingDayOnOrAfter(rng, addDays(job.deployDate, job.durationDays));

    // mid-deployment events
    const sensors = job.participants.filter((p) => p.role.startsWith("Sensor"));
    if (job.durationDays > 20 && sensors.length > 0 && rng.chance(0.06) && !job.forced) {
      const swapDay = addDays(job.deployDate, rng.int(7, job.durationDays - 5));
      this.heap.push(this.at(swapDay, this.rngs.time), () => this.swapComponent(job, rng.pick(sensors).assetId));
    }
    if (job.durationDays > 10 && rng.chance(0.08) && !job.forced) {
      const day = addDays(job.deployDate, rng.int(3, job.durationDays - 2));
      this.heap.push(this.at(day, this.rngs.time), () => this.configurationChange(job));
    }
    if (job.durationDays > 30 && rng.chance(0.03) && !job.forced) {
      const day = addDays(job.deployDate, rng.int(10, job.durationDays - 5));
      this.heap.push(this.at(day, this.rngs.time), () => this.projectMove(job));
    }
    for (let d = 365; d < job.durationDays - 20; d += 365) {
      const day = workingDayOnOrAfter(rng, addDays(job.deployDate, d));
      this.heap.push(this.at(day, this.rngs.time), () => this.siteInspection(job));
    }
    if (sensors.length === 0 && job.participants.length === 1 && rng.chance(0.03) && job.durationDays > 14 && !job.forced) {
      const day = addDays(job.deployDate, rng.int(5, job.durationDays - 3));
      this.heap.push(this.at(day, this.rngs.time), () => this.loneLoggerFault(job));
      return; // the fault path ends this deployment
    }
    if (job.forced === "partial-recovery") {
      const partialDay = workingDayOnOrAfter(rng, addDays(job.deployDate, Math.floor(job.durationDays / 2)));
      this.heap.push(this.at(partialDay, this.rngs.time), () => this.recover(job, "partial-only"));
      return;
    }
    const partial = !job.forced && sensors.length > 0 && rng.chance(0.12);
    this.heap.push(this.at(recoverDay, this.rngs.time), () => this.recover(job, partial ? "partial" : "full"));
  }

  private abandonJob(job: Job): void {
    job.kit.busy = false;
    job.project.openStations = Math.max(0, job.project.openStations - 1);
    job.kit.nextJobDate = addDays(this.today, this.rngs.jobs.int(10, 40));
  }

  private openParticipants(job: Job): string[] {
    return this.ledger.openComponentRows(job.installationId!).map((r) => r.asset);
  }

  private recover(job: Job, mode: "full" | "partial" | "partial-only"): void {
    const rng = this.rngs.jobs;
    const kit = job.kit;
    if (this.frozen.has(kit.loggerId)) return; // a planted station that stays on site past as-of
    const open = this.openParticipants(job).filter((id) => this.ledger.status(id) === "Deployed");
    if (open.length === 0) {
      this.finishJob(job);
      return;
    }
    const day = this.today;
    const ts = this.at(day, this.rngs.time, { hourBias: "afternoon" });
    let toRecover = open;
    if (mode !== "full") {
      const nonPrimary = open.filter((id) => id !== kit.loggerId);
      toRecover = nonPrimary.length > 0 ? nonPrimary.slice(0, Math.max(1, Math.ceil(nonPrimary.length / 2))) : open;
    }
    // rare coverage path: whole station returned straight to the office (Deployed -> Return)
    if (mode === "full" && rng.chance(0.004) && toRecover.length === open.length) {
      const tx = this.ledger.apply({ type: "Return", ts, performedby: job.tech, tolocation: kit.office, notes: "Station returned directly to the office.", lines: toRecover.map((assetId) => ({ assetId })) });
      this.ledger.closeInstallationComponents(job.installationId!, toRecover, tx.ts, tx.transactionId);
      this.finishJob(job);
      return;
    }
    const missing = toRecover.filter((id) => id !== kit.loggerId && rng.chance(0.01));
    const recovered = toRecover.filter((id) => !missing.includes(id));
    let closeTx: string | null = null;
    let closeTs = ts;
    if (recovered.length > 0) {
      const bad = recovered.filter(() => rng.chance(0.01));
      const undeploy = this.ledger.apply({
        type: "Undeploy",
        ts,
        performedby: job.tech,
        touser: job.tech,
        notes: mode === "full" ? "Station recovered from site." : "Partial recovery — remaining components left on site.",
        lines: recovered.map((assetId) => ({ assetId, condition: bad.includes(assetId) ? (rng.chance(0.5) ? "Damaged" : "NeedsService") : "Good" })),
      });
      closeTx = undeploy.transactionId;
      closeTs = undeploy.ts;
      if (bad.length > 0) {
        this.ledger.apply({ type: "ReportFault", ts: plusSeconds(undeploy.ts, 60), performedby: job.tech, notes: "Reported damaged/needs-service on recovery.", lines: bad.map((assetId) => ({ assetId })) });
        for (const id of bad) this.scheduleRepairOutcome(id, addDays(day, rng.int(3, 10)));
      }
    }
    if (missing.length > 0) {
      const mt = this.ledger.apply({ type: "MarkMissing", ts: plusSeconds(closeTs, 60), performedby: job.tech, notes: "Not found on site at recovery.", lines: missing.map((assetId) => ({ assetId })) });
      closeTx = closeTx ?? mt.transactionId;
      closeTs = mt.ts;
      for (const id of missing) this.scheduleMissingOutcome(id, day);
    }
    this.ledger.closeInstallationComponents(job.installationId!, toRecover, closeTs, closeTx);
    const remaining = this.openParticipants(job);
    if (remaining.length > 0) {
      if (mode === "partial-only") {
        // planted: the rest stays on site past as-of
        for (const id of remaining) this.frozen.add(id);
        this.frozen.add(kit.loggerId);
        kit.busy = true;
        return;
      }
      const second = workingDayOnOrAfter(rng, addDays(day, rng.int(7, 42)));
      this.heap.push(this.at(second, this.rngs.time), () => this.recover(job, "full"));
    }
    // bring recovered items back to the office, or keep them in custody until the next job
    const held = recovered.filter((id) => this.ledger.status(id) === "CheckedOut");
    const isMember = (id: string) => id === kit.loggerId || kit.members.some((m) => m.assetId === id);
    const substitutes = held.filter((id) => !isMember(id));
    const own = held.filter(isMember);
    if (substitutes.length > 0) {
      // borrowed spares always go back to the office — only the kit itself may stay in custody
      const returnDay = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 3)));
      this.heap.push(this.at(returnDay, this.rngs.time, { hourBias: "afternoon" }), () => this.returnToOffice(substitutes, job.tech, kit.office, false));
    }
    if (own.length > 0) {
      if (rng.chance(0.8) || remaining.length > 0) {
        const returnDay = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 5)));
        this.heap.push(this.at(returnDay, this.rngs.time, { hourBias: "afternoon" }), () => this.returnToOffice(own, job.tech, kit.office, rng.chance(0.03)));
      } else {
        kit.heldBy = job.tech;
      }
    }
    if (remaining.length === 0) this.finishJob(job);
  }

  private finishJob(job: Job): void {
    const kit = job.kit;
    kit.busy = false;
    job.project.openStations = Math.max(0, job.project.openStations - 1);
    const gapMedian = (kit.lowDemand ? 120 : 16) / this.tier(this.today);
    kit.nextJobDate = addDays(this.today, Math.round(this.rngs.jobs.lognormal(gapMedian, 0.7, 2, 900)));
  }

  /** Return by the custodian — the app's own two-step pattern for bad condition (Return then
   * ReportFault in one submission, feature 003). Occasionally to another office (inter-office loan). */
  private returnToOffice(assetIds: string[], tech: string, homeOffice: string, otherOffice: boolean): void {
    const rng = this.rngs.jobs;
    const ids = assetIds.filter((id) => this.ledger.status(id) === "CheckedOut" && this.ledger.assets.get(id)!.custodian === tech && !this.frozen.has(id) && !this.ledger.isComponentChild(id));
    if (ids.length === 0) return;
    const active = this.activeOffices(this.today).filter((o) => o.name !== homeOffice);
    const tolocation = otherOffice && active.length > 0 ? rng.pick(active).name : homeOffice;
    const ts = this.at(this.today, this.rngs.time, { hourBias: "afternoon" });
    const conditions = new Map<string, "Good" | "Damaged" | "NeedsService">();
    for (const id of ids) conditions.set(id, rng.chance(0.92) ? "Good" : rng.chance(0.5) ? "Damaged" : "NeedsService");
    const ret = this.ledger.apply({
      type: "Return",
      ts,
      performedby: tech,
      tolocation,
      notes: tolocation === homeOffice ? null : `Returned to ${tolocation} for the next job there.`,
      lines: ids.map((assetId) => ({ assetId, condition: conditions.get(assetId) })),
    });
    const bad = ids.filter((id) => conditions.get(id) !== "Good");
    if (bad.length > 0) {
      this.ledger.apply({ type: "ReportFault", ts: plusSeconds(ret.ts, 60), performedby: tech, notes: "Reported damaged/needs-service on return.", lines: bad.map((assetId) => ({ assetId })) });
      for (const id of bad) this.scheduleRepairOutcome(id, addDays(this.today, rng.int(3, 14)));
    }
    if (tolocation !== homeOffice) {
      // the loan comes home later by stock transfer (Available -> Transfer)
      const backDay = workingDayOnOrAfter(rng, addDays(this.today, rng.int(20, 120)));
      this.heap.push(this.at(backDay, this.rngs.time), () => {
        const back = ids.filter((id) => this.ledger.status(id) === "Available" && this.ledger.assets.get(id)!.currentlocation === tolocation && !this.frozen.has(id));
        if (back.length === 0) return;
        this.ledger.apply({ type: "Transfer", ts: this.at(this.today, this.rngs.time), performedby: this.admin(homeOffice, this.today, rng), tolocation: homeOffice, notes: `Stock returned to ${homeOffice}.`, lines: back.map((assetId) => ({ assetId })) });
      });
    }
  }

  private swapComponent(job: Job, outgoingId: string): void {
    const rng = this.rngs.jobs;
    if (!job.installationId || this.ledger.installation(job.installationId).end) return;
    const row = this.ledger.openComponentRows(job.installationId).find((r) => r.asset === outgoingId);
    if (!row || this.ledger.status(outgoingId) !== "Deployed") return;
    const w = this.windowOf.get(outgoingId)!;
    const incoming = this.takeSpare(job.kit.office, job.kit.family, w.class as "sensor", new Set(this.openParticipants(job)), job.forced === "swap");
    if (!incoming) return;
    const ts = this.at(this.today, this.rngs.time);
    const out = this.ledger.apply({ type: "Undeploy", ts, performedby: job.tech, touser: job.tech, notes: "Component swapped in service — outgoing unit recovered.", lines: [{ assetId: outgoingId }] });
    const inn = this.ledger.apply({
      type: "Deploy",
      ts: plusSeconds(out.ts, 60),
      performedby: job.tech,
      tolocation: job.site.name,
      toproject: job.project.number,
      primaryAssetId: job.kit.loggerId,
      notes: "Component swapped in service — replacement installed.",
      lines: [{ assetId: incoming, kitRole: row.kitrole, orientation: row.orientation, powersource: job.powersource }],
    });
    this.ledger.closeInstallationComponents(job.installationId, [outgoingId], out.ts, out.transactionId);
    this.ledger.addInstallationComponent(job.installationId, { asset: incoming, kitrole: row.kitrole, orientation: row.orientation, start: inn.ts, end: null, openedbyline: inn.transactionId, closedbyline: null });
    job.participants.push({ assetId: incoming, role: row.kitrole, orientation: row.orientation });
    const backDay = workingDayOnOrAfter(rng, addDays(this.today, rng.int(1, 4)));
    this.heap.push(this.at(backDay, this.rngs.time, { hourBias: "afternoon" }), () => {
      if (this.ledger.status(outgoingId) !== "CheckedOut") return;
      const ts2 = this.at(this.today, this.rngs.time, { hourBias: "afternoon" });
      const ret = this.ledger.apply({ type: "Return", ts: ts2, performedby: job.tech, tolocation: job.kit.office, lines: [{ assetId: outgoingId, condition: "NeedsService" }] });
      this.ledger.apply({ type: "ReportFault", ts: plusSeconds(ret.ts, 60), performedby: job.tech, notes: "Reported damaged/needs-service on return.", lines: [{ assetId: outgoingId }] });
      this.scheduleRepairOutcome(outgoingId, addDays(this.today, rng.int(3, 14)));
    });
    if (job.forced === "swap") this.recordPlanted("component-swap", "Installation with a component swapped mid-life, still on site (feature 005 US4)", { installationId: job.installationId, outgoing: outgoingId, incoming, site: job.site.name });
  }

  /** feature 005 US4 as api/mock/deployment.ts records it: an Audit transaction (no status change)
   * with the change in its notes; the installation's start is untouched. */
  private configurationChange(job: Job): void {
    const rng = this.rngs.jobs;
    if (!job.installationId) return;
    const inst = this.ledger.installation(job.installationId);
    if (inst.end) return;
    const rows = this.ledger.openComponentRows(job.installationId);
    const deployed = rows.filter((r) => this.ledger.status(r.asset) === "Deployed");
    if (deployed.length === 0) return;
    const notes: string[] = ["Configuration change on live installation"];
    const lines: Array<{ assetId: string; orientation?: Orientation | null }> = [];
    if (rng.chance(0.5)) {
      const newPower = rng.pick((["Battery", "Solar", "AC", "External"] as PowerSource[]).filter((p) => p !== inst.powersource));
      notes.push(`power source ${inst.powersource} -> ${newPower}`);
      inst.powersource = newPower;
      for (const r of deployed) lines.push({ assetId: r.asset });
    } else {
      const sensor = deployed.find((r) => r.kitrole.startsWith("Sensor"));
      if (!sensor) return;
      const newOrientation = rng.pick(ORIENTATIONS.filter((o) => o !== sensor.orientation));
      notes.push(`orientation ${sensor.orientation} -> ${newOrientation} on ${sensor.asset}`);
      sensor.orientation = newOrientation;
      lines.push({ assetId: sensor.asset, orientation: newOrientation });
    }
    this.ledger.apply({ type: "Audit", ts: this.at(this.today, this.rngs.time), performedby: job.tech, notes: notes.join("; "), lines });
  }

  /** feature 005 FR-027: the whole station moves to another project — Transfer(toproject) on every
   * deployed component (the transition matrix allows Transfer from Deployed). */
  private projectMove(job: Job): void {
    const rng = this.rngs.jobs;
    if (!job.installationId || this.ledger.installation(job.installationId).end) return;
    const deployed = this.openParticipants(job).filter((id) => this.ledger.status(id) === "Deployed");
    if (deployed.length === 0) return;
    const others = this.activeProjects(job.kit.office, this.today).filter((p) => p.number !== job.project.number && p.office === job.kit.office);
    const target = others.length > 0 ? rng.pick(others) : this.createProject(job.kit.office, this.today, rng, true, { site: job.site });
    this.ledger.apply({ type: "Transfer", ts: this.at(this.today, this.rngs.time), performedby: this.admin(job.kit.office, this.today, rng), toproject: target.number, notes: `Station reassigned from ${job.project.number} to ${target.number}.`, lines: deployed.map((assetId) => ({ assetId })) });
    job.project.openStations = Math.max(0, job.project.openStations - 1);
    target.openStations += 1;
    if (!target.sites.includes(job.site.name)) target.sites.push(job.site.name);
    job.site.projects.add(target.number);
    job.project = target;
    this.ledger.installation(job.installationId).project = target.number;
  }

  private siteInspection(job: Job): void {
    if (!job.installationId || this.ledger.installation(job.installationId).end) return;
    const deployed = this.openParticipants(job).filter((id) => this.ledger.status(id) === "Deployed");
    if (deployed.length === 0) return;
    this.ledger.apply({ type: "Audit", ts: this.at(this.today, this.rngs.time), performedby: job.tech, notes: "Annual site inspection — station confirmed in place.", lines: deployed.map((assetId) => ({ assetId })) });
  }

  /** Deployed -> ReportFault coverage: a single-logger station fails on site, is pulled and sent to
   * the lab by an admin. Installation closed at the fault. */
  private loneLoggerFault(job: Job): void {
    const rng = this.rngs.jobs;
    const id = job.kit.loggerId;
    if (this.ledger.status(id) !== "Deployed" || !job.installationId) return;
    const ts = this.at(this.today, this.rngs.time);
    const fault = this.ledger.apply({ type: "ReportFault", ts, performedby: job.tech, notes: "Instrument stopped logging on site — pulled for service.", lines: [{ assetId: id }] });
    this.ledger.closeInstallationComponents(job.installationId, [id], fault.ts, fault.transactionId);
    const sendDay = workingDayOnOrAfter(rng, addDays(this.today, rng.int(2, 6)));
    this.heap.push(this.at(sendDay, this.rngs.time), () => {
      if (this.ledger.status(id) !== "NeedsRepair") return;
      this.sendToLab([id], job.kit.office);
    });
    this.finishJob(job);
  }

  // ================================================================ standalone equipment

  private standaloneCycles(day: DateStr): void {
    const rng = this.rngs.jobs;
    for (const rec of this.standalone.values()) {
      if (rec.nextCycleDate > day || this.frozen.has(rec.assetId)) continue;
      const a = this.ledger.assets.get(rec.assetId)!;
      if (a.lifecycle === "Retired") continue;
      if (a.status !== "Available" || a.currentlocation !== rec.office) {
        rec.nextCycleDate = addDays(day, rng.int(5, 20));
        continue;
      }
      if (isWeekend(day) && rng.chance(0.85)) continue;
      const tech = this.pickTech(rec.office, day, rng);
      if (!tech) continue;
      const w = this.windowOf.get(rec.assetId)!;
      const project = this.pickProject(rec.office, day, rng, false);
      const duration = Math.max(1, Math.round(rng.lognormal(rec.cycleMedianDays, 0.6, 1, 400)));
      const expected = rng.chance(0.65) ? addDays(day, duration + rng.int(1, 5)) : null;
      this.ledger.apply({
        type: "Checkout",
        ts: this.at(day, this.rngs.time, { hourBias: "morning" }),
        performedby: tech,
        touser: tech,
        toproject: project.number,
        expectedreturn: expected,
        notes: w.class === "accessory" ? "Accessory checked out with field kit." : null,
        lines: [{ assetId: rec.assetId }],
      });
      const back = workingDayOnOrAfter(rng, addDays(day, duration));
      this.heap.push(this.at(back, this.rngs.time, { hourBias: "afternoon" }), () => {
        if (this.frozen.has(rec.assetId)) return;
        if (this.ledger.status(rec.assetId) === "CheckedOut" && rng.chance(0.02)) {
          // handover to a colleague before it comes back
          const other = this.pickTech(rec.office, this.today, rng);
          if (other && other !== tech) {
            this.ledger.apply({ type: "Transfer", ts: this.at(this.today, this.rngs.time), performedby: tech, touser: other, notes: "Handed over to a colleague on site.", lines: [{ assetId: rec.assetId }] });
            const later = workingDayOnOrAfter(rng, addDays(this.today, rng.int(2, 15)));
            this.heap.push(this.at(later, this.rngs.time, { hourBias: "afternoon" }), () => this.returnToOffice([rec.assetId], other, rec.office, false));
            return;
          }
        }
        this.returnToOffice([rec.assetId], tech, rec.office, rng.chance(0.03));
      });
      const gapMedian = (rec.lowDemand ? 150 : 20) / this.tier(day);
      rec.nextCycleDate = addDays(back, Math.round(rng.lognormal(gapMedian, 0.7, 1, 900)));
    }
  }

  // ================================================================ calibration (feature 004)

  private calibrationScan(day: DateStr): void {
    const rng = this.rngs.cal;
    const horizon = addDays(day, 45);
    const perOffice = new Map<string, string[]>();
    const fieldChecks: string[] = [];
    for (const a of this.ledger.assets.values()) {
      if (a.lifecycle === "Retired" || a.status !== "Available" || !a.nextcaldue || a.nextcaldue > horizon) continue;
      if (this.frozen.has(a.assetid) || this.ledger.isComponentChild(a.assetid)) continue;
      const w = this.windowOf.get(a.assetid);
      if (!w || !this.modelOf.get(modelKey(a.equipmentmodel))?.defaultcalintervalmonths) continue;
      const p = 0.45 * (this.neglectCal.get(a.assetid) ?? 1);
      if (!rng.chance(p)) continue;
      if (w.class === "standalone" && rng.chance(0.25)) {
        fieldChecks.push(a.assetid);
        continue;
      }
      const office = a.currentlocation ?? a.homeoffice ?? "Ottawa";
      if (!perOffice.has(office)) perOffice.set(office, []);
      perOffice.get(office)!.push(a.assetid);
    }
    for (const [office, ids] of perOffice) {
      const sendDay = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 4)));
      this.heap.push(this.at(sendDay, this.rngs.time), () => this.sendToLab(ids.filter((id) => this.ledger.status(id) === "Available" && !this.frozen.has(id)), office));
    }
    for (const id of fieldChecks) {
      const d = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 6)));
      this.heap.push(this.at(d, this.rngs.time), () => {
        const a = this.ledger.assets.get(id)!;
        if (a.status !== "Available" || a.lifecycle === "Retired") return;
        this.ledger.recordCalibration({ assetId: id, calibrationdate: this.today, lab: null, certificatenumber: `SYN-FIELD-${String(++this.certSeq).padStart(6, "0")}`, cost: null, result: "Pass", ts: this.at(this.today, this.rngs.time), performedby: this.admin(a.homeoffice!, this.today, rng) });
      });
    }
  }

  private sendToLab(assetIds: string[], office: string): void {
    const rng = this.rngs.cal;
    const ids = assetIds.filter((id) => this.ledger.canApply("SendToCalibration", [id]));
    if (ids.length === 0) return;
    const admin = this.admin(office, this.today, rng);
    const tx = this.ledger.apply({ type: "SendToCalibration", ts: this.at(this.today, this.rngs.time), performedby: admin, tolocation: this.cfg.offices.calLab, notes: `Despatched to ${this.cfg.offices.calLab}.`, lines: ids.map((assetId) => ({ assetId })) });
    for (const id of ids) {
      const back = workingDayOnOrAfter(rng, addDays(localDateOf(tx.ts), Math.round(rng.lognormal(24, 0.35, 10, 60))));
      this.heap.push(this.at(back, this.rngs.time), () => this.labReturn(id, office));
    }
  }

  private labCost(assetId: string, rng: Rng): string {
    const type = this.ledger.assets.get(assetId)!.equipmentmodel.equipmenttype;
    const base = type === "DataLogger" ? 420 : type === "Geophone" ? 260 : type === "SoundLevelMeter" || type === "Microphone" ? 340 : type.includes("TotalStation") ? 650 : 220;
    return (Math.round(base * (0.85 + rng.next() * 0.3) / 5) * 5).toFixed(2);
  }

  private labReturn(assetId: string, office: string): void {
    const rng = this.rngs.cal;
    const a = this.ledger.assets.get(assetId)!;
    if (a.status !== "InCalibration") return;
    const admin = this.admin(office, this.today, rng);
    const ts = this.at(this.today, this.rngs.time);
    const r = rng.next();
    if (r < 0.012) {
      // lab reports the unit beyond adjustment (InCalibration -> ReportFault)
      this.ledger.apply({ type: "ReportFault", ts, performedby: admin, notes: "Lab reports unit beyond adjustment.", lines: [{ assetId }] });
      const day = workingDayOnOrAfter(rng, addDays(this.today, rng.int(7, 28)));
      this.heap.push(this.at(day, this.rngs.time), () => {
        if (this.ledger.status(assetId) !== "NeedsRepair") return;
        const t2 = this.at(this.today, this.rngs.time);
        if (rng.chance(0.6)) {
          this.ledger.apply({ type: "Retire", ts: t2, performedby: this.admin(office, this.today, rng), notes: "Condemned by the lab.", lines: [{ assetId, retirementReason: "Damaged" }] });
          this.onRetired(assetId);
        } else {
          this.ledger.apply({ type: "RepairComplete", ts: t2, performedby: this.admin(office, this.today, rng), notes: "Repaired at the lab.", lines: [{ assetId }] });
          this.ledger.apply({ type: "Transfer", ts: plusSeconds(t2, 120), performedby: this.admin(office, this.today, rng), tolocation: a.homeoffice!, notes: "Returned from lab after repair.", lines: [{ assetId }] });
        }
      });
      return;
    }
    if (r < 0.02) {
      this.ledger.apply({ type: "Retire", ts, performedby: admin, notes: "Retired at the lab — not economic to recalibrate.", lines: [{ assetId, retirementReason: rng.chance(0.6) ? "Obsolete" : "Damaged" }] });
      this.onRetired(assetId);
      return;
    }
    const result: "Pass" | "Adjusted" | "Fail" = r < 0.05 ? "Fail" : r < 0.16 ? "Adjusted" : "Pass";
    this.recordLabCalibration(assetId, result, admin, ts);
    if (result === "Fail") {
      const day = workingDayOnOrAfter(rng, addDays(this.today, 1));
      this.heap.push(this.at(day, this.rngs.time), () => {
        if (this.ledger.status(assetId) !== "Available") return;
        this.ledger.apply({ type: "ReportFault", ts: this.at(this.today, this.rngs.time), performedby: this.admin(office, this.today, rng), notes: "Failed calibration — out of tolerance.", lines: [{ assetId }] });
        this.scheduleRepairOutcome(assetId, addDays(this.today, rng.int(7, 30)), "repair-only");
      });
    }
  }

  private recordLabCalibration(assetId: string, result: "Pass" | "Adjusted" | "Fail", admin: string, ts: UtcIso): void {
    const rng = this.rngs.cal;
    const a = this.ledger.assets.get(assetId)!;
    const date = localDateOf(ts);
    const cert = `SYN-MC-${date.slice(2, 4)}-${String(++this.certSeq).padStart(6, "0")}`;
    // FR-016 (feature 004): a Fail does not advance the next-due date — record it with the
    // previous due date, exactly as an admin would type it.
    this.ledger.recordCalibration({ assetId, calibrationdate: date, nextduedate: result === "Fail" ? a.nextcaldue ?? date : null, lab: this.cfg.offices.calLab, certificatenumber: cert, cost: this.labCost(assetId, rng), result, ts, performedby: admin });
    // permanent components calibrated separately (Q5): their records follow the parent's return
    let t = ts;
    for (const childId of this.ledger.componentChildrenOf(assetId)) {
      const child = this.ledger.assets.get(childId)!;
      if (!this.modelOf.get(modelKey(child.equipmentmodel))?.defaultcalintervalmonths) continue;
      t = plusSeconds(t, 60);
      this.ledger.recordCalibration({ assetId: childId, calibrationdate: date, lab: this.cfg.offices.calLab, certificatenumber: `SYN-MC-${date.slice(2, 4)}-${String(++this.certSeq).padStart(6, "0")}`, cost: this.labCost(childId, rng), result: "Pass", ts: t, performedby: admin });
    }
  }

  // ================================================================ faults, losses, retirements

  private scheduleRepairOutcome(assetId: string, day: DateStr, mode: "normal" | "repair-only" = "normal"): void {
    const rng = this.rngs.hazard;
    const d = workingDayOnOrAfter(rng, addDays(day, Math.round(rng.lognormal(21, 0.6, 2, 90))));
    this.heap.push(this.at(d, this.rngs.time), () => {
      const a = this.ledger.assets.get(assetId)!;
      if (a.status !== "NeedsRepair" || this.frozen.has(assetId)) return;
      const office = a.currentlocation ?? a.homeoffice ?? "Ottawa";
      const admin = this.admin(a.homeoffice ?? office, this.today, rng);
      const ts = this.at(this.today, this.rngs.time);
      const ageYears = daysBetween(localDateOf(this.ledger.acquiredOn.get(assetId)!), this.today) / 365.25;
      const r = rng.next();
      if (mode === "normal" && r < 0.1 && ageYears > 3) {
        this.ledger.apply({ type: "Retire", ts, performedby: admin, notes: "Beyond economic repair.", lines: [{ assetId, retirementReason: "Damaged" }] });
        this.onRetired(assetId);
      } else if (mode === "normal" && r < 0.3 && this.modelOf.get(modelKey(a.equipmentmodel))?.defaultcalintervalmonths) {
        this.sendToLab([assetId], a.homeoffice ?? office);
      } else {
        this.ledger.apply({ type: "RepairComplete", ts, performedby: admin, notes: "Repaired in the office.", lines: [{ assetId }] });
      }
    });
  }

  private scheduleMissingOutcome(assetId: string, day: DateStr): void {
    const rng = this.rngs.hazard;
    if (rng.chance(0.7)) {
      const d = workingDayOnOrAfter(rng, addDays(day, rng.int(14, 112)));
      this.heap.push(this.at(d, this.rngs.time), () => {
        const a = this.ledger.assets.get(assetId)!;
        if (a.status !== "Missing" || this.frozen.has(assetId)) return;
        const admin = this.admin(a.homeoffice!, this.today, rng);
        const ts = this.at(this.today, this.rngs.time);
        this.ledger.apply({ type: "Found", ts, performedby: admin, notes: "Located and recovered.", lines: [{ assetId }] });
        if (a.currentlocation !== a.homeoffice) {
          this.ledger.apply({ type: "Transfer", ts: plusSeconds(ts, 120), performedby: admin, tolocation: a.homeoffice!, notes: "Brought back to the office after being found.", lines: [{ assetId }] });
        }
      });
    } else {
      const d = workingDayOnOrAfter(rng, addDays(day, rng.int(120, 365)));
      this.heap.push(this.at(d, this.rngs.time), () => {
        const a = this.ledger.assets.get(assetId)!;
        if (a.status !== "Missing" || this.frozen.has(assetId)) return;
        this.ledger.apply({ type: "Retire", ts: this.at(this.today, this.rngs.time), performedby: this.admin(a.homeoffice!, this.today, rng), notes: "Written off as lost.", lines: [{ assetId, retirementReason: "Lost" }] });
        this.onRetired(assetId);
      });
    }
  }

  private dailyHazards(day: DateStr): void {
    const rng = this.rngs.hazard;
    const perDay = 1 / 365;
    for (const a of this.ledger.assets.values()) {
      if (a.lifecycle === "Retired" || this.frozen.has(a.assetid) || this.ledger.isComponentChild(a.assetid)) continue;
      const w = this.windowOf.get(a.assetid);
      if (!w || w.class === "static") continue;
      if (a.status === "Available") {
        if (rng.chance(0.05 * perDay)) {
          const office = a.currentlocation ?? a.homeoffice!;
          this.heap.push(this.at(day, this.rngs.time), () => {
            if (this.ledger.status(a.assetid) !== "Available") return;
            this.ledger.apply({ type: "ReportFault", ts: this.at(this.today, this.rngs.time), performedby: this.admin(office, this.today, rng), notes: "Found faulty during pre-job check.", lines: [{ assetId: a.assetid }] });
            this.scheduleRepairOutcome(a.assetid, this.today);
          });
        } else if (rng.chance(0.005 * perDay)) {
          this.heap.push(this.at(day, this.rngs.time), () => {
            if (this.ledger.status(a.assetid) !== "Available") return;
            this.ledger.apply({ type: "MarkMissing", ts: this.at(this.today, this.rngs.time), performedby: this.admin(a.homeoffice!, this.today, rng), notes: "Not found in the store room.", lines: [{ assetId: a.assetid }] });
            this.scheduleMissingOutcome(a.assetid, this.today);
          });
        } else if (rng.chance(0.03 * perDay) && a.currentlocation === a.homeoffice) {
          // stock transfer to another office (Available -> Transfer)
          const others = this.activeOffices(day).filter((o) => o.name !== a.homeoffice);
          if (others.length === 0) continue;
          const to = rng.pick(others).name;
          this.heap.push(this.at(day, this.rngs.time), () => {
            if (this.ledger.status(a.assetid) !== "Available") return;
            this.ledger.apply({ type: "Transfer", ts: this.at(this.today, this.rngs.time), performedby: this.admin(a.homeoffice!, this.today, rng), tolocation: to, notes: `Stock moved to ${to} to cover demand.`, lines: [{ assetId: a.assetid }] });
            const backDay = workingDayOnOrAfter(rng, addDays(this.today, rng.int(30, 240)));
            this.heap.push(this.at(backDay, this.rngs.time), () => {
              const x = this.ledger.assets.get(a.assetid)!;
              if (x.status !== "Available" || x.currentlocation !== to || this.frozen.has(a.assetid)) return;
              this.ledger.apply({ type: "Transfer", ts: this.at(this.today, this.rngs.time), performedby: this.admin(x.homeoffice!, this.today, rng), tolocation: x.homeoffice!, notes: `Stock returned to ${x.homeoffice}.`, lines: [{ assetId: a.assetid }] });
            });
          });
        }
      } else if (a.status === "CheckedOut") {
        if (rng.chance(0.02 * perDay)) {
          this.heap.push(this.at(day, this.rngs.time), () => {
            if (this.ledger.status(a.assetid) !== "CheckedOut") return;
            this.ledger.apply({ type: "MarkMissing", ts: this.at(this.today, this.rngs.time), performedby: a.custodian ?? this.admin(a.homeoffice!, this.today, rng), notes: "Reported lost by the custodian.", lines: [{ assetId: a.assetid }] });
            this.scheduleMissingOutcome(a.assetid, this.today);
          });
        } else if (rng.chance(0.02 * perDay)) {
          // reported faulty while in the field (CheckedOut -> ReportFault)
          this.heap.push(this.at(day, this.rngs.time), () => {
            if (this.ledger.status(a.assetid) !== "CheckedOut") return;
            this.ledger.apply({ type: "ReportFault", ts: this.at(this.today, this.rngs.time), performedby: a.custodian ?? this.admin(a.homeoffice!, this.today, rng), notes: "Reported faulty in the field.", lines: [{ assetId: a.assetid }] });
            this.scheduleRepairOutcome(a.assetid, this.today, "repair-only");
          });
        }
      }
    }
  }

  private monthlyRetirements(day: DateStr): void {
    const rng = this.rngs.retire;
    for (const a of this.ledger.assets.values()) {
      if (a.lifecycle === "Retired" || this.frozen.has(a.assetid) || this.ledger.isComponentChild(a.assetid)) continue;
      const w = this.windowOf.get(a.assetid);
      if (!w) continue;
      const acquired = this.ledger.acquiredOn.get(a.assetid)!;
      const age = daysBetween(localDateOf(acquired), day) / 365.25;
      const h = this.hazardPerYear(w.hazard, age) / 12;
      if (!rng.chance(h)) continue;
      if (a.status !== "Available" && !(a.status === "NeedsRepair" && rng.chance(0.5))) continue;
      const reasons = w.hazard === "legacy" ? RETIRE_LEGACY : w.hazard === "consumable" ? RETIRE_CONSUMABLE : RETIRE_CURRENT;
      const reason = a.status === "NeedsRepair" ? "Damaged" : rng.weighted(reasons);
      const d = workingDayOnOrAfter(rng, addDays(day, rng.int(0, 20)));
      this.heap.push(this.at(d, this.rngs.time), () => {
        const x = this.ledger.assets.get(a.assetid)!;
        if (x.lifecycle === "Retired" || !this.ledger.canApply("Retire", [a.assetid])) return;
        this.ledger.apply({ type: "Retire", ts: this.at(this.today, this.rngs.time), performedby: this.admin(x.homeoffice!, this.today, rng), notes: reason === "Sold" ? "Sold to a third party." : reason === "Obsolete" ? "Superseded — removed from service." : "Damaged beyond repair.", lines: [{ assetId: a.assetid, retirementReason: reason }] });
        this.onRetired(a.assetid);
      });
    }
  }

  private onRetired(assetId: string): void {
    const kit = this.kits.get(assetId);
    if (kit) {
      // the logger is gone: its members become spares for the office's other kits
      for (const m of kit.members) {
        this.kitByMember.delete(m.assetId);
        const w = this.windowOf.get(m.assetId)!;
        if (this.ledger.status(m.assetId) !== "Retired") this.placeMember(m.assetId, kit.office, w, this.today);
      }
      kit.members = [];
      kit.busy = true; // never starts another job
    }
    const memberKit = this.kitByMember.get(assetId);
    if (memberKit) {
      memberKit.members = memberKit.members.filter((m) => m.assetId !== assetId);
      this.kitByMember.delete(assetId);
    }
    this.standalone.delete(assetId);
  }

  // ================================================================ audits (annual stocktake)

  private scheduleAudit(office: string, day: DateStr): void {
    const rng = this.rngs.audit;
    this.heap.push(this.at(day, this.rngs.time, { hourBias: "morning" }), () => {
      const lines: string[] = [];
      const yearAgo = addDays(this.today, -365);
      for (const a of this.ledger.assets.values()) {
        if (this.ledger.isComponentChild(a.assetid)) continue;
        if (a.lifecycle === "Retired") {
          const last = this.ledger.lastTs.get(a.assetid) ?? "";
          if (a.homeoffice === office && last.slice(0, 10) >= yearAgo && rng.chance(0.3)) lines.push(a.assetid);
          continue;
        }
        if ((a.status === "Available" || a.status === "NeedsRepair") && a.currentlocation === office) lines.push(a.assetid);
        else if (a.homeoffice === office && (a.status === "CheckedOut" || a.status === "Deployed") && rng.chance(0.05)) lines.push(a.assetid);
        else if (a.homeoffice === office && (a.status === "InCalibration" || a.status === "Missing") && rng.chance(0.5)) lines.push(a.assetid);
      }
      if (lines.length === 0) return;
      this.ledger.apply({ type: "Audit", ts: this.at(this.today, this.rngs.time, { hourBias: "morning" }), performedby: this.admin(office, this.today, rng), notes: `Annual stocktake — ${office} ${yearOf(this.today)}.`, lines: lines.map((assetId) => ({ assetId })) });
    });
  }

  // ================================================================ roster movements (FR-038)

  private rosterMovements(day: DateStr): void {
    for (const p of this.cfg.roster) {
      if (p.end === null || addDays(p.end, -10) !== day) continue;
      const held = [...this.ledger.assets.values()].filter((a) => a.custodian === p.upn && a.status === "CheckedOut" && !this.frozen.has(a.assetid) && !this.ledger.isComponentChild(a.assetid));
      if (held.length === 0) continue;
      if (this.leaverException === p.upn) continue;
      for (const kit of this.kits.values()) if (kit.heldBy === p.upn) kit.heldBy = null;
      this.heap.push(this.at(day, this.rngs.time, { hourBias: "afternoon" }), () => this.returnToOffice(held.map((a) => a.assetid), p.upn, p.office, false));
    }
  }

  // ================================================================ planted scenarios (FR-050)

  private recordPlanted(key: string, description: string, identifiers: Record<string, string | string[]>, once = false): void {
    if (once && this.planted.some((p) => p.key === key)) return;
    this.planted.push({ key, description, identifiers });
  }

  private daysBefore(n: number): DateStr {
    return addDays(this.params.asOf, -n);
  }

  private pickAvailable(pred: (id: string) => boolean, rng: Rng): string | null {
    const candidates = [...this.ledger.assets.values()]
      .filter((a) => a.lifecycle === "Active" && a.status === "Available" && !this.frozen.has(a.assetid) && !this.ledger.isComponentChild(a.assetid) && pred(a.assetid))
      .map((a) => a.assetid)
      .sort();
    return candidates.length > 0 ? rng.pick(candidates) : null;
  }

  private forceJob(kit: Kit, forced: string, opts: JobOptions): Job | null {
    if (kit.busy) return null;
    const job = this.planJob(kit, this.today, this.rngs.planted, forced, opts);
    if (!job) return null;
    this.launchJob(job, this.today);
    return job;
  }

  private idleKit(pred: (k: Kit) => boolean = () => true): Kit | null {
    const list = [...this.kits.values()]
      .filter((k) => !k.busy && this.ledger.status(k.loggerId) === "Available" && !this.frozen.has(k.loggerId) && this.officeActive(this.officeCfg(k.office), this.today) && pred(k))
      .sort((a, b) => (a.loggerId < b.loggerId ? -1 : 1));
    return list.length > 0 ? this.rngs.planted.pick(list) : null;
  }

  private plantedTriggers(day: DateStr): void {
    const rng = this.rngs.planted;
    if (this.params.historyYears < 2) return;

    if (day === this.daysBefore(400)) {
      // P1: one chronically un-calibrated asset per active office; P12: a leaver who keeps two items
      const ids: string[] = [];
      for (const o of this.activeOffices(day)) {
        const id = this.pickAvailable((x) => {
          const a = this.ledger.assets.get(x)!;
          return a.homeoffice === o.name && a.currentlocation === o.name && this.modelOf.get(modelKey(a.equipmentmodel))?.defaultcalintervalmonths === 12 && !this.kitByMember.has(x) && !this.kits.has(x);
        }, rng) ?? this.pickAvailable((x) => {
          const a = this.ledger.assets.get(x)!;
          return a.homeoffice === o.name && this.modelOf.get(modelKey(a.equipmentmodel))?.defaultcalintervalmonths === 12;
        }, rng);
        if (id) {
          this.neglectCal.set(id, 0);
          ids.push(id);
        }
      }
      this.recordPlanted("overdue-calibration-per-office", "An overdue calibration at every active office (feature 004 US1)", { assetIds: ids });
      const leaver = this.cfg.roster.filter((p) => p.role === "FieldUser" && p.end !== null && p.end > this.daysBefore(380) && p.end < this.daysBefore(120)).sort((a, b) => (a.upn < b.upn ? -1 : 1))[0];
      if (leaver) {
        this.leaverException = leaver.upn;
        const cands = [...this.standalone.values()].filter((s) => s.office === leaver.office && this.ledger.status(s.assetId) === "Available").slice(0, 2);
        if (cands.length > 0) {
          const project = this.pickProject(leaver.office, day, rng, false);
          this.heap.push(this.at(day, this.rngs.time), () => {
            const ids2 = cands.map((c) => c.assetId).filter((id) => this.ledger.canApply("Checkout", [id]));
            if (ids2.length === 0) return;
            this.ledger.apply({ type: "Checkout", ts: this.at(this.today, this.rngs.time), performedby: leaver.upn, touser: leaver.upn, toproject: project.number, expectedreturn: addDays(this.today, 14), lines: ids2.map((assetId) => ({ assetId })) });
            for (const id of ids2) this.frozen.add(id);
            this.recordPlanted("leaver-holding-assets", "A person who left the company while still holding equipment (feature 006 edge case)", { upn: leaver.upn, leftOn: leaver.end!, assetIds: ids2 });
          });
        }
      }
    }

    if (day === this.daysBefore(300)) {
      // P8: a failed calibration followed by repair and re-calibration
      const id = this.pickAvailable((x) => {
        const a = this.ledger.assets.get(x)!;
        return !!this.modelOf.get(modelKey(a.equipmentmodel))?.defaultcalintervalmonths && !this.kits.has(x) && !this.kitByMember.has(x) && a.currentlocation === a.homeoffice;
      }, rng);
      if (id) {
        this.frozen.add(id);
        const a = this.ledger.assets.get(id)!;
        const office = a.homeoffice!;
        const t0 = this.at(day, this.rngs.time);
        const send = this.ledger.apply({ type: "SendToCalibration", ts: t0, performedby: this.admin(office, day, rng), tolocation: this.cfg.offices.calLab, notes: "Routine calibration.", lines: [{ assetId: id }] });
        const d1 = workingDayOnOrAfter(rng, addDays(localDateOf(send.ts), 21));
        this.heap.push(this.at(d1, this.rngs.time), () => {
          const admin = this.admin(office, this.today, rng);
          this.recordLabCalibration(id, "Fail", admin, this.at(this.today, this.rngs.time));
          const d2 = workingDayOnOrAfter(rng, addDays(this.today, 1));
          this.heap.push(this.at(d2, this.rngs.time), () => {
            this.ledger.apply({ type: "ReportFault", ts: this.at(this.today, this.rngs.time), performedby: admin, notes: "Failed calibration — out of tolerance.", lines: [{ assetId: id }] });
            const d3 = workingDayOnOrAfter(rng, addDays(this.today, 20));
            this.heap.push(this.at(d3, this.rngs.time), () => {
              this.ledger.apply({ type: "RepairComplete", ts: this.at(this.today, this.rngs.time), performedby: admin, notes: "Sensor element replaced.", lines: [{ assetId: id }] });
              const d4 = workingDayOnOrAfter(rng, addDays(this.today, 7));
              this.heap.push(this.at(d4, this.rngs.time), () => {
                const s2 = this.ledger.apply({ type: "SendToCalibration", ts: this.at(this.today, this.rngs.time), performedby: admin, tolocation: this.cfg.offices.calLab, notes: "Re-calibration after repair.", lines: [{ assetId: id }] });
                const d5 = workingDayOnOrAfter(rng, addDays(localDateOf(s2.ts), 18));
                this.heap.push(this.at(d5, this.rngs.time), () => {
                  this.recordLabCalibration(id, "Pass", admin, this.at(this.today, this.rngs.time));
                  this.frozen.delete(id);
                  this.recordPlanted("failed-calibration-then-repair", "A Failed calibration (next-due not advanced, feature 004 FR-016) followed by repair and a passing re-calibration", { assetId: id });
                });
              });
            });
          });
        });
      }
    }

    if (day === this.daysBefore(200)) {
      // P3: a checkout whose expected return is long past
      const rec = [...this.standalone.values()].filter((s) => this.ledger.status(s.assetId) === "Available" && this.ledger.assets.get(s.assetId)!.currentlocation === s.office && !this.frozen.has(s.assetId)).sort((a, b) => (a.assetId < b.assetId ? -1 : 1))[0];
      if (rec) {
        const tech = this.pickTech(rec.office, day, rng);
        if (tech) {
          const project = this.pickProject(rec.office, day, rng, false);
          this.ledger.apply({ type: "Checkout", ts: this.at(day, this.rngs.time), performedby: tech, touser: tech, toproject: project.number, expectedreturn: addDays(day, 30), notes: "Short survey job.", lines: [{ assetId: rec.assetId }] });
          this.frozen.add(rec.assetId);
          this.recordPlanted("expected-return-overdue", "A checkout whose expected return is more than 90 days past (flow F4's case)", { assetId: rec.assetId, custodian: tech, expectedReturn: addDays(day, 30) });
        }
      }
      // P2: a station whose member falls overdue for calibration while deployed
      const kit = this.idleKit((k) => k.members.some((m) => m.role === "Sensor"));
      if (kit) {
        for (const m of kit.members) this.neglectCal.set(m.assetId, 0);
        this.neglectCal.set(kit.loggerId, 0);
        const job = this.forceJob(kit, "deployed-overdue", { durationDays: 400 });
        if (job) this.recordPlanted("deployed-and-overdue", "A deployed asset that is overdue for calibration (feature 004 FR-030)", { loggerId: kit.loggerId, site: job.site.name });
      }
    }

    if (day === this.daysBefore(120)) {
      // P5: a station with a component swapped mid-life, still on site
      const kit = this.idleKit((k) => k.members.some((m) => m.role === "Sensor"));
      if (kit) {
        const job = this.forceJob(kit, "swap", { durationDays: 400 });
        if (job) {
          const swapDay = workingDayOnOrAfter(rng, this.daysBefore(60));
          this.heap.push(this.at(swapDay, this.rngs.time), () => {
            const sensor = this.openParticipants(job).find((id) => id !== kit.loggerId && this.ledger.status(id) === "Deployed");
            if (sensor) this.swapComponent(job, sensor);
          });
        }
      }
    }

    if (day === this.daysBefore(100)) {
      // P7: an asset retired after at least fifteen years
      const cutoff = addMonths(day, -15 * 12);
      const id = this.pickAvailable((x) => localDateOf(this.ledger.acquiredOn.get(x)!) <= cutoff && !this.kits.has(x) && !this.kitByMember.has(x), rng)
        ?? this.pickAvailable((x) => localDateOf(this.ledger.acquiredOn.get(x)!) <= cutoff, rng);
      if (id) {
        this.ledger.apply({ type: "Retire", ts: this.at(day, this.rngs.time), performedby: this.admin(this.ledger.assets.get(id)!.homeoffice!, day, rng), notes: "Superseded — removed from service after long use.", lines: [{ assetId: id, retirementReason: "Obsolete" }] });
        this.onRetired(id);
        this.frozen.add(id);
        this.recordPlanted("retired-after-15-years", "An asset retired after at least fifteen years, with its full history (feature 006 FR-022/FR-029)", { assetId: id, acquired: localDateOf(this.ledger.acquiredOn.get(id)!) });
      }
    }

    if (day === this.daysBefore(90)) {
      // P4: a partially recovered installation
      const kit = this.idleKit((k) => k.members.filter((m) => m.role === "Sensor").length >= 1);
      if (kit) {
        const job = this.forceJob(kit, "partial-recovery", { durationDays: 90 });
        if (job) this.recordPlanted("partial-recovery", "An installation partially recovered — sensors back, logger still on site (feature 005 FR-015)", { loggerId: kit.loggerId, site: job.site.name });
      }
      // P6: an asset missing at as-of
      const id = this.pickAvailable((x) => this.standalone.has(x), rng);
      if (id) {
        this.ledger.apply({ type: "MarkMissing", ts: this.at(day, this.rngs.time), performedby: this.admin(this.ledger.assets.get(id)!.homeoffice!, day, rng), notes: "Not found in the store room after inventory count.", lines: [{ assetId: id }] });
        this.frozen.add(id);
        this.recordPlanted("missing", "An asset currently Missing (feature 003 US6)", { assetId: id });
      }
      // P13: a project closed while its station is still deployed
      const openJobProject = this.projects.filter((p) => !p.closed && p.openStations > 0 && p.number !== this.closedProjectException && !this.planted.some((x) => x.identifiers["project"] === p.number)).sort((a, b) => (a.number < b.number ? -1 : 1));
      const victim = openJobProject.find((p) => this.ledger.installations.some((i) => i.project === p.number && i.end === null && i.start < this.daysBefore(120)));
      if (victim) {
        this.closedProjectException = victim.number;
        victim.closed = true;
        victim.end = day;
        this.ledger.projects.find((x) => x.projectnumber === victim.number)!.status = "Closed";
        const inst = this.ledger.installations.find((i) => i.project === victim.number && i.end === null)!;
        for (const r of this.ledger.openComponentRows(inst.id)) this.frozen.add(r.asset);
        const k = this.kits.get(inst.primaryasset);
        if (k) k.busy = true;
        this.recordPlanted("closed-project-with-station", "A project closed while a station remained deployed on it (feature 006 edge case)", { project: victim.number, installationId: inst.id, site: inst.site });
      }
    }

    if (day === this.daysBefore(60)) {
      // P14: a site reused by a second project — guaranteed by deploying a new project's station to an existing site
      const site = [...this.sites.values()].filter((s) => s.projects.size === 1 && this.officeActive(this.officeCfg(this.projects.find((p) => s.projects.has(p.number))!.office), day)).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
      if (site) {
        const office = this.projects.find((p) => site.projects.has(p.number))!.office;
        const kit = this.idleKit((k) => k.office === office);
        if (kit) {
          const project = this.createProject(office, day, rng, true, { site, durationDays: 180 });
          const job = this.forceJob(kit, "site-reuse", { project, durationDays: 20 });
          if (job) {
            job.site = site;
            this.recordPlanted("site-on-two-projects", "A site with installations on two different projects (feature 005 FR-019)", { site: site.name, projects: [...site.projects] });
          }
        }
      }
    }

    if (day === this.daysBefore(60) || day === this.daysBefore(10)) {
      // P1 top-up: any office still without an overdue calibration gets one whose due date has
      // already arrived (or arrives before as-of) and which will not be sent from now on.
      const planted = this.planted.find((p) => p.key === "overdue-calibration-per-office");
      const ids = planted ? [...(planted.identifiers["assetIds"] as string[])] : [];
      for (const o of this.activeOffices(day)) {
        const hasOverdue = [...this.ledger.assets.values()].some((a) => a.lifecycle === "Active" && a.homeoffice === o.name && a.status !== "InCalibration" && !!a.nextcaldue && a.nextcaldue < this.params.asOf && (this.neglectCal.get(a.assetid) === 0 || a.nextcaldue < day));
        if (hasOverdue) continue;
        const id = this.pickAvailable((x) => {
          const a = this.ledger.assets.get(x)!;
          return a.homeoffice === o.name && !!a.nextcaldue && a.nextcaldue <= this.params.asOf;
        }, rng);
        if (id) {
          this.neglectCal.set(id, 0);
          ids.push(id);
        }
      }
      if (planted) planted.identifiers["assetIds"] = ids;
    }

    if (day === this.daysBefore(30)) {
      // P11: an asset holding at an office that is not its home
      const rec = [...this.standalone.values()].filter((s) => this.ledger.status(s.assetId) === "Available" && this.ledger.assets.get(s.assetId)!.currentlocation === s.office && !this.frozen.has(s.assetId)).sort((a, b) => (a.assetId < b.assetId ? -1 : 1))[1];
      const others = this.activeOffices(day).filter((o) => rec && o.name !== rec.office);
      if (rec && others.length > 0) {
        const to = others[0].name;
        this.ledger.apply({ type: "Transfer", ts: this.at(day, this.rngs.time), performedby: this.admin(rec.office, day, rng), tolocation: to, notes: `Stock moved to ${to} to cover demand.`, lines: [{ assetId: rec.assetId }] });
        this.frozen.add(rec.assetId);
        this.recordPlanted("at-foreign-office", "An asset currently at an office other than its home office (feature 006 edge case)", { assetId: rec.assetId, homeOffice: rec.office, currentLocation: to });
      }
    }

    if (day === this.daysBefore(20)) {
      // P15: a shared-serial logger deployed while its own geophone stays at the office
      const kit = this.idleKit((k) => k.family === "micromate" && k.members.some((m) => m.role === "Sensor" && this.ledger.assets.get(m.assetId)!.serialnumber === this.ledger.assets.get(k.loggerId)!.serialnumber && this.ledger.status(m.assetId) === "Available"));
      if (kit) {
        const own = kit.members.find((m) => m.role === "Sensor")!.assetId;
        this.frozen.add(own);
        const job = this.forceJob(kit, "shared-serial-apart", { durationDays: 60, substituteSensor: true });
        if (job) this.recordPlanted("shared-serial-pair-apart", "A logger and its same-serial geophone currently at different locations (Principle III)", { loggerId: kit.loggerId, geophoneId: own, site: job.site.name });
      }
    }
  }

  private finalisePlanted(): void {
    this.recordPlanted("office-without-admin", "An office with no administrator assigned (feature 004 FR-027a)", { office: this.cfg.offices.noAdminOffice });
  }

  // ================================================================ exposure for outputs

  officeAdminAssignments(): Array<{ office: string; adminUpns: string[] }> {
    return this.cfg.offices.offices.map((o) => ({
      office: o.name,
      adminUpns: o.name === this.cfg.offices.noAdminOffice ? [] : this.cfg.roster.filter((p) => p.role === "OfficeAdmin" && p.office === o.name && this.isActive(p, this.params.asOf)).map((p) => p.upn),
    }));
  }

  statusOf(id: string): AssetStatus {
    return this.ledger.status(id);
  }

  monthKey(day: DateStr): string {
    return `${yearOf(day)}-${String(monthOf(day)).padStart(2, "0")}`;
  }
}
