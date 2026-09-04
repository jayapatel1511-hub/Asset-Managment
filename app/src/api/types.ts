/**
 * Compatibility re-export. The entity shapes moved to `packages/contracts/` — see that package's
 * README for why the contract belongs to neither side.
 *
 * This file stays so that no screen, hook or test had to change import paths in the move. New
 * code should import from the contract package directly.
 */
export * from "../../../packages/contracts/src/types";
