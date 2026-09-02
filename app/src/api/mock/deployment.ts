/**
 * Feature 005 — Deployment & Kits. Owned exclusively by WS-A.
 *
 * Every write here goes through `store.applyTransaction` exactly like every existing submit*
 * method in ../mock/index.ts — never assign asset.status/currentlocation/custodian/currentproject
 * directly (Principle I). "Deploy" and "Undeploy" are already valid transaction types
 * (data/reference/state_machine.json already allows them; domain/deriveState.ts already handles
 * them and already opens/closes Kit relationships for Deploy).
 *
 * `Installation` and `InstallationComponent` rows themselves are written directly by this file
 * (they are transaction DETAIL, not derived asset state — plan.md's Constitution Check row for
 * Principle I says so explicitly) but only ever alongside a transaction that justifies the write:
 * a deployment creates them, a recovery closes them, a swap/config-change amends them. There is no
 * code path here that edits an Installation/InstallationComponent without a transaction behind it.
 *
 * PHASE 2 INTEGRATION NOTE (orchestrator): WS-A found and flagged that `deriveState.ts`'s
 * "Undeploy" case was grouped with "Return" and unconditionally set `custodian: null`, ignoring
 * `line.touser` — wrong for FR-013 (a recovered component must land in the RECOVERING USER's
 * custody). WS-A worked around it here by chaining a same-dated "Transfer" after every Undeploy.
 * `deriveState.ts` has since been fixed directly (Undeploy now honours `touser` and, matching
 * Checkout's honesty about location, leaves `currentlocation` null rather than guessing the home
 * office) — so the custody-correction Transfer chains that used to live in `submitRecovery` and
 * `submitComponentSwap` have been removed as redundant. If you are reading this while porting to
 * `api/dataverse/`, Undeploy alone now does the right thing; no extra transaction is needed.
 */
import { componentsAsOf } from "../../domain/installation";
import { requiresOrientation } from "../../domain/installation";
import type {
  ComponentSwapInput,
  ConfigurationChangeInput,
  DeploymentInput,
  DeploymentMethods,
  RecoveryInput,
  SubmissionOutcome,
} from "../AmsBackend";
import { isAdmin } from "../types";
import type { CurrentUser, Installation, InstallationComponent, KitRole, Location } from "../types";
import type { MockStore } from "./store";

function newId(prefix: string): string {
  return `mock-${prefix}-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createDeploymentMethods(store: MockStore, getCurrentUser: () => Promise<CurrentUser>): DeploymentMethods {
  return {
    async submitDeployment(input: DeploymentInput): Promise<SubmissionOutcome> {
      await store.ready;
      const user = await getCurrentUser();

      // FR-007 idempotency, checked BEFORE any business-rule validation below: a retried
      // clientSubmissionId must succeed the same way it did the first time, even though by now
      // every named asset's status has already moved to Deployed — re-running the validation
      // against that now-mutated state would wrongly refuse the retry as "already deployed".
      if (store.processedClientSubmissionIds.has(input.clientSubmissionId)) {
        const existing = store.transactions.find((t) => t.notes?.includes(input.clientSubmissionId));
        if (existing) return { ok: true, transactionId: existing.id, transactionName: existing.name };
      }

      // ---- validation (Principle V: refused here independently of ComponentPicker/DeployPage's
      // own pre-submit checks, which mirror every one of these) ----

      if (!input.primaryAssetId) {
        return { ok: false, reason: "deploy.error.noPrimary" };
      }
      const primary = store.assets.get(input.primaryAssetId);
      if (!primary) {
        return { ok: false, reason: `Unknown asset ${input.primaryAssetId}.`, offendingAssetId: input.primaryAssetId };
      }
      if (primary.equipmentmodel.equipmenttype !== "DataLogger") {
        return { ok: false, reason: "deploy.error.primaryNotLogger", offendingAssetId: input.primaryAssetId };
      }
      if (!input.project?.trim()) {
        return { ok: false, reason: "A project is required to deploy a station." };
      }
      const project = store.projects.find((p) => p.projectnumber === input.project);
      if (project && project.status !== "Active") {
        return { ok: false, reason: "deploy.error.inactiveProject" };
      }
      if (!input.site?.trim() || !input.sitename?.trim() || !input.locationtype) {
        return { ok: false, reason: "A site, its location type and name are required." };
      }
      if (!input.powersource) {
        return { ok: false, reason: "A power source is required." };
      }

      // Components excluding an accidental duplicate of the primary itself.
      const componentInputs = input.components.filter((c) => c.assetId !== input.primaryAssetId);
      const allAssetIds = [input.primaryAssetId, ...componentInputs.map((c) => c.assetId)];
      const seen = new Set<string>();
      for (const id of allAssetIds) {
        if (seen.has(id)) return { ok: false, reason: `${id} is listed more than once in this deployment.`, offendingAssetId: id };
        seen.add(id);
      }

      const admin = isAdmin(user);
      for (const id of allAssetIds) {
        const asset = store.assets.get(id);
        if (!asset) {
          return { ok: false, reason: `Unknown asset ${id}.`, offendingAssetId: id };
        }
        if (asset.status === "Deployed") {
          // FR-008
          return { ok: false, reason: "deploy.error.alreadyDeployed", offendingAssetId: id };
        }
        if (asset.status === "CheckedOut" && asset.custodian !== user.upn && !admin) {
          // FR-007
          return { ok: false, reason: "deploy.error.notHeld", offendingAssetId: id };
        }
        if (store.openRelationshipsAsChild(id).some((r) => r.relationshiptype === "Component")) {
          // the SIM-in-a-modem case: a permanent Component never appears on the form directly
          return { ok: false, reason: "deploy.error.componentAlone", offendingAssetId: id };
        }
      }

      for (const c of componentInputs) {
        if (requiresOrientation(c.kitRole) && !c.orientation) {
          // FR-004
          return { ok: false, reason: "deploy.error.orientationRequired", offendingAssetId: c.assetId };
        }
      }

      // ---- create the Site location if it's new ----
      let siteLocation = store.locations.find((l) => l.name === input.site && l.locationtype === "Site");
      if (!siteLocation) {
        siteLocation = {
          id: newId("loc"),
          name: input.site,
          locationtype: "Site",
          parentlocation: null,
          isactive: true,
          note: null,
        } satisfies Location;
        store.locations.push(siteLocation);
      }

      const deploymentDate = input.deploymentDate || nowIso();

      type PlannedLine = { assetId: string; kitRole: KitRole; orientation: string | null };
      const plannedLines: PlannedLine[] = [
        { assetId: input.primaryAssetId, kitRole: "Primary", orientation: null },
        ...componentInputs.map((c) => ({ assetId: c.assetId, kitRole: c.kitRole, orientation: c.orientation ?? null })),
      ];

      // FR-010/FR-003: one Deploy transaction, one line per asset, atomic — everything above is
      // pre-flight; store.applyTransaction itself validates every line before writing anything.
      const result = store.applyTransaction({
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

      // FR-007 idempotency guard for THIS method's own side effects: a retried
      // clientSubmissionId returns the same transaction from applyTransaction without writing a
      // new line — mirror that here so the Installation/InstallationComponent rows aren't
      // duplicated on retry.
      const alreadyRecorded = store.installations.some((i) => i.openedbytransaction === result.transactionId);
      if (!alreadyRecorded) {
        const installationId = newId("inst");
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
        store.installations.push(installation);

        for (const l of plannedLines) {
          store.installationComponents.push({
            id: newId("instcomp"),
            installation: installationId,
            asset: l.assetId,
            kitrole: l.kitRole,
            orientation: l.orientation as InstallationComponent["orientation"],
            start: deploymentDate,
            end: null,
            openedbyline: result.transactionId,
            closedbyline: null,
          });
        }
        store.persist();
      }

      return result;
    },

    async submitRecovery(input: RecoveryInput): Promise<SubmissionOutcome> {
      await store.ready;
      const user = await getCurrentUser();

      // FR-007 idempotency — see submitDeployment's identical guard: by the time a retry arrives
      // the named components are already recovered/closed, which would otherwise wrongly refuse
      // the retry (e.g. "installation already closed").
      if (store.processedClientSubmissionIds.has(input.clientSubmissionId)) {
        const existing = store.transactions.find((t) => t.notes?.includes(input.clientSubmissionId));
        if (existing) return { ok: true, transactionId: existing.id, transactionName: existing.name };
      }

      if (input.components.length === 0) {
        return { ok: false, reason: "Select at least one component to recover." };
      }

      const installation = store.installations.find((i) => i.id === input.installationId);
      if (!installation) {
        return { ok: false, reason: `Unknown installation ${input.installationId}.` };
      }
      if (installation.end) {
        return { ok: false, reason: `Installation ${input.installationId} is already closed.` };
      }

      const openRows = store.installationComponents.filter((c) => c.installation === installation.id && c.end === null);

      for (const c of input.components) {
        if (!openRows.some((r) => r.asset === c.assetId)) {
          // FR: naming an asset that isn't part of this (open) installation
          return { ok: false, reason: "recover.error.notInstalled", offendingAssetId: c.assetId };
        }
      }
      for (const lb of input.leaveBehind ?? []) {
        if (!openRows.some((r) => r.asset === lb.assetId)) {
          return { ok: false, reason: "recover.error.notInstalled", offendingAssetId: lb.assetId };
        }
      }

      // FR-018: when the primary is being recovered/marked missing, every OTHER open component
      // must be accounted for — named in `components` or explicitly left behind with a reason.
      const namedIds = new Set(input.components.map((c) => c.assetId));
      const leftBehindIds = new Set((input.leaveBehind ?? []).map((l) => l.assetId));
      if (namedIds.has(installation.primaryasset)) {
        for (const row of openRows) {
          if (row.asset === installation.primaryasset) continue;
          if (!namedIds.has(row.asset) && !leftBehindIds.has(row.asset)) {
            return { ok: false, reason: "recover.error.leaveBehindUndecided", offendingAssetId: row.asset };
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
        // FR-012/FR-013: Deployed -> CheckedOut, into custody (not straight to Available/office —
        // that is what the separate, pre-existing Return screen is for once the tech is back).
        const undeployResult = store.applyTransaction({
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
          // FR-017: a damaged/needs-service recovery goes on to NeedsRepair, definitively out of
          // the available pool — same two-step pattern submitReturn already uses.
          const faultResult = store.applyTransaction({
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
        const missingResult = store.applyTransaction({
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

      // Close the named InstallationComponent rows (FR-014/FR-015) and, once nothing remains
      // open, the Installation itself.
      for (const c of input.components) {
        const row = store.installationComponents.find(
          (r) => r.installation === installation.id && r.asset === c.assetId && r.end === null
        );
        if (row) {
          row.end = recoveryDate;
          row.closedbyline = closedByAsset.get(c.assetId) ?? null;
        }
      }
      const stillOpen = store.installationComponents.filter((r) => r.installation === installation.id && r.end === null);
      if (stillOpen.length === 0 && !installation.end) {
        installation.end = recoveryDate;
        installation.closedbytransaction = primaryResult && primaryResult.ok ? primaryResult.transactionId : null;
      }
      store.persist();

      return primaryResult!;
    },

    async submitComponentSwap(input: ComponentSwapInput): Promise<SubmissionOutcome> {
      await store.ready;
      const user = await getCurrentUser();

      // FR-007 idempotency — see submitDeployment's identical guard.
      if (store.processedClientSubmissionIds.has(input.clientSubmissionId)) {
        const existing = store.transactions.find((t) => t.notes?.includes(input.clientSubmissionId));
        if (existing) return { ok: true, transactionId: existing.id, transactionName: existing.name };
      }

      if (!input.reason?.trim()) {
        return { ok: false, reason: "A reason is required to swap a component." };
      }
      const installation = store.installations.find((i) => i.id === input.installationId);
      if (!installation) {
        return { ok: false, reason: `Unknown installation ${input.installationId}.` };
      }
      if (installation.end) {
        return { ok: false, reason: `Installation ${input.installationId} is already closed.` };
      }
      if (input.outgoingAssetId === installation.primaryasset) {
        return { ok: false, reason: "Swapping the primary data logger is not supported — recover and redeploy the station instead." };
      }
      const outgoingRow = store.installationComponents.find(
        (r) => r.installation === installation.id && r.asset === input.outgoingAssetId && r.end === null
      );
      if (!outgoingRow) {
        return { ok: false, reason: "recover.error.notInstalled", offendingAssetId: input.outgoingAssetId };
      }
      if (requiresOrientation(input.kitRole) && !input.orientation) {
        return { ok: false, reason: "deploy.error.orientationRequired", offendingAssetId: input.incomingAssetId };
      }
      const incoming = store.assets.get(input.incomingAssetId);
      if (!incoming) {
        return { ok: false, reason: `Unknown asset ${input.incomingAssetId}.`, offendingAssetId: input.incomingAssetId };
      }
      const incomingOk = incoming.status === "Available" || incoming.custodian === user.upn;
      if (!incomingOk) {
        return { ok: false, reason: "swap.error.incomingUnavailable", offendingAssetId: input.incomingAssetId };
      }

      const effectiveDate = input.effectiveDate || nowIso();

      // FR-024: outgoing is recovered (Deployed -> CheckedOut, into the swapping user's custody —
      // deriveState.ts's Undeploy case handles this directly, see this file's header note).
      const undeployResult = store.applyTransaction({
        clientSubmissionId: input.clientSubmissionId,
        transactiontype: "Undeploy",
        performedby: user.upn,
        date: effectiveDate,
        touser: user.upn,
        notes: input.reason,
        lines: [{ assetId: input.outgoingAssetId }],
      });
      if (!undeployResult.ok) return undeployResult;

      // incoming is deployed into the same station, same site/project, same effective date.
      const deployResult = store.applyTransaction({
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

      const alreadyRecorded = store.installationComponents.some((r) => r.openedbyline === deployResult.transactionId);
      if (!alreadyRecorded) {
        outgoingRow.end = effectiveDate;
        outgoingRow.closedbyline = undeployResult.transactionId;
        store.installationComponents.push({
          id: newId("instcomp"),
          installation: installation.id,
          asset: input.incomingAssetId,
          kitrole: input.kitRole,
          orientation: input.orientation ?? null,
          start: effectiveDate,
          end: null,
          openedbyline: deployResult.transactionId,
          closedbyline: null,
        });
        // FR-026: installation.start is untouched — only the component rows change.
        store.persist();
      }

      return deployResult;
    },

    async submitConfigurationChange(input: ConfigurationChangeInput): Promise<SubmissionOutcome> {
      await store.ready;
      const hasChange = Boolean(
        input.orientationChanges?.length || input.powersource || input.position !== undefined || input.toproject
      );
      if (!hasChange) {
        return { ok: false, reason: "config.error.noChange" };
      }
      const installation = store.installations.find((i) => i.id === input.installationId);
      if (!installation) {
        return { ok: false, reason: `Unknown installation ${input.installationId}.` };
      }
      if (installation.end) {
        return { ok: false, reason: `Installation ${input.installationId} is already closed.` };
      }
      if (!input.reason?.trim()) {
        return { ok: false, reason: "A reason is required to change a live installation's configuration." };
      }

      const user = await getCurrentUser();
      const effectiveDate = input.effectiveDate || nowIso();
      const openRows = store.installationComponents.filter((c) => c.installation === installation.id && c.end === null);

      for (const oc of input.orientationChanges ?? []) {
        if (!openRows.some((r) => r.asset === oc.assetId)) {
          return { ok: false, reason: "recover.error.notInstalled", offendingAssetId: oc.assetId };
        }
      }

      // NOTE for the orchestrator: moving a live installation to a new project (FR-027) updates
      // Installation.project (transaction detail, written directly — see header comment) but
      // canNOT also update Asset.currentproject through deriveState: the generated state machine
      // has no transaction type valid from "Deployed" that carries a project ("Transfer" — the
      // only type deriveState maps toproject through — is not listed under "Deployed" in
      // data/reference/state_machine.json; only Return/Undeploy/ReportFault/MarkMissing/Audit
      // are). Recorded here rather than worked around by writing asset.currentproject directly,
      // which would be a Principle I violation of exactly the kind AGENT-BRIEF warns against.
      // Fix requires either adding "Transfer": "Deployed" to the JSON (regenerate
      // domain/stateMachine.ts) or a dedicated transaction type — a call for the orchestrator, not
      // this workstream acting alone on shared/generated files.
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

      // Captured BEFORE calling applyTransaction, which itself flips this to `true` — the only
      // reliable way to tell a fresh submission from a retried clientSubmissionId, since a retry
      // returns `ok: true` too (applyTransaction's own idempotency guard, FR-007) and must not
      // re-apply the Installation/InstallationComponent field writes a second time.
      const wasAlreadyProcessed = store.processedClientSubmissionIds.has(input.clientSubmissionId);

      // Recorded as an Audit transaction (Deployed -> Deployed, no status change) so the change
      // has a dated, immutable line of its own — FR-025/FR-026: never an in-place edit with no
      // trace, and the installation's start date is never touched.
      const result = store.applyTransaction({
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

      if (!wasAlreadyProcessed) {
        if (input.powersource) installation.powersource = input.powersource;
        if (input.position !== undefined) installation.position = input.position;
        if (input.toproject) installation.project = input.toproject;
        for (const oc of input.orientationChanges ?? []) {
          const row = store.installationComponents.find(
            (r) => r.installation === installation.id && r.asset === oc.assetId && r.end === null
          );
          if (row) row.orientation = oc.orientation;
        }
        store.persist();
      }

      return result;
    },

    async listSites(onlyCurrent?: boolean): Promise<Location[]> {
      await store.ready;
      const siteNames = new Set(store.installations.map((i) => i.site));
      let sites = store.locations.filter((l) => l.locationtype === "Site" && siteNames.has(l.name));
      if (onlyCurrent) {
        const currentSiteNames = new Set(store.installations.filter((i) => i.end === null).map((i) => i.site));
        sites = sites.filter((l) => currentSiteNames.has(l.name));
      }
      return sites;
    },

    async getSiteInstallations(site: string): Promise<Installation[]> {
      await store.ready;
      return store.installations.filter((i) => i.site === site).sort((a, b) => (a.start < b.start ? 1 : -1));
    },

    async getInstallationSnapshot(installationId: string, asOf: string) {
      await store.ready;
      const installation = store.installations.find((i) => i.id === installationId);
      if (!installation) return null;
      const components = store.installationComponents.filter((c) => c.installation === installationId);
      const atDate = componentsAsOf(components, asOf);
      return {
        installation,
        components: atDate.map((c) => ({ asset: c.asset, kitrole: c.kitrole, orientation: c.orientation })),
        asOf,
      };
    },

    async getAssetInstallations(assetId: string): Promise<Installation[]> {
      await store.ready;
      const instIds = new Set(store.installationComponents.filter((c) => c.asset === assetId).map((c) => c.installation));
      return store.installations.filter((i) => instIds.has(i.id)).sort((a, b) => (a.start < b.start ? 1 : -1));
    },
  };
}
