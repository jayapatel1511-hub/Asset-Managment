/**
 * Feature 005 — Deployment & Kits. Owned exclusively by WS-A after Phase 0.
 *
 * Every method below throws until WS-A implements it. Signatures are fixed by
 * specs/005-deployment-and-kits/contracts/ams-backend-deployment.md and must not change without
 * going back through the orchestrator (api/AmsBackend.ts and api/types.ts are frozen).
 *
 * Implementation notes for WS-A (delete this comment block once real bodies exist):
 *   - submitDeployment / submitRecovery / submitComponentSwap go through
 *     `store.applyTransaction` exactly like every existing submit* method in ../mock/index.ts —
 *     never assign asset.status/currentlocation/custodian/currentproject directly (Principle I).
 *     "Deploy" and "Undeploy" are already valid transaction types (data/reference/state_machine.json
 *     already allows them; app/src/domain/deriveState.ts already handles them and already opens/
 *     closes Kit relationships for Deploy — see KIT_OPENING_TYPES/KIT_CLOSING_TYPES there).
 *   - `store.installations` / `store.installationComponents` are the two new arrays added in
 *     Phase 0 (see store.ts) — read/write them directly (they're public fields), same pattern
 *     already used for store.relationships elsewhere in this codebase. store.ts itself does not
 *     need editing.
 *   - `store.applyTransaction`'s per-line `orientation`/`powersource` fields were added in
 *     Phase 0 specifically so Deploy lines can carry them through to the written TransactionLine.
 *   - Creating a new Site: push a Location (locationtype: "Site") onto `store.locations` before
 *     building the transaction, exactly like any other array mutation on the store.
 *   - Every refusal reason must match the exact keys in the contract's § Refusal reasons table
 *     (deploy.error.noPrimary, etc.) — i18n keys for all of them already exist (Phase 0).
 */
import type {
  ComponentSwapInput,
  DeploymentInput,
  DeploymentMethods,
  RecoveryInput,
  ConfigurationChangeInput,
} from "../AmsBackend";
import type { CurrentUser } from "../types";
import type { MockStore } from "./store";

export function createDeploymentMethods(
  _store: MockStore,
  _getCurrentUser: () => Promise<CurrentUser>
): DeploymentMethods {
  return {
    async submitDeployment(_input: DeploymentInput) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async submitRecovery(_input: RecoveryInput) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async submitComponentSwap(_input: ComponentSwapInput) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async submitConfigurationChange(_input: ConfigurationChangeInput) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async listSites(_onlyCurrent?: boolean) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async getSiteInstallations(_site: string) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async getInstallationSnapshot(_installationId: string, _asOf: string) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
    async getAssetInstallations(_assetId: string) {
      throw new Error("not implemented — WS-A (specs/005-deployment-and-kits)");
    },
  };
}
