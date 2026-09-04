/**
 * Versioned quality-rule catalogue for the first Data Management proof.
 *
 * Implemented rules are the ones the current schema can evaluate honestly.
 * Every other rule from docs/16 §6 is present with `implementation_ref =
 * "not-implemented"` so the catalogue is complete and later versions do not
 * pretend a rule ran when it did not (FR-014).
 *
 * Duplicate detection produces candidates only. Shared serials are a valid
 * physical pattern and are never auto-merged.
 */
import { createHash } from "node:crypto";
import type { DataQualityRule, QualitySeverity } from "../../../../packages/contracts/src/dataManagement";

export const RULE_CAL_UNKNOWN_DUE = "DQ-CAL-UNKNOWN-DUE";
export const RULE_CAL_OVERDUE = "DQ-CAL-OVERDUE";
export const RULE_MISSING_HOME = "DQ-ASSET-MISSING-HOME-OFFICE";
export const RULE_MISSING_SERIAL = "DQ-ASSET-MISSING-SERIAL";
export const RULE_TEMPORARY_TAG = "DQ-ASSET-TEMPORARY-TAG";
export const RULE_UNKNOWN_CUSTODIAN = "DQ-ASSET-UNKNOWN-CUSTODIAN";
export const RULE_OFFICE_NO_ADMIN = "DQ-REF-OFFICE-NO-ADMIN";
export const RULE_SHARED_SERIAL = "DQ-DUP-SHARED-SERIAL";

const IMPL = "server/src/modules/data-management/engine.ts";

function ruleId(key: string): string {
  const hex = createHash("sha256").update(`ams-quality-rule:${key}:1`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rule(
  ruleKey: string,
  domain: string,
  severity: QualitySeverity,
  title: string,
  description: string,
  implementationRef: string,
  isActive: boolean
): DataQualityRule {
  return {
    id: ruleId(ruleKey),
    ruleKey,
    version: 1,
    domain,
    severity,
    ownerUserId: null,
    schedule: null,
    isActive,
    implementationRef,
    title,
    description,
  };
}

export const QUALITY_RULES: DataQualityRule[] = [
  rule(RULE_CAL_UNKNOWN_DUE, "Calibration", "High", "Calibrated model with no due date", "An active asset whose model tracks calibration has no next-due date. FR-017: counted explicitly, never omitted.", IMPL, true),
  rule(RULE_CAL_OVERDUE, "Calibration", "High", "Overdue calibration", "An active asset not at the lab has a next-due date before today.", IMPL, true),
  rule(RULE_MISSING_HOME, "Asset identity", "Medium", "Missing home office", "An active asset has no recorded home office, or it is Unassigned.", IMPL, true),
  rule(RULE_MISSING_SERIAL, "Asset identity", "Medium", "Serial absent where the model requires one", "The catalogue marks the model serialised and the asset has no serial.", IMPL, true),
  rule(RULE_TEMPORARY_TAG, "Asset identity", "Medium", "Temporary tag still in use", "The canonical Asset ID still matches the temporary-tag pattern.", IMPL, true),
  rule(RULE_UNKNOWN_CUSTODIAN, "Operational integrity", "Medium", "Unknown custodian", "The asset is CheckedOut and no custodian is recorded.", IMPL, true),
  rule(RULE_OFFICE_NO_ADMIN, "Reference integrity", "Medium", "Office without an assigned administrator", "An active office has no office-admin assignment.", IMPL, true),
  rule(
    RULE_SHARED_SERIAL,
    "Asset identity",
    "Low",
    "Shared-serial duplicate candidate",
    "Two or more active assets share a serial. This is a candidate only — shared serials are a valid pattern and are never auto-merged.",
    IMPL,
    true
  ),

  // ---- catalogue completeness: docs/16 §6, not yet evaluable or gated ----
  rule("DQ-ASSET-MALFORMED-ID", "Asset identity", "Critical", "Blank or malformed canonical Asset ID", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-ASSET-DUPLICATE-ID", "Asset identity", "Critical", "Duplicate canonical Asset ID", "Enforced by the database unique index; no issue row is minted.", "not-implemented", false),
  rule("DQ-ASSET-SERIAL-PREFIX", "Asset identity", "Low", "Model/serial prefix inconsistency", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-ASSET-ALIAS-COLLISION", "Asset identity", "High", "Alias collision", "Blocked on the asset_identifier table.", "not-implemented", false),
  rule("DQ-ASSET-SYNTHETIC-IN-PROD", "Asset identity", "Critical", "Synthetic marker in a non-synthetic environment", "Enforced by migration 0007 on load; not re-issued as a quality issue here.", "not-implemented", false),
  rule("DQ-REF-INACTIVE-USED", "Reference integrity", "Medium", "Inactive reference used for a new assignment", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-REF-CYCLIC-LOCATION", "Reference integrity", "High", "Cyclic or invalid location hierarchy", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-REF-DUPLICATE-MODEL", "Reference integrity", "High", "Duplicate equipment-model key", "Enforced by the catalogue primary key.", "not-implemented", false),
  rule("DQ-REF-PROJECT-STATUS", "Reference integrity", "Low", "Project missing authoritative status", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-REF-EXTERNAL-DIVERGED", "Reference integrity", "Medium", "External-authoritative record diverged from source", "Blocked on source authority decisions.", "not-implemented", false),
  rule("DQ-REF-ORPHAN-ALIAS", "Reference integrity", "Low", "Orphaned or unreferenced reference alias", "Blocked on the alias table.", "not-implemented", false),
  rule("DQ-OPS-REPLAY-DISAGREES", "Operational integrity", "Critical", "Current-state projection disagrees with event replay", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-OPS-TWO-INSTALLATIONS", "Operational integrity", "High", "Asset in two open installations", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-OPS-TWO-PARENTS", "Operational integrity", "High", "Child with two open parents", "Enforced by rel_one_open_parent.", "not-implemented", false),
  rule("DQ-OPS-SPAN-OVERLAP", "Operational integrity", "High", "Relationship or installation spans overlap", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-OPS-RETIRED-OPEN", "Operational integrity", "High", "Retired asset with unresolved open custody or installation", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-OPS-STALE-CHECKOUT", "Operational integrity", "Medium", "Stale checkout beyond policy", "OD-12 service levels are not decided; this rule does not invent a threshold.", "not-implemented", false),
  rule("DQ-OPS-MISSING-LOCATION", "Operational integrity", "Medium", "Missing physical location where a transition requires one", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-OPS-OUTBOX-RECONCILE", "Operational integrity", "Critical", "Transaction/outbox reconciliation failure", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-CAL-FAILED-SUMMARY", "Calibration", "High", "Failed calibration incorrectly advancing a successful summary", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-CAL-DUPLICATE", "Calibration", "Medium", "Duplicate calibration candidate", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-CAL-MISSING-CERT", "Calibration", "Medium", "Record missing a required certificate", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-DOC-MISSING-BLOB", "Calibration", "High", "Metadata points to a missing Blob object", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-DOC-ORPHAN-BLOB", "Calibration", "Medium", "Object exists without database metadata", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-DOC-HASH-MISMATCH", "Calibration", "High", "Document hash mismatch", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-DOC-SCAN-STALE", "Calibration", "Medium", "Malware scan pending or failed beyond threshold", "OD-12 is open; no threshold is invented.", "not-implemented", false),
  rule("DQ-DOC-LAB-EXPIRED", "Calibration", "Low", "Expired or invalid laboratory record", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-SEC-RESTRICTED-IN-REPORT", "Privacy and security", "Critical", "Restricted field included in a general report projection", "Reporting views already exclude ICCID/phone/IP; not re-issued here.", "not-implemented", false),
  rule("DQ-SEC-RESTRICTED-OFFLINE", "Privacy and security", "Critical", "Field User offline store contains restricted data", "Dictionary offlineCacheAllowed=false is the contract; runtime check is later.", "not-implemented", false),
  rule("DQ-SEC-EXPORT-EXPIRED", "Privacy and security", "High", "Expired export artifact still accessible", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-SEC-INACTIVE-ROLE", "Privacy and security", "High", "Inactive user retains an application role", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-SEC-PROD-IN-SYNTHETIC", "Privacy and security", "Critical", "Production value present in a synthetic dataset", "Not implemented in this proof.", "not-implemented", false),
  rule("DQ-SEC-RETAINED-PAST-POLICY", "Privacy and security", "Medium", "Data retained beyond policy without legal hold", "Retention periods are unspecified (FR-069).", "not-implemented", false),
];

export const RULE_VERSION_STAMP = QUALITY_RULES.filter((r) => r.isActive)
  .map((r) => `${r.ruleKey}@${r.version}`)
  .sort()
  .join(",");

export function qualityAlertStub(input: { ruleKey: string; severity: QualitySeverity; ownerUserId: string | null; entityId: string }): { wouldAlert: boolean; owner: string; summary: string } {
  // STOP OD-12: detection + owner field only. No production notification cadence.
  return {
    wouldAlert: input.severity === "Critical",
    owner: input.ownerUserId ?? "Data Steward",
    summary: `${input.ruleKey} on ${input.entityId}`,
  };
}
