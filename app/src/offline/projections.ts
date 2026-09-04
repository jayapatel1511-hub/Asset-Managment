/**
 * What is allowed to reach the device cache — WS-W6's "asset/reference cache projections", and
 * the enforcement point for CLAUDE.md's offline rule "Cache only approved projections, never
 * unrestricted API rows", rule 10 (no restricted SIM/network fields for Field Users) and rule 11
 * (no certificate bytes in the browser).
 *
 * THE STRUCTURAL POINT — read this before adding a field:
 *
 *   `toAssetProjection` builds its result by naming every field, one at a time. It never spreads
 *   an `Asset`. That is the whole design: `Asset` is a shared type that other lanes edit, and the
 *   day someone adds `eng_asset.pin` or `contractRate` to it, a spread would put that on 1,026
 *   phones without anyone deciding to. Explicit construction makes the cache a *decision* rather
 *   than a default. `ASSET_PROJECTION_FIELDS` is the named place that decision is recorded.
 *
 *   `assertCacheSafe` is the second line: a runtime deep scan, run on *every* write in
 *   projections/drafts/commands, that refuses a payload carrying a restricted key name or binary
 *   content no matter which code path produced it. Belt and braces on purpose — the projection
 *   function protects the paths we wrote, the assertion protects the ones somebody adds later.
 *
 * WHY `identifiervalue` / `phonenumber` / `staticip` SPECIFICALLY:
 *   Those are api/types.ts's three field-secured attributes (FR-030, Principle VII) — the ICCID,
 *   the SIM's phone number and the static IP. `app/scripts/scan-bundle.mjs` already fails a
 *   release build that ships them; this is the same rule applied to the copy that would otherwise
 *   sit on a phone for months. `carrier` is not on FR-030's list but is excluded from the field
 *   projection anyway: it is SIM/network metadata and no phone workflow needs it.
 *
 * WHY NO CERTIFICATE BYTES:
 *   Rule 11 — production documents are private, and "no broad storage credential reaches the
 *   browser". A cached PDF is the credential-free version of the same leak, and it survives
 *   sign-out. Calibration *dates* are cacheable facts; the certificate is not.
 */
import type { Asset } from "../api/types";

/**
 * Field-secured attributes (api/types.ts, FR-030). Never cached, for any role — an Office Admin's
 * phone is still a phone that can be lost, and the offline cache has no server-side authorization
 * check to re-run when it is read.
 */
export const RESTRICTED_FIELDS: readonly string[] = ["identifiervalue", "phonenumber", "staticip"];

/** Key names that carry document bytes or a document credential (rule 11). */
export const DOCUMENT_FIELD_PATTERN = /certificate|blob|sas|signature|attachment/i;

export type ProjectionKind = "asset" | "location" | "project" | "equipmentModel";

export interface ProjectionRow<T = unknown> {
  /** Compound primary key with `id` — see db.ts. */
  kind: ProjectionKind;
  id: string;
  /** Partition stamp. Redundant with the database name, and deliberately so: a row that somehow
   * ends up in the wrong database is detectable rather than merely unlikely. */
  partition: string;
  /** When this projection was taken from the server, for staleness display. */
  cachedAt: string;
  value: T;
}

/**
 * The asset fields the Field surface may hold offline.
 *
 * Chosen against REMAINING-WORK.md's phone slice — find, check out, return, transfer, report
 * fault, deploy/recover, reserve. Everything here answers "is this the right asset, and may I act
 * on it". `notes` is excluded: unbounded operator free text has no classification, and an
 * unclassified string is not an approved projection (CLAUDE.md rule 18 — every production field
 * needs a definition, classification and offline rule before it ships).
 */
export const ASSET_PROJECTION_FIELDS = [
  "assetid",
  "manufacturer",
  "model",
  "equipmenttype",
  "serialnumber",
  "homeoffice",
  "lifecycle",
  "status",
  "currentlocation",
  "custodian",
  "currentproject",
  "parentasset",
  "lastcaldate",
  "nextcaldue",
] as const;

export type AssetProjectionField = (typeof ASSET_PROJECTION_FIELDS)[number];

export type AssetProjection = {
  readonly [K in AssetProjectionField]: K extends "assetid" | "manufacturer" | "model" | "equipmenttype" ? string : string | null;
};

/**
 * Narrow an API asset to the approved offline projection.
 *
 * Note what is NOT here: `id` (the server's GUID — the phone addresses assets by their canonical
 * Asset ID, rule 6), `notes`, `carrier`, the three restricted fields, `retirementreason`,
 * `migrationsource`, and `pendingSync` (a client-side display flag; caching it would persist a
 * stale "pending" badge past the replay that cleared it).
 */
export function toAssetProjection(asset: Asset): AssetProjection {
  return {
    assetid: asset.assetid,
    manufacturer: asset.equipmentmodel.manufacturer,
    model: asset.equipmentmodel.model,
    equipmenttype: asset.equipmentmodel.equipmenttype,
    serialnumber: asset.serialnumber,
    homeoffice: asset.homeoffice,
    lifecycle: asset.lifecycle,
    status: asset.status,
    currentlocation: asset.currentlocation,
    custodian: asset.custodian,
    currentproject: asset.currentproject,
    parentasset: asset.parentasset,
    lastcaldate: asset.lastcaldate,
    nextcaldue: asset.nextcaldue,
  };
}

/** Thrown instead of writing. Never carries the offending *value* — see scan-bundle.mjs's rule
 * that a guard which echoes what it found becomes the leak. */
export class RestrictedFieldError extends Error {
  constructor(readonly field: string, readonly path: string) {
    super(`Refusing to cache "${path}": ${field} is restricted and must never be written to device storage.`);
    this.name = "RestrictedFieldError";
  }
}

const BINARY_TYPES = ["Blob", "File", "ArrayBuffer", "Uint8Array", "DataView"];

function binaryKind(value: unknown): string | null {
  if (value instanceof ArrayBuffer) return "ArrayBuffer";
  if (ArrayBuffer.isView(value)) return "TypedArray";
  const ctor = (value as { constructor?: { name?: string } } | null)?.constructor?.name;
  return ctor && BINARY_TYPES.includes(ctor) ? ctor : null;
}

/**
 * Deep-scan a value about to be written to device storage and throw if it carries anything rule
 * 10 or rule 11 forbids. Runs on every offline write.
 *
 * Cost is proportional to the payload, and payloads here are a handful of small objects — a
 * projection row or one queued command. That is a fair price for a guarantee that does not depend
 * on every future call site remembering the rule.
 */
export function assertCacheSafe(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;

  const binary = binaryKind(value);
  if (binary) throw new RestrictedFieldError(binary, path);

  if (typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCacheSafe(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    const lowered = key.toLowerCase();
    if (RESTRICTED_FIELDS.includes(lowered)) throw new RestrictedFieldError(key, childPath);
    // A null certificateurl is a fact ("there is no certificate"); a populated one is a document
    // handle we refuse to persist. Rule 11 is about the bytes and the credential, not the absence.
    if (DOCUMENT_FIELD_PATTERN.test(key) && child !== null && child !== undefined && child !== "") {
      throw new RestrictedFieldError(key, childPath);
    }
    assertCacheSafe(child, childPath);
  }
}

/** True when a value can be cached. For a caller that wants to skip rather than fail. */
export function isCacheSafe(value: unknown): boolean {
  try {
    assertCacheSafe(value);
    return true;
  } catch {
    return false;
  }
}
