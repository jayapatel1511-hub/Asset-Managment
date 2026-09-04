#!/usr/bin/env node
/**
 * Generates the DC-22 state machine from specs/010…/contracts/transition-table.md.
 *
 * The markdown §3 tables are the reviewed contract. This script transcribes them into the §8
 * machine form, asserts every rule id still appears in the markdown, writes:
 *
 *   data/reference/state_machine.json     — axis machine (authority) + pill projection
 *   packages/contracts/src/stateMachine.ts
 *
 * Allow/deny is the 27 axis rules. The seven-value `compatibility.transitions` matrix is a
 * generated projection for screens that still grey buttons by pill — not the authority.
 *
 * Wired as predev/prebuild/pretest. Never hand-edit the two outputs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SOURCE_MD = path.join(ROOT, "specs/010-web-application-platform/contracts/transition-table.md");
const JSON_OUT = path.join(ROOT, "data/reference/state_machine.json");
const TS_OUT = path.join(ROOT, "packages/contracts/src/stateMachine.ts");

const LIFECYCLES = ["Active", "Retired"];
const DISPOSITIONS = ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab", "Missing"];
const SERVICEABILITIES = ["Serviceable", "NeedsRepair", "OutOfService"];
const STATUSES = ["Available", "CheckedOut", "Deployed", "InCalibration", "NeedsRepair", "Missing", "Retired"];
const PILL_TYPES = [
  "AddToInventory",
  "Audit",
  "Checkout",
  "Deploy",
  "Found",
  "MarkMissing",
  "RepairComplete",
  "ReportFault",
  "Retire",
  "Return",
  "ReturnFromCalibration",
  "SendToCalibration",
  "Transfer",
  "Undeploy",
];

/** §7.1 / DC-21. InTransit has no compatibility pill; it collapses to Available. */
function statusFromAxes(axes) {
  if (axes.lifecycle === "Retired") return "Retired";
  if (axes.disposition === "Missing") return "Missing";
  if (axes.disposition === "AtCalibrationLab") return "InCalibration";
  if (axes.serviceability === "NeedsRepair" || axes.serviceability === "OutOfService") return "NeedsRepair";
  if (axes.disposition === "Deployed") return "Deployed";
  if (axes.disposition === "CheckedOut") return "CheckedOut";
  return "Available";
}

function axesFromStatus(status) {
  if (status === "Retired") return { lifecycle: "Retired", disposition: "AtOffice", serviceability: "OutOfService" };
  switch (status) {
    case "Available":
      return { lifecycle: "Active", disposition: "AtOffice", serviceability: "Serviceable" };
    case "CheckedOut":
      return { lifecycle: "Active", disposition: "CheckedOut", serviceability: "Serviceable" };
    case "Deployed":
      return { lifecycle: "Active", disposition: "Deployed", serviceability: "Serviceable" };
    case "InCalibration":
      return { lifecycle: "Active", disposition: "AtCalibrationLab", serviceability: "Serviceable" };
    case "NeedsRepair":
      return { lifecycle: "Active", disposition: "AtOffice", serviceability: "NeedsRepair" };
    case "Missing":
      return { lifecycle: "Active", disposition: "Missing", serviceability: "Serviceable" };
    default:
      return { lifecycle: "Active", disposition: "AtOffice", serviceability: "Serviceable" };
  }
}

const ALL = {
  lifecycle: null,
  disposition: null,
  serviceability: null,
};

function rule(partial) {
  const requires = { ...ALL, ...partial.requires };
  const sets = partial.sets ?? {};
  const axes = ["lifecycle", "disposition", "serviceability"];
  const untouched = partial.untouched ?? axes.filter((a) => sets[a] === undefined);
  return { requires, sets, untouched, refusal: {}, ...partial, requires, sets, untouched };
}

/**
 * 27 variants transcribed from transition-table.md §3. Guards are the parts of a Requires cell
 * that are not an axis value list (destination kind, calibration result, creation).
 */
const RULES = [
  rule({
    id: "R-01",
    type: "AddToInventory",
    creation: true,
    requires: {},
    sets: { lifecycle: "Active", disposition: "AtOffice", serviceability: "Serviceable" },
    untouched: [],
    refusal: {},
  }),
  rule({
    id: "R-02",
    type: "Checkout",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice"], serviceability: ["Serviceable"] },
    sets: { disposition: "CheckedOut" },
    refusal: { disposition: "conflict.error.assetNotEligible", serviceability: "transition.error.serviceability" },
  }),
  rule({
    id: "R-03",
    type: "Return",
    requires: { lifecycle: ["Active"], disposition: ["CheckedOut", "Deployed"] },
    sets: { disposition: "AtOffice" },
    refusal: { disposition: "conflict.error.assetNotEligible", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-04",
    type: "Transfer",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice"] },
    sets: { disposition: "InTransit" },
    guards: { toLocationIsOffice: true, toLocationDiffers: true },
    refusal: { disposition: "conflict.error.assetNotEligible", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-05",
    type: "Transfer",
    requires: { lifecycle: ["Active"], disposition: ["InTransit"] },
    sets: { disposition: "AtOffice" },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-06",
    type: "Transfer",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "CheckedOut", "Deployed", "AtCalibrationLab"] },
    sets: {},
    guards: { notInterOfficeDispatch: true },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-07",
    type: "Deploy",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "CheckedOut"], serviceability: ["Serviceable"] },
    sets: { disposition: "Deployed" },
    refusal: { disposition: "conflict.error.assetNotEligible", serviceability: "transition.error.serviceability", project: "transition.error.projectInactive" },
  }),
  rule({
    id: "R-08",
    type: "Undeploy",
    requires: { lifecycle: ["Active"], disposition: ["Deployed"] },
    sets: { disposition: "CheckedOut" },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-09",
    type: "SendToCalibration",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "CheckedOut"] },
    sets: { disposition: "AtCalibrationLab" },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-10",
    type: "ReturnFromCalibration",
    requires: { lifecycle: ["Active"], disposition: ["AtCalibrationLab"] },
    sets: { disposition: "AtOffice" },
    guards: { calibrationPass: true },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-11",
    type: "ReturnFromCalibration",
    requires: { lifecycle: ["Active"], disposition: ["AtCalibrationLab"] },
    sets: { disposition: "AtOffice", serviceability: "NeedsRepair" },
    guards: { calibrationFail: true },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-12",
    type: "ReportFault",
    requires: {
      lifecycle: ["Active"],
      disposition: ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab"],
      serviceability: ["Serviceable"],
    },
    sets: { serviceability: "NeedsRepair" },
    refusal: { disposition: "conflict.error.assetNotEligible", serviceability: "transition.error.serviceability" },
  }),
  rule({
    id: "R-13",
    type: "RepairComplete",
    requires: { lifecycle: ["Active"], serviceability: ["NeedsRepair"] },
    sets: { serviceability: "Serviceable" },
    refusal: { serviceability: "transition.error.serviceability" },
  }),
  rule({
    id: "R-14",
    type: "MarkOutOfService",
    requires: { lifecycle: ["Active"], serviceability: ["Serviceable", "NeedsRepair"] },
    sets: { serviceability: "OutOfService" },
    roleFloor: ["OfficeAdmin", "SystemOwner"],
    refusal: { serviceability: "transition.error.serviceability", role: "auth.error.forbidden" },
  }),
  rule({
    id: "R-15",
    type: "ReturnToService",
    requires: { lifecycle: ["Active"], serviceability: ["OutOfService"] },
    sets: { serviceability: "Serviceable" },
    roleFloor: ["OfficeAdmin", "SystemOwner"],
    refusal: { serviceability: "transition.error.serviceability", role: "auth.error.forbidden" },
  }),
  rule({
    id: "R-16",
    type: "MarkMissing",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab"] },
    sets: { disposition: "Missing" },
    refusal: { disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-17a",
    type: "Found",
    requires: { lifecycle: ["Active"], disposition: ["Missing"] },
    sets: { disposition: "AtOffice" },
    guards: { foundOffice: true },
    refusal: { disposition: "conflict.error.assetNotEligible", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-17b",
    type: "Found",
    requires: { lifecycle: ["Active"], disposition: ["Missing"] },
    sets: { disposition: "CheckedOut" },
    guards: { foundCustody: true },
    refusal: { disposition: "conflict.error.assetNotEligible", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-17c",
    type: "Found",
    requires: { lifecycle: ["Active"], disposition: ["Missing"] },
    sets: { disposition: "Deployed" },
    guards: { foundInstalled: true },
    refusal: { disposition: "conflict.error.assetNotEligible", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-18",
    type: "RehomeAsset",
    requires: { lifecycle: ["Active"] },
    sets: {},
    roleFloor: ["OfficeAdmin", "SystemOwner"],
    refusal: { role: "auth.error.forbidden" },
  }),
  rule({
    id: "R-19",
    type: "Retire",
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "AtCalibrationLab", "Missing"] },
    sets: { lifecycle: "Retired" },
    freeze: ["disposition", "serviceability"],
    roleFloor: ["OfficeAdmin", "SystemOwner"],
    refusal: {
      disposition: "conflict.error.assetNotEligible",
      openObligation: "transition.error.openObligation",
      missingReason: "command.error.validation",
    },
  }),
  rule({
    id: "R-20",
    type: "AttachComponent",
    singleAsset: false,
    requires: { lifecycle: ["Active"], disposition: ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab"], serviceability: ["Serviceable"] },
    sets: {},
    refusal: { component: "transition.error.componentRule", disposition: "conflict.error.assetNotEligible" },
  }),
  rule({
    id: "R-21",
    type: "DetachComponent",
    singleAsset: false,
    requires: { lifecycle: ["Active"] },
    sets: {},
    refusal: { component: "transition.error.componentRule", destination: "transition.error.destinationRequired" },
  }),
  rule({
    id: "R-22",
    type: "SwapComponent",
    singleAsset: false,
    composedOf: ["R-21", "R-20"],
    requires: { lifecycle: ["Active"] },
    sets: {},
    refusal: { component: "transition.error.componentRule" },
  }),
  rule({
    id: "R-23",
    type: "ChangeInstallationConfiguration",
    singleAsset: false,
    requires: { lifecycle: ["Active"], disposition: ["Deployed"] },
    sets: {},
    refusal: { component: "transition.error.componentRule" },
  }),
  rule({
    id: "R-24",
    type: "Audit",
    requires: {},
    sets: {},
    refusal: {},
  }),
  rule({
    id: "R-25",
    type: "Correction",
    requires: {},
    sets: {},
    roleFloor: ["OfficeAdmin", "SystemOwner"],
    refusal: { validation: "command.error.validation", role: "auth.error.forbidden" },
  }),
];

const RETIRED_IS_TERMINAL = {
  allowedTypes: ["Audit", "Correction"],
  refusal: "transition.error.lifecycleRetired",
};

function axisOk(allowed, actual) {
  if (allowed == null) return true;
  return allowed.includes(actual);
}

function isInterOfficeDispatch(ctx) {
  if (!ctx.toLocation) return false;
  if (ctx.toLocationKind && ctx.toLocationKind !== "Office") return false;
  if (!ctx.currentLocation) return true;
  return ctx.toLocation !== ctx.currentLocation;
}

function guardsOk(rule, ctx) {
  const g = rule.guards;
  if (!g) return true;
  if (g.toLocationIsOffice && ctx.toLocationKind && ctx.toLocationKind !== "Office") return false;
  if (g.toLocationDiffers && !isInterOfficeDispatch(ctx)) return false;
  if (g.notInterOfficeDispatch && isInterOfficeDispatch(ctx) && ctx.disposition === "AtOffice") return false;
  if (g.calibrationPass && ctx.calibrationResult === "Fail") return false;
  if (g.calibrationFail && ctx.calibrationResult !== "Fail") return false;
  if (g.foundCustody && !ctx.toUser) return false;
  if (g.foundInstalled && !(ctx.toProject && ctx.toLocationKind === "Site")) return false;
  if (g.foundOffice) {
    if (ctx.toUser) return false;
    if (ctx.toProject && ctx.toLocationKind === "Site") return false;
    if (!ctx.toLocation) return false;
  }
  return true;
}

function failedAxis(rule, axes) {
  if (!axisOk(rule.requires.lifecycle, axes.lifecycle)) return "lifecycle";
  if (!axisOk(rule.requires.disposition, axes.disposition)) return "disposition";
  if (!axisOk(rule.requires.serviceability, axes.serviceability)) return "serviceability";
  return null;
}

function matchRule(type, axes, ctx) {
  if (axes.lifecycle === "Retired" && !RETIRED_IS_TERMINAL.allowedTypes.includes(type)) {
    return { ok: false, code: RETIRED_IS_TERMINAL.refusal, failedAxis: "lifecycle" };
  }
  const candidates = RULES.filter((r) => r.type === type && r.singleAsset !== false);
  if (candidates.length === 0) {
    return { ok: false, code: "transition.error.invalid", failedAxis: null };
  }
  const ctxWithDisp = { ...ctx, disposition: axes.disposition };
  let bestFail = null;
  for (const r of candidates) {
    if (r.creation && !(axes.disposition === "AtOffice" && axes.serviceability === "Serviceable" && axes.lifecycle === "Active")) {
      bestFail ??= { code: "transition.error.invalid", failedAxis: "disposition" };
      continue;
    }
    const axis = failedAxis(r, axes);
    if (axis) {
      const code = r.refusal[axis] ?? (axis === "serviceability" ? "transition.error.serviceability" : axis === "lifecycle" ? RETIRED_IS_TERMINAL.refusal : "conflict.error.assetNotEligible");
      bestFail ??= { code, failedAxis: axis };
      continue;
    }
    if (!guardsOk(r, ctxWithDisp)) {
      if (type === "Found") bestFail ??= { code: "transition.error.destinationRequired", failedAxis: "disposition" };
      else bestFail ??= { code: r.refusal.disposition ?? "transition.error.invalid", failedAxis: "disposition" };
      continue;
    }
    const next = { ...axes };
    for (const [k, v] of Object.entries(r.sets)) next[k] = v;
    return { ok: true, rule: r, axesAfter: next };
  }
  if (type === "Found" && axes.disposition === "Missing" && !ctx.toUser && !ctx.toLocation && !ctx.toProject) {
    return { ok: false, code: "transition.error.destinationRequired", failedAxis: "disposition" };
  }
  return { ok: false, ...(bestFail ?? { code: "transition.error.invalid", failedAxis: null }) };
}

function locationForPill(status) {
  if (status === "Available" || status === "NeedsRepair") return "Ottawa";
  if (status === "Deployed") return "site-1";
  if (status === "InCalibration") return "lab-1";
  return null;
}

function buildCompatibility() {
  const transitions = {};
  for (const status of STATUSES) {
    const axes = axesFromStatus(status);
    const ctx = {
      currentLocation: locationForPill(status),
      toLocation: "Toronto",
      toLocationKind: "Office",
      toUser: null,
      toProject: null,
      calibrationResult: "Pass",
    };
    const row = {};
    for (const type of PILL_TYPES) {
      const result = matchRule(type, axes, ctx);
      if (result.ok) row[type] = statusFromAxes(result.axesAfter);
    }
    transitions[status] = row;
  }
  return transitions;
}

function assertReachability(rules) {
  const reachable = { lifecycle: new Set(), disposition: new Set(), serviceability: new Set() };
  const exited = { lifecycle: new Set(), disposition: new Set(), serviceability: new Set() };
  for (const r of rules) {
    for (const [axis, value] of Object.entries(r.sets ?? {})) {
      reachable[axis].add(value);
    }
    if (r.id === "R-01") {
      reachable.lifecycle.add("Active");
      reachable.disposition.add("AtOffice");
      reachable.serviceability.add("Serviceable");
    }
    for (const axis of ["lifecycle", "disposition", "serviceability"]) {
      const req = r.requires[axis];
      if (Array.isArray(req)) for (const v of req) exited[axis].add(v);
    }
  }
  const missingReach = [];
  for (const v of LIFECYCLES) if (!reachable.lifecycle.has(v)) missingReach.push(`lifecycle:${v}`);
  for (const v of DISPOSITIONS) if (!reachable.disposition.has(v)) missingReach.push(`disposition:${v}`);
  for (const v of SERVICEABILITIES) if (!reachable.serviceability.has(v)) missingReach.push(`serviceability:${v}`);
  if (missingReach.length) {
    throw new Error(`state machine: unreachable axis values: ${missingReach.join(", ")}`);
  }
  const missingExit = [];
  for (const v of LIFECYCLES) {
    if (v === "Retired") continue; // terminal — DC-13
    if (!exited.lifecycle.has(v)) missingExit.push(`lifecycle:${v}`);
  }
  for (const v of DISPOSITIONS) if (!exited.disposition.has(v)) missingExit.push(`disposition:${v}`);
  for (const v of SERVICEABILITIES) if (!exited.serviceability.has(v)) missingExit.push(`serviceability:${v}`);
  if (missingExit.length) {
    throw new Error(`state machine: unexited axis values: ${missingExit.join(", ")}`);
  }
}

function assertMarkdown(md, rules) {
  const ids = [...new Set(rules.map((r) => r.id.replace(/[abc]$/, "")))];
  const missing = ids.filter((id) => !md.includes(id));
  // R-17a lives as "R-17a / R-17b / R-17c"
  const variantIds = ["R-17a", "R-17b", "R-17c"];
  const missingVariants = variantIds.filter((id) => !md.includes(id));
  if (missing.length || missingVariants.length) {
    throw new Error(`transition-table.md is missing rule ids: ${[...missing, ...missingVariants].join(", ")}`);
  }
  if (rules.length !== 27) {
    throw new Error(`expected 27 rule variants, generator has ${rules.length}`);
  }
}

const md = readFileSync(SOURCE_MD, "utf8");
assertMarkdown(md, RULES);
assertReachability(RULES);

const compatibility = { statuses: STATUSES, transitions: buildCompatibility() };

const machine = {
  version: "2026-09-03",
  source: "specs/010-web-application-platform/contracts/transition-table.md",
  generatedBy: "app/scripts/generate-state-machine.mjs",
  supersedes: "hand-maintained seven-value matrix",
  axes: {
    lifecycle: LIFECYCLES,
    disposition: DISPOSITIONS,
    serviceability: SERVICEABILITIES,
  },
  derived: {
    calibrationCurrency: ["NotRequired", "Failed", "Unknown", "Overdue", "DueSoon", "Current"],
    calibrationCurrencyPrecedence: ["NotRequired", "Failed", "Unknown", "Overdue", "DueSoon", "Current"],
    dueSoonHorizonDays: 30,
    todayTimezone: "America/Toronto",
    displayPillPrecedence: [
      { pill: "Retired", when: { lifecycle: ["Retired"] } },
      { pill: "Missing", when: { disposition: ["Missing"] } },
      { pill: "In calibration", when: { disposition: ["AtCalibrationLab"] } },
      { pill: "Needs repair", when: { serviceability: ["NeedsRepair", "OutOfService"] } },
      { pill: "Deployed", when: { disposition: ["Deployed"] } },
      { pill: "Checked out", when: { disposition: ["CheckedOut"] } },
      { pill: "In transit", when: { disposition: ["InTransit"] } },
      { pill: "Available", when: {} },
    ],
  },
  retiredIsTerminal: RETIRED_IS_TERMINAL,
  rules: RULES,
  compatibility,
};

writeFileSync(JSON_OUT, `${JSON.stringify(machine, null, 2)}\n`, "utf8");

const allTypes = [...new Set(RULES.map((r) => r.type))].sort();
const banner = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source of truth: specs/010-web-application-platform/contracts/transition-table.md §3
 * Generated by:    app/scripts/generate-state-machine.mjs (\`npm run generate:state-machine\`)
 *
 * DC-22 item 4: this is the axis machine (TRANSITION_RULES). STATE_MACHINE is a generated
 * seven-value compatibility projection for screens that still grey actions by pill — it is
 * not the allow/deny authority. deriveState evaluates TRANSITION_RULES against stored axes.
 *
 * Regenerate: \`npm run generate:state-machine\`.
 */

export type AssetStatus = ${STATUSES.map((s) => JSON.stringify(s)).join(" | ")};

export type Lifecycle = ${LIFECYCLES.map((s) => JSON.stringify(s)).join(" | ")};
export type Disposition = ${DISPOSITIONS.map((s) => JSON.stringify(s)).join(" | ")};
export type Serviceability = ${SERVICEABILITIES.map((s) => JSON.stringify(s)).join(" | ")};

export type TransactionType =
${allTypes.map((t) => `  | ${JSON.stringify(t)}`).join("\n")};

export const STATUSES: readonly AssetStatus[] = ${JSON.stringify(STATUSES, null, 2)} as const;

export const LIFECYCLES: readonly Lifecycle[] = ${JSON.stringify(LIFECYCLES)} as const;
export const DISPOSITIONS: readonly Disposition[] = ${JSON.stringify(DISPOSITIONS)} as const;
export const SERVICEABILITIES: readonly Serviceability[] = ${JSON.stringify(SERVICEABILITIES)} as const;

export const RETIRED_IS_TERMINAL = ${JSON.stringify(RETIRED_IS_TERMINAL, null, 2)} as const;

export type AxisName = "lifecycle" | "disposition" | "serviceability";

export interface TransitionRule {
  id: string;
  type: TransactionType;
  requires: {
    lifecycle: readonly Lifecycle[] | null;
    disposition: readonly Disposition[] | null;
    serviceability: readonly Serviceability[] | null;
  };
  sets: Partial<{ lifecycle: Lifecycle; disposition: Disposition; serviceability: Serviceability }>;
  untouched: readonly AxisName[];
  freeze?: readonly AxisName[];
  creation?: boolean;
  singleAsset?: boolean;
  composedOf?: readonly string[];
  roleFloor?: readonly string[];
  guards?: Record<string, boolean>;
  refusal: Record<string, string>;
}

export const TRANSITION_RULES: readonly TransitionRule[] = ${JSON.stringify(RULES, null, 2)} as unknown as readonly TransitionRule[];

/** Compatibility pill matrix — generated projection of TRANSITION_RULES over the 7 canonical pills. Not the allow/deny authority. */
export const STATE_MACHINE: Readonly<
  Record<AssetStatus, Partial<Record<TransactionType, AssetStatus>>>
> = ${JSON.stringify(compatibility.transitions, null, 2)} as const;
`;

writeFileSync(TS_OUT, banner, "utf8");

const rel = (p) => path.relative(process.cwd(), p);
console.log(`Generated ${rel(JSON_OUT)} and ${rel(TS_OUT)} from ${rel(SOURCE_MD)} (${RULES.length} rules)`);
