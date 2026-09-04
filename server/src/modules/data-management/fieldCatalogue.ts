/**
 * Committed field dictionary for every production column the current migration set stores.
 *
 * Authority, classification, offline and export rules live here — not in the UI. OD-4
 * classification labels are Dev placeholders (`Unapproved:*`); they are not a corporate
 * taxonomy. Retention beyond the approved indefinite asset/history class is `Unspecified`
 * (FR-069). Restricted SIM/network fields never allow Field User read, offline cache or
 * a general export.
 */
import { createHash } from "node:crypto";
import type { DataDictionaryEntry, FieldAuthorityMode } from "../../../../packages/contracts/src/dataManagement";

const ALL = ["FieldUser", "OfficeAdmin", "SystemOwner", "ReportReader"] as const;
const STEWARD = ["OfficeAdmin", "SystemOwner", "ReportReader"] as const;
const ADMIN = ["OfficeAdmin", "SystemOwner"] as const;
const OWNER = ["SystemOwner"] as const;
const NONE: string[] = [];

/** OD-4 placeholders. Production acceptance requires the approved taxonomy. */
export const CLASS_INTERNAL = "Unapproved:Internal";
export const CLASS_CONFIDENTIAL = "Unapproved:Confidential";
export const CLASS_RESTRICTED = "Unapproved:Restricted";

export const RETAIN_INDEFINITE = "Indefinite";
export const RETAIN_UNSPECIFIED = "Unspecified";

const RESTRICTED_FIELDS = new Set(["identifiervalue", "phonenumber", "staticip"]);

interface Spec {
  field: string;
  display: string;
  definition: string;
  dataType: string;
  authority: FieldAuthorityMode;
  classification?: string;
  read?: readonly string[];
  write?: readonly string[];
  export?: readonly string[];
  offline?: boolean;
  retention?: string;
  lineage?: string;
  quality?: string[];
  allowed?: unknown;
}

function idFor(entity: string, field: string): string {
  const hex = createHash("sha256").update(`ams-dictionary:${entity}.${field}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function expand(entity: string, owner: string, steward: string, specs: Spec[]): DataDictionaryEntry[] {
  return specs.map((s) => {
    const restricted = RESTRICTED_FIELDS.has(s.field);
    const system = s.authority === "SystemDerived";
    return {
      id: idFor(entity, s.field),
      entityName: entity,
      fieldName: s.field,
      displayName: s.display,
      definition: s.definition,
      dataType: s.dataType,
      allowedValues: s.allowed,
      ownerRole: owner,
      stewardRole: steward,
      authorityMode: s.authority,
      classification: s.classification ?? (restricted ? CLASS_RESTRICTED : CLASS_INTERNAL),
      readRoles: [...(s.read ?? (restricted ? ADMIN : ALL))],
      writeRoles: [...(s.write ?? (system ? NONE : ADMIN))],
      exportRoles: [...(s.export ?? (restricted ? OWNER : STEWARD))],
      offlineCacheAllowed: s.offline ?? !restricted,
      retentionClass: s.retention ?? (entity.startsWith("asset") ? RETAIN_INDEFINITE : RETAIN_UNSPECIFIED),
      qualityRuleIds: s.quality ?? [],
      lineageSource:
        s.lineage ??
        (s.authority === "SystemDerived"
          ? "derived-from-accepted-events"
          : s.authority === "ImportedOnce"
            ? "migration"
            : s.authority === "ReferenceOnly"
              ? "ams-catalogue"
              : s.authority === "ExternalAuthoritative"
                ? "external-system"
                : "ams-managed"),
      deprecatedAt: null,
      replacedByField: null,
      rowVersion: 1,
    };
  });
}

const manufacturer = expand("manufacturer", "Data Owner", "Data Steward", [
  { field: "id", display: "Manufacturer id", definition: "Stable key for a curated manufacturer.", dataType: "text", authority: "SystemDerived" },
  { field: "name", display: "Name", definition: "Unique manufacturer name. Selected, not typed.", dataType: "text", authority: "ReferenceOnly" },
  { field: "isactive", display: "Active", definition: "Inactive manufacturers stay on history and are hidden from new assignment.", dataType: "boolean", authority: "AMSManaged" },
  { field: "note", display: "Note", definition: "Steward note.", dataType: "text", authority: "AMSManaged" },
]);

const equipmentCategory = expand("equipment_category", "Data Owner", "Data Steward", [
  { field: "id", display: "Category id", definition: "Stable key for a curated equipment category.", dataType: "text", authority: "SystemDerived" },
  { field: "name", display: "Name", definition: "Category name. Roots are asset groups; children are equipment types.", dataType: "text", authority: "ReferenceOnly" },
  { field: "parent_id", display: "Parent category", definition: "Parent category. Null for a root group.", dataType: "text", authority: "AMSManaged" },
  { field: "sortorder", display: "Sort order", definition: "Display order among siblings.", dataType: "integer", authority: "AMSManaged" },
  { field: "isactive", display: "Active", definition: "Inactive categories stay on history and are hidden from new assignment.", dataType: "boolean", authority: "AMSManaged" },
  { field: "note", display: "Note", definition: "Steward note.", dataType: "text", authority: "AMSManaged" },
]);

const assetIdentifier = expand("asset_identifier", "Data Owner", "Data Steward", [
  { field: "id", display: "Identifier id", definition: "Identity of one alias or tag for an asset.", dataType: "text", authority: "SystemDerived" },
  { field: "asset_uuid", display: "Asset UUID", definition: "Asset this identifier belongs to.", dataType: "text", authority: "SystemDerived" },
  { field: "identifier_type", display: "Identifier type", definition: "CanonicalAssetId, TemporaryTag, LegacyTag, Serial, ICCID, IMEI or Other.", dataType: "text", authority: "AMSManaged" },
  { field: "identifier_value", display: "Identifier value", definition: "The tag or alias as recorded. ICCID values are restricted.", dataType: "text", authority: "AMSManaged" },
  { field: "normalized_value", display: "Normalized value", definition: "Lower-trimmed form used for uniqueness and search.", dataType: "text", authority: "SystemDerived" },
  { field: "is_current", display: "Current", definition: "Whether this identifier is currently in force.", dataType: "boolean", authority: "SystemDerived" },
  { field: "valid_from", display: "Valid from", definition: "When this identifier became current.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "valid_to", display: "Valid to", definition: "When this identifier stopped being current.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "is_sensitive", display: "Sensitive", definition: "True for ICCID and other restricted identifiers.", dataType: "boolean", authority: "SystemDerived" },
  { field: "source", display: "Source", definition: "How this identifier was recorded.", dataType: "text", authority: "ImportedOnce" },
]);

const userOfficeScope = expand("user_office_scope", "System Owner", "System Owner", [
  { field: "id", display: "Scope id", definition: "Identity of one office-scope assignment.", dataType: "text", authority: "SystemDerived" },
  { field: "user_upn", display: "User UPN", definition: "User the scope belongs to.", dataType: "text", authority: "AMSManaged", classification: CLASS_CONFIDENTIAL, read: ADMIN, export: OWNER },
  { field: "office", display: "Office", definition: "Office this scope covers.", dataType: "text", authority: "AMSManaged", read: ADMIN, export: OWNER },
  { field: "scope_type", display: "Scope type", definition: "Member, Administer or Report.", dataType: "text", authority: "AMSManaged", read: ADMIN, export: OWNER },
  { field: "valid_from", display: "Valid from", definition: "When the scope opened.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "valid_to", display: "Valid to", definition: "When the scope closed. Null means current.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const location = expand("location", "Data Owner", "Data Steward", [
  { field: "id", display: "Location id", definition: "Stable key for the curated location record.", dataType: "text", authority: "SystemDerived", lineage: "ams-registration" },
  { field: "name", display: "Name", definition: "Unique location name used as the operational reference.", dataType: "text", authority: "AMSManaged", lineage: "ams-catalogue" },
  { field: "locationtype", display: "Location type", definition: "Region, Office, Site, Vehicle, CalLab, Client or Storage.", dataType: "text", authority: "ReferenceOnly", allowed: ["Region", "Office", "Site", "Vehicle", "CalLab", "Client", "Storage"] },
  { field: "parentlocation", display: "Parent location", definition: "Parent location name in the curated hierarchy.", dataType: "text", authority: "AMSManaged" },
  { field: "isactive", display: "Active", definition: "Inactive records stay visible on history and are hidden from new assignment.", dataType: "boolean", authority: "AMSManaged" },
  { field: "note", display: "Note", definition: "Steward note on the location record.", dataType: "text", authority: "AMSManaged" },
]);

const equipmentModel = expand("equipment_model", "Data Owner", "Data Steward", [
  { field: "manufacturer", display: "Manufacturer", definition: "Catalogue manufacturer. Part of the three-part model key.", dataType: "text", authority: "ReferenceOnly" },
  { field: "model", display: "Model", definition: "Catalogue model name. Part of the three-part model key.", dataType: "text", authority: "ReferenceOnly" },
  { field: "equipmenttype", display: "Equipment type", definition: "Catalogue equipment type. Part of the three-part model key.", dataType: "text", authority: "ReferenceOnly" },
  { field: "assetgroup", display: "Asset group", definition: "Reporting group for the model.", dataType: "text", authority: "AMSManaged" },
  { field: "idprefix", display: "Asset ID prefix", definition: "Prefix used when minting a canonical Asset ID.", dataType: "text", authority: "AMSManaged" },
  { field: "isserialised", display: "Serialised", definition: "Whether a serial is required for this model.", dataType: "boolean", authority: "AMSManaged", quality: ["DQ-ASSET-MISSING-SERIAL"] },
  { field: "identifiertype", display: "Identifier type", definition: "Serial, ICCID, IMEI or None.", dataType: "text", authority: "AMSManaged", allowed: ["Serial", "ICCID", "IMEI", "None"] },
  { field: "defaultcalintervalmonths", display: "Default calibration interval (months)", definition: "Null means calibration is not tracked for this model.", dataType: "integer", authority: "AMSManaged", quality: ["DQ-CAL-UNKNOWN-DUE"] },
  { field: "name", display: "Display name", definition: "Optional human label for the catalogue row.", dataType: "text", authority: "AMSManaged" },
  { field: "isactive", display: "Active", definition: "Inactive catalogue rows stay on history and are hidden from new assignment.", dataType: "boolean", authority: "AMSManaged" },
]);

const project = expand("project", "Data Owner", "Data Steward", [
  { field: "id", display: "Project id", definition: "Stable key for the project record.", dataType: "text", authority: "SystemDerived" },
  { field: "projectnumber", display: "Project number", definition: "Unique project number used on operational records.", dataType: "text", authority: "AMSManaged", lineage: "imported-or-ams" },
  { field: "name", display: "Name", definition: "Project name.", dataType: "text", authority: "AMSManaged" },
  { field: "status", display: "Status", definition: "Active or Closed.", dataType: "text", authority: "AMSManaged", allowed: ["Active", "Closed"] },
  { field: "office", display: "Office", definition: "Home office for the project.", dataType: "text", authority: "AMSManaged" },
  { field: "pm", display: "Project manager", definition: "Named project manager.", dataType: "text", authority: "AMSManaged" },
]);

const asset = expand("asset", "Data Owner", "Data Steward", [
  { field: "id", display: "Asset UUID", definition: "Stable database key. Never the human-readable tag.", dataType: "text", authority: "SystemDerived", lineage: "ams-registration", offline: true },
  { field: "assetid", display: "Canonical Asset ID", definition: "Unique immutable tag. Temporary and legacy values remain aliases once the alias table exists.", dataType: "text", authority: "SystemDerived", quality: ["DQ-ASSET-TEMPORARY-TAG"], offline: true },
  { field: "migrationsource", display: "Migration source", definition: "Lineage pointer to the legacy row that produced this asset.", dataType: "text", authority: "ImportedOnce", lineage: "migration" },
  { field: "manufacturer", display: "Manufacturer", definition: "Selected from the equipment catalogue. Not free text.", dataType: "text", authority: "ReferenceOnly" },
  { field: "model", display: "Model", definition: "Selected from the equipment catalogue. Not free text.", dataType: "text", authority: "ReferenceOnly" },
  { field: "equipmenttype", display: "Equipment type", definition: "Selected from the equipment catalogue. Not free text.", dataType: "text", authority: "ReferenceOnly" },
  { field: "serialnumber", display: "Serial number", definition: "Non-unique. Shared serials are a valid physical pattern and never auto-merge.", dataType: "text", authority: "AMSManaged", quality: ["DQ-ASSET-MISSING-SERIAL", "DQ-DUP-SHARED-SERIAL"] },
  { field: "homeoffice", display: "Home office", definition: "Owning office. Selected from curated locations.", dataType: "text", authority: "AMSManaged", quality: ["DQ-ASSET-MISSING-HOME-OFFICE"] },
  { field: "lifecycle", display: "Lifecycle", definition: "Active or Retired. Written only by accepted events.", dataType: "text", authority: "SystemDerived", allowed: ["Active", "Retired"] },
  { field: "disposition", display: "Disposition", definition: "Stored disposition axis. Written only by accepted events (DC-22).", dataType: "text", authority: "SystemDerived" },
  { field: "serviceability", display: "Serviceability", definition: "Stored serviceability axis. Written only by accepted events (DC-22).", dataType: "text", authority: "SystemDerived" },
  { field: "status", display: "Compatibility status", definition: "Generated projection of the three stored axes. Never written directly.", dataType: "text", authority: "SystemDerived" },
  { field: "currentlocation", display: "Current location", definition: "Derived exclusively from accepted events.", dataType: "text", authority: "SystemDerived" },
  { field: "custodian", display: "Custodian", definition: "Derived exclusively from accepted events.", dataType: "text", authority: "SystemDerived", quality: ["DQ-ASSET-UNKNOWN-CUSTODIAN"] },
  { field: "currentproject", display: "Current project", definition: "Derived exclusively from accepted events.", dataType: "text", authority: "SystemDerived" },
  { field: "parentasset", display: "Parent asset", definition: "Open kit/component parent. Derived from relationship events.", dataType: "text", authority: "SystemDerived" },
  { field: "lastcaldate", display: "Last calibration date", definition: "Derived from accepted calibration records.", dataType: "text", authority: "SystemDerived", quality: ["DQ-CAL-UNKNOWN-DUE", "DQ-CAL-OVERDUE"] },
  { field: "nextcaldue", display: "Next calibration due", definition: "Derived from accepted calibration records. Unknown is counted, never omitted.", dataType: "text", authority: "SystemDerived", quality: ["DQ-CAL-UNKNOWN-DUE", "DQ-CAL-OVERDUE"] },
  { field: "retirementreason", display: "Retirement reason", definition: "Set by the Retire command.", dataType: "text", authority: "SystemDerived", allowed: ["Sold", "Lost", "Damaged", "Obsolete"] },
  { field: "notes", display: "Notes", definition: "Free-text operational note. Not a state field.", dataType: "text", authority: "AMSManaged" },
  { field: "carrier", display: "Carrier", definition: "Communications carrier where recorded.", dataType: "text", authority: "AMSManaged" },
  { field: "identifiervalue", display: "ICCID", definition: "Restricted SIM identifier. Field users never receive or cache this.", dataType: "text", authority: "AMSManaged", classification: CLASS_RESTRICTED, read: ADMIN, write: ADMIN, export: OWNER, offline: false },
  { field: "phonenumber", display: "Phone number", definition: "Restricted SIM phone number. Field users never receive or cache this.", dataType: "text", authority: "AMSManaged", classification: CLASS_RESTRICTED, read: ADMIN, write: ADMIN, export: OWNER, offline: false },
  { field: "staticip", display: "Static IP", definition: "Restricted network address. Field users never receive or cache this.", dataType: "text", authority: "AMSManaged", classification: CLASS_RESTRICTED, read: ADMIN, write: ADMIN, export: OWNER, offline: false },
  { field: "row_version", display: "Row version", definition: "Optimistic concurrency token. Server-owned.", dataType: "integer", authority: "SystemDerived" },
]);

const txn = expand("asset_transaction", "Data Owner", "System Owner", [
  { field: "id", display: "Transaction id", definition: "Immutable header identity.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "name", display: "Transaction name", definition: "Human sequence value minted by the server (TXN-n).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "transactiontype", display: "Transaction type", definition: "Named business event type.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "transactiondate", display: "Effective date", definition: "Business-effective time supplied with the command and accepted by the server.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "performedby", display: "Performed by", definition: "UPN resolved from the authenticated session. Never from the body.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL, retention: RETAIN_INDEFINITE },
  { field: "fromlocation", display: "From location", definition: "Location before the event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "tolocation", display: "To location", definition: "Location after the event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "fromuser", display: "From user", definition: "Prior custodian.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL, retention: RETAIN_INDEFINITE },
  { field: "touser", display: "To user", definition: "Receiving custodian.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL, retention: RETAIN_INDEFINITE },
  { field: "fromproject", display: "From project", definition: "Prior project.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "toproject", display: "To project", definition: "Receiving project.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "primaryasset", display: "Primary asset", definition: "Primary asset of a multi-asset event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "notes", display: "Notes", definition: "Event note recorded with the command.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "expectedreturn", display: "Expected return", definition: "Checkout expected-return date.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "client_submission_id", display: "Client submission id", definition: "Idempotency identity of the command that produced this header.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "recorded_at", display: "Recorded at", definition: "Server acceptance time.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const line = expand("asset_transaction_line", "Data Owner", "System Owner", [
  { field: "id", display: "Line id", definition: "Immutable line identity.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "transaction_id", display: "Transaction id", definition: "Parent header.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "asset", display: "Asset ID", definition: "Canonical Asset ID the line applies to.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "statusbefore", display: "Status before", definition: "Generated compatibility status before the event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "statusafter", display: "Status after", definition: "Generated compatibility status after the event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "lifecycle_before", display: "Lifecycle before", definition: "Stored lifecycle before the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "lifecycle_after", display: "Lifecycle after", definition: "Stored lifecycle after the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "disposition_before", display: "Disposition before", definition: "Stored disposition before the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "disposition_after", display: "Disposition after", definition: "Stored disposition after the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "serviceability_before", display: "Serviceability before", definition: "Stored serviceability before the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "serviceability_after", display: "Serviceability after", definition: "Stored serviceability after the event (DC-22).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "kitrole", display: "Kit role", definition: "Role this asset played in the event.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "orientation", display: "Orientation", definition: "Sensor orientation when recorded.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "powersource", display: "Power source", definition: "Power source when recorded.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "condition", display: "Condition", definition: "Observed condition on the line.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "processed", display: "Processed", definition: "Whether the line was applied.", dataType: "boolean", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "notes", display: "Line notes", definition: "Per-line note.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "line_number", display: "Line number", definition: "Stable order within the header.", dataType: "integer", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const relationship = expand("asset_relationship", "Data Owner", "Data Steward", [
  { field: "id", display: "Relationship id", definition: "Identity of a dated parent/child membership.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "parentasset", display: "Parent asset", definition: "Parent Asset ID.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "childasset", display: "Child asset", definition: "Child Asset ID.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "relationshiptype", display: "Relationship type", definition: "Component (permanent) or Kit (per checkout/deployment).", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "start_at", display: "Start", definition: "When the membership opened.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "end_at", display: "End", definition: "When the membership closed. Null means open.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "createdbyline", display: "Opened by line", definition: "Transaction line that opened the membership.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "closedbyline", display: "Closed by line", definition: "Transaction line that closed the membership.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const calibration = expand("calibration_record", "Data Owner", "Data Steward", [
  { field: "id", display: "Calibration record id", definition: "Identity of one calibration fact.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "asset", display: "Asset ID", definition: "Asset the record belongs to.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "calibrationdate", display: "Calibration date", definition: "When the laboratory work happened. Null only for legacy due-date-only evidence.", dataType: "text", authority: "AMSManaged", retention: RETAIN_INDEFINITE },
  { field: "nextduedate", display: "Next due date", definition: "Due date recorded with this evidence.", dataType: "text", authority: "AMSManaged", retention: RETAIN_INDEFINITE, quality: ["DQ-CAL-UNKNOWN-DUE", "DQ-CAL-OVERDUE"] },
  { field: "lab", display: "Laboratory", definition: "Selected from curated calibration laboratories when present.", dataType: "text", authority: "ReferenceOnly", retention: RETAIN_INDEFINITE },
  { field: "certificatenumber", display: "Certificate number", definition: "Laboratory certificate number.", dataType: "text", authority: "AMSManaged", retention: RETAIN_INDEFINITE },
  { field: "certificateurl", display: "Legacy certificate URL", definition: "Legacy pointer. Production certificates are private Blob objects with metadata in document.", dataType: "text", authority: "ImportedOnce", retention: RETAIN_INDEFINITE },
  { field: "cost", display: "Cost", definition: "Recorded cost if supplied.", dataType: "text", authority: "AMSManaged", retention: RETAIN_UNSPECIFIED },
  { field: "result", display: "Result", definition: "Pass, Fail or Adjusted.", dataType: "text", authority: "AMSManaged", allowed: ["Pass", "Fail", "Adjusted"], retention: RETAIN_INDEFINITE },
  { field: "corrected_by", display: "Corrected by", definition: "Actor of a compensating calibration correction.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL, retention: RETAIN_INDEFINITE },
  { field: "corrected_at", display: "Corrected at", definition: "When a compensating correction was recorded.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const idSequence = expand("id_sequence", "System Owner", "System Owner", [
  { field: "prefix", display: "Prefix", definition: "Asset ID prefix whose next value is tracked.", dataType: "text", authority: "SystemDerived" },
  { field: "nextvalue", display: "Next value", definition: "Next integer the server will mint for this prefix.", dataType: "integer", authority: "SystemDerived" },
]);

const installation = expand("installation", "Data Owner", "Data Steward", [
  { field: "id", display: "Installation id", definition: "Identity of one station-at-site span.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "site", display: "Site", definition: "Site location name.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "project", display: "Project", definition: "Project number the installation belongs to.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "primaryasset", display: "Primary asset", definition: "Data logger that is the primary of the station.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "locationtype", display: "Location type", definition: "Recorded location type at deploy.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "sitename", display: "Site name", definition: "Human site name recorded at deploy.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "position", display: "Position", definition: "Free-text position on the site.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "latitude", display: "Latitude", definition: "Optional latitude.", dataType: "double precision", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "longitude", display: "Longitude", definition: "Optional longitude.", dataType: "double precision", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "coordinatesource", display: "Coordinate source", definition: "Manual or Device.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "powersource", display: "Power source", definition: "Power source recorded at deploy.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "start_at", display: "Start", definition: "When the installation opened.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "end_at", display: "End", definition: "When the installation closed. Null means current.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "openedbytransaction", display: "Opened by transaction", definition: "Deploy transaction that opened the span.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "closedbytransaction", display: "Closed by transaction", definition: "Recovery transaction that closed the span.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "notes", display: "Notes", definition: "Installation note.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const instComp = expand("installation_component", "Data Owner", "Data Steward", [
  { field: "id", display: "Component id", definition: "Identity of one asset's membership of an installation.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "installation", display: "Installation", definition: "Parent installation id.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "asset", display: "Asset ID", definition: "Member asset.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "kitrole", display: "Kit role", definition: "Role the asset played.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "orientation", display: "Orientation", definition: "Orientation while installed.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "start_at", display: "Start", definition: "When this membership opened.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "end_at", display: "End", definition: "When this membership closed.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "openedbyline", display: "Opened by line", definition: "Line that opened the membership.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "closedbyline", display: "Closed by line", definition: "Line that closed the membership.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const officeAdmin = expand("office_admin_assignment", "System Owner", "System Owner", [
  { field: "office", display: "Office", definition: "Office name this assignment covers.", dataType: "text", authority: "AMSManaged", quality: ["DQ-REF-OFFICE-NO-ADMIN"] },
  { field: "admin_upns", display: "Administrator UPNs", definition: "UPNs assigned as office administrators. Empty is a gap.", dataType: "jsonb", authority: "AMSManaged", classification: CLASS_CONFIDENTIAL, quality: ["DQ-REF-OFFICE-NO-ADMIN"] },
]);

const idempotency = expand("command_idempotency", "System Owner", "System Owner", [
  { field: "client_submission_id", display: "Client submission id", definition: "Idempotency key. Same id plus same request returns the original result.", dataType: "text", authority: "SystemDerived" },
  { field: "request_hash", display: "Request hash", definition: "Canonical hash of the accepted request.", dataType: "text", authority: "SystemDerived" },
  { field: "user_upn", display: "User UPN", definition: "Caller that claimed the submission.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
  { field: "command", display: "Command", definition: "Named command that claimed the key.", dataType: "text", authority: "SystemDerived" },
  { field: "response", display: "Response", definition: "Stored outcome. Null only between claim and commit.", dataType: "jsonb", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the claim was written.", dataType: "text", authority: "SystemDerived" },
]);

const appUser = expand("app_user", "System Owner", "System Owner", [
  { field: "upn", display: "UPN", definition: "Mutable display handle. Not the stable identity key.", dataType: "text", authority: "ExternalAuthoritative", classification: CLASS_CONFIDENTIAL, read: ADMIN, export: OWNER },
  { field: "object_id", display: "Object id", definition: "Stable Entra object id. The identity key.", dataType: "text", authority: "ExternalAuthoritative", classification: CLASS_CONFIDENTIAL, read: OWNER, export: OWNER, offline: false },
  { field: "tenant_id", display: "Tenant id", definition: "Directory tenant the identity belongs to.", dataType: "text", authority: "ExternalAuthoritative", classification: CLASS_CONFIDENTIAL, read: OWNER, export: OWNER, offline: false },
  { field: "display_name", display: "Display name", definition: "Directory display name.", dataType: "text", authority: "ExternalAuthoritative", classification: CLASS_CONFIDENTIAL, read: ADMIN, export: STEWARD },
  { field: "homeoffice", display: "Home office", definition: "AMS home office assignment.", dataType: "text", authority: "AMSManaged" },
  { field: "is_active", display: "Active", definition: "Disabled accounts authenticate at the IdP and are refused here.", dataType: "boolean", authority: "AMSManaged" },
  { field: "created_at", display: "Created at", definition: "When the AMS user row was created.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "updated_at", display: "Updated at", definition: "When the AMS user row last changed.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const appUserRole = expand("app_user_role", "System Owner", "System Owner", [
  { field: "upn", display: "UPN", definition: "User the role row belongs to.", dataType: "text", authority: "AMSManaged", classification: CLASS_CONFIDENTIAL, read: ADMIN, export: OWNER },
  { field: "role", display: "Role", definition: "FieldUser, OfficeAdmin, SystemOwner or ReportReader.", dataType: "text", authority: "AMSManaged", read: ADMIN, export: OWNER, allowed: ["FieldUser", "OfficeAdmin", "SystemOwner", "ReportReader"] },
  { field: "office", display: "Office scope", definition: "Null means global. Non-null is that office only.", dataType: "text", authority: "AMSManaged", read: ADMIN, export: OWNER },
]);

const outbox = expand("outbox_event", "System Owner", "Platform Operator", [
  { field: "id", display: "Outbox id", definition: "Internal sequence of the outbox row.", dataType: "bigint", authority: "SystemDerived" },
  { field: "event_id", display: "Event id", definition: "Stable event identity committed with the business event.", dataType: "text", authority: "SystemDerived" },
  { field: "event_type", display: "Event type", definition: "Outbox event type.", dataType: "text", authority: "SystemDerived" },
  { field: "aggregate_type", display: "Aggregate type", definition: "Aggregate the event belongs to.", dataType: "text", authority: "SystemDerived" },
  { field: "aggregate_id", display: "Aggregate id", definition: "Aggregate identity.", dataType: "text", authority: "SystemDerived" },
  { field: "payload", display: "Payload", definition: "Event payload. Sensitive values must already be absent.", dataType: "jsonb", authority: "SystemDerived", export: OWNER },
  { field: "available_at", display: "Available at", definition: "When a worker may claim the row.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "attempt_count", display: "Attempt count", definition: "Delivery attempts so far.", dataType: "integer", authority: "SystemDerived" },
  { field: "locked_at", display: "Locked at", definition: "When the current worker claimed the row.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "locked_by", display: "Locked by", definition: "Worker that holds the claim.", dataType: "text", authority: "SystemDerived" },
  { field: "processed_at", display: "Processed at", definition: "When delivery completed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "dead_lettered_at", display: "Dead-lettered at", definition: "When the row was parked after failed delivery.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "dead_letter_reason", display: "Dead-letter reason", definition: "Why the row was parked.", dataType: "text", authority: "SystemDerived" },
  { field: "last_error", display: "Last error", definition: "Last delivery error. Must not contain secrets.", dataType: "text", authority: "SystemDerived" },
  { field: "correlation_id", display: "Correlation id", definition: "Correlation identifier for the originating command.", dataType: "text", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the outbox row was written.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const outboxDelivery = expand("outbox_delivery", "System Owner", "Platform Operator", [
  { field: "event_id", display: "Event id", definition: "Outbox event being delivered.", dataType: "text", authority: "SystemDerived" },
  { field: "consumer", display: "Consumer", definition: "Named consumer of the event.", dataType: "text", authority: "SystemDerived" },
  { field: "outcome", display: "Outcome", definition: "InProgress or Delivered.", dataType: "text", authority: "SystemDerived" },
  { field: "detail", display: "Detail", definition: "Consumer-side detail. Secrets redacted.", dataType: "text", authority: "SystemDerived" },
  { field: "claimed_at", display: "Claimed at", definition: "When the consumer claimed the event.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "delivered_at", display: "Delivered at", definition: "When the consumer finished.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const suppression = expand("notification_suppression", "System Owner", "Platform Operator", [
  { field: "subject_key", display: "Subject key", definition: "What the cadence applies to.", dataType: "text", authority: "SystemDerived" },
  { field: "notification_kind", display: "Notification kind", definition: "Kind of notification being paced.", dataType: "text", authority: "SystemDerived" },
  { field: "last_sent_at", display: "Last sent at", definition: "When the last notification was sent.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "next_eligible_at", display: "Next eligible at", definition: "Earliest time another send is allowed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "send_count", display: "Send count", definition: "How many times this subject has been notified.", dataType: "integer", authority: "SystemDerived" },
]);

const alert = expand("operational_alert", "System Owner", "Platform Operator", [
  { field: "id", display: "Alert id", definition: "Identity of an operational alert.", dataType: "text", authority: "SystemDerived" },
  { field: "alert_kind", display: "Alert kind", definition: "Named kind of alert.", dataType: "text", authority: "SystemDerived" },
  { field: "severity", display: "Severity", definition: "Warning or Critical.", dataType: "text", authority: "SystemDerived" },
  { field: "owner", display: "Owner", definition: "Named owner of the alert. OD-12 SLAs are not invented here.", dataType: "text", authority: "SystemDerived" },
  { field: "summary", display: "Summary", definition: "Short description. No secrets.", dataType: "text", authority: "SystemDerived" },
  { field: "detail", display: "Detail", definition: "Structured detail. Secrets redacted.", dataType: "jsonb", authority: "SystemDerived", export: OWNER },
  { field: "raised_at", display: "Raised at", definition: "When the alert was raised.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "acknowledged_at", display: "Acknowledged at", definition: "When someone acknowledged the alert.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "acknowledged_by", display: "Acknowledged by", definition: "Who acknowledged the alert.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
]);

const document = expand("document", "Data Owner", "Data Steward", [
  { field: "id", display: "Document id", definition: "Identity of private document metadata. Bytes stay in object storage.", dataType: "text", authority: "SystemDerived" },
  { field: "document_type", display: "Document type", definition: "Named document type.", dataType: "text", authority: "AMSManaged" },
  { field: "container", display: "Container", definition: "Private storage container name. Not a credential.", dataType: "text", authority: "SystemDerived", read: ADMIN, export: OWNER, offline: false },
  { field: "blob_path", display: "Blob path", definition: "Private object path. Never a browser URL or SAS.", dataType: "text", authority: "SystemDerived", read: ADMIN, export: OWNER, offline: false },
  { field: "original_file_name", display: "Original file name", definition: "Name supplied at upload.", dataType: "text", authority: "AMSManaged" },
  { field: "stored_file_name", display: "Stored file name", definition: "Name used in object storage.", dataType: "text", authority: "SystemDerived", read: ADMIN, export: OWNER },
  { field: "media_type", display: "Media type", definition: "MIME type of the object.", dataType: "text", authority: "SystemDerived" },
  { field: "size_bytes", display: "Size (bytes)", definition: "Object size.", dataType: "bigint", authority: "SystemDerived" },
  { field: "sha256", display: "SHA-256", definition: "Content hash used for reconciliation.", dataType: "text", authority: "SystemDerived", read: ADMIN, export: OWNER },
  { field: "scan_status", display: "Scan status", definition: "Malware scan state of the object.", dataType: "text", authority: "SystemDerived" },
  { field: "scan_detail", display: "Scan detail", definition: "Scanner detail. No payload bytes.", dataType: "text", authority: "SystemDerived", read: ADMIN },
  { field: "scanned_at", display: "Scanned at", definition: "When the scan completed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "retention_class", display: "Retention class", definition: "Retention class for the document.", dataType: "text", authority: "AMSManaged" },
  { field: "upload_state", display: "Upload state", definition: "Pending or completed upload.", dataType: "text", authority: "SystemDerived" },
  { field: "linked_entity_type", display: "Linked entity type", definition: "Entity type this document is attached to.", dataType: "text", authority: "AMSManaged" },
  { field: "linked_entity_id", display: "Linked entity id", definition: "Entity this document is attached to.", dataType: "text", authority: "AMSManaged" },
  { field: "replaces_document_id", display: "Replaces document", definition: "Prior document this one supersedes.", dataType: "text", authority: "SystemDerived" },
  { field: "replaced_by_document_id", display: "Replaced by document", definition: "Successor document.", dataType: "text", authority: "SystemDerived" },
  { field: "superseded_reason", display: "Superseded reason", definition: "Why the document was superseded.", dataType: "text", authority: "AMSManaged" },
  { field: "is_current", display: "Current", definition: "Whether this is the current document for its link.", dataType: "boolean", authority: "SystemDerived" },
  { field: "void_reason", display: "Void reason", definition: "Why the document was voided.", dataType: "text", authority: "AMSManaged" },
  { field: "voided_at", display: "Voided at", definition: "When the document was voided.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "voided_by", display: "Voided by", definition: "Who voided the document.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
  { field: "uploaded_by_user_id", display: "Uploaded by", definition: "Authenticated uploader.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
  { field: "uploaded_at", display: "Uploaded at", definition: "When the object landed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the metadata row was created.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "is_synthetic", display: "Synthetic", definition: "Marks a synthetic fixture. Production loads refuse the pair.", dataType: "boolean", authority: "SystemDerived" },
  { field: "client_submission_id", display: "Client submission id", definition: "Upload command identity.", dataType: "text", authority: "SystemDerived" },
]);

const calDoc = expand("calibration_document", "Data Owner", "Data Steward", [
  { field: "calibration_record_id", display: "Calibration record", definition: "Calibration fact the document supports.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "document_id", display: "Document", definition: "Private document metadata id.", dataType: "text", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "relationship_type", display: "Relationship type", definition: "Usually Certificate.", dataType: "text", authority: "AMSManaged", retention: RETAIN_INDEFINITE },
  { field: "is_current", display: "Current", definition: "At most one current certificate per calibration record.", dataType: "boolean", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "linked_at", display: "Linked at", definition: "When the link was created.", dataType: "timestamptz", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
  { field: "linked_by", display: "Linked by", definition: "Who linked the document.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL, retention: RETAIN_INDEFINITE },
  { field: "unlinked_at", display: "Unlinked at", definition: "When the link ended.", dataType: "timestamptz", authority: "SystemDerived", retention: RETAIN_INDEFINITE },
]);

const meta = expand("meta", "System Owner", "Platform Operator", [
  { field: "key", display: "Key", definition: "Environment and dataset markers the database itself enforces.", dataType: "text", authority: "SystemDerived" },
  { field: "value", display: "Value", definition: "Marker value. Production refuses a synthetic dataset here.", dataType: "text", authority: "SystemDerived" },
]);

const schemaMigration = expand("schema_migration", "System Owner", "Platform Operator", [
  { field: "version", display: "Version", definition: "Applied migration number.", dataType: "integer", authority: "SystemDerived" },
  { field: "name", display: "Name", definition: "Descriptive half of the migration filename.", dataType: "text", authority: "SystemDerived" },
  { field: "checksum", display: "Checksum", definition: "sha256 of the applied file. Drift is refused.", dataType: "text", authority: "SystemDerived", read: OWNER, export: OWNER },
  { field: "applied_at", display: "Applied at", definition: "When the migration landed.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const dictionary = expand("data_dictionary_entry", "Data Owner", "Data Steward", [
  { field: "id", display: "Entry id", definition: "Stable dictionary entry identity.", dataType: "text", authority: "SystemDerived" },
  { field: "entity_name", display: "Entity", definition: "Logical entity the field belongs to.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "field_name", display: "Field", definition: "Logical field name.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "display_name", display: "Display name", definition: "Label shown to stewards.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "definition", display: "Definition", definition: "Business meaning of the field.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "data_type", display: "Data type", definition: "Declared type.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "allowed_values", display: "Allowed values", definition: "Optional controlled vocabulary.", dataType: "jsonb", authority: "AMSManaged", write: OWNER },
  { field: "owner_role", display: "Owner role", definition: "Data Owner concept for this field.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "steward_role", display: "Steward role", definition: "Steward concept for this field.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "authority_mode", display: "Authority mode", definition: "Who may change the field, and how.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "classification", display: "Classification", definition: "Sensitivity. Dev placeholder until OD-4.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "read_roles", display: "Read roles", definition: "Roles permitted to read.", dataType: "text[]", authority: "AMSManaged", write: OWNER },
  { field: "write_roles", display: "Write roles", definition: "Roles permitted to write through a named command.", dataType: "text[]", authority: "AMSManaged", write: OWNER },
  { field: "export_roles", display: "Export roles", definition: "Roles permitted to include the field in a governed export.", dataType: "text[]", authority: "AMSManaged", write: OWNER },
  { field: "offline_cache_allowed", display: "Offline cache allowed", definition: "Whether a Field User IndexedDB projection may hold this field.", dataType: "boolean", authority: "AMSManaged", write: OWNER },
  { field: "retention_class", display: "Retention class", definition: "Retention class. Periods are not invented.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "quality_rule_ids", display: "Quality rule ids", definition: "Rules that govern this field.", dataType: "text[]", authority: "AMSManaged", write: OWNER },
  { field: "lineage_source", display: "Lineage source", definition: "Where the value typically comes from.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "deprecated_at", display: "Deprecated at", definition: "When the entry was deprecated.", dataType: "timestamptz", authority: "AMSManaged", write: OWNER },
  { field: "replaced_by_field", display: "Replaced by", definition: "Successor field if deprecated.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "row_version", display: "Row version", definition: "Optimistic concurrency token.", dataType: "integer", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the entry was created.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "updated_at", display: "Updated at", definition: "When the entry last changed.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const qualityRule = expand("data_quality_rule", "Data Owner", "Data Steward", [
  { field: "id", display: "Rule id", definition: "Stable rule identity. Versions do not rewrite history.", dataType: "text", authority: "SystemDerived" },
  { field: "rule_key", display: "Rule key", definition: "Implementation key, stable across versions.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "version", display: "Version", definition: "Immutable version number.", dataType: "integer", authority: "AMSManaged", write: OWNER },
  { field: "domain", display: "Domain", definition: "Quality domain the rule belongs to.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "severity", display: "Severity", definition: "Critical, High, Medium or Low.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "owner_user_id", display: "Default owner", definition: "Default issue owner. Not an SLA hour.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "schedule", display: "Schedule", definition: "Optional run schedule. Cadence is not an invented SLA.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "is_active", display: "Active", definition: "Inactive rules stay in history and stop opening new issues.", dataType: "boolean", authority: "AMSManaged", write: OWNER },
  { field: "implementation_ref", display: "Implementation", definition: "Code module id, or not-implemented.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "title", display: "Title", definition: "Steward-facing rule title.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "description", display: "Description", definition: "What the rule detects.", dataType: "text", authority: "AMSManaged", write: OWNER },
  { field: "created_at", display: "Created at", definition: "When this version was recorded.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const qualityIssue = expand("data_quality_issue", "Data Owner", "Data Steward", [
  { field: "id", display: "Issue id", definition: "Identity of one rule failure on one record/scope.", dataType: "text", authority: "SystemDerived" },
  { field: "rule_id", display: "Rule id", definition: "Rule that detected the issue.", dataType: "text", authority: "SystemDerived" },
  { field: "rule_version", display: "Rule version", definition: "Version at detection. Later rule edits do not rewrite this.", dataType: "integer", authority: "SystemDerived" },
  { field: "entity_type", display: "Entity type", definition: "Kind of record that failed.", dataType: "text", authority: "SystemDerived" },
  { field: "entity_id", display: "Entity id", definition: "Record that failed.", dataType: "text", authority: "SystemDerived" },
  { field: "scope_key", display: "Scope key", definition: "Distinguishes multiple failures on one record.", dataType: "text", authority: "SystemDerived" },
  { field: "severity", display: "Severity", definition: "Copied from the rule at detection.", dataType: "text", authority: "SystemDerived" },
  { field: "status", display: "Status", definition: "Open through Reopened. Resolved only after re-evaluation or approved verification.", dataType: "text", authority: "AMSManaged", write: ADMIN },
  { field: "office_location_id", display: "Office", definition: "Owning office for scope.", dataType: "text", authority: "SystemDerived" },
  { field: "owner_user_id", display: "Owner", definition: "Assigned steward. Not an invented SLA.", dataType: "text", authority: "AMSManaged", write: ADMIN },
  { field: "first_detected_at", display: "First detected", definition: "First time this scope failed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "last_detected_at", display: "Last detected", definition: "Most recent rule run that still failed.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "due_at", display: "Due at", definition: "Optional due date. OD-12 SLAs are not invented.", dataType: "timestamptz", authority: "AMSManaged", write: ADMIN },
  { field: "evidence", display: "Evidence", definition: "Rule evidence. Restricted values are stripped.", dataType: "jsonb", authority: "SystemDerived", export: ADMIN },
  { field: "resolution_note", display: "Resolution note", definition: "Note recorded at verification.", dataType: "text", authority: "AMSManaged", write: ADMIN },
  { field: "waiver_reason", display: "Waiver reason", definition: "Required for a waiver.", dataType: "text", authority: "AMSManaged", write: ADMIN },
  { field: "waiver_approver_user_id", display: "Waiver approver", definition: "Approver, who must not be the requester.", dataType: "text", authority: "AMSManaged", write: ADMIN, classification: CLASS_CONFIDENTIAL },
  { field: "waiver_expires_at", display: "Waiver expires", definition: "Required expiry. After expiry a still-failing record reopens.", dataType: "timestamptz", authority: "AMSManaged", write: ADMIN },
  { field: "verification_type", display: "Verification type", definition: "RuleReevaluation or ManualApproved.", dataType: "text", authority: "SystemDerived" },
  { field: "related_job_id", display: "Related job", definition: "QualityRuleRun or later job that last touched the issue.", dataType: "text", authority: "SystemDerived" },
  { field: "row_version", display: "Row version", definition: "Optimistic concurrency token.", dataType: "integer", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the issue row was created.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "updated_at", display: "Updated at", definition: "When the issue row last changed.", dataType: "timestamptz", authority: "SystemDerived" },
]);

const dataJob = expand("data_job", "Data Owner", "Data Steward", [
  { field: "id", display: "Job id", definition: "Immutable job identity.", dataType: "text", authority: "SystemDerived" },
  { field: "job_type", display: "Job type", definition: "Named job type. QualityRuleRun is the first proof.", dataType: "text", authority: "SystemDerived" },
  { field: "status", display: "Status", definition: "Job lifecycle status.", dataType: "text", authority: "SystemDerived" },
  { field: "schema_version", display: "Schema version", definition: "Contract/schema version the job ran against.", dataType: "text", authority: "SystemDerived" },
  { field: "environment", display: "Environment", definition: "Environment the job ran in.", dataType: "text", authority: "SystemDerived" },
  { field: "requested_by", display: "Requested by", definition: "Authenticated requester.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
  { field: "approved_by", display: "Approved by", definition: "Approver where required.", dataType: "text", authority: "SystemDerived", classification: CLASS_CONFIDENTIAL },
  { field: "idempotency_key", display: "Idempotency key", definition: "Client submission id for the job.", dataType: "text", authority: "SystemDerived" },
  { field: "request_hash", display: "Request hash", definition: "Canonical hash of the job request.", dataType: "text", authority: "SystemDerived" },
  { field: "source_name", display: "Source name", definition: "Optional source label.", dataType: "text", authority: "AMSManaged" },
  { field: "source_hash", display: "Source hash", definition: "Optional source hash.", dataType: "text", authority: "SystemDerived" },
  { field: "request_parameters", display: "Request parameters", definition: "Job parameters. Secrets excluded.", dataType: "jsonb", authority: "SystemDerived", export: ADMIN },
  { field: "code_version", display: "Code version", definition: "Implementation version that ran.", dataType: "text", authority: "SystemDerived" },
  { field: "reversibility_class", display: "Reversibility", definition: "Reversible, Compensatable or Irreversible.", dataType: "text", authority: "SystemDerived" },
  { field: "dry_run_summary", display: "Dry-run summary", definition: "Counts from a dry run, when the job type has one.", dataType: "jsonb", authority: "SystemDerived" },
  { field: "result_summary", display: "Result summary", definition: "Final counts. No silent row loss.", dataType: "jsonb", authority: "SystemDerived" },
  { field: "started_at", display: "Started at", definition: "When the job started.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "completed_at", display: "Completed at", definition: "When the job finished.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "artifact_path", display: "Artifact path", definition: "Private artifact path. Not a browser credential.", dataType: "text", authority: "SystemDerived", read: ADMIN, export: OWNER, offline: false },
  { field: "artifact_expires_at", display: "Artifact expires", definition: "When the private artifact expires.", dataType: "timestamptz", authority: "SystemDerived" },
  { field: "correlation_id", display: "Correlation id", definition: "Correlation identifier.", dataType: "text", authority: "SystemDerived" },
  { field: "created_at", display: "Created at", definition: "When the job header was created.", dataType: "timestamptz", authority: "SystemDerived" },
]);

export const FIELD_DICTIONARY: DataDictionaryEntry[] = [
  ...location,
  ...equipmentModel,
  ...project,
  ...manufacturer,
  ...equipmentCategory,
  ...asset,
  ...txn,
  ...line,
  ...relationship,
  ...calibration,
  ...idSequence,
  ...installation,
  ...instComp,
  ...officeAdmin,
  ...idempotency,
  ...appUser,
  ...appUserRole,
  ...userOfficeScope,
  ...assetIdentifier,
  ...outbox,
  ...outboxDelivery,
  ...suppression,
  ...alert,
  ...document,
  ...calDoc,
  ...meta,
  ...schemaMigration,
  ...dictionary,
  ...qualityRule,
  ...qualityIssue,
  ...dataJob,
];

/** Fields whose values must never appear in a general DTO or quality evidence blob. */
export const RESTRICTED_FIELD_NAMES = [...RESTRICTED_FIELDS];

export function dictionaryContradictions(entries: DataDictionaryEntry[] = FIELD_DICTIONARY): Array<{ entityName: string; fieldName: string; detail: string }> {
  const out: Array<{ entityName: string; fieldName: string; detail: string }> = [];
  for (const e of entries) {
    if (RESTRICTED_FIELDS.has(e.fieldName)) {
      if (e.offlineCacheAllowed) out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "restricted field cannot be offline-cached" });
      if (e.readRoles.includes("FieldUser")) out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "restricted field cannot be readable by FieldUser" });
      if (e.exportRoles.includes("FieldUser")) out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "restricted field cannot be generally exportable" });
      if (e.classification !== CLASS_RESTRICTED) out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "restricted field must carry Unapproved:Restricted until OD-4" });
    }
    if (!e.lineageSource) {
      out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "every production field needs a lineage source (FR-002)" });
    }
    if (!e.ownerRole || !e.stewardRole) {
      out.push({ entityName: e.entityName, fieldName: e.fieldName, detail: "every production field needs quality ownership (owner and steward roles)" });
    }
  }
  return out;
}
