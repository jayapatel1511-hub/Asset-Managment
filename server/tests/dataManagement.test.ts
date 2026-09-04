/**
 * Feature 011 first proof: read-only dictionary, quality rules, issue queue.
 *
 * The assertions that matter:
 *   - Field User is denied the dictionary
 *   - coverage is complete for production columns
 *   - re-running rules updates one issue per (rule, entity, scope)
 *   - resolve without verification is refused
 *   - waiver needs reason + other approver + expiry; expiry reopens if still failing
 *   - overview carries dataCurrency and rule version
 *   - Ottawa admin cannot assign a Toronto-scoped issue
 *   - shared-serial findings are candidates, never a merge
 *   - restricted SIM fields never appear in evidence
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DictionaryCoverageReport, DictionaryPage, QualityCommandOutcome, QualityIssuePage, QualityOverviewCounts } from "../../packages/contracts/src/dataManagement";
import { buildApp, createContext } from "../src/app";
import type { Database } from "../src/db/database";
import { seedDevIdentities } from "../src/db/identity";
import { loadMigrations, migrate } from "../src/db/migrate";
import { openTestDatabase } from "../src/db/open";
import { qualityAlertStub } from "../src/modules/data-management/ruleCatalogue";
import { get, getJson, newSubmissionId, post, type TestApp } from "./helpers";

let t: TestApp;
let tmpDir: string | undefined;

/**
 * Another lane owns 0016 (DC-22 stored axes) and seed.ts writes those columns. These tests
 * migrate through 0015 — the data-management first proof — and load a small fixture.
 */
async function createDmTestApp(): Promise<TestApp> {
  const db = await openTestDatabase({ migrate: false });
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "ams-dm-mig-"));
  for (const file of loadMigrations().filter((f) => f.version <= 15)) {
    writeFileSync(path.join(tmpDir, file.filename), file.sql);
  }
  await migrate(db, { dir: tmpDir });
  await seedDevIdentities(db);
  await insertFixtures(db);
  const app = await buildApp(createContext(db, { synthetic: false }), { logger: false });
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.close();
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function insertFixtures(db: Database): Promise<void> {
  await db.query("INSERT INTO location (id, name, locationtype, isactive) VALUES ('loc-ott','Ottawa','Office',true), ('loc-tor','Toronto','Office',true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO office_admin_assignment (office, admin_upns) VALUES ('Ottawa', '[\"admin@englobecorp.com\"]'::jsonb) ON CONFLICT DO NOTHING");
  await db.query(
    `INSERT INTO equipment_model (manufacturer, model, equipmenttype, assetgroup, idprefix, isserialised, identifiertype, defaultcalintervalmonths)
     VALUES ('Instantel','Micromate','DataLogger','Seismic','DL', true, 'Serial', 12)
     ON CONFLICT DO NOTHING`
  );
  const rows: Array<[string, string, string | null, string, string | null, string | null]> = [
    ["u-unk", "DL-UNK-1", "Ottawa", "Available", null, "SN-1"],
    ["u-over", "DL-OVER-1", "Ottawa", "Available", "2020-01-01", "SN-2"],
    ["u-tmp", "TMP-OTT", "Ottawa", "Available", "2028-01-01", "SN-3"],
    ["u-home", "DL-HOME-1", "Unassigned", "Available", "2028-01-01", "SN-4"],
    ["u-cust", "DL-CUST-1", "Ottawa", "CheckedOut", "2028-01-01", "SN-5"],
    ["u-dup-a", "DL-DUP-A", "Ottawa", "Available", "2028-01-01", "SHARED-99"],
    ["u-dup-b", "DL-DUP-B", "Toronto", "Available", "2028-01-01", "SHARED-99"],
    ["u-tor", "DL-TOR-1", "Toronto", "Available", null, "SN-6"],
  ];
  for (const [id, assetid, home, status, due, serial] of rows) {
    await db.query(
      `INSERT INTO asset (id, assetid, manufacturer, model, equipmenttype, serialnumber, homeoffice, lifecycle, status, nextcaldue)
       VALUES ($1,$2,'Instantel','Micromate','DataLogger',$3,$4,'Active',$5,$6)`,
      [id, assetid, serial, home, status, due]
    );
  }
}

beforeAll(async () => {
  t = await createDmTestApp();
}, 180_000);

afterAll(async () => {
  await t?.close();
});

async function runRules(as: "admin" | "owner" = "owner") {
  const res = await post(t.app, "/api/data-management/quality/commands/run-rules", { clientSubmissionId: newSubmissionId("qr") }, as);
  expect(res.statusCode).toBe(200);
  return res.json() as QualityCommandOutcome;
}

describe("field dictionary", () => {
  it("refuses Field User reads", async () => {
    const res = await get(t.app, "/api/data-management/dictionary", "field");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "forbidden_role" });
  });

  it("pages for an Office Admin without requiring the full fleet in memory", async () => {
    const page = await getJson<DictionaryPage>(t.app, "/api/data-management/dictionary?page=1&pageSize=20", "admin");
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.total).toBeGreaterThan(page.items.length);
    expect(page.dataCurrency).toBeTruthy();
  });

  it("reports full coverage and no contradictions", async () => {
    const report = await getJson<DictionaryCoverageReport>(t.app, "/api/data-management/dictionary/coverage", "owner");
    expect(report.missing).toEqual([]);
    expect(report.contradictions).toEqual([]);
    expect(report.withEntry).toBe(report.totalProductionFields);
    expect(report.totalProductionFields).toBeGreaterThan(100);
  });

  it("marks restricted SIM fields as not offline-cached and not Field-User readable", async () => {
    const iccid = await getJson<{ offlineCacheAllowed: boolean; readRoles: string[]; classification: string }>(
      t.app,
      "/api/data-management/dictionary/asset/identifiervalue",
      "admin"
    );
    expect(iccid.offlineCacheAllowed).toBe(false);
    expect(iccid.readRoles).not.toContain("FieldUser");
    expect(iccid.classification).toBe("Unapproved:Restricted");
  });
});

describe("quality rules and issues", () => {
  it("creates one issue per scope and does not duplicate on re-run", async () => {
    const first = await runRules();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE&pageSize=1",
      "admin"
    );
    expect(page.total).toBeGreaterThan(0);
    const second = await runRules();
    expect(second.ok).toBe(true);
    const again = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE&pageSize=1",
      "admin"
    );
    expect(again.total).toBe(page.total);
  });

  it("puts Field-home attention numbers on the queue", async () => {
    const unknown = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=1",
      "admin"
    );
    const overdue = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-OVERDUE&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=1",
      "admin"
    );
    expect(unknown.total).toBeGreaterThan(0);
    expect(unknown.ruleVersion).toBeTruthy();
    expect(unknown.dataCurrency).toBeTruthy();
    expect(overdue.total).toBeGreaterThan(0);
  });

  it("refuses resolve without re-evaluation or manual verification", async () => {
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-ASSET-TEMPORARY-TAG&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=1",
      "admin"
    );
    expect(page.items.length).toBeGreaterThan(0);
    const issue = page.items[0];
    const res = await post(
      t.app,
      "/api/data-management/quality/commands/set-issue-status",
      { issueId: issue.id, status: "Resolved", clientSubmissionId: newSubmissionId("resolve"), expectedRowVersion: issue.rowVersion },
      "admin"
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, error: "quality.verificationRequired" });
  });

  it("refuses a waiver that is missing reason, approver or expiry, and refuses self-approval", async () => {
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-ASSET-TEMPORARY-TAG&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=1",
      "admin"
    );
    const issue = page.items[0];
    const incomplete = await post(
      t.app,
      "/api/data-management/quality/commands/waive-issue",
      { issueId: issue.id, reason: "", approverUserId: "", waiverExpiresAt: "", clientSubmissionId: newSubmissionId("w1"), expectedRowVersion: issue.rowVersion },
      "admin"
    );
    expect(incomplete.json()).toMatchObject({ ok: false, error: "quality.waiverIncomplete" });
    const self = await post(
      t.app,
      "/api/data-management/quality/commands/waive-issue",
      {
        issueId: issue.id,
        reason: "temporary",
        approverUserId: "admin@englobecorp.com",
        waiverExpiresAt: "2099-01-01T00:00:00.000Z",
        clientSubmissionId: newSubmissionId("w2"),
        expectedRowVersion: issue.rowVersion,
      },
      "admin"
    );
    expect(self.json()).toMatchObject({ ok: false, error: "quality.selfApprovalForbidden" });
  });

  it("reopens an expired waiver when the record still fails", async () => {
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=1",
      "owner"
    );
    const issue = page.items[0];
    const waived = await post(
      t.app,
      "/api/data-management/quality/commands/waive-issue",
      {
        issueId: issue.id,
        reason: "awaiting lab booking",
        approverUserId: "admin@englobecorp.com",
        waiverExpiresAt: "2020-01-01T00:00:00.000Z",
        clientSubmissionId: newSubmissionId("w3"),
        expectedRowVersion: issue.rowVersion,
      },
      "owner"
    );
    expect(waived.json()).toMatchObject({ ok: true });
    await t.db.query("UPDATE data_quality_issue SET status = 'Waived', waiver_expires_at = '2020-01-01T00:00:00Z' WHERE id = $1", [issue.id]);
    await runRules("owner");
    const after = await getJson<{ status: string }>(t.app, `/api/data-management/quality/issues/${issue.id}`, "owner");
    expect(after.status).toBe("Reopened");
  });

  it("includes dataCurrency, rule version and Field-home links on the overview", async () => {
    const overview = await getJson<QualityOverviewCounts>(t.app, "/api/data-management/quality/overview", "admin");
    expect(overview.dataCurrency).toBeTruthy();
    expect(overview.ruleVersion).toContain("DQ-CAL-UNKNOWN-DUE");
    expect(overview.links.calibrationUnknown).toContain("DQ-CAL-UNKNOWN-DUE");
    expect(overview.links.calibrationOverdue).toContain("DQ-CAL-OVERDUE");
    expect(overview.calibrationUnknown).toBeGreaterThan(0);
  });

  it("refuses a Toronto Office Admin assigning an Ottawa issue", async () => {
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE&officeId=Ottawa&status=Open,Assigned,InProgress,Blocked,Reopened&pageSize=5",
      "owner"
    );
    const ottawa = page.items.find((i) => (i.officeLocationId ?? "").toLowerCase() === "ottawa");
    expect(ottawa).toBeTruthy();
    const res = await post(
      t.app,
      "/api/data-management/quality/commands/assign-issue",
      {
        issueId: ottawa!.id,
        ownerUserId: "toronto-admin@englobecorp.com",
        clientSubmissionId: newSubmissionId("asg"),
        expectedRowVersion: ottawa!.rowVersion,
      },
      "toronto"
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "quality.forbidden" });
  });

  it("records shared serials as candidates and never as a merge", async () => {
    const page = await getJson<QualityIssuePage>(
      t.app,
      "/api/data-management/quality/issues?ruleKey=DQ-DUP-SHARED-SERIAL&pageSize=5",
      "admin"
    );
    expect(page.total).toBeGreaterThan(0);
    for (const issue of page.items) {
      expect(issue.evidence.autoMerge).toBe(false);
      expect(issue.evidence.candidateOnly).toBe(true);
    }
  });

  it("never puts restricted SIM fields in issue evidence", async () => {
    const page = await getJson<QualityIssuePage>(t.app, "/api/data-management/quality/issues?pageSize=50", "admin");
    for (const issue of page.items) {
      const blob = JSON.stringify(issue.evidence);
      expect(blob).not.toMatch(/identifiervalue/i);
      expect(blob).not.toMatch(/phonenumber/i);
      expect(blob).not.toMatch(/staticip/i);
    }
  });

  it("lets a Field User read the issue queue so Field home can route here", async () => {
    const res = await get(t.app, "/api/data-management/quality/issues?ruleKey=DQ-CAL-OVERDUE&pageSize=1", "field");
    expect(res.statusCode).toBe(200);
  });

  it("names an owner on a critical-alert stub without inventing SLA hours", () => {
    const stub = qualityAlertStub({ ruleKey: "DQ-X", severity: "Critical", ownerUserId: "steward", entityId: "a1" });
    expect(stub.wouldAlert).toBe(true);
    expect(stub.owner).toBe("steward");
    expect(JSON.stringify(stub)).not.toMatch(/\d+\s*hour/i);
  });
});
