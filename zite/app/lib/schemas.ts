// MIRROR of apps/englobe-ams-field/src/lib/schemas.ts — see zite/README.md.
// Shared zod shapes. Pure schema only — no zitejs/db import, so this is safe
// for both endpoint and (type-only) frontend use.
import { z } from 'zod';

export const assetRowSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  serialNumber: z.string(),
  status: z.string(),
  lifecycle: z.string(),
  custodian: z.string(),
  equipmentType: z.string(),
  assetGroup: z.string(),
  modelLabel: z.string(),
  homeOffice: z.string(),
  currentLocation: z.string(),
  currentProject: z.string(),
  parentAsset: z.string(),
  lastCalDate: z.string(),
  nextCalDue: z.string(),
  notes: z.string(),
  dataOrigin: z.string(),
  overdue: z.boolean(),
  daysOverdue: z.number().optional(),
  temporaryTag: z.boolean(),
});

/**
 * The refusal contract, carried over from server/README.md.
 *
 * A refusal is a BUSINESS ANSWER, not a transport failure: the endpoint resolves
 * with ok:false and a reason the technician can read, rather than throwing. That
 * distinction is what lets an offline queue tell "the server said no" (stop, show
 * the reason) apart from "the request never arrived" (retry). Throwing here would
 * collapse the two.
 *
 * NOTE: do not spread this into an endpoint's outputSchema — the SDK generator
 * resolves outputSchema statically and silently drops fields that arrive via an
 * imported spread. Declare them inline. Kept here as the written contract.
 */
export const refusalFields = {
  ok: z.boolean(),
  reason: z.string().optional(),
  offendingAssetId: z.string().optional(),
};
