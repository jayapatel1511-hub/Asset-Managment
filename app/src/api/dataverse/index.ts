// LEGACY-POWER-PLATFORM — PARKED 2026-09-03.
//
// Dataverse is not the production system of record. This module is no longer imported by
// src/api/index.ts, so none of it reaches the bundle; it is kept on disk only as the record of
// the adapter shape the AmsBackend interface would need if a Dataverse path were ever revived.
// Do not implement against it. The production adapter is src/api/http/ against server/.

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
  // DATAVERSE-ONLY. Answerable without a tenant, and deliberately not `unimplemented`: the app
  // shell asks this on every load (components/DatasetBanner.tsx) and a throw there would break
  // every screen. A Dataverse environment holds the real data unless feature 007's US5 load has
  // put synthetic rows in it — which needs Q14 answered first, and would be detected here by
  // querying the synthetic marker (FR-005), not by a manifest file.
  getDatasetInfo = async () => ({ synthetic: false });
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

  // ---- deployment (feature 005, WS-A / WS-E) ----
  submitDeployment = unimplemented;
  submitRecovery = unimplemented;
  submitComponentSwap = unimplemented;
  submitConfigurationChange = unimplemented;
  listSites = unimplemented;
  getSiteInstallations = unimplemented;
  getInstallationSnapshot = unimplemented;
  getAssetInstallations = unimplemented;

  // ---- reporting (feature 006, WS-B / WS-E) ----
  getFleetCounts = unimplemented;
  getCalibrationCounts = unimplemented;

  // ---- offline queue (feature 003 US5, WS-C / WS-E) ----
  // NOTE for WS-E: a real Dataverse-backed queue is where offline actually matters — this mock
  // stub exists only to satisfy the interface; see api/mock/offline.ts's header for why the mock
  // backend's own "offline" is closer to a demo than a real network boundary.
  listPendingSubmissions = unimplemented;

  // ---- office admin assignment (feature 004 US4, WS-D / WS-E) ----
  listOfficeAdminAssignments = unimplemented;
  setOfficeAdmins = unimplemented;
}
