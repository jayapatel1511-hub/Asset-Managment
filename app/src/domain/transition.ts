/**
 * Axis-rule evaluator (transition-table.md §8).
 *
 * One lookup: (type, current axes, command context) → allow + Sets, or a structured refusal.
 * deriveState and server transaction guards share this. The seven-value STATE_MACHINE pill
 * matrix is a generated projection, not the authority.
 */
import {
  RETIRED_IS_TERMINAL,
  TRANSITION_RULES,
  type AxisName,
  type Disposition,
  type TransactionType,
  type TransitionRule,
} from "./stateMachine";
import type { StateAxes } from "./stateAxes";

export interface TransitionContext {
  currentLocation?: string | null;
  toLocation?: string | null;
  toLocationKind?: "Office" | "Site" | "CalibrationLab" | "Other" | null;
  toUser?: string | null;
  toProject?: string | null;
  calibrationResult?: "Pass" | "Fail" | "Adjusted" | null;
}

export type TransitionRefusal = {
  ok: false;
  code: string;
  failedAxis: AxisName | null;
};

export type TransitionMatch = {
  ok: true;
  rule: TransitionRule;
  axesAfter: StateAxes;
};

function axisOk(allowed: readonly string[] | null | undefined, actual: string): boolean {
  if (allowed == null) return true;
  return allowed.includes(actual);
}

function isInterOfficeDispatch(ctx: TransitionContext): boolean {
  if (!ctx.toLocation) return false;
  if (ctx.toLocationKind && ctx.toLocationKind !== "Office") return false;
  if (!ctx.currentLocation) return true;
  return ctx.toLocation !== ctx.currentLocation;
}

function guardsOk(rule: TransitionRule, ctx: TransitionContext & { disposition: Disposition }): boolean {
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

function failedAxis(rule: TransitionRule, axes: StateAxes): AxisName | null {
  if (!axisOk(rule.requires.lifecycle, axes.lifecycle)) return "lifecycle";
  if (!axisOk(rule.requires.disposition, axes.disposition)) return "disposition";
  if (!axisOk(rule.requires.serviceability, axes.serviceability)) return "serviceability";
  return null;
}

function refusalCode(rule: TransitionRule, axis: AxisName): string {
  if (rule.refusal[axis]) return rule.refusal[axis];
  if (axis === "serviceability") return "transition.error.serviceability";
  if (axis === "lifecycle") return RETIRED_IS_TERMINAL.refusal;
  return "conflict.error.assetNotEligible";
}

function applySets(rule: TransitionRule, axes: StateAxes): StateAxes {
  return {
    lifecycle: rule.sets.lifecycle ?? axes.lifecycle,
    disposition: rule.sets.disposition ?? axes.disposition,
    serviceability: rule.sets.serviceability ?? axes.serviceability,
  };
}

export function evaluateTransition(
  type: TransactionType,
  axes: StateAxes,
  ctx: TransitionContext = {}
): TransitionMatch | TransitionRefusal {
  if (axes.lifecycle === "Retired" && !(RETIRED_IS_TERMINAL.allowedTypes as readonly string[]).includes(type)) {
    return { ok: false, code: RETIRED_IS_TERMINAL.refusal, failedAxis: "lifecycle" };
  }

  const candidates = TRANSITION_RULES.filter((r) => r.type === type && r.singleAsset !== false);
  if (candidates.length === 0) {
    return { ok: false, code: "transition.error.invalid", failedAxis: null };
  }

  const ctxWithDisp = { ...ctx, disposition: axes.disposition };
  let bestFail: TransitionRefusal | null = null;

  for (const r of candidates) {
    if (
      r.creation &&
      !(axes.lifecycle === "Active" && axes.disposition === "AtOffice" && axes.serviceability === "Serviceable")
    ) {
      bestFail ??= { ok: false, code: "transition.error.invalid", failedAxis: "disposition" };
      continue;
    }
    const axis = failedAxis(r, axes);
    if (axis) {
      bestFail ??= { ok: false, code: refusalCode(r, axis), failedAxis: axis };
      continue;
    }
    if (!guardsOk(r, ctxWithDisp)) {
      if (type === "Found") {
        bestFail ??= { ok: false, code: "transition.error.destinationRequired", failedAxis: "disposition" };
      } else {
        bestFail ??= { ok: false, code: r.refusal.disposition ?? "transition.error.invalid", failedAxis: "disposition" };
      }
      continue;
    }
    return { ok: true, rule: r, axesAfter: applySets(r, axes) };
  }

  if (type === "Found" && axes.disposition === "Missing" && !ctx.toUser && !ctx.toLocation && !ctx.toProject) {
    return { ok: false, code: "transition.error.destinationRequired", failedAxis: "disposition" };
  }

  return bestFail ?? { ok: false, code: "transition.error.invalid", failedAxis: null };
}

export function isTransitionAllowed(type: TransactionType, axes: StateAxes, ctx: TransitionContext = {}): boolean {
  return evaluateTransition(type, axes, ctx).ok;
}
