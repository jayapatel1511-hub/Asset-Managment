/**
 * Asset ID minting and parsing — feature 001 FR-001, FR-002, FR-004, FR-006, FR-007.
 *
 * Constitution Principle III: the Asset ID is a human-readable, unique, immutable TAG, not the
 * primary key (the Dataverse GUID is). It never encodes office, project, custodian or status.
 *
 * Minting rule (docs/01-data-model.md):
 *   serialised:     {model.idprefix}-{serial}         DL-UM-16984, GEO-V12-30220, SLM-S50-13595
 *   non-serialised: {model.idprefix}-{seq:04}          DST-0246, AC-0012, SRV-0016
 *   untagged/tmp:   TMP-{seq:04}
 *
 * A serial that already embeds the prefix's own trailing letters (UM16984, BE18794) keeps only
 * the digits after the prefix: DL-UM-16984, never DL-UM-UM16984. migration/02_clean.py's
 * `mint_serialised_id` implements the identical rule in Python for the historical import; this
 * is the one the running app uses for every NEW asset from here on (FR-006).
 */

export interface MintableModel {
  idprefix: string;
  isserialised: boolean;
}

/** Strips a manufacturer code the serial already embeds, if it repeats the prefix's own
 * trailing segment (e.g. prefix "GEO-UM" + serial "UM16984" -> "16984"). */
export function stripEmbeddedPrefixCode(prefix: string, serial: string): string {
  const trimmed = serial.trim();
  const lastSegment = prefix.split("-").at(-1) ?? "";
  if (
    lastSegment.length > 0 &&
    trimmed.toUpperCase().startsWith(lastSegment.toUpperCase()) &&
    trimmed.length > lastSegment.length
  ) {
    return trimmed.slice(lastSegment.length);
  }
  return trimmed;
}

/** FR-006: mint a serialised asset's tag. Throws if serial is blank — call mintSequenced instead. */
export function mintSerialisedId(prefix: string, serial: string): string {
  const cleanSerial = serial.trim();
  if (!cleanSerial) {
    throw new Error("mintSerialisedId requires a non-blank serial; use mintSequencedId for non-serialised models.");
  }
  return `${prefix}-${stripEmbeddedPrefixCode(prefix, cleanSerial)}`;
}

/** FR-006/FR-007: mint a non-serialised (or untagged-temporary) asset's tag from the next
 * sequence value for its prefix. The sequence value itself — guaranteeing it is issued to at
 * most one asset under concurrent creation (FR-007) — is the API layer's job (an atomic
 * increment against eng_idsequence / the mock store), not this pure function's. */
export function mintSequencedId(prefix: string, nextSequenceValue: number, padding = 4): string {
  if (!Number.isInteger(nextSequenceValue) || nextSequenceValue < 1) {
    throw new Error(`mintSequencedId requires a positive integer sequence value, got ${nextSequenceValue}`);
  }
  return `${prefix}-${String(nextSequenceValue).padStart(padding, "0")}`;
}

/** Mint the correct tag for a model, given a serial (may be blank for non-serialised models). */
export function mintAssetId(model: MintableModel, serial: string | null | undefined, nextSequenceValue: number): string {
  if (model.isserialised) {
    const s = (serial ?? "").trim();
    if (!s) {
      throw new Error("A serialised model requires a serial number to mint an Asset ID.");
    }
    return mintSerialisedId(model.idprefix, s);
  }
  return mintSequencedId(model.idprefix, nextSequenceValue);
}

export function mintTemporaryId(nextSequenceValue: number): string {
  return mintSequencedId("TMP", nextSequenceValue);
}

export interface ParsedAssetId {
  raw: string;
  prefix: string;
  suffix: string;
  isTemporary: boolean;
  isPrefixOnly: boolean;
}

/** Parses an Asset ID back into prefix/suffix. Never throws — a malformed or legacy tag
 * (blank, prefix-only like "GEO-") still needs to render on screen (edge case: "prefix-only
 * legacy tag ... must be findable and visibly flagged as needing completion"). */
export function parseAssetId(assetId: string): ParsedAssetId {
  const raw = assetId.trim();
  const isPrefixOnly = raw.endsWith("-");
  if (isPrefixOnly || raw === "") {
    return { raw, prefix: raw.replace(/-$/, ""), suffix: "", isTemporary: false, isPrefixOnly: true };
  }
  const lastDash = raw.lastIndexOf("-");
  if (lastDash === -1) {
    return { raw, prefix: raw, suffix: "", isTemporary: false, isPrefixOnly: false };
  }
  const prefix = raw.slice(0, lastDash);
  const suffix = raw.slice(lastDash + 1);
  return { raw, prefix, suffix, isTemporary: prefix === "TMP", isPrefixOnly: false };
}

export function isTemporaryAssetId(assetId: string): boolean {
  return parseAssetId(assetId).isTemporary;
}

export function isIncompleteAssetId(assetId: string): boolean {
  const parsed = parseAssetId(assetId);
  return parsed.isPrefixOnly || parsed.isTemporary;
}
