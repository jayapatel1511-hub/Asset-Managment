/**
 * Feature 011 first-proof wire types — field dictionary and quality issues.
 * Shapes follow `specs/011-data-management/contracts/field-dictionary.md` and
 * `contracts/quality-issue.md`. Writes are named commands, never a generic PATCH.
 */
export type FieldAuthorityMode =
  | "SystemDerived"
  | "AMSManaged"
  | "ExternalAuthoritative"
  | "ImportedOnce"
  | "ReferenceOnly";

export interface DataDictionaryEntry {
  id: string;
  entityName: string;
  fieldName: string;
  displayName: string;
  definition: string;
  dataType: string;
  allowedValues?: unknown;
  ownerRole: string;
  stewardRole: string;
  authorityMode: FieldAuthorityMode;
  /** OD-4: Dev placeholder until the corporate taxonomy is approved. */
  classification: string;
  readRoles: string[];
  writeRoles: string[];
  exportRoles: string[];
  offlineCacheAllowed: boolean;
  retentionClass: string;
  qualityRuleIds: string[];
  lineageSource?: string | null;
  deprecatedAt?: string | null;
  replacedByField?: string | null;
  rowVersion: number;
}

export interface DictionaryCoverageReport {
  totalProductionFields: number;
  withEntry: number;
  missing: Array<{ entityName: string; fieldName: string }>;
  contradictions: Array<{ entityName: string; fieldName: string; detail: string }>;
  asOf: string;
}

export interface DictionaryPage {
  items: DataDictionaryEntry[];
  page: number;
  pageSize: number;
  total: number;
  dataCurrency: string;
}

export type QualityIssueStatus =
  | "Open"
  | "Assigned"
  | "InProgress"
  | "Blocked"
  | "Resolved"
  | "Waived"
  | "FalsePositive"
  | "Reopened";

export type QualitySeverity = "Critical" | "High" | "Medium" | "Low";

export interface DataQualityRule {
  id: string;
  ruleKey: string;
  version: number;
  domain: string;
  severity: QualitySeverity;
  ownerUserId?: string | null;
  schedule?: string | null;
  isActive: boolean;
  implementationRef: string;
  title: string;
  description: string;
}

export interface DataQualityIssue {
  id: string;
  ruleId: string;
  ruleKey: string;
  domain: string;
  ruleVersion: number;
  entityType: string;
  entityId: string;
  scopeKey: string;
  severity: QualitySeverity;
  status: QualityIssueStatus;
  officeLocationId?: string | null;
  ownerUserId?: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  dueAt?: string | null;
  evidence: Record<string, unknown>;
  resolutionNote?: string | null;
  waiverReason?: string | null;
  waiverApproverUserId?: string | null;
  waiverExpiresAt?: string | null;
  verificationType?: "RuleReevaluation" | "ManualApproved" | null;
  relatedJobId?: string | null;
  rowVersion: number;
}

export interface QualityOverviewCounts {
  bySeverity: Record<string, number>;
  byDomain: Record<string, number>;
  byOffice: Record<string, number>;
  byAgeBucket: Record<string, number>;
  temporaryTags: number;
  unknownCustodians: number;
  calibrationUnknownOrOverdue: number;
  calibrationUnknown: number;
  calibrationOverdue: number;
  duplicateCandidates: number;
  failedJobs: number;
  missingOrQuarantinedDocuments: number;
  reconciliationFailures: number;
  ruleVersion: string;
  dataCurrency: string;
  /** Each count names the governing ruleKey so the UI can link (FR-015). */
  links: Record<string, string>;
}

export interface QualityIssuePage {
  items: DataQualityIssue[];
  page: number;
  pageSize: number;
  total: number;
  dataCurrency: string;
  ruleVersion: string;
}

export interface QualityCommandResult {
  ok: true;
  issue?: DataQualityIssue;
  jobId?: string;
  opened: number;
  updated: number;
  resolved: number;
  reopened: number;
}

export interface QualityCommandError {
  ok: false;
  error: string;
  reason: string;
}

export type QualityCommandOutcome = QualityCommandResult | QualityCommandError;
