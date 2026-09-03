// MIRROR of apps/englobe-ams-field/src/strings.ts — see zite/README.md.
//
// UI copy. Taken verbatim from app/src/i18n/en.json and docs/12-ui-spec.md so the
// Zite test environment says exactly what the specified Field surface says.
// Do not paraphrase these — the specification is the source of truth.

export const S = {
  // S01 Search / Home (docs/12 5.1)
  'search.placeholder': 'Search Asset ID, serial, or model…',
  'search.minChars': 'Type at least 3 characters to search.',
  'search.noResults': 'Nothing matched "{query}".',
  'search.searchByModelInstead': 'Search by model instead',
  'search.filter.myEquipment': 'My equipment',
  'search.filter.availableHere': 'Available here',
  'search.filter.calDue30': 'Cal due ≤ 30d',

  // S03 Asset detail (docs/12 5.3)
  'asset.overdue': 'OVERDUE',
  'asset.retired': 'Retired',
  'asset.temporaryTag': 'Temporary tag — needs completion',
  'asset.calOverdue': 'Calibration overdue',
  'asset.location': 'Location',
  'asset.custodian': 'Custodian',
  'asset.project': 'Project',
  'asset.homeOffice': 'Home office',
  'asset.parent': 'Parent asset',
  'asset.nextCalDue': 'Next calibration due',
  'asset.lastCalDate': 'Last calibrated',
  'asset.notes': 'Notes',
  'asset.noCustodian': 'Unknown — not yet returned in the pilot sweep',
  'asset.actions.checkout': 'Checkout',
  'asset.actions.notAllowed': 'Not available from {status}',
  'asset.notFound': 'No asset found for "{query}".',

  // S04 Checkout (docs/12 5.5)
  'checkout.title': 'Checkout',
  'checkout.project': 'Project',
  'checkout.projectRequired': 'A project is required.',
  'checkout.assignedTo': 'Assigned to',
  'checkout.expectedReturn': 'Expected return (optional)',
  'checkout.notes': 'Notes',
  'cart.title': 'Cart',
  'cart.empty': 'Add assets by scanning or searching.',
  'cart.remove': 'Remove',
  'cart.primary': 'Primary',
  'cart.refusedNotAvailable': "{assetId} is {status}, held by {custodian} — can't add it.",
  'cart.submit': 'Submit',
  'cart.submitting': 'Submitting…',
  'cart.changedSinceAdded': '{assetId} changed since you added it — nothing was submitted.',

  // Common
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.none': 'None',
  'common.unknown': 'Unknown',
} as const;

/** Fill {placeholders}. Missing keys are left visible rather than silently blanked. */
export function t(key: keyof typeof S, vars?: Record<string, string>): string {
  let out: string = S[key];
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** docs/12 2.5 — the seven statuses and their display labels. */
export const STATUS_LABEL: Record<string, string> = {
  Available: 'Available',
  CheckedOut: 'Checked out',
  Deployed: 'Deployed',
  InCalibration: 'In calibration',
  NeedsRepair: 'Needs repair',
  Missing: 'Missing',
  Retired: 'Retired',
};
