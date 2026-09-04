/**
 * Named quality commands. No generic PATCH. Closure requires re-evaluation
 * or an approved manual verification (FR-012). Waivers need reason, a
 * different approver, and an expiry (FR-013). Same submission id + different
 * body is refused (rule 3).
 */
import { createHash } from "node:crypto";
import type { DataQualityIssue, QualityCommandOutcome } from "../../../../packages/contracts/src/dataManagement";
import type { AuthUser } from "../../auth/roles";
import { isGlobalScope, scopeCovers } from "../../auth/roles";
import type { Database, Queryable, Tx } from "../../db/database";
import { evaluateIssueStillFails, runQualityRules } from "./engine";

export interface IssueRow {
  id: string;
  rule_id: string;
  rule_key: string;
  domain: string;
  rule_version: number;
  entity_type: string;
  entity_id: string;
  scope_key: string;
  severity: DataQualityIssue["severity"];
  status: DataQualityIssue["status"];
  office_location_id: string | null;
  owner_user_id: string | null;
  first_detected_at: Date | string;
  last_detected_at: Date | string;
  due_at: Date | string | null;
  evidence: Record<string, unknown>;
  resolution_note: string | null;
  waiver_reason: string | null;
  waiver_approver_user_id: string | null;
  waiver_expires_at: Date | string | null;
  verification_type: DataQualityIssue["verificationType"];
  related_job_id: string | null;
  row_version: number;
}

const ISSUE_SELECT = `
  SELECT i.*, r.rule_key, r.domain
    FROM data_quality_issue i
    JOIN data_quality_rule r ON r.id = i.rule_id
`;

export function issueFromRow(r: IssueRow): DataQualityIssue {
  const iso = (v: Date | string | null | undefined): string | null => {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  };
  return {
    id: r.id,
    ruleId: r.rule_id,
    ruleKey: r.rule_key,
    domain: r.domain,
    ruleVersion: r.rule_version,
    entityType: r.entity_type,
    entityId: r.entity_id,
    scopeKey: r.scope_key,
    severity: r.severity,
    status: r.status,
    officeLocationId: r.office_location_id,
    ownerUserId: r.owner_user_id,
    firstDetectedAt: iso(r.first_detected_at) ?? "",
    lastDetectedAt: iso(r.last_detected_at) ?? "",
    dueAt: iso(r.due_at),
    evidence: r.evidence ?? {},
    resolutionNote: r.resolution_note,
    waiverReason: r.waiver_reason,
    waiverApproverUserId: r.waiver_approver_user_id,
    waiverExpiresAt: iso(r.waiver_expires_at),
    verificationType: r.verification_type ?? null,
    relatedJobId: r.related_job_id,
    rowVersion: r.row_version,
  };
}

export async function loadIssue(db: Queryable, id: string): Promise<IssueRow | null> {
  const res = await db.query<IssueRow>(`${ISSUE_SELECT} WHERE i.id = $1`, [id]);
  return res.rows[0] ?? null;
}

function fail(error: string, reason: string): QualityCommandOutcome {
  return { ok: false, error, reason };
}

export function canSeeIssue(user: AuthUser, office: string | null | undefined): boolean {
  if (isGlobalScope(user)) return true;
  if (user.roles.includes("FieldUser") && !user.roles.includes("OfficeAdmin") && !user.roles.includes("ReportReader") && !user.roles.includes("SystemOwner")) {
    return true;
  }
  if (!office) return isGlobalScope(user);
  return scopeCovers(user, office);
}

export function canWriteIssue(user: AuthUser, office: string | null | undefined): boolean {
  if (!user.roles.includes("OfficeAdmin") && !user.roles.includes("SystemOwner")) return false;
  if (isGlobalScope(user)) return true;
  if (!office) return false;
  return scopeCovers(user, office);
}

function hashRequest(body: unknown): string {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  };
  return createHash("sha256").update(stable(body)).digest("hex");
}

interface IdempotencyRow {
  response: QualityCommandOutcome | null;
  request_hash: string;
}

async function runNamed<T extends QualityCommandOutcome>(
  db: Database,
  meta: { clientSubmissionId: string; command: string; user: AuthUser; request: unknown },
  body: (tx: Tx) => Promise<T>
): Promise<T> {
  const requestHash = hashRequest(meta.request);
  const prior = await db.query<IdempotencyRow>(
    "SELECT response, request_hash FROM command_idempotency WHERE client_submission_id = $1",
    [meta.clientSubmissionId]
  );
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      return fail("quality.idempotencyPayloadMismatch", "This submission was already used for a different request.") as T;
    }
    if (prior.rows[0].response) return prior.rows[0].response as T;
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO command_idempotency (client_submission_id, request_hash, user_upn, command, response, created_at)
         VALUES ($1,$2,$3,$4,NULL,$5)`,
        [meta.clientSubmissionId, requestHash, meta.user.upn, meta.command, new Date().toISOString()]
      );
      const outcome = await body(tx);
      if (!outcome.ok) {
        const err = new Error("quality-refusal");
        (err as Error & { outcome: T }).outcome = outcome;
        throw err;
      }
      await tx.query("UPDATE command_idempotency SET response = $1::jsonb WHERE client_submission_id = $2", [
        JSON.stringify(outcome),
        meta.clientSubmissionId,
      ]);
      return outcome;
    });
  } catch (err) {
    const outcome = (err as { outcome?: T }).outcome;
    if (outcome) return outcome;
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      const again = await db.query<IdempotencyRow>(
        "SELECT response, request_hash FROM command_idempotency WHERE client_submission_id = $1",
        [meta.clientSubmissionId]
      );
      if (again.rows[0]?.request_hash !== requestHash) {
        return fail("quality.idempotencyPayloadMismatch", "This submission was already used for a different request.") as T;
      }
      if (again.rows[0]?.response) return again.rows[0].response as T;
    }
    throw err;
  }
}

export async function commandRunRules(
  db: Database,
  user: AuthUser,
  clientSubmissionId: string
): Promise<QualityCommandOutcome> {
  const request = { command: "RunQualityRules" };
  const requestHash = hashRequest({ ...request, clientSubmissionId });
  const prior = await db.query<IdempotencyRow>(
    "SELECT response, request_hash FROM command_idempotency WHERE client_submission_id = $1",
    [clientSubmissionId]
  );
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      return fail("quality.idempotencyPayloadMismatch", "This submission was already used for a different request.");
    }
    if (prior.rows[0].response) return prior.rows[0].response;
  }
  await db.query(
    `INSERT INTO command_idempotency (client_submission_id, request_hash, user_upn, command, response, created_at)
     VALUES ($1,$2,$3,'RunQualityRules',NULL,$4)
     ON CONFLICT (client_submission_id) DO NOTHING`,
    [clientSubmissionId, requestHash, user.upn, new Date().toISOString()]
  );
  const result = await runQualityRules(db, { requestedBy: user.upn, clientSubmissionId, requestHash });
  const outcome: QualityCommandOutcome = {
    ok: true,
    jobId: result.jobId,
    opened: result.opened,
    updated: result.updated,
    resolved: result.resolved,
    reopened: result.reopened,
  };
  await db.query("UPDATE command_idempotency SET response = $1::jsonb WHERE client_submission_id = $2", [
    JSON.stringify(outcome),
    clientSubmissionId,
  ]);
  return outcome;
}

export async function commandAssignIssue(
  db: Database,
  user: AuthUser,
  input: { issueId: string; ownerUserId: string; dueAt?: string | null; clientSubmissionId: string; expectedRowVersion: number }
): Promise<QualityCommandOutcome> {
  return runNamed(db, { clientSubmissionId: input.clientSubmissionId, command: "AssignIssue", user, request: input }, async (tx) => {
    const issue = await loadIssue(tx, input.issueId);
    if (!issue) return fail("quality.issueNotFound", "No such quality issue.");
    if (!canWriteIssue(user, issue.office_location_id)) return fail("quality.forbidden", "This account is not scoped to administer that issue.");
    if (issue.row_version !== input.expectedRowVersion) return fail("quality.staleRowVersion", "The issue changed since it was loaded.");
    await tx.query(
      `UPDATE data_quality_issue
          SET owner_user_id = $1, due_at = $2, status = CASE WHEN status IN ('Open','Reopened') THEN 'Assigned' ELSE status END,
              row_version = row_version + 1, updated_at = now()
        WHERE id = $3`,
      [input.ownerUserId, input.dueAt ?? null, issue.id]
    );
    const next = await loadIssue(tx, issue.id);
    return { ok: true, issue: next ? issueFromRow(next) : undefined, opened: 0, updated: 1, resolved: 0, reopened: 0 };
  });
}

const WORKFLOW_STATUSES = new Set(["Assigned", "InProgress", "Blocked", "Reopened"]);

export async function commandSetIssueStatus(
  db: Database,
  user: AuthUser,
  input: { issueId: string; status: string; clientSubmissionId: string; expectedRowVersion: number }
): Promise<QualityCommandOutcome> {
  return runNamed(db, { clientSubmissionId: input.clientSubmissionId, command: "SetIssueStatus", user, request: input }, async (tx) => {
    if (input.status === "Resolved") {
      return fail("quality.verificationRequired", "An issue closes only after the rule re-runs successfully or an approved manual verification is recorded.");
    }
    if (input.status === "Waived" || input.status === "FalsePositive") {
      return fail("quality.verificationRequired", "Use the dedicated waive or false-positive command.");
    }
    if (!WORKFLOW_STATUSES.has(input.status)) return fail("quality.forbidden", "That status is not set through this command.");
    const issue = await loadIssue(tx, input.issueId);
    if (!issue) return fail("quality.issueNotFound", "No such quality issue.");
    if (!canWriteIssue(user, issue.office_location_id)) return fail("quality.forbidden", "This account is not scoped to administer that issue.");
    if (issue.row_version !== input.expectedRowVersion) return fail("quality.staleRowVersion", "The issue changed since it was loaded.");
    await tx.query(
      `UPDATE data_quality_issue SET status = $1, row_version = row_version + 1, updated_at = now() WHERE id = $2`,
      [input.status, issue.id]
    );
    const next = await loadIssue(tx, issue.id);
    return { ok: true, issue: next ? issueFromRow(next) : undefined, opened: 0, updated: 1, resolved: 0, reopened: 0 };
  });
}

export async function commandWaiveIssue(
  db: Database,
  user: AuthUser,
  input: { issueId: string; reason: string; approverUserId: string; waiverExpiresAt: string; clientSubmissionId: string; expectedRowVersion: number }
): Promise<QualityCommandOutcome> {
  return runNamed(db, { clientSubmissionId: input.clientSubmissionId, command: "WaiveIssue", user, request: input }, async (tx) => {
    if (!input.reason.trim() || !input.approverUserId.trim() || !input.waiverExpiresAt) {
      return fail("quality.waiverIncomplete", "A waiver requires a reason, an approver and an expiry.");
    }
    if (input.approverUserId === user.upn) {
      return fail("quality.selfApprovalForbidden", "The requester cannot approve their own waiver.");
    }
    const issue = await loadIssue(tx, input.issueId);
    if (!issue) return fail("quality.issueNotFound", "No such quality issue.");
    if (!canWriteIssue(user, issue.office_location_id)) return fail("quality.forbidden", "This account is not scoped to administer that issue.");
    if (issue.row_version !== input.expectedRowVersion) return fail("quality.staleRowVersion", "The issue changed since it was loaded.");
    await tx.query(
      `UPDATE data_quality_issue
          SET status = 'Waived', waiver_reason = $1, waiver_approver_user_id = $2, waiver_expires_at = $3,
              row_version = row_version + 1, updated_at = now()
        WHERE id = $4`,
      [input.reason, input.approverUserId, input.waiverExpiresAt, issue.id]
    );
    const next = await loadIssue(tx, issue.id);
    return { ok: true, issue: next ? issueFromRow(next) : undefined, opened: 0, updated: 1, resolved: 0, reopened: 0 };
  });
}

export async function commandMarkFalsePositive(
  db: Database,
  user: AuthUser,
  input: { issueId: string; note: string; clientSubmissionId: string; expectedRowVersion: number }
): Promise<QualityCommandOutcome> {
  return runNamed(db, { clientSubmissionId: input.clientSubmissionId, command: "MarkFalsePositive", user, request: input }, async (tx) => {
    const issue = await loadIssue(tx, input.issueId);
    if (!issue) return fail("quality.issueNotFound", "No such quality issue.");
    if (!canWriteIssue(user, issue.office_location_id)) return fail("quality.forbidden", "This account is not scoped to administer that issue.");
    if (issue.row_version !== input.expectedRowVersion) return fail("quality.staleRowVersion", "The issue changed since it was loaded.");
    await tx.query(
      `UPDATE data_quality_issue
          SET status = 'FalsePositive', resolution_note = $1, row_version = row_version + 1, updated_at = now()
        WHERE id = $2`,
      [input.note, issue.id]
    );
    const next = await loadIssue(tx, issue.id);
    return { ok: true, issue: next ? issueFromRow(next) : undefined, opened: 0, updated: 1, resolved: 0, reopened: 0 };
  });
}

export async function commandVerifyResolution(
  db: Database,
  user: AuthUser,
  input: { issueId: string; verificationType: "RuleReevaluation" | "ManualApproved"; note?: string; approverUserId?: string; clientSubmissionId: string; expectedRowVersion: number }
): Promise<QualityCommandOutcome> {
  return runNamed(db, { clientSubmissionId: input.clientSubmissionId, command: "VerifyResolution", user, request: input }, async (tx) => {
    const issue = await loadIssue(tx, input.issueId);
    if (!issue) return fail("quality.issueNotFound", "No such quality issue.");
    if (!canWriteIssue(user, issue.office_location_id)) return fail("quality.forbidden", "This account is not scoped to administer that issue.");
    if (issue.row_version !== input.expectedRowVersion) return fail("quality.staleRowVersion", "The issue changed since it was loaded.");
    if (input.verificationType === "ManualApproved") {
      const approver = input.approverUserId?.trim() ?? "";
      if (!approver) return fail("quality.verificationRequired", "Manual verification requires an approver.");
      if (approver === user.upn) return fail("quality.selfApprovalForbidden", "The requester cannot approve their own verification.");
    } else {
      const stillFails = await evaluateIssueStillFails(tx, issue);
      if (stillFails) return fail("quality.verificationRequired", "The rule still fails for this record.");
    }
    await tx.query(
      `UPDATE data_quality_issue
          SET status = 'Resolved', verification_type = $1, resolution_note = $2,
              row_version = row_version + 1, updated_at = now()
        WHERE id = $3`,
      [input.verificationType, input.note ?? null, issue.id]
    );
    const next = await loadIssue(tx, issue.id);
    return { ok: true, issue: next ? issueFromRow(next) : undefined, opened: 0, updated: 1, resolved: 1, reopened: 0 };
  });
}

export { ISSUE_SELECT };
