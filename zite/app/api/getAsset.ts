// MIRROR of apps/englobe-ams-field/src/api/getAsset.ts — see zite/README.md.
import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { loadRefMaps, shapeAsset, linkId, type AssetRow } from '../lib/assetRead';
import { assetRowSchema } from '../lib/schemas';

/**
 * S03 Asset detail (docs/12 5.3) — where it is, who has it, status, next calibration due.
 *
 * The action list is computed server-side from the state machine
 * (data/reference/state_machine.json), not asserted by the browser. The Field slice
 * only implements Checkout, so that is the only action returned; the rest of the
 * matrix in docs/12 5.3 belongs to workflows out of scope here.
 */
export default createEndpoint({
  description: 'Get one asset by its canonical Asset ID, with resolved reference names',
  inputSchema: z.object({ assetId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    asset: assetRowSchema.optional(),
    canCheckout: z.boolean(),
    children: z.array(z.object({ id: z.string(), assetId: z.string(), status: z.string() })),
  }),
  // Annotated so the not-found branch does not erase `asset` from the client type.
  execute: async ({ input }): Promise<{
    found: boolean;
    asset?: AssetRow;
    canCheckout: boolean;
    children: { id: string; assetId: string; status: string }[];
  }> => {
    const rec = await zite.assets.findOne({ filters: { assetId: input.assetId } });
    if (!rec) return { found: false, canCheckout: false, children: [] };

    const maps = await loadRefMaps();

    // Resolve the parent's human-readable Asset ID (the link field holds a UUID).
    let parentAssetId: string | undefined;
    const parentId = linkId(rec.parentAsset);
    if (parentId) {
      const parent = await zite.assets.findOne({ id: parentId });
      parentAssetId = parent?.assetId;
    }

    // "Attached items" — assets whose parent is this one.
    const kids = await zite.assets.findAll({ filters: { parentAsset: rec.id }, limit: 100 });

    return {
      found: true,
      asset: shapeAsset(rec, maps, parentAssetId),
      // The state machine allows Checkout only from Available. This is the same rule
      // the write path re-checks; the UI just gets an earlier hint.
      canCheckout: rec.status === 'Available',
      children: kids.records.map(k => ({ id: k.id, assetId: k.assetId ?? '', status: k.status ?? '' })),
    };
  },
});
