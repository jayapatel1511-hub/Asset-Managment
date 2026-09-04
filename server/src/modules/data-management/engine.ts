/**
 * Data-quality rule engine.
 *
 * One issue per (rule, entity, scope). A re-run updates that row; it never
 * opens a second. An issue reaches Resolved only when the record now passes
 * (RuleReevaluation) or an approved ManualApproved verification is recorded.
 * Duplicate serials are candidates. Restricted field values never enter evidence.
 */
import { randomUUID } from "node:crypto";
import type { Queryable, Tx } from "../../db/database";
import { resolveEnvironment } from "../../db/database";
import { FIELD_DICTIONARY, RESTRICTED_FIELD_NAMES } from "./fieldCatalogue";
import {
  QUALITY_RULES,
  RULE_CAL_OVERDUE,
  RULE_CAL_UNKNOWN_DUE,
  RULE_MISSING_HOME,
  RULE_MISSING_SERIAL,
  RULE_OFFICE_NO_ADMIN,
  RULE_SHARED_SERIAL,
  RULE_TEMPORARY_TAG,
  RULE_UNKNOWN_CUSTODIAN,
  RULE_VERSION_STAMP,
  qualityAlertStub,
} from "./ruleCatalogue";

const RESTRICTED = new Set(RESTRICTED_FIELD_NAMES);
const OPENISH = new Set(["Open", "Assigned", "InProgress", "Blocked", "Reopened"]);
const TERMINAL_KEEP = new Set(["FalsePositive"]);

export interface Finding {
  ruleKey: string;
  entityType: string;
  entityId: string;
  scopeKey: string;
  office: string | null;
  evidence: Record<string, unknown>;
}

export interface RuleRunSummary {
  jobId: string;
  opened: number;
  updated: number;
  resolved: number;
  reopened: number;
  findings: number;
  dataCurrency: string;
  ruleVersion: string;
}

interface RuleRow {
  id: string;
  rule_key: string;
  version: number;
  severity: string;
  is_active: boolean;
}

interface IssueRow {
  id: string;
  rule_id: string;
  status: string;
  row_version: number;
  waiver_expires_at: Date | string | null;
}

function scrub(evidence: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(evidence)) {
    if (RESTRICTED.has(k.toLowerCase())) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = scrub(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function ensureRules(db: Queryable): Promise<void> {
  const existing = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM data_quality_rule");
  if ((existing.rows[0]?.n ?? 0) >= QUALITY_RULES.length) return;
  for (const r of QUALITY_RULES) {
    await db.query(
      `INSERT INTO data_quality_rule (
         id, rule_key, version, domain, severity, owner_user_id, schedule, is_active,
         implementation_ref, title, description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (rule_key, version) DO UPDATE SET
         domain = EXCLUDED.domain,
         severity = EXCLUDED.severity,
         is_active = EXCLUDED.is_active,
         implementation_ref = EXCLUDED.implementation_ref,
         title = EXCLUDED.title,
         description = EXCLUDED.description`,
      [r.id, r.ruleKey, r.version, r.domain, r.severity, r.ownerUserId ?? null, r.schedule ?? null, r.isActive, r.implementationRef, r.title, r.description]
    );
  }
}

async function todayIso(db: Queryable): Promise<string> {
  const res = await db.query<{ d: string }>("SELECT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d");
  return res.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
}

async function collectFindings(db: Queryable, today: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  const unknown = await db.query<{ id: string; assetid: string; homeoffice: string | null }>(
    `SELECT a.id, a.assetid, a.homeoffice
       FROM asset a
       JOIN equipment_model m
         ON m.manufacturer = a.manufacturer AND m.model = a.model AND m.equipmenttype = a.equipmenttype
      WHERE a.lifecycle = 'Active'
        AND (m.defaultcalintervalmonths IS NOT NULL OR a.lastcaldate IS NOT NULL OR a.nextcaldue IS NOT NULL)
        AND (a.nextcaldue IS NULL OR btrim(a.nextcaldue) = '')`
  );
  for (const r of unknown.rows) {
    findings.push({
      ruleKey: RULE_CAL_UNKNOWN_DUE,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "calibration-unknown-due",
      office: r.homeoffice,
      evidence: { assetid: r.assetid, nextcaldue: null },
    });
  }

  const overdue = await db.query<{ id: string; assetid: string; homeoffice: string | null; nextcaldue: string }>(
    `SELECT a.id, a.assetid, a.homeoffice, a.nextcaldue
       FROM asset a
       JOIN equipment_model m
         ON m.manufacturer = a.manufacturer AND m.model = a.model AND m.equipmenttype = a.equipmenttype
      WHERE a.lifecycle = 'Active'
        AND a.status <> 'InCalibration'
        AND a.nextcaldue IS NOT NULL AND btrim(a.nextcaldue) <> ''
        AND a.nextcaldue < $1
        AND (m.defaultcalintervalmonths IS NOT NULL OR a.lastcaldate IS NOT NULL OR a.nextcaldue IS NOT NULL)`,
    [today]
  );
  for (const r of overdue.rows) {
    findings.push({
      ruleKey: RULE_CAL_OVERDUE,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "calibration-overdue",
      office: r.homeoffice,
      evidence: { assetid: r.assetid, nextcaldue: r.nextcaldue, asOf: today },
    });
  }

  const noHome = await db.query<{ id: string; assetid: string; homeoffice: string | null }>(
    `SELECT id, assetid, homeoffice FROM asset
      WHERE lifecycle = 'Active'
        AND (homeoffice IS NULL OR btrim(homeoffice) = '' OR homeoffice = 'Unassigned')`
  );
  for (const r of noHome.rows) {
    findings.push({
      ruleKey: RULE_MISSING_HOME,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "missing-home-office",
      office: r.homeoffice,
      evidence: { assetid: r.assetid, homeoffice: r.homeoffice },
    });
  }

  const noSerial = await db.query<{ id: string; assetid: string; homeoffice: string | null }>(
    `SELECT a.id, a.assetid, a.homeoffice
       FROM asset a
       JOIN equipment_model m
         ON m.manufacturer = a.manufacturer AND m.model = a.model AND m.equipmenttype = a.equipmenttype
      WHERE a.lifecycle = 'Active'
        AND m.isserialised
        AND (a.serialnumber IS NULL OR btrim(a.serialnumber) = '')`
  );
  for (const r of noSerial.rows) {
    findings.push({
      ruleKey: RULE_MISSING_SERIAL,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "missing-serial",
      office: r.homeoffice,
      evidence: { assetid: r.assetid, serialRequired: true },
    });
  }

  const temps = await db.query<{ id: string; assetid: string; homeoffice: string | null }>(
    `SELECT id, assetid, homeoffice FROM asset
      WHERE lifecycle = 'Active' AND btrim(assetid) ~ '^TMP-[^-]+$'`
  );
  for (const r of temps.rows) {
    findings.push({
      ruleKey: RULE_TEMPORARY_TAG,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "temporary-tag",
      office: r.homeoffice,
      evidence: { assetid: r.assetid },
    });
  }

  const unknownCustodian = await db.query<{ id: string; assetid: string; homeoffice: string | null }>(
    `SELECT id, assetid, homeoffice FROM asset
      WHERE lifecycle = 'Active' AND status = 'CheckedOut'
        AND (custodian IS NULL OR btrim(custodian) = '')`
  );
  for (const r of unknownCustodian.rows) {
    findings.push({
      ruleKey: RULE_UNKNOWN_CUSTODIAN,
      entityType: "asset",
      entityId: r.id,
      scopeKey: "unknown-custodian",
      office: r.homeoffice,
      evidence: { assetid: r.assetid, status: "CheckedOut" },
    });
  }

  const offices = await db.query<{ id: string; name: string }>(
    `SELECT l.id, l.name
       FROM location l
       LEFT JOIN office_admin_assignment o ON o.office = l.name
      WHERE l.locationtype = 'Office' AND l.isactive
        AND (o.office IS NULL OR o.admin_upns IS NULL OR o.admin_upns = '[]'::jsonb)`
  );
  for (const r of offices.rows) {
    findings.push({
      ruleKey: RULE_OFFICE_NO_ADMIN,
      entityType: "location",
      entityId: r.id,
      scopeKey: "office-no-admin",
      office: r.name,
      evidence: { office: r.name },
    });
  }

  const shared = await db.query<{ serial_key: string; assetids: string[]; ids: string[]; n: number }>(
    `SELECT lower(btrim(serialnumber)) AS serial_key,
            array_agg(assetid ORDER BY assetid) AS assetids,
            array_agg(id ORDER BY assetid) AS ids,
            count(*)::int AS n
       FROM asset
      WHERE lifecycle = 'Active'
        AND serialnumber IS NOT NULL AND btrim(serialnumber) <> ''
      GROUP BY 1
     HAVING count(*) > 1`
  );
  for (const r of shared.rows) {
    findings.push({
      ruleKey: RULE_SHARED_SERIAL,
      entityType: "serial",
      entityId: r.serial_key,
      scopeKey: "shared-serial",
      office: null,
      evidence: {
        assetCount: r.n,
        assetIds: r.assetids,
        candidateOnly: true,
        autoMerge: false,
        note: "Shared serials are a valid pattern. Duplicate detection never auto-merges.",
      },
    });
  }

  return findings;
}

async function upsertFinding(
  tx: Tx,
  finding: Finding,
  rule: RuleRow,
  now: Date,
  jobId: string,
  counts: { opened: number; updated: number; reopened: number }
): Promise<void> {
  const evidence = scrub(finding.evidence);
  const existing = await tx.query<IssueRow>(
    `SELECT id, rule_id, status, row_version, waiver_expires_at
       FROM data_quality_issue
      WHERE rule_id = $1 AND entity_type = $2 AND entity_id = $3 AND scope_key = $4`,
    [rule.id, finding.entityType, finding.entityId, finding.scopeKey]
  );
  const row = existing.rows[0];
  if (!row) {
    await tx.query(
      `INSERT INTO data_quality_issue (
         id, rule_id, rule_version, entity_type, entity_id, scope_key, severity, status,
         office_location_id, first_detected_at, last_detected_at, evidence, related_job_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Open',$8,$9,$9,$10::jsonb,$11)`,
      [randomUUID(), rule.id, rule.version, finding.entityType, finding.entityId, finding.scopeKey, rule.severity, finding.office, now.toISOString(), JSON.stringify(evidence), jobId]
    );
    counts.opened += 1;
    return;
  }
  if (TERMINAL_KEEP.has(row.status)) {
    await tx.query(
      `UPDATE data_quality_issue SET last_detected_at = $1, evidence = $2::jsonb, related_job_id = $3, row_version = row_version + 1, updated_at = $1
        WHERE id = $4`,
      [now.toISOString(), JSON.stringify(evidence), jobId, row.id]
    );
    counts.updated += 1;
    return;
  }
  const waiverExpired = row.status === "Waived" && row.waiver_expires_at && new Date(row.waiver_expires_at).getTime() <= now.getTime();
  if (row.status === "Waived" && !waiverExpired) {
    await tx.query(
      `UPDATE data_quality_issue SET last_detected_at = $1, evidence = $2::jsonb, related_job_id = $3, row_version = row_version + 1, updated_at = $1
        WHERE id = $4`,
      [now.toISOString(), JSON.stringify(evidence), jobId, row.id]
    );
    counts.updated += 1;
    return;
  }
  const nextStatus = row.status === "Resolved" || waiverExpired ? "Reopened" : row.status;
  if (nextStatus === "Reopened") counts.reopened += 1;
  else counts.updated += 1;
  await tx.query(
    `UPDATE data_quality_issue
        SET last_detected_at = $1, evidence = $2::jsonb, related_job_id = $3, status = $4,
            office_location_id = $5, verification_type = NULL, row_version = row_version + 1, updated_at = $1
      WHERE id = $6`,
    [now.toISOString(), JSON.stringify(evidence), jobId, nextStatus, finding.office, row.id]
  );
}

async function closePassing(
  tx: Tx,
  stillFailing: Set<string>,
  rulesByKey: Map<string, RuleRow>,
  now: Date,
  jobId: string
): Promise<number> {
  const activeIds = [...rulesByKey.values()].map((r) => r.id);
  if (activeIds.length === 0) return 0;
  const open = await tx.query<IssueRow & { entity_type: string; entity_id: string; scope_key: string; rule_id: string }>(
    `SELECT id, rule_id, status, row_version, waiver_expires_at, entity_type, entity_id, scope_key
       FROM data_quality_issue
      WHERE rule_id = ANY($1::text[])
        AND status = ANY($2::text[])`,
    [activeIds, [...OPENISH, "Waived"]]
  );
  let resolved = 0;
  for (const row of open.rows) {
    const key = `${row.rule_id}|${row.entity_type}|${row.entity_id}|${row.scope_key}`;
    if (stillFailing.has(key)) continue;
    if (row.status === "Waived") {
      const expired = row.waiver_expires_at && new Date(row.waiver_expires_at).getTime() <= now.getTime();
      if (!expired) continue;
    }
    await tx.query(
      `UPDATE data_quality_issue
          SET status = 'Resolved', verification_type = 'RuleReevaluation', related_job_id = $1,
              row_version = row_version + 1, updated_at = $2
        WHERE id = $3`,
      [jobId, now.toISOString(), row.id]
    );
    resolved += 1;
  }
  return resolved;
}

export async function runQualityRules(
  db: Queryable & { transaction?: (body: (tx: Tx) => Promise<RuleRunSummary>) => Promise<RuleRunSummary> },
  opts: { requestedBy: string; clientSubmissionId: string; requestHash: string }
): Promise<RuleRunSummary> {
  await ensureRules(db);
  const today = await todayIso(db);
  const findings = await collectFindings(db, today);
  const rules = await db.query<RuleRow>("SELECT id, rule_key, version, severity, is_active FROM data_quality_rule WHERE is_active");
  const byKey = new Map(rules.rows.map((r) => [r.rule_key, r]));
  const now = new Date();
  const jobId = randomUUID();
  const env = resolveEnvironment();

  const apply = async (tx: Tx): Promise<RuleRunSummary> => {
    await tx.query(
      `INSERT INTO data_job (
         id, job_type, status, schema_version, environment, requested_by, idempotency_key, request_hash,
         request_parameters, code_version, reversibility_class, started_at, correlation_id
       ) VALUES ($1,'QualityRuleRun','Running','011-us1',$2,$3,$4,$5,$6::jsonb,$7,'Reversible',$8,$1)`,
      [jobId, env, opts.requestedBy, opts.clientSubmissionId, opts.requestHash, JSON.stringify({ today }), RULE_VERSION_STAMP, now.toISOString()]
    );
    const counts = { opened: 0, updated: 0, reopened: 0 };
    const failing = new Set<string>();
    for (const finding of findings) {
      const rule = byKey.get(finding.ruleKey);
      if (!rule) continue;
      failing.add(`${rule.id}|${finding.entityType}|${finding.entityId}|${finding.scopeKey}`);
      await upsertFinding(tx, finding, rule, now, jobId, counts);
      if (rule.severity === "Critical") {
        qualityAlertStub({ ruleKey: finding.ruleKey, severity: "Critical", ownerUserId: null, entityId: finding.entityId });
      }
    }
    const resolved = await closePassing(tx, failing, byKey, now, jobId);
    const summary = {
      jobId,
      opened: counts.opened,
      updated: counts.updated,
      resolved,
      reopened: counts.reopened,
      findings: findings.length,
      dataCurrency: now.toISOString(),
      ruleVersion: RULE_VERSION_STAMP,
    };
    await tx.query(
      `UPDATE data_job SET status = 'Completed', completed_at = $1, result_summary = $2::jsonb WHERE id = $3`,
      [now.toISOString(), JSON.stringify(summary), jobId]
    );
    return summary;
  };

  if (typeof db.transaction === "function") return db.transaction(apply);
  return apply(db as Tx);
}

export async function evaluateIssueStillFails(db: Queryable, issue: { rule_key: string; entity_type: string; entity_id: string; scope_key: string }): Promise<boolean> {
  const today = await todayIso(db);
  const findings = await collectFindings(db, today);
  return findings.some(
    (f) => f.ruleKey === issue.rule_key && f.entityType === issue.entity_type && f.entityId === issue.entity_id && f.scopeKey === issue.scope_key
  );
}

export function dictionaryFieldCount(): number {
  return FIELD_DICTIONARY.length;
}
