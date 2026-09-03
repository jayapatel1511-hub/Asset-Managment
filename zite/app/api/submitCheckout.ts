// MIRROR of apps/englobe-ams-field/src/api/submitCheckout.ts — see zite/README.md.
import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { refuseSubmit, checkoutPatch } from '../lib/checkoutRules';

/**
 * S04 Checkout — the write path. This is the SECOND and authoritative refusal layer.
 *
 * Three things this endpoint deliberately does, and one it deliberately cannot:
 *
 * 1. It re-reads every asset from the database and re-checks the transition itself.
 *    The browser's cart is a proposal. CLAUDE.md rule 1: the browser does not decide
 *    role, current state, previous state or next state. If anything moved between
 *    adding and submitting, nothing is written at all.
 *
 * 2. It refuses with ok:false rather than throwing (server/README.md), so an offline
 *    queue can tell a business "no" from a transport failure.
 *
 * 3. The state it writes is the state deriveState() derives for a Checkout line
 *    (app/src/domain/deriveState.ts): status CheckedOut, custodian = the assignee,
 *    currentProject = the project, and currentLocation CLEARED — the item has left,
 *    and claiming it is still at the office is exactly the dishonesty the derived-state
 *    rule exists to remove.
 *
 * WHAT IT CANNOT DO — and does not pretend to:
 *    Zite has no transaction. Verified 2026-09-03, see docs/18 2b: successive writes
 *    do not roll back when a later one fails. So a multi-asset checkout is applied one
 *    record at a time and CAN half-succeed. All validation is therefore done up front,
 *    which shrinks the window but does not close it; if a write still fails midway the
 *    response says exactly which assets were changed instead of reporting a clean
 *    failure. That honesty is the point — CLAUDE.md rule 2 is not satisfiable here.
 */
export default createEndpoint({
  description: 'Check out one or more Available assets to a project and a person',
  inputSchema: z.object({
    assetIds: z.array(z.string()).min(1),
    projectId: z.string(),
    assignedTo: z.string(),
    expectedReturn: z.string().optional(),
    notes: z.string().optional(),
    clientSubmissionId: z.string(),
  }),
  // The refusal contract is spelled out inline rather than spread in from a shared
  // object: the SDK generator resolves outputSchema statically, and silently drops
  // fields that arrive via an imported spread.
  outputSchema: z.object({
    ok: z.boolean(),
    reason: z.string().optional(),
    offendingAssetId: z.string().optional(),
    reference: z.string().optional(),
    appliedAssetIds: z.array(z.string()),
    partial: z.boolean(),
  }),
  // The generated client type is inferred from what execute RETURNS, not from
  // outputSchema. Without this annotation the inferred type is a union of the branches,
  // and the success branch has no `reason` — so the caller cannot read r.reason at all.
  // Annotating once keeps the refusal contract visible on the client.
  execute: async ({ input }): Promise<{
    ok: boolean;
    reason?: string;
    offendingAssetId?: string;
    reference?: string;
    appliedAssetIds: string[];
    partial: boolean;
  }> => {
    const none = { appliedAssetIds: [] as string[], partial: false };

    if (!input.projectId) return { ok: false, reason: 'A project is required.', ...none };
    if (!input.assignedTo) return { ok: false, reason: 'Assigned to is required.', ...none };

    const project = await zite.projects.findOne({ id: input.projectId });
    if (!project) return { ok: false, reason: 'That project no longer exists.', ...none };
    if (project.status !== 'Active') {
      return { ok: false, reason: `Project ${project.projectNumber} is ${project.status} — pick an active project.`, ...none };
    }

    // ---- Pass 1: validate everything. Write nothing yet. ----
    const toApply: { id: string; assetId: string }[] = [];
    for (const assetId of input.assetIds) {
      const rec = await zite.assets.findOne({ filters: { assetId } });
      const refusal = refuseSubmit(rec, assetId);
      if (refusal) return { ok: false, ...refusal, ...none };
      toApply.push({ id: rec!.id, assetId: rec!.assetId ?? assetId });
    }

    // ---- Pass 2: apply. One record at a time, because there is no transaction. ----
    const applied: string[] = [];
    for (const a of toApply) {
      try {
        await zite.assets.update({
          id: a.id,
          record: checkoutPatch(input.projectId, input.assignedTo) as any,
        });
        applied.push(a.assetId);
      } catch (e: any) {
        return {
          ok: false,
          offendingAssetId: a.assetId,
          reason:
            `Applied ${applied.length} of ${toApply.length} assets, then failed on ${a.assetId}: ` +
            `${String(e?.message ?? e)}. Zite has no transaction, so the earlier changes STAND. ` +
            `Fix ${a.assetId} and re-submit only the remainder.`,
          appliedAssetIds: applied,
          partial: applied.length > 0,
        };
      }
    }

    return {
      ok: true,
      // A display reference only. There is no transaction table in this environment
      // (docs/18 7a deferred history), so nothing about this checkout is recorded as an
      // append-only event — the asset rows simply now hold the new state.
      reference: input.clientSubmissionId.slice(0, 8).toUpperCase(),
      appliedAssetIds: applied,
      partial: false,
    };
  },
});
