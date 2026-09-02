/**
 * Backend refusals from feature 005's submit* methods come back as either an i18n key (the
 * eleven exact strings in contracts/ams-backend-deployment.md § Refusal reasons — e.g.
 * "deploy.error.notHeld") or, for basic required-field checks with no dedicated key, a plain
 * English sentence — the same convention feature 003's submitCheckout/submitTransfer already use.
 * `t()` (i18n/index.ts) already falls back to returning its input unchanged when the input isn't
 * a known key, so calling it on either kind of reason is safe: a known key gets translated and
 * interpolated, a plain sentence passes straight through.
 *
 * Shared across deploy/recover/site (all WS-A-owned) so the three screens describe a refusal
 * identically rather than three slightly different renderings of the same eleven strings.
 */
import { backend } from "../../api";
import { t, type StringKey } from "../../i18n";

export async function describeRefusal(reason: string, offendingAssetId?: string, project?: string): Promise<string> {
  const params: Record<string, string> = {};
  if (offendingAssetId) {
    params.assetId = offendingAssetId;
    if (reason === "deploy.error.notHeld") {
      // the one refusal whose template needs more than the asset id — who currently holds it
      const asset = await backend.getAsset(offendingAssetId);
      params.custodian = asset?.custodian ?? "—";
    }
  }
  if (project) params.project = project;
  return t(reason as StringKey, params);
}
