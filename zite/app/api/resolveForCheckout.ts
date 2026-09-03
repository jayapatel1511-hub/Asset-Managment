// MIRROR of apps/englobe-ams-field/src/api/resolveForCheckout.ts — see zite/README.md.
import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { loadRefMaps, shapeAsset, type AssetRow } from '../lib/assetRead';
import { assetRowSchema } from '../lib/schemas';
import { refuseAdd } from '../lib/checkoutRules';

/**
 * Add-by-ID for S04 (docs/12 5.5, component C11). EXACT Asset ID only — not fuzzy.
 *
 * This is the FIRST of the two refusal layers CLAUDE.md demands. It exists so the
 * technician finds out at the moment of adding, rather than after filling the whole
 * form. It is a convenience, not the control: submitCheckout re-checks independently,
 * because between adding and submitting somebody else may have taken the asset.
 *
 * Refusal is returned as ok:false with a readable reason, never thrown — see
 * server/README.md "The refusal contract".
 */
export default createEndpoint({
  description: 'Validate one Asset ID for the checkout cart: it must exist and be Available',
  inputSchema: z.object({ assetId: z.string() }),
  // Inline, not spread — see the note in submitCheckout.ts.
  outputSchema: z.object({
    ok: z.boolean(),
    reason: z.string().optional(),
    offendingAssetId: z.string().optional(),
    asset: assetRowSchema.optional(),
  }),
  // Annotated for the same reason as submitCheckout: the client type comes from the
  // return type, and an un-annotated union would hide either `reason` or `asset`.
  execute: async ({ input }): Promise<{
    ok: boolean;
    reason?: string;
    offendingAssetId?: string;
    asset?: AssetRow;
  }> => {
    const wanted = input.assetId.trim();
    if (!wanted) return { ok: false, reason: 'Enter an Asset ID.' };

    const rec = await zite.assets.findOne({ filters: { assetId: wanted } });

    const refusal = refuseAdd(rec, wanted);
    if (refusal) return { ok: false, ...refusal };

    const maps = await loadRefMaps();
    // refuseAdd already returned for the undefined case; TS cannot see that through
    // the helper's return type, hence the assertion.
    return { ok: true, asset: shapeAsset(rec!, maps) };
  },
});
