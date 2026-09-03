// MIRROR of apps/englobe-ams-field/src/lib/checkoutRules.ts in the Zite workspace repo.
// The Zite copy is the one that runs; this is here so the rules stay reviewable in this
// repository after the 14-day trial lapses. See zite/README.md.
//
// The checkout decision, as pure functions.
//
// Kept out of the endpoint bodies on purpose, mirroring how app/ and server/ both
// import app/src/domain/deriveState.ts rather than each restating the rules: logic
// that decides whether a business event is allowed should be callable without a
// transport around it, so it can be exercised directly. The endpoints in src/api/
// are thin wrappers over these.
//
// No zitejs import here — this file is pure.

export type AssetLike = {
  id: string;
  assetId?: string;
  status?: string;
  custodian?: string;
};

export type Refusal = { reason: string; offendingAssetId?: string };

/**
 * data/reference/state_machine.json: Checkout appears only under "Available".
 * Every other status has no Checkout entry, which is what makes this a refusal
 * rather than a preference.
 */
export const CHECKOUT_ALLOWED_FROM = 'Available';

/** Layer 1 — adding to the cart (docs/12 5.5, cart.refusedNotAvailable). */
export function refuseAdd(rec: AssetLike | undefined, wantedId: string): Refusal | null {
  if (!rec) return { reason: `No asset found for "${wantedId}".` };
  if (rec.status !== CHECKOUT_ALLOWED_FROM) {
    const custodian = rec.custodian && rec.custodian.length ? rec.custodian : 'nobody';
    return {
      offendingAssetId: rec.assetId,
      reason: `${rec.assetId} is ${rec.status}, held by ${custodian} — can't add it.`,
    };
  }
  return null;
}

/**
 * Layer 2 — submitting (docs/12 5.5, cart.changedSinceAdded). Same rule, different
 * copy, because by now the technician was already told it was addable and the
 * interesting fact is that something moved underneath them.
 */
export function refuseSubmit(rec: AssetLike | undefined, wantedId: string): Refusal | null {
  if (!rec) return { reason: `No asset found for "${wantedId}".`, offendingAssetId: wantedId };
  if (rec.status !== CHECKOUT_ALLOWED_FROM) {
    return {
      offendingAssetId: rec.assetId,
      reason: `${rec.assetId} changed since you added it — nothing was submitted.`,
    };
  }
  return null;
}

/**
 * The state a Checkout line derives, from app/src/domain/deriveState.ts:
 *
 *   case "Checkout": custodian = touser, currentproject = toproject, currentlocation = null
 *
 * currentLocation is CLEARED rather than left at the office. The comment in
 * deriveState puts it best: the item has left, and claiming it is still at the office
 * is exactly the dishonesty the derived-state rule exists to remove.
 */
export function checkoutPatch(projectId: string, assignedTo: string) {
  return {
    status: 'CheckedOut',
    custodian: assignedTo,
    currentProject: [projectId],
    currentLocation: null,
  };
}
