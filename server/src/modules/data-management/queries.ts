/**
 * Quality overview and issue-queue reads. Server-side paging only (FR-080).
 * Every overview count names the governing ruleKey so the UI can link (FR-015).
 */
import type { QualityIssuePage, QualityOverviewCounts } from "../../../../packages/contracts/src/dataManagement";
import type { AuthUser } from "../../auth/roles";
import { isGlobalScope } from "../../auth/roles";
import type { Queryable } from "../../db/database";
import { ISSUE_SELECT, canSeeIssue, issueFromRow, type IssueRow } from "./commands";
import { ensureRules } from "./engine";
import {
  RULE_CAL_OVERDUE,
  RULE_CAL_UNKNOWN_DUE,
  RULE_MISSING_HOME,
  RULE_OFFICE_NO_ADMIN,
  RULE_SHARED_SERIAL,
  RULE_TEMPORARY_TAG,
  RULE_UNKNOWN_CUSTODIAN,
  RULE_VERSION_STAMP,
} from "./ruleCatalogue";

const OPEN = ["Open", "Assigned", "InProgress", "Blocked", "Reopened"];

export async function qualityOverview(db: Queryable, user: AuthUser): Promise<QualityOverviewCounts> {
  await ensureRules(db);
  const scoped = !isGlobalScope(user) && !(user.roles.includes("FieldUser") && user.roles.length === 1);
  const offices = (user.scopedOffices ?? []).map((o) => o.toLowerCase());
  const rows = await db.query<{
    severity: string;
    domain: string;
    office_location_id: string | null;
    rule_key: string;
    age_bucket: string;
    n: number;
  }>(
    `SELECT i.severity, r.domain, i.office_location_id, r.rule_key,
            CASE
              WHEN extract(epoch from (now() - i.first_detected_at)) / 86400 <= 7 THEN 'd0_7'
              WHEN extract(epoch from (now() - i.first_detected_at)) / 86400 <= 30 THEN 'd8_30'
              ELSE 'd31plus'
            END AS age_bucket,
            count(*)::int AS n
       FROM data_quality_issue i
       JOIN data_quality_rule r ON r.id = i.rule_id
      WHERE i.status = ANY($1::text[])
        AND ($2::boolean = false OR i.office_location_id IS NULL OR lower(i.office_location_id) = ANY($3::text[]))
      GROUP BY 1,2,3,4,5`,
    [OPEN, scoped, offices]
  );

  const bySeverity: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const byDomain: Record<string, number> = {};
  const byOffice: Record<string, number> = {};
  const byAgeBucket: Record<string, number> = { d0_7: 0, d8_30: 0, d31plus: 0 };
  const byRule: Record<string, number> = {};
  for (const r of rows.rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + r.n;
    const office = r.office_location_id ?? "(none)";
    byOffice[office] = (byOffice[office] ?? 0) + r.n;
    byRule[r.rule_key] = (byRule[r.rule_key] ?? 0) + r.n;
    byAgeBucket[r.age_bucket] = (byAgeBucket[r.age_bucket] ?? 0) + r.n;
  }

  const calUnknown = byRule[RULE_CAL_UNKNOWN_DUE] ?? 0;
  const calOverdue = byRule[RULE_CAL_OVERDUE] ?? 0;
  return {
    bySeverity,
    byDomain,
    byOffice,
    byAgeBucket,
    temporaryTags: byRule[RULE_TEMPORARY_TAG] ?? 0,
    unknownCustodians: byRule[RULE_UNKNOWN_CUSTODIAN] ?? 0,
    calibrationUnknown: calUnknown,
    calibrationOverdue: calOverdue,
    calibrationUnknownOrOverdue: calUnknown + calOverdue,
    duplicateCandidates: byRule[RULE_SHARED_SERIAL] ?? 0,
    failedJobs: 0,
    missingOrQuarantinedDocuments: 0,
    reconciliationFailures: 0,
    ruleVersion: RULE_VERSION_STAMP,
    dataCurrency: new Date().toISOString(),
    links: {
      bySeverity: "/api/data-management/quality/issues?status=Open",
      temporaryTags: `/api/data-management/quality/issues?ruleKey=${RULE_TEMPORARY_TAG}`,
      unknownCustodians: `/api/data-management/quality/issues?ruleKey=${RULE_UNKNOWN_CUSTODIAN}`,
      calibrationUnknown: `/api/data-management/quality/issues?ruleKey=${RULE_CAL_UNKNOWN_DUE}`,
      calibrationOverdue: `/api/data-management/quality/issues?ruleKey=${RULE_CAL_OVERDUE}`,
      calibrationUnknownOrOverdue: `/api/data-management/quality/issues?ruleKey=${RULE_CAL_UNKNOWN_DUE},${RULE_CAL_OVERDUE}`,
      duplicateCandidates: `/api/data-management/quality/issues?ruleKey=${RULE_SHARED_SERIAL}`,
      missingHomeOffice: `/api/data-management/quality/issues?ruleKey=${RULE_MISSING_HOME}`,
      officeNoAdmin: `/api/data-management/quality/issues?ruleKey=${RULE_OFFICE_NO_ADMIN}`,
    },
  };
}

export async function listQualityIssues(
  db: Queryable,
  user: AuthUser,
  q: {
    officeId?: string;
    domain?: string;
    severity?: string;
    status?: string;
    ownerUserId?: string;
    ruleKey?: string;
    page: number;
    pageSize: number;
  }
): Promise<QualityIssuePage> {
  await ensureRules(db);
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.officeId) add("lower(i.office_location_id) = lower(?)", q.officeId);
  if (q.domain) add("r.domain = ?", q.domain);
  if (q.severity) add("i.severity = ?", q.severity);
  if (q.status) {
    const statuses = q.status.split(",").map((s) => s.trim()).filter(Boolean);
    add("i.status = ANY(?::text[])", statuses);
  }
  if (q.ownerUserId) add("i.owner_user_id = ?", q.ownerUserId);
  if (q.ruleKey) {
    const keys = q.ruleKey.split(",").map((s) => s.trim()).filter(Boolean);
    add("r.rule_key = ANY(?::text[])", keys);
  }
  if (!isGlobalScope(user) && !(user.roles.includes("FieldUser") && user.roles.length === 1)) {
    const offices = (user.scopedOffices ?? []).map((o) => o.toLowerCase());
    add("(i.office_location_id IS NULL OR lower(i.office_location_id) = ANY(?::text[]))", offices);
  }
  const clause = where.join(" AND ");
  const total = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM data_quality_issue i JOIN data_quality_rule r ON r.id = i.rule_id WHERE ${clause}`,
    params
  );
  const offset = (q.page - 1) * q.pageSize;
  params.push(q.pageSize, offset);
  const rows = await db.query<IssueRow>(
    `${ISSUE_SELECT} WHERE ${clause}
      ORDER BY CASE i.severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
               i.last_detected_at DESC, i.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const items = rows.rows.map(issueFromRow).filter((i) => canSeeIssue(user, i.officeLocationId));
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total: total.rows[0]?.n ?? 0,
    dataCurrency: new Date().toISOString(),
    ruleVersion: RULE_VERSION_STAMP,
  };
}

export { canSeeIssue };
