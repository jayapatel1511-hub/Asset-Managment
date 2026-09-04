# Contract: `AmsBackend` additions for Deployment & Kits

> **LEGACY MOCK/ADAPTER CONTRACT.** This records the pre-pivot client seam; it does not authorize a
> Dataverse adapter or a universal browser DTO. Current server-authoritative API/PostgreSQL contracts
> and D18 purpose-sized Work/Administration projections govern implementation.

**Feature**: 005 | **Date**: 2026-09-02 | **Consumers**: `api/mock/deployment.ts` (WS-A), `api/dataverse/index.ts` (WS-E), every screen under `features/deploy|recover|site`

These signatures are added to `app/src/api/AmsBackend.ts` and the types to `app/src/api/types.ts`
**in Phase 0 by the orchestrator**, with both implementations throwing
`new Error("not implemented")`. They are fixed at that point: WS-A implements the mock, WS-E
implements Dataverse, and neither renegotiates the shape. That is what allows the two to proceed
in parallel.

Style follows the existing interface exactly — `clientSubmissionId` for idempotency (FR-007),
`SubmissionOutcome` for every write, `offendingAssetId` on a refusal that names one asset.

## Types — add to `api/types.ts`

```ts
export type Orientation = "H" | "V" | "BH" | "N" | "E" | "S" | "W";
export type PowerSource = "Battery" | "Solar" | "AC" | "External";

/** One station at one site for one project over one span of time. Dated, not current-only —
 *  acceptance question 7 asks what was installed where on a PAST date, which the source
 *  spreadsheet's current-only design could never answer. */
export interface Installation {
  id: string;
  site: string;                    // location NAME, locationtype "Site"
  project: string;                 // project number
  primaryasset: string;            // assetid of the data logger — FR-009 requires one
  locationtype: LocationType;
  sitename: string;
  position: string | null;         // free text by explicit decision: "POR-403", "Pier 3"
  latitude: number | null;
  longitude: number | null;
  coordinatesource: "Manual" | "Device" | null;   // ASSUMPTION: FR-006
  powersource: PowerSource;
  start: string;                   // ISO
  end: string | null;              // null = currently installed
  openedbytransaction: string;
  closedbytransaction: string | null;
  notes: string | null;
}

/** An asset's dated membership of an installation, and the role it played. Separate from
 *  AssetRelationship because a component can be swapped mid-installation (US4) — the
 *  installation continues while this row ends and a replacement row begins. */
export interface InstallationComponent {
  id: string;
  installation: string;            // Installation.id
  asset: string;                   // assetid
  kitrole: KitRole;
  orientation: Orientation | null; // required where the role requires it — FR-004
  start: string;
  end: string | null;
  openedbyline: string | null;
  closedbyline: string | null;
}

/** Reconstruction result for US3 / FR-020 — what was on site, as at a date. */
export interface InstallationSnapshot {
  installation: Installation;
  components: Array<{ asset: string; kitrole: KitRole; orientation: Orientation | null }>;
  asOf: string;
}
```

## Inputs

```ts
export interface DeploymentComponentInput {
  assetId: string;
  kitRole: KitRole;
  orientation?: Orientation | null;
  }

export interface DeploymentInput {
  project: string;                 // required — FR-002
  primaryAssetId: string;          // required, must be a data logger — FR-002, FR-009
  components: DeploymentComponentInput[];   // excludes the primary; may be empty
  site: string;                    // existing Site location name, or a new one to create
  locationtype: LocationType;      // required — FR-005
  sitename: string;                // required — FR-002
  position?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinatesource?: "Manual" | "Device" | null;
  powersource: PowerSource;        // required — FR-005
  deploymentDate: string;          // required — FR-002; defaults to now
  notes?: string | null;
  clientSubmissionId: string;
}

export interface RecoveryComponentInput {
  assetId: string;
  /** "Recovered" returns it to the recovering user's custody; "Missing" marks it missing in the
   *  same action (FR-016) rather than falsely recovering it. */
  disposition: "Recovered" | "Missing";
  condition?: Condition;           // FR-017 — Damaged/NeedsService keeps it out of the pool
  notes?: string | null;
}

export interface RecoveryInput {
  installationId: string;
  components: RecoveryComponentInput[];   // subset = partial recovery (FR-012, FR-015)
  /** FR-018: when the primary is recovered but components are left behind, the caller MUST say
   *  what happens to them. Backend refuses if the primary is in `components` and any remaining
   *  component is absent from both `components` and this field. */
  leaveBehind?: Array<{ assetId: string; reason: string }>;
  recoveryDate: string;
  notes?: string | null;
  clientSubmissionId: string;
}

export interface ComponentSwapInput {
  installationId: string;
  outgoingAssetId: string;
  incomingAssetId: string;
  kitRole: KitRole;
  orientation?: Orientation | null;
  /** FR-024: both changes carry the same effective date, and the installation does not end. */
  effectiveDate: string;
  reason: string;
  clientSubmissionId: string;
}

export interface ConfigurationChangeInput {
  installationId: string;
  /** At least one must be present. */
  orientationChanges?: Array<{ assetId: string; orientation: Orientation }>;
  powersource?: PowerSource;
  position?: string | null;
  /** FR-027: moving the whole station to another project. */
  toproject?: string;
  effectiveDate: string;
  reason: string;
  clientSubmissionId: string;
}
```

## Methods — add to `interface AmsBackend`

```ts
  // ---- deployment (feature 005) ----

  /** US1. Creates one Deploy transaction with a line per asset (primary + components), one
   *  Installation, and one InstallationComponent per asset. Atomic — FR-010, FR-003.
   *  Refuses when: no primary (FR-009); primary is not a data logger (FR-002); any asset is not
   *  held by the caller and the caller is not an admin (FR-007); any asset is already deployed
   *  (FR-008); a role requiring orientation has none (FR-004); the project is inactive.
   *  Creates the Site location if `site` names a new one. */
  submitDeployment(input: DeploymentInput): Promise<SubmissionOutcome>;

  /** US2. Undeploy/Return per component, closes the InstallationComponent rows and — when
   *  nothing remains installed — the Installation itself with an end date (FR-014).
   *  Partial recovery leaves the Installation open and accurately reflects what remains
   *  (FR-015). Refuses when FR-018's leave-behind decision is missing. */
  submitRecovery(input: RecoveryInput): Promise<SubmissionOutcome>;

  /** US4. Two paired transactions on one effective date: the outgoing asset recovered, the
   *  incoming asset deployed. The Installation's `start` is NOT altered (FR-026) and it never
   *  shows an interruption in service. */
  submitComponentSwap(input: ComponentSwapInput): Promise<SubmissionOutcome>;

  /** US4. A dated amendment — orientation, power, position, or the whole station's project.
   *  Recorded as a transaction, never as an edit (FR-025). Previous values stay in history. */
  submitConfigurationChange(input: ConfigurationChangeInput): Promise<SubmissionOutcome>;

  /** US3. Sites that have, or have ever had, an installation. `onlyCurrent` filters to those
   *  with an open one. */
  listSites(onlyCurrent?: boolean): Promise<Location[]>;

  /** US3. Every installation at a site, newest first, current and historical (FR-019, FR-023 —
   *  readable after the project closes). */
  getSiteInstallations(site: string): Promise<Installation[]>;

  /** US3 / FR-020. What was installed, in which roles and orientations, as at `asOf`.
   *  Pure reconstruction from dated rows — the aggregate form of acceptance question 7. */
  getInstallationSnapshot(installationId: string, asOf: string): Promise<InstallationSnapshot | null>;

  /** US1 support. An asset's installations, for the deployments section of its detail screen
   *  (FR-021). */
  getAssetInstallations(assetId: string): Promise<Installation[]>;
```

## Refusal reasons — exact strings

`SubmissionError.reason` values, so screens and tests agree. All go through `i18n/en.json`; the
keys are added in Phase 0.

| Key | When | `offendingAssetId` |
|---|---|---|
| `deploy.error.noPrimary` | FR-009 — no data logger named | — |
| `deploy.error.primaryNotLogger` | FR-002 — primary is not equipmenttype `DataLogger` | yes |
| `deploy.error.notHeld` | FR-007 — asset not in caller's custody, caller not admin | yes |
| `deploy.error.alreadyDeployed` | FR-008 — asset has an open installation elsewhere | yes |
| `deploy.error.orientationRequired` | FR-004 — role needs orientation, none given | yes |
| `deploy.error.inactiveProject` | project status is `Closed` | — |
| `deploy.error.componentAlone` | a permanent Component named directly (FR-026 of 003) | yes |
| `recover.error.leaveBehindUndecided` | FR-018 — primary recovered, components unaccounted for | yes |
| `recover.error.notInstalled` | asset is not part of this installation | yes |
| `swap.error.incomingUnavailable` | incoming asset is not Available or held by the caller | yes |
| `config.error.noChange` | no field supplied | — |

## Invariants a reviewer must be able to verify

1. Exactly one open `Installation` per site+project+primary asset at any time.
2. An asset has at most one open `InstallationComponent` — the deployment analogue of the
   at-most-one-open-relationship rule (FR-030 of feature 003).
3. Closing the last open `InstallationComponent` closes the `Installation`.
4. A swap changes no `Installation.start` and leaves no gap in coverage for the role.
5. Every `Installation` row references the transaction that opened it, and every closed one the
   transaction that closed it. No installation exists without a transaction.
6. `getInstallationSnapshot(id, t)` returns exactly the components whose `start <= t` and
   (`end` is null or `end > t`).
