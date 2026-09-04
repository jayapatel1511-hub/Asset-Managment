/**
 * Compatibility re-export. The generated axis machine lives in
 * `packages/contracts/src/stateMachine.ts` (from transition-table.md, not the old pill JSON).
 *
 * NOT generated — `app/scripts/generate-state-machine.mjs` writes the contract package's copy.
 * This file is a hand-written shim so existing importers keep working.
 */
export * from "../../../packages/contracts/src/stateMachine";
