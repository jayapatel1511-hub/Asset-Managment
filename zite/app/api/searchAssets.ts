// MIRROR of apps/englobe-ams-field/src/api/searchAssets.ts — see zite/README.md.
import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { loadRefMaps, shapeAsset } from '../lib/assetRead';
import { assetRowSchema } from '../lib/schemas';

/**
 * S01 Search (docs/12 5.1) — by Asset ID, serial, or model name, minimum 3 characters.
 *
 * The 3-character floor is enforced HERE as well as in the input, not only in the
 * browser: CLAUDE.md rule 1 says the browser owns no business authority, and that
 * includes not being trusted to decide when a query is cheap enough to run.
 */
export default createEndpoint({
  description: 'Search assets by Asset ID, serial number, or model name (minimum 3 characters)',
  inputSchema: z.object({
    query: z.string(),
  }),
  outputSchema: z.object({
    tooShort: z.boolean(),
    total: z.number(),
    groups: z.array(z.object({
      label: z.string(),
      count: z.number(),
      assets: z.array(assetRowSchema),
    })),
  }),
  execute: async ({ input }) => {
    const q = input.query.trim();
    if (q.length < 3) return { tooShort: true, total: 0, groups: [] };

    const maps = await loadRefMaps();

    // Model-name matching first: find the models whose name/manufacturer/model
    // contains the query, then the assets pointing at them.
    const modelIds: string[] = [];
    for (const [id, m] of maps.models) {
      const hay = `${m.name} ${m.manufacturer} ${m.model}`.toLowerCase();
      if (hay.includes(q.toLowerCase())) modelIds.push(id);
    }

    // findAll filters are AND-only, so the three ways of matching are three queries
    // unioned by record id rather than one OR.
    const queries: Promise<{ records: any[] }>[] = [
      zite.assets.findAll({ filters: { assetId: { contains: q } }, limit: 200 }),
      zite.assets.findAll({ filters: { serialNumber: { contains: q } }, limit: 200 }),
    ];
    if (modelIds.length) {
      queries.push(zite.assets.findAll({ filters: { equipmentModel: { in: modelIds } }, limit: 500 }));
    }
    const results = await Promise.all(queries);

    const byId = new Map<string, any>();
    for (const r of results) for (const rec of r.records) byId.set(rec.id, rec);

    const rows = [...byId.values()]
      .map(r => shapeAsset(r, maps))
      .sort((a, b) => a.assetId.localeCompare(b.assetId));

    // Grouped by equipment type, groups in order of first appearance (docs/12 5.1).
    const order: string[] = [];
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!grouped.has(row.equipmentType)) { grouped.set(row.equipmentType, []); order.push(row.equipmentType); }
      grouped.get(row.equipmentType)!.push(row);
    }

    return {
      tooShort: false,
      total: rows.length,
      groups: order.map(label => ({ label, count: grouped.get(label)!.length, assets: grouped.get(label)! })),
    };
  },
});
