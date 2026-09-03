/**
 * Feature 005 — Deployment & Kits, ported from api/mock/deployment.ts rule for rule, including
 * its refusal reasons: several of those are i18n keys ("deploy.error.alreadyDeployed") because
 * DeployPage/RecoverPage/SwapDialog pass them through `describeRefusal` →
 * `t(reason, { assetId, custodian, project })`. Returning plain English instead would silently
 * degrade the screens' messages, so the keys are reproduced exactly.
 *
 * `installation` and `installation_component` rows are transaction DETAIL, not derived asset
 * state (feature 005 plan.md's Constitution Check), so this file writes them directly — but only
 * ever alongside the transaction that justifies the write, and never an asset's status, location,
 * custodian, project or parent, which only applyTransaction touches.
 *
 * The mock's three idempotency guards per method (an early `processedClientSubmissionIds` check,
 * and an `alreadyRecorded` check before the Installation writes) have no equivalent here and are
 * deliberately absent: `runCommand` answers a replay from the command_idempotency table before
 * this code runs at all, so the second call never reaches the business rules that would wrongly
 * refuse it ("already deployed") — the exact failure those guards existed to prevent.
 */
import { randomUUID } from "node:crypto";
import type {
  ComponentSwapInput,
  ConfigurationChangeInput,
  DeploymentInput,
  RecoveryInput,
  SubmissionOutcome,
} from "../../../app/src/api/AmsBackend";
import type { CurrentUser, Installation, InstallationComponent, KitRole } from "../../../app/src/api/types";
import { isAdmin } from "../../../app/src/api/types";
import { requiresOrientation } from "../../../app/src/domain/installation";
import type { Queryable } from "../db/pglite";
import {
  COMPONENT_COLUMNS,
  INSTALLATION_COLUMNS,
  LOCATION_COLUMNS,
  componentToValues,
  installationToValues,
  insertRows,
  locationToValues,
  type ComponentRow,
  type InstallationRow,
} from "../db/rows";
import { loadAsset } from "./commandService";
import { applyTransaction, refuse } from "./transactionService";

function nowIso(): string {
  return new Date().toISOString();
}

async function getInstallation(tx: Queryable, id: string): Promise<InstallationRow | undefined> {
  const res = await tx.query<InstallationRow>("SELECT * FROM installation WHERE id = $1", [id]);
  return res.rows[0];
}

async function openComponentRows(tx: Queryable, installationId: string): Promise<ComponentRow[]> {
  const res = await tx.query<ComponentRow>(
    "SELECT * FROM installation_component WHERE installation = $1 AND end_at IS NULL ORDER BY start_at, id",
    [installationId]
  );
  return res.rows;
}

// ---------------------------------------------------------------- US1 — deploy

export async function submitDeployment(
  tx: Queryable,
  user: CurrentUser,
  input: DeploymentInput
): Promise<SubmissionOutcome> {
  // ---- validation (Principle V: refused here independently of DeployPage's own pre-submit
  // checks, which mirror every one of these) ----
  if (!input.primaryAssetId) return refuse("deploy.error.noPrimary");

  const primary = await loadAsset(tx, input.primaryAssetId);
  if (!primary) return refuse(`Unknown asset ${input.primaryAssetId}.`, input.primaryAssetId);
  if (primary.equipmenttype !== "DataLogger") {
    return refuse("deploy.error.primaryNotLogger", input.primaryAssetId); // FR-002, FR-009
  }
  if (!input.project?.trim()) return refuse("A project is required to deploy a station.");

  const project = await tx.query<{ status: string }>("SELECT status FROM project WHERE projectnumber = $1", [input.project]);
  if (project.rows[0] && project.rows[0].status !== "Active") return refuse("deploy.error.inactiveProject");

  if (!input.site?.trim() || !input.sitename?.trim() || !input.locationtype) {
    return refuse("A site, its location type and name are required.");
  }
  if (!input.powersource) return refuse("A power source is required.");

  const componentInputs = input.components.filter((c) => c.assetId !== input.primaryAssetId);
  const allAssetIds = [input.primaryAssetId, ...componentInputs.map((c) => c.assetId)];
  const seen = new Set<string>();
  for (const id of allAssetIds) {
    if (seen.has(id)) return refuse(`${id} is listed more than once in this deployment.`, id);
    seen.add(id);
  }

  const admin = isAdmin(user);
  for (const id of allAssetIds) {
    const row = await loadAsset(tx, id);
    if (!row) return refuse(`Unknown asset ${id}.`, id);
    if (row.status === "Deployed") return refuse("deploy.error.alreadyDeployed", id); // FR-008
    if (row.status === "CheckedOut" && row.custodian !== user.upn && !admin) {
      return refuse("deploy.error.notHeld", id); // FR-007
    }
    const comp = await tx.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM asset_relationship
        WHERE childasset = $1 AND end_at IS NULL AND relationshiptype = 'Component'`,
      [id]
    );
    if ((comp.rows[0]?.c ?? 0) > 0) {
      // the SIM-in-a-modem case: a permanent Component never appears on the form directly
      return refuse("deploy.error.componentAlone", id);
    }
  }

  for (const c of componentInputs) {
    if (requiresOrientation(c.kitRole) && !c.orientation) {
      return refuse("deploy.error.orientationRequired", c.assetId); // FR-004
    }
  }

  // ---- create the Site location if it's new ----
  // location.name is UNIQUE in the schema, so a name already taken by an office or cal lab is
  // refused with an explanation rather than left to fail as a constraint violation (the mock,
  // holding locations in an array keyed by nothing, could create a second row with that name).
  const existing = await tx.query<{ name: string; locationtype: string }>(
    "SELECT name, locationtype FROM location WHERE name = $1",
    [input.site]
  );
  if (existing.rows[0] && existing.rows[0].locationtype !== "Site") {
    return refuse(`"${input.site}" already names a ${existing.rows[0].locationtype}, not a site — use a different site name.`);
  }
  if (!existing.rows[0]) {
    await insertRows(tx, "location", LOCATION_COLUMNS, [
      locationToValues({ id: randomUUID(), name: input.site, locationtype: "Site", parentlocation: null, isactive: true, note: null }),
    ]);
  }

  const deploymentDate = input.deploymentDate || nowIso();
  const plannedLines: Array<{ assetId: string; kitRole: KitRole; orientation: string | null }> = [
    { assetId: input.primaryAssetId, kitRole: "Primary", orientation: null },
    ...componentInputs.map((c) => ({ assetId: c.assetId, kitRole: c.kitRole, orientation: c.orientation ?? null })),
  ];

  // FR-010/FR-003: one Deploy transaction, one line per asset, atomic.
  const result = await applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Deploy",
    performedby: user.upn,
    date: deploymentDate,
    tolocation: input.site,
    toproject: input.project,
    primaryAssetId: input.primaryAssetId,
    notes: input.notes ?? null,
    lines: plannedLines.map((l) => ({
      assetId: l.assetId,
      kitRole: l.kitRole,
      orientation: l.orientation,
      powersource: input.powersource,
    })),
  });
  if (!result.ok) return result;

  const installationId = randomUUID();
  const installation: Installation = {
    id: installationId,
    site: input.site,
    project: input.project,
    primaryasset: input.primaryAssetId,
    locationtype: input.locationtype,
    sitename: input.sitename,
    position: input.position ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    coordinatesource: input.coordinatesource ?? null,
    powersource: input.powersource,
    start: deploymentDate,
    end: null,
    openedbytransaction: result.transactionId,
    closedbytransaction: null,
    notes: input.notes ?? null,
  };
  await insertRows(tx, "installation", INSTALLATION_COLUMNS, [installationToValues(installation)]);
  await insertRows(
    tx,
    "installation_component",
    COMPONENT_COLUMNS,
    plannedLines.map((l) =>
      componentToValues({
        id: randomUUID(),
        installation: installationId,
        asset: l.assetId,
        kitrole: l.kitRole,
        orientation: l.orientation as InstallationComponent["orientation"],
        start: deploymentDate,
        end: null,
        openedbyline: result.transactionId,
        closedbyline: null,
      })
    )
  );

  return result;
}

// ---------------------------------------------------------------- US2 — recover

export async function submitRecovery(tx: Queryable, user: CurrentUser, input: RecoveryInput): Promise<SubmissionOutcome> {
  if (input.components.length === 0) return refuse("Select at least one component to recover.");

  const installation = await getInstallation(tx, input.installationId);
  if (!installation) return refuse(`Unknown installation ${input.installationId}.`);
  if (installation.end_at) return refuse(`Installation ${input.installationId} is already closed.`);

  const openRows = await openComponentRows(tx, installation.id);

  for (const c of input.components) {
    if (!openRows.some((r) => r.asset === c.assetId)) return refuse("recover.error.notInstalled", c.assetId);
  }
  for (const lb of input.leaveBehind ?? []) {
    if (!openRows.some((r) => r.asset === lb.assetId)) return refuse("recover.error.notInstalled", lb.assetId);
  }

  // FR-018: when the primary is being recovered or marked missing, every OTHER open component
  // must be accounted for — recovered, or explicitly left behind with a reason.
  const namedIds = new Set(input.components.map((c) => c.assetId));
  const leftBehindIds = new Set((input.leaveBehind ?? []).map((l) => l.assetId));
  if (namedIds.has(installation.primaryasset)) {
    for (const row of openRows) {
      if (row.asset === installation.primaryasset) continue;
      if (!namedIds.has(row.asset) && !leftBehindIds.has(row.asset)) {
        return refuse("recover.error.leaveBehindUndecided", row.asset);
      }
    }
  }

  const recoveryDate = input.recoveryDate || nowIso();
  const recoveredInputs = input.components.filter((c) => c.disposition === "Recovered");
  const missingInputs = input.components.filter((c) => c.disposition === "Missing");
  const badRecovered = recoveredInputs.filter((c) => c.condition && c.condition !== "Good");

  const closedByAsset = new Map<string, string>();
  let primaryResult: SubmissionOutcome | null = null;

  if (recoveredInputs.length > 0) {
    // FR-012/FR-013: Deployed -> CheckedOut, into the recovering user's custody — not straight
    // to Available at an office, which would be a false claim about where the item is.
    const undeployResult = await applyTransaction(tx, {
      clientSubmissionId: input.clientSubmissionId,
      transactiontype: "Undeploy",
      performedby: user.upn,
      date: recoveryDate,
      touser: user.upn,
      notes: input.notes ?? null,
      lines: recoveredInputs.map((c) => ({ assetId: c.assetId, condition: c.condition })),
    });
    if (!undeployResult.ok) return undeployResult;
    primaryResult = undeployResult;
    for (const c of recoveredInputs) closedByAsset.set(c.assetId, undeployResult.transactionId);

    if (badRecovered.length > 0) {
      // FR-017: damaged / needs-service goes on to NeedsRepair, out of the available pool.
      const faultResult = await applyTransaction(tx, {
        clientSubmissionId: `${input.clientSubmissionId}-fault`,
        transactiontype: "ReportFault",
        performedby: user.upn,
        date: recoveryDate,
        notes: "Reported damaged/needs-service on recovery.",
        lines: badRecovered.map((c) => ({ assetId: c.assetId, condition: c.condition })),
      });
      if (!faultResult.ok) return faultResult;
    }
  }

  if (missingInputs.length > 0) {
    // FR-016: marked missing rather than falsely recovered.
    const missingResult = await applyTransaction(tx, {
      clientSubmissionId: `${input.clientSubmissionId}-missing`,
      transactiontype: "MarkMissing",
      performedby: user.upn,
      date: recoveryDate,
      notes: input.notes ?? null,
      lines: missingInputs.map((c) => ({ assetId: c.assetId, condition: c.condition })),
    });
    if (!missingResult.ok) return missingResult;
    if (!primaryResult) primaryResult = missingResult;
    for (const c of missingInputs) closedByAsset.set(c.assetId, missingResult.transactionId);
  }

  // Close the named component rows (FR-014/FR-015) and, once nothing remains open, the
  // installation itself. A partial recovery leaves it open, still describing what is on site.
  for (const c of input.components) {
    await tx.query(
      `UPDATE installation_component SET end_at = $1, closedbyline = $2
        WHERE installation = $3 AND asset = $4 AND end_at IS NULL`,
      [recoveryDate, closedByAsset.get(c.assetId) ?? null, installation.id, c.assetId]
    );
  }
  const stillOpen = await openComponentRows(tx, installation.id);
  if (stillOpen.length === 0) {
    await tx.query("UPDATE installation SET end_at = $1, closedbytransaction = $2 WHERE id = $3 AND end_at IS NULL", [
      recoveryDate,
      primaryResult && primaryResult.ok ? primaryResult.transactionId : null,
      installation.id,
    ]);
  }

  if (!primaryResult) return refuse("Select at least one component to recover.");
  return primaryResult;
}

// ---------------------------------------------------------------- US4 — component swap

export async function submitComponentSwap(
  tx: Queryable,
  user: CurrentUser,
  input: ComponentSwapInput
): Promise<SubmissionOutcome> {
  if (!input.reason?.trim()) return refuse("A reason is required to swap a component.");

  const installation = await getInstallation(tx, input.installationId);
  if (!installation) return refuse(`Unknown installation ${input.installationId}.`);
  if (installation.end_at) return refuse(`Installation ${input.installationId} is already closed.`);
  if (input.outgoingAssetId === installation.primaryasset) {
    return refuse("Swapping the primary data logger is not supported — recover and redeploy the station instead.");
  }

  const openRows = await openComponentRows(tx, installation.id);
  const outgoingRow = openRows.find((r) => r.asset === input.outgoingAssetId);
  if (!outgoingRow) return refuse("recover.error.notInstalled", input.outgoingAssetId);
  if (requiresOrientation(input.kitRole) && !input.orientation) {
    return refuse("deploy.error.orientationRequired", input.incomingAssetId);
  }

  const incoming = await loadAsset(tx, input.incomingAssetId);
  if (!incoming) return refuse(`Unknown asset ${input.incomingAssetId}.`, input.incomingAssetId);
  if (!(incoming.status === "Available" || incoming.custodian === user.upn)) {
    return refuse("swap.error.incomingUnavailable", input.incomingAssetId);
  }

  const effectiveDate = input.effectiveDate || nowIso();

  // FR-024: the outgoing asset is recovered into the swapping user's custody, the incoming asset
  // is deployed into the same station, both on one effective date. The installation does not end
  // and its start is never altered (FR-026) — only the component rows change.
  const undeployResult = await applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Undeploy",
    performedby: user.upn,
    date: effectiveDate,
    touser: user.upn,
    notes: input.reason,
    lines: [{ assetId: input.outgoingAssetId }],
  });
  if (!undeployResult.ok) return undeployResult;

  const deployResult = await applyTransaction(tx, {
    clientSubmissionId: `${input.clientSubmissionId}-deploy`,
    transactiontype: "Deploy",
    performedby: user.upn,
    date: effectiveDate,
    tolocation: installation.site,
    toproject: installation.project,
    primaryAssetId: installation.primaryasset,
    notes: input.reason,
    lines: [
      {
        assetId: input.incomingAssetId,
        kitRole: input.kitRole,
        orientation: input.orientation ?? null,
        powersource: installation.powersource,
      },
    ],
  });
  if (!deployResult.ok) return deployResult;

  await tx.query("UPDATE installation_component SET end_at = $1, closedbyline = $2 WHERE id = $3", [
    effectiveDate,
    undeployResult.transactionId,
    outgoingRow.id,
  ]);
  await insertRows(tx, "installation_component", COMPONENT_COLUMNS, [
    componentToValues({
      id: randomUUID(),
      installation: installation.id,
      asset: input.incomingAssetId,
      kitrole: input.kitRole,
      orientation: input.orientation ?? null,
      start: effectiveDate,
      end: null,
      openedbyline: deployResult.transactionId,
      closedbyline: null,
    }),
  ]);

  return deployResult;
}

// ---------------------------------------------------------------- US4 — configuration change

export async function submitConfigurationChange(
  tx: Queryable,
  user: CurrentUser,
  input: ConfigurationChangeInput
): Promise<SubmissionOutcome> {
  const hasChange = Boolean(
    input.orientationChanges?.length || input.powersource || input.position !== undefined || input.toproject
  );
  if (!hasChange) return refuse("config.error.noChange");

  const installation = await getInstallation(tx, input.installationId);
  if (!installation) return refuse(`Unknown installation ${input.installationId}.`);
  if (installation.end_at) return refuse(`Installation ${input.installationId} is already closed.`);
  if (!input.reason?.trim()) return refuse("A reason is required to change a live installation's configuration.");

  const effectiveDate = input.effectiveDate || nowIso();
  const openRows = await openComponentRows(tx, installation.id);

  for (const oc of input.orientationChanges ?? []) {
    if (!openRows.some((r) => r.asset === oc.assetId)) return refuse("recover.error.notInstalled", oc.assetId);
  }

  // Carried over from api/mock/deployment.ts, still true: moving a live installation to another
  // project (FR-027) updates Installation.project — transaction detail — but cannot also move
  // Asset.currentproject, because the only transaction type deriveState maps `toproject` through
  // is Transfer, and Transfer from Deployed leaves the asset Deployed without touching the
  // project (deriveState's Transfer case applies only the fields the transaction names, and this
  // Audit transaction names none). Recorded rather than worked around by writing
  // asset.currentproject directly, which would be a Principle I violation.
  const affected = new Set<string>();
  for (const oc of input.orientationChanges ?? []) affected.add(oc.assetId);
  if (input.powersource || input.position !== undefined || input.toproject) {
    for (const r of openRows) affected.add(r.asset);
  }
  if (affected.size === 0) affected.add(installation.primaryasset);

  const noteParts = [input.reason];
  if (input.powersource && input.powersource !== installation.powersource) {
    noteParts.push(`power source ${installation.powersource} -> ${input.powersource}`);
  }
  if (input.position !== undefined && input.position !== installation.position) {
    noteParts.push(`position ${installation.position ?? "—"} -> ${input.position ?? "—"}`);
  }
  if (input.toproject && input.toproject !== installation.project) {
    noteParts.push(`project ${installation.project} -> ${input.toproject} (installation record only — see code note on Asset.currentproject)`);
  }

  // Recorded as an Audit transaction (Deployed -> Deployed) so the amendment has a dated,
  // immutable line of its own — FR-025/FR-026: never an in-place edit with no trace.
  const result = await applyTransaction(tx, {
    clientSubmissionId: input.clientSubmissionId,
    transactiontype: "Audit",
    performedby: user.upn,
    date: effectiveDate,
    notes: noteParts.join("; "),
    lines: [...affected].map((assetId) => ({
      assetId,
      orientation: input.orientationChanges?.find((o) => o.assetId === assetId)?.orientation ?? null,
    })),
  });
  if (!result.ok) return result;

  if (input.powersource) {
    await tx.query("UPDATE installation SET powersource = $1 WHERE id = $2", [input.powersource, installation.id]);
  }
  if (input.position !== undefined) {
    await tx.query("UPDATE installation SET position = $1 WHERE id = $2", [input.position, installation.id]);
  }
  if (input.toproject) {
    await tx.query("UPDATE installation SET project = $1 WHERE id = $2", [input.toproject, installation.id]);
  }
  for (const oc of input.orientationChanges ?? []) {
    await tx.query(
      "UPDATE installation_component SET orientation = $1 WHERE installation = $2 AND asset = $3 AND end_at IS NULL",
      [oc.orientation, installation.id, oc.assetId]
    );
  }

  return result;
}

// ---------------------------------------------------------------- feature 004 US4 — office admins

export async function setOfficeAdmins(
  tx: Queryable,
  office: string,
  adminUpns: string[]
): Promise<SubmissionOutcome> {
  const known = await tx.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM location WHERE locationtype = 'Office' AND name = $1",
    [office]
  );
  if ((known.rows[0]?.c ?? 0) === 0) {
    return refuse(`${office} is not a known office — pick one from the location table.`);
  }

  // Dedupe case-insensitively while preserving first-seen casing, and drop blanks. This is
  // reference-data maintenance (a text input standing in for a directory picker), not a
  // transaction, so there is nothing to derive and validation is data hygiene.
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of adminUpns) {
    const upn = raw.trim();
    if (!upn) continue;
    const key = upn.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(upn);
  }

  // Replace, never merge (AGENT-BRIEF: "replace (not merge) the admin list for that office").
  await tx.query(
    `INSERT INTO office_admin_assignment (office, admin_upns) VALUES ($1, $2::jsonb)
     ON CONFLICT (office) DO UPDATE SET admin_upns = EXCLUDED.admin_upns`,
    [office, JSON.stringify(cleaned)]
  );

  return { ok: true, transactionId: `office-admins-${office}`, transactionName: office };
}
