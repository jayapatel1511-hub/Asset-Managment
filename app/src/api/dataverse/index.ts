// DATAVERSE-ONLY
/**
 * Real Dataverse implementation of AmsBackend via the Power Apps Code Apps SDK
 * (@microsoft/power-apps). NOT implemented in this session — there is no tenant access
 * (CLAUDE.md/session constraint: "Do NOT create any Dataverse object, run `pac auth`, or touch a
 * Power Platform environment"). Every export in this file throws, so importing it is safe but
 * calling it fails loudly rather than silently returning fake data.
 *
 * What a real implementation does, one file per table as docs/02-app.md's structure prescribes
 * (api/asset.ts, api/transaction.ts, api/location.ts, ... each wrapping the SDK's typed
 * Dataverse client), is sketched in each stub's docstring below so the shape is unambiguous the
 * day a developer with `pac auth create` picks this up:
 *
 *   - initialize(): call `initialize()` from @microsoft/power-apps at app startup (see
 *     docs referenced in package.json's @microsoft/power-apps dependency).
 *   - Every read method becomes a Dataverse Web API GET against the matching eng_* table,
 *     translated through the same Asset/Location/... types in api/types.ts so no screen changes.
 *   - Every write method becomes a Web API POST of one eng_transaction + N eng_transactionline
 *     rows in a single $batch (atomicity — FR-003), and STOPS THERE: it does not itself compute
 *     the resulting eng_asset.status/location/custodian — flow F1 does that, asynchronously,
 *     after the row lands (see solution/flows/F1). This file must NOT call deriveState() to
 *     write eng_asset directly; doing so would duplicate F1's job and violate Principle V's
 *     "enforced independently in the automation" requirement by giving the app a second,
 *     unaudited write path to derived fields.
 *   - previewNextAssetId / registerAsset: the eng_idsequence optimistic-concurrency increment
 *     described in docs/01-data-model.md ("If-Match etag; on conflict, re-read and retry up to
 *     3x") lives here, not in the mock (which is single-threaded JS and needs no such retry).
 *
 * Field security (FR-030) is enforced by the Dataverse field security profile `AMS Sensitive`
 * (docs/05-security.md) — this file does not need its own "hide ICCID from Field Users" logic
 * the way api/mock/index.ts does, because Dataverse itself refuses to return those columns to a
 * caller without the profile. That is the point of Principle V: the interface's check exists for
 * a fast, explained refusal, and the actual guarantee lives at the data layer.
 */
import type { AmsBackend } from "../AmsBackend";

const NOT_AVAILABLE =
  "The Dataverse backend is not available in this build — no Power Platform tenant is connected " +
  "(see docs/09-build-report.md, 'What needs the tenant'). Set VITE_AMS_BACKEND=mock, which is " +
  "also this app's default.";

function unimplemented(): never {
  throw new Error(NOT_AVAILABLE);
}

// DATAVERSE-ONLY
export class DataverseAmsBackend implements AmsBackend {
  getCurrentUser = unimplemented;
  searchAssets = unimplemented;
  listAssets = unimplemented;
  getAsset = unimplemented;
  getAssetHistory = unimplemented;
  getAssetRelationships = unimplemented;
  listLocations = unimplemented;
  listEquipmentModels = unimplemented;
  listProjects = unimplemented;
  listCalibrationDue = unimplemented;
  getCalibrationHistory = unimplemented;
  recordCalibration = unimplemented;
  sendToCalibration = unimplemented;
  submitCheckout = unimplemented;
  submitReturn = unimplemented;
  submitTransfer = unimplemented;
  reportFault = unimplemented;
  markMissing = unimplemented;
  markFound = unimplemented;
  completeRepair = unimplemented;
  previewNextAssetId = unimplemented;
  registerAsset = unimplemented;
  retireAsset = unimplemented;
}
