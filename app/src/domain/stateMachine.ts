/**
 * Compatibility re-export. The generated transition matrix moved to
 * `packages/contracts/src/stateMachine.ts`, because `AssetStatus` is part of the wire contract
 * and the server validates against the same matrix (constitution Principle V).
 *
 * NOT generated — `app/scripts/generate-state-machine.mjs` writes the contract package's copy
 * now. This file is a hand-written two-line shim so that the nine existing importers, the
 * `predev`/`prebuild`/`pretest` hooks and `data/reference/state_machine.json` as the one source
 * of truth all keep working unchanged.
 */
export * from "../../../packages/contracts/src/stateMachine";
