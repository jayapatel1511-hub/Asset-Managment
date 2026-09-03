/**
 * Display helpers for values that are enums in the data and prose on screen —
 * `docs/12-ui-spec.md` gap G-09: "DataLogger", "SoundLevelMeter" and "CheckedOut → Deployed" leak
 * the schema onto a technician's phone.
 *
 * These are deliberately NOT keys in `en.json`. FR-031 requires every user-facing *label* to come
 * from the string table, and these are not labels — they are transformations of data values whose
 * set is open: `equipmenttype` and `assetgroup` come from `data/reference/equipment_models.csv`
 * and grow whenever the catalogue does, so a fixed key per value would silently fall back to the
 * raw enum for every new model. A French locale overrides these functions rather than adding
 * seventeen keys that would be stale by the next catalogue import.
 *
 * Status names are the one closed set here, and `components/StatusPill.tsx` already has keys for
 * them; `statusLabel` is for the places that render a status inline in a sentence, where the
 * pill's styling would be wrong.
 *
 * **Acronyms are why this is not a one-line regex.** The real data contains `SWO`, `VWReadout`,
 * `MEMSSensor` and `HDCamera`, and a naive camelCase split plus lower-casing turns those into
 * "Swo", "Vw readout", "Mems sensor" and "Hd camera". Tokenising first and leaving all-caps runs
 * alone is what makes them read correctly. `tests/i18n/humanise.test.ts` pins every one of those
 * cases against the values actually present in `migration/staged/`.
 */

/** Splits a PascalCase/camelCase identifier into words, keeping runs of capitals together:
 * "VWReadout" → ["VW", "Readout"], "MEMSSensor" → ["MEMS", "Sensor"], "SWO" → ["SWO"]. */
function tokenise(value: string): string[] {
  return value.match(/[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+/g) ?? [value];
}

/** An all-caps run of two or more letters is an acronym and keeps its case. */
function isAcronym(token: string): boolean {
  return token.length >= 2 && token === token.toUpperCase() && /[A-Z]/.test(token);
}

/**
 * "DataLogger" → "Data logger", "SoundLevelMeter" → "Sound level meter",
 * "VWReadout" → "VW readout", "SWO" → "SWO", "CheckedOut" → "Checked out".
 *
 * A value that already contains a space is prose, not an identifier, and is returned untouched —
 * office names ("Stoney Creek") and the catalogue's own long-form manufacturer strings
 * ("N/A (service, not a manufactured unit)") must survive this function unchanged.
 */
export function humaniseEnum(value: string): string {
  if (!value || value.includes(" ")) return value;
  const tokens = tokenise(value);
  return tokens
    .map((token, i) => {
      if (isAcronym(token)) return token;
      const lower = token.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** An equipment type or asset group, as it should appear in a list header or a subtitle. */
export function equipmentTypeLabel(equipmenttype: string): string {
  return humaniseEnum(equipmenttype);
}

/** A status as it should appear inline in a sentence — "Checked out", not "CheckedOut". */
export function statusLabel(status: string): string {
  return humaniseEnum(status);
}
