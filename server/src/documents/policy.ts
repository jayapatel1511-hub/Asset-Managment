/**
 * Who may do what with a document, and what a document is allowed to be.
 *
 * AUTHORIZATION ON EVERY REQUEST — WS-W7 § owns "upload/download authorization", and the brief
 * states the principle it protects: *a document URL is never a capability by itself*. Every
 * function in `service.ts` that touches bytes takes a `CurrentUser` and calls into this file
 * first. There is no route, no path and no id that grants access on its own, because there is no
 * pre-signed link anywhere in this lane (see `blobStore.ts` § THE SAS QUESTION).
 *
 * THE FIELD-USER RULE, and why it is this strict. `specs/REMAINING-WORK.md` § WS-W6 rules:
 * "no restricted SIM/network fields **or certificate bytes** for Field Users". CLAUDE.md rule 10
 * says the same for the offline cache. So a Field User may see THAT a certificate exists — its
 * number, its scan state, whether it is current — and never receives the file. That is not a UI
 * decision: `getContent` refuses, so devtools, a copied URL and an offline cache all get the
 * same nothing, exactly as `readModel.applySensitiveFieldSecurity` does for ICCIDs.
 *
 * OFFICE SCOPE — ASSUMPTION A-R5. specs/_planning/BUILD-FREEZE.md froze it: "`OfficeAdmin` is
 * **office-scoped**; `SystemOwner` is **global**". Applied here by comparing the linked asset's
 * `homeoffice` to the caller's. Two honest caveats:
 *   - the POC `CurrentUser` has `homeoffice` and no `scopedOffices`, so one home office is the
 *     scope until the identity lane lands `auth/authorize.ts` and the frozen `CurrentUser`'s
 *     optional `scopedOffices`;
 *   - a document whose linked asset cannot be determined (a `Transaction` or `Other` link) has
 *     no office to scope by and falls back to the admin check alone.
 * This file is the seam: when `auth/authorize.ts` exists, `officeScopeAllows` delegates to it
 * and nothing else in the lane changes.
 *
 * NO EXISTENCE LEAK. An unauthorized caller gets `document.error.forbidden` whether or not the
 * document exists (contract § Download: "Field User without permission → `document.error.forbidden`
 * (no existence leak beyond policy)"). The authorization check therefore runs BEFORE the
 * not-found check wherever the answer would otherwise reveal a real id.
 */
import type { CurrentUser } from "../../../app/src/api/types";
import { isAdminUser } from "../auth/devAuth";
import type { DocumentMetadata } from "./types";

/** Contract § Limits — "Max size: 20 MiB certificates (ASSUMPTION until ops confirms)". */
export const DOCUMENT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  /** Contract § Limits — "`application/pdf`, approved image types". */
  allowedMediaTypes: ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/heic"] as const,
  maxFileNameChars: 255,
} as const;

export type AllowedMediaType = (typeof DOCUMENT_LIMITS.allowedMediaTypes)[number];

export function isAllowedMediaType(mediaType: string): mediaType is AllowedMediaType {
  return (DOCUMENT_LIMITS.allowedMediaTypes as readonly string[]).includes(mediaType);
}

// ---------------------------------------------------------------- content sniffing

const MAGIC: Array<{ mediaType: string; prefix: number[] }> = [
  { mediaType: "application/pdf", prefix: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mediaType: "image/png", prefix: [0x89, 0x50, 0x4e, 0x47] },
  { mediaType: "image/jpeg", prefix: [0xff, 0xd8, 0xff] },
];

/**
 * Checks the declared media type against the bytes' magic number.
 *
 * DELIBERATELY WEAK, and worth having anyway. It catches the common real case — a `.docx` or an
 * executable declared as `application/pdf` — without pretending to be content inspection; that
 * is the scanner's job (`scan.ts`), and this returns `true` for formats it has no signature for
 * (TIFF variants, HEIC) rather than refusing what it does not recognise. A check that refuses
 * valid files is worse than no check, because people route around it.
 */
export function contentMatchesDeclaredType(mediaType: string, bytes: Buffer): boolean {
  const known = MAGIC.find((m) => m.mediaType === mediaType);
  if (!known) return true;
  if (bytes.byteLength < known.prefix.length) return false;
  return known.prefix.every((byte, i) => bytes[i] === byte);
}

// ---------------------------------------------------------------- authorization

export interface DocumentSubject {
  /** The asset the document ultimately concerns, when one can be determined. Null for a
   * document linked to something with no asset (see this file's header § OFFICE SCOPE). */
  assetId: string | null;
  /** That asset's home office — the scope key. */
  homeoffice: string | null;
}

/** Any authenticated caller may learn that a certificate exists and what state it is in. */
export function canReadMetadata(_user: CurrentUser): boolean {
  return true;
}

/**
 * Bytes. Administrators only, office-scoped — see this file's header § THE FIELD-USER RULE and
 * § OFFICE SCOPE.
 *
 * Note what is NOT checked: the asset's lifecycle. A retired asset's calibration certificates
 * stay retrievable, because retirement ends the asset's service life, not the organisation's
 * obligation to evidence what it was calibrated to (WS-W7 § required tests, "retired asset
 * retrieval"). Retention, not lifecycle, is what eventually removes a document, under rule 20's
 * approved policy.
 */
export function canReadContent(user: CurrentUser, subject: DocumentSubject): boolean {
  if (!isAdminUser(user)) return false;
  return officeScopeAllows(user, subject);
}

/** Creating, completing, replacing and voiding are all administrator acts. */
export function canWriteDocument(user: CurrentUser, subject: DocumentSubject): boolean {
  if (!isAdminUser(user)) return false;
  return officeScopeAllows(user, subject);
}

/** Reconciliation reads the whole store and every metadata row across every office, so it is a
 * global act and belongs to the global role. */
export function canReconcile(user: CurrentUser): boolean {
  return user.roles.includes("SystemOwner");
}

/**
 * A-R5's office scope. `SystemOwner` is global; `OfficeAdmin` is confined to its own home
 * office; a subject with no determinable office is not scoped (the admin check already ran).
 */
export function officeScopeAllows(user: CurrentUser, subject: DocumentSubject): boolean {
  if (user.roles.includes("SystemOwner")) return true;
  if (!subject.homeoffice) return true;
  return user.homeoffice === subject.homeoffice;
}

/** The single sentence every refusal uses, so no message ever hints at whether the id was real. */
export const FORBIDDEN_REASON =
  "You are not permitted to access this document. [document.error.forbidden]";

/**
 * Redacts a metadata row for a caller who may read metadata but not bytes.
 *
 * `container`/`blobPath` are dropped for everyone (`toClientMetadata`); this additionally makes
 * clear to the client that content is not available to it, so the UI can render "Certificate on
 * file — ask an administrator" rather than a download button that 403s.
 */
export function contentVisibility(user: CurrentUser, subject: DocumentSubject, doc: DocumentMetadata): {
  canDownload: boolean;
  scanState: DocumentMetadata["scanState"];
} {
  return { canDownload: canReadContent(user, subject), scanState: doc.scanState };
}
