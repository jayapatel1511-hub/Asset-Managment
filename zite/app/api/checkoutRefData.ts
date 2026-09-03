// MIRROR of apps/englobe-ams-field/src/api/checkoutRefData.ts — see zite/README.md.
import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';

/**
 * Pickers for S04 Checkout: Active projects, and the people a checkout can be assigned to.
 *
 * On people — there is deliberately NO staff table. docs/17 D1, answered by Jay on
 * 2026-09-03: "attributes of existing staff only", because identity lives in Entra and
 * the app cannot mint one. In production this list comes from the directory. In this
 * test environment the nearest honest stand-in is the set of custodians the synthetic
 * fleet already records, so the picker is real data rather than an invented roster.
 */
export default createEndpoint({
  description: 'Reference data for the checkout form: active projects and assignable people',
  inputSchema: z.object({}),
  outputSchema: z.object({
    projects: z.array(z.object({ id: z.string(), label: z.string() })),
    people: z.array(z.string()),
  }),
  execute: async () => {
    const projects = await zite.projects.findAll({ filters: { status: 'Active' }, limit: 500 });

    const people = await zite.sql({
      query: `SELECT DISTINCT "custodian" AS person
              FROM "Assets"
              WHERE "custodian" IS NOT NULL AND "custodian" <> ''
              ORDER BY 1`,
    });

    return {
      projects: projects.records
        .map(p => ({ id: p.id, label: `${p.projectNumber ?? ''} — ${p.projectName ?? ''}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      people: people.rows.map(r => String(r.person)),
    };
  },
});
