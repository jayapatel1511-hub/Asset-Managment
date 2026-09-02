/**
 * domain/installation.ts — pure functions over InstallationComponent rows. Feature 005 (WS-A).
 *
 * Constitution Principle III (domain/ is pure — AGENT-BRIEF.md §3.3): no store access, no fetch,
 * no React. Same discipline as domain/deriveState.ts — this is what makes the point-in-time
 * reconstruction (US3 / FR-020, acceptance question 7) and the recovery/orientation rules
 * (US1/US2) unit-testable with no backend at all, and what lets solution/flows/F1's README claim
 * agreement with it by inspection.
 */
import type { InstallationComponent, KitRole } from "../api/types";

/**
 * FR-004: orientation matters for a sensor's physical placement — the geophone slots of a
 * station — and is meaningless for the primary data logger, a microphone, a modem or its
 * permanent SIM (spec Assumptions: "Orientation matters for geophones and is meaningless for
 * modems and SIMs; the form asks only where it applies"). `ComponentPicker.tsx` only prompts for
 * orientation where this returns true, and `api/mock/deployment.ts` refuses a submission that
 * omits it where it does (deploy.error.orientationRequired) — one rule, checked at both layers
 * (Principle V), not two definitions that could drift.
 */
export function requiresOrientation(kitRole: KitRole): boolean {
  return kitRole === "Sensor1" || kitRole === "Sensor2" || kitRole === "Sensor3" || kitRole === "Sensor4";
}

/**
 * FR-020 / acceptance question 7: what was on site, as at `asOf`. A component is "in" at that
 * instant when its membership span covers it: it started at or before `asOf`, and either it is
 * still open (`end === null`) or it ended strictly after `asOf`. A component whose span ends
 * exactly at `asOf` is already out — its replacement, if any, starts exactly then (FR-022's swap
 * pairing needs this half-open convention: no gap, no overlap, on the effective date itself the
 * incoming component is the one counted).
 */
export function componentsAsOf(components: InstallationComponent[], asOf: string): InstallationComponent[] {
  return components.filter((c) => c.start <= asOf && (c.end === null || c.end > asOf));
}

/** The components of an installation not yet closed — what a recovery still has to account for
 * (FR-015, FR-018). */
export function openComponents(components: InstallationComponent[]): InstallationComponent[] {
  return components.filter((c) => c.end === null);
}

/** FR-014: an installation is fully recovered once none of its components remain open — the
 * condition under which `submitRecovery` closes the Installation itself with an end date. */
export function isFullyRecovered(components: InstallationComponent[]): boolean {
  return openComponents(components).length === 0;
}
