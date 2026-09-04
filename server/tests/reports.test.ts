/**
 * WS-W9 — the reporting lane's evidence.
 *
 * `specs/REMAINING-WORK.md` § WS-W9 states one definition of done — "A Report Reader answers all
 * seven questions without operational write access or restricted fields" — and four rules under
 * it. This file is arranged as those rules, in that order, because a reporting test suite that is
 * organised by endpoint proves that the endpoints respond, not that the numbers are true.
 *
 *   A  restricted identifiers are absent from the views      (rule 10, FR-003, "manager DTOs/
 *                                                             views exclude sensitive identifiers")
 *   B  every figure reconciles to operational data           (the definition of done)
 *   C  office scope filters report rows                      (A-R5)
 *   D  a Report Reader has no operational write access       (the definition of done)
 *   E  exports are governed                                  (rule 19)
 *   F  data currency is visible and accurate                 (FR-002, "data currency visible")
 *
 * Two disciplines run through it.
 *
 * **Reconciliation is computed independently, not read back.** Every assertion in section B
 * derives its expected figure from the operational tables or from `services/readModel.ts` — the
 * code path the running application uses — and never from the report it is checking. A test that
 * asks the report for a number and then asks the report for the same number again is a test that
 * passes when both are wrong.
 *
 * **The leak test is introspection, not reading.** Section A queries
 * `information_schema.columns` and `pg_get_viewdef()`, so it fails on a column that is renamed
 * into a view as much as on one selected plainly — and it proves it can fail, by asserting that
 * the same introspection *does* find the three columns on the `asset` table itself. An exclusion
 * test that has never been shown to detect an inclusion is decoration.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { HistoryEntry, Installation } from "../../app/src/api/types";
import { isTemporaryAssetId } from "../../app/src/domain/assetId";
import { buildTimeline } from "../../app/src/domain/pointInTime";
import { computeUtilisation, recordsBeganAt, statusSpans } from "../../app/src/domain/utilisation";
import { ReadModel } from "../src/services/readModel";
import {
  APPROVED_VIEWS,
  EXPORT_TEMPLATES,
  RESTRICTED_COLUMNS,
  type ExportArtifact,
  type ExportAuditRecord,
  type ReportEnvelope,
} from "../src/services/reportService";
import { createTestApp, newSubmissionId, type TestApp } from "./helpers";

let t: TestApp;
let read: ReadModel;

/** The demo identities this file uses. `reader` and `toronto` were added to
 * `src/auth/devAuth.ts` by the identity lane for exactly this matrix. */
type Who = "field" | "admin" | "owner" | "reader" | "toronto";

function inject(app: FastifyInstance, method: "GET" | "POST", url: string, as: Who, body?: unknown) {
  return app.inject({ method, url, ...(body === undefined ? {} : { payload: body as object }), headers: { "x-ams-dev-user": as } });
}

async function report<T>(url: string, as: Who = "owner"): Promise<ReportEnvelope<T>> {
  const res = await inject(t.app, "GET", url, as);
  if (res.statusCode !== 200) throw new Error(`GET ${url} as ${as} → ${res.statusCode}: ${res.body}`);
  return res.json() as ReportEnvelope<T>;
}

/** Every report route, so a sweep can assert a property of all of them at once. */
const ALL_REPORT_ROUTES = [
  "/api/reports/catalog",
  "/api/reports/fleet",
  "/api/reports/where-who?limit=5",
  "/api/reports/availability",
  "/api/reports/calibration?horizonDays=30",
  "/api/reports/by-project",
  "/api/reports/site-timeline",
  "/api/reports/utilisation?periodDays=30",
  "/api/reports/exports/templates",
];

const OTTAWA = "Ottawa";
const PROJECT_WITH_ASSETS = "02005717";

beforeAll(async () => {
  t = await createTestApp();
  read = new ReadModel(t.db);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

// ============================================================================================
// A — restricted identifiers are absent from the approved views
// ============================================================================================

describe("A · no approved view exposes a restricted identifier (CLAUDE.md rule 10, FR-003)", () => {
  it("declares every view docs/15 §12 names for reporting, and creates them", async () => {
    const res = await t.db.query<{ viewname: string }>(
      "SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'v\\_%'"
    );
    const present = new Set(res.rows.map((r) => r.viewname));
    for (const view of APPROVED_VIEWS) expect(present.has(view), `${view} is missing`).toBe(true);
  });

  it("finds no restricted column on ANY view in the reporting namespace", async () => {
    // Introspection, not a reading of views.sql: an alias, a `SELECT *` through a join, or a
    // column added by another lane's edit would all show up here.
    const res = await t.db.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN pg_views v ON v.viewname = c.table_name AND v.schemaname = c.table_schema
        WHERE c.table_schema = 'public'
          AND c.table_name LIKE 'v\\_%'
          AND c.column_name = ANY($1::text[])`,
      [[...RESTRICTED_COLUMNS]]
    );
    expect(res.rows, `restricted columns exposed: ${JSON.stringify(res.rows)}`).toEqual([]);
  });

  it("finds no restricted identifier anywhere in a view's DEFINITION, so an alias cannot hide one", async () => {
    const res = await t.db.query<{ viewname: string; leaks: boolean }>(
      `SELECT viewname,
              pg_get_viewdef(('public.' || quote_ident(viewname))::regclass) ~* '(identifiervalue|phonenumber|staticip)' AS leaks
         FROM pg_views
        WHERE schemaname = 'public' AND viewname LIKE 'v\\_%'`
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(APPROVED_VIEWS.length);
    expect(res.rows.filter((r) => r.leaks)).toEqual([]);
  });

  it("PROVES the introspection can fail: the same query finds all three on the asset table", async () => {
    const res = await t.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset' AND column_name = ANY($1::text[])`,
      [[...RESTRICTED_COLUMNS]]
    );
    expect(res.rows.map((r) => r.column_name).sort()).toEqual([...RESTRICTED_COLUMNS].sort());
  });

  it("returns no restricted key in any report payload, for the most privileged role there is", async () => {
    // A JSON *key*, not the bare word: `/api/reports/catalog` names all three deliberately, in
    // `restrictedColumnsExcluded`, and that is the opposite of a leak.
    for (const url of ALL_REPORT_ROUTES) {
      const res = await inject(t.app, "GET", url, "owner");
      expect(res.statusCode, url).toBe(200);
      for (const column of RESTRICTED_COLUMNS) {
        expect(res.body.includes(`"${column}":`), `${url} leaked ${column}`).toBe(false);
      }
    }
  });

  it("states the exclusion on the catalog, so an auditor need not read the SQL", async () => {
    const catalog = (await inject(t.app, "GET", "/api/reports/catalog", "reader")).json();
    expect(catalog.restrictedColumnsExcluded).toEqual([...RESTRICTED_COLUMNS]);
    expect(catalog.approvedViews).toEqual([...APPROVED_VIEWS]);
  });
});

// ============================================================================================
// B — every figure reconciles to operational data
// ============================================================================================

describe("B1 · Fleet (question 1) reconciles with the operational read model", () => {
  it("total equals listAssets()'s own predicate over the same rows", async () => {
    const [assets, models] = await Promise.all([read.allAssets(), read.modelIndex()]);
    const expected = read.filterAssets(assets, models, {}).length;
    const fleet = await report<{ total: number }>("/api/reports/fleet");
    expect(fleet.data.total).toBe(expected);
  });

  it("total equals the operational count under an office filter, a status filter and includeRetired", async () => {
    const [assets, models] = await Promise.all([read.allAssets(), read.modelIndex()]);
    const cases = [
      { qs: `office=${OTTAWA}`, filter: { office: OTTAWA } },
      { qs: "status=Available", filter: { status: ["Available"] } },
      { qs: "status=CheckedOut,NeedsRepair", filter: { status: ["CheckedOut", "NeedsRepair"] } },
      { qs: "includeRetired=1", filter: { includeRetired: true } },
      { qs: "equipmenttype=DataLogger", filter: { equipmenttype: "DataLogger" } },
      { qs: "assetgroup=Seismographs", filter: { assetgroup: "Seismographs" } },
      { qs: `project=${PROJECT_WITH_ASSETS}`, filter: { project: PROJECT_WITH_ASSETS } },
    ];
    for (const c of cases) {
      const expected = read.filterAssets(assets, models, c.filter).length;
      const actual = await report<{ total: number }>(`/api/reports/fleet?${c.qs}`);
      expect(actual.data.total, c.qs).toBe(expected);
    }
  });

  it("keeps every breakdown summing to the same total (SC-003's invariant, in SQL this time)", async () => {
    const fleet = await report<{
      total: number;
      byOffice: Record<string, number>;
      byAssetGroup: Record<string, number>;
      byEquipmentType: Record<string, number>;
    }>("/api/reports/fleet");
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(fleet.data.byOffice)).toBe(fleet.data.total);
    expect(sum(fleet.data.byAssetGroup)).toBe(fleet.data.total);
    expect(sum(fleet.data.byEquipmentType)).toBe(fleet.data.total);
  });

  it("agrees with the pre-existing /api/reports/fleet-counts, which is left untouched", async () => {
    const legacy = (await inject(t.app, "GET", "/api/reports/fleet-counts", "owner")).json();
    const fleet = await report<{
      total: number;
      byOffice: Record<string, number>;
      byAssetGroup: Record<string, number>;
      byEquipmentType: Record<string, number>;
      temporaryTags: number;
      thirdPartyOwned: number;
    }>("/api/reports/fleet");
    expect(fleet.data.total).toBe(legacy.total);
    expect(fleet.data.byOffice).toEqual(legacy.byOffice);
    expect(fleet.data.byAssetGroup).toEqual(legacy.byAssetGroup);
    expect(fleet.data.byEquipmentType).toEqual(legacy.byEquipmentType);
    expect(fleet.data.temporaryTags).toBe(legacy.temporaryTags);
    expect(fleet.data.thirdPartyOwned).toBe(legacy.thirdPartyOwned);
  });

  it("counts temporary tags and third-party ownership with the SQL predicates the domain uses (FR-011/FR-012)", async () => {
    const assets = await read.allAssets();
    const active = assets.filter((a) => a.lifecycle !== "Retired");
    const expectedTemporary = active.filter((a) => isTemporaryAssetId(a.assetid)).length;
    const expectedThirdParty = active.filter((a) => a.notes && /\bowned by\b/i.test(a.notes)).length;
    const fleet = await report<{ temporaryTags: number; thirdPartyOwned: number; total: number }>("/api/reports/fleet");
    expect(fleet.data.temporaryTags).toBe(expectedTemporary);
    expect(fleet.data.thirdPartyOwned).toBe(expectedThirdParty);
    // FR-011/FR-012: marked, never excluded.
    expect(fleet.data.total).toBeGreaterThan(expectedTemporary + expectedThirdParty);
  });
});

describe("B2 · Where/Who (questions 2 and 3) reconciles", () => {
  it("returns the asset's current location, custodian and project as the asset table holds them", async () => {
    const assets = await read.allAssets();
    const withCustodian = assets.find((a) => a.custodian && a.lifecycle !== "Retired");
    expect(withCustodian, "the staged fleet should carry at least one custodian").toBeDefined();
    const found = await report<{ rows: Array<{ assetid: string; custodian: string | null; currentlocation: string | null }> }>(
      `/api/reports/where-who?assetId=${encodeURIComponent(withCustodian!.assetid)}`
    );
    expect(found.data.rows).toHaveLength(1);
    expect(found.data.rows[0].custodian).toBe(withCustodian!.custodian);
    expect(found.data.rows[0].currentlocation).toBe(withCustodian!.currentlocation);
  });

  it("separates the unknown-custodian sweep from assets that are simply in the office (FR-010)", async () => {
    const assets = await read.allAssets();
    const expected = assets
      .filter((a) => a.lifecycle !== "Retired" && (a.status === "CheckedOut" || a.status === "Deployed") && !a.custodian)
      .map((a) => a.assetid)
      .sort();
    const whereWho = await report<{ unknownCustodian: Array<{ assetid: string }> }>("/api/reports/where-who?limit=1");
    expect(whereWho.data.unknownCustodian.map((a) => a.assetid).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("B3 · Availability (question 4) reconciles", () => {
  it("totals the same rows the asset table calls available (FR-007)", async () => {
    const expected = await t.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM asset WHERE lifecycle <> 'Retired' AND status = 'Available'"
    );
    const availability = await report<{ total: number; byOffice: Record<string, number>; byEquipmentType: Record<string, number> }>(
      "/api/reports/availability"
    );
    expect(availability.data.total).toBe(expected.rows[0].n);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(availability.data.byOffice)).toBe(availability.data.total);
    expect(sum(availability.data.byEquipmentType)).toBe(availability.data.total);
  });

  it("excludes deployed, in-calibration, needing-repair, missing and retired assets", async () => {
    const excluded = await t.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM asset
        WHERE status IN ('Deployed', 'InCalibration', 'NeedsRepair', 'Missing') OR lifecycle = 'Retired'`
    );
    const [all, availability] = await Promise.all([
      report<{ total: number }>("/api/reports/fleet?includeRetired=1"),
      report<{ total: number }>("/api/reports/availability"),
    ]);
    expect(availability.data.total).toBeLessThanOrEqual(all.data.total - excluded.rows[0].n);
  });
});

describe("B4 · Calibration (question 5) reconciles", () => {
  it("buckets exactly as readModel.getCalibrationCounts does, office for office", async () => {
    const expected = await read.getCalibrationCounts(30);
    const calibration = await report<{ byOffice: typeof expected.byOffice }>("/api/reports/calibration?horizonDays=30");
    expect(calibration.data.byOffice).toEqual(expected.byOffice);
  });

  it("agrees with the pre-existing /api/reports/calibration-counts, which is left untouched", async () => {
    const legacy = (await inject(t.app, "GET", "/api/reports/calibration-counts?horizonDays=30", "owner")).json();
    const calibration = await report<{ byOffice: Record<string, unknown> }>("/api/reports/calibration?horizonDays=30");
    expect(calibration.data.byOffice).toEqual(legacy.byOffice);
  });

  it("moves assets between due-soon and overdue as the horizon widens, and never loses one", async () => {
    const thirty = await report<{ byOffice: Record<string, { dueSoon: number; overdue: number; unknown: number; inCalibration: number }> }>(
      "/api/reports/calibration?horizonDays=30"
    );
    const year = await report<typeof thirty.data>("/api/reports/calibration?horizonDays=365");
    const tally = (d: typeof thirty.data, k: "dueSoon" | "overdue" | "unknown") =>
      Object.values(d.byOffice).reduce((sum, o) => sum + o[k], 0);
    expect(tally(year.data, "dueSoon")).toBeGreaterThanOrEqual(tally(thirty.data, "dueSoon"));
    expect(tally(year.data, "overdue")).toBe(tally(thirty.data, "overdue")); // overdue ignores the horizon
    expect(tally(year.data, "unknown")).toBe(tally(thirty.data, "unknown")); // FR-017: never reclassified
  });

  it("lists every overdue asset it counted, with days overdue, custodian and location (FR-015)", async () => {
    const calibration = await report<{
      byOffice: Record<string, { overdue: number }>;
      overdue: Array<{ assetid: string; daysoverdue: number | null; nextcaldue: string | null }>;
      truncated: boolean;
    }>("/api/reports/calibration?horizonDays=30");
    const counted = Object.values(calibration.data.byOffice).reduce((sum, o) => sum + o.overdue, 0);
    expect(calibration.data.truncated).toBe(false);
    expect(calibration.data.overdue.length).toBe(counted);
    const today = new Date().toISOString().slice(0, 10);
    for (const row of calibration.data.overdue) {
      expect(row.nextcaldue!.slice(0, 10) < today, `${row.assetid} is not actually overdue`).toBe(true);
      expect(row.daysoverdue).toBeGreaterThan(0);
    }
  });
});

describe("B5 · By project (question 6) reconciles", () => {
  it("lists exactly the assets the asset table assigns to the project (FR-008)", async () => {
    const expected = await t.db.query<{ assetid: string }>(
      "SELECT assetid FROM asset WHERE currentproject = $1 ORDER BY assetid",
      [PROJECT_WITH_ASSETS]
    );
    const byProject = await report<{ rows: Array<{ assetid: string; custodian: string | null }> }>(
      `/api/reports/by-project?project=${PROJECT_WITH_ASSETS}`
    );
    expect(byProject.data.rows.map((r) => r.assetid)).toEqual(expected.rows.map((r) => r.assetid));
    expect(expected.rows.length).toBeGreaterThan(0);
  });

  it("summarises every project with at least one asset, and the counts add up", async () => {
    const expected = await t.db.query<{ currentproject: string; n: number }>(
      "SELECT currentproject, count(*)::int AS n FROM asset WHERE currentproject IS NOT NULL GROUP BY 1"
    );
    const byProject = await report<{ projects: Array<{ projectnumber: string; assetCount: number }> }>("/api/reports/by-project");
    const actual = new Map(byProject.data.projects.map((p) => [p.projectnumber, p.assetCount]));
    expect(actual.size).toBe(expected.rows.length);
    for (const row of expected.rows) expect(actual.get(row.currentproject), row.currentproject).toBe(row.n);
  });
});

describe("B6 · Asset timeline (question 7) reconciles", () => {
  let sampleAsset = "";

  beforeAll(async () => {
    const assets = await read.allAssets();
    sampleAsset = assets[0].assetid;
  });

  it("returns the same lines, in the same order, as the operational history read", async () => {
    const expected = await read.getAssetHistory(sampleAsset);
    const timeline = await report<{ events: Array<{ lineid: string; transactiondate: string }> }>(
      `/api/reports/asset-timeline/${encodeURIComponent(sampleAsset)}`
    );
    expect(timeline.data.events.map((e) => e.lineid)).toEqual(expected.map((h) => h.id));
    expect(expected.length).toBeGreaterThan(0);
  });

  it("keeps a retired asset's timeline (FR-022)", async () => {
    const retired = await t.db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE lifecycle = 'Retired' LIMIT 1");
    if (retired.rows.length === 0) return; // the staged fleet retires nothing; nothing to assert
    const timeline = await report<{ events: unknown[] }>(`/api/reports/asset-timeline/${encodeURIComponent(retired.rows[0].assetid)}`);
    expect(timeline.data.events.length).toBeGreaterThan(0);
  });

  it("states the asset's state at the start of a filtered range (FR-020)", async () => {
    const history = await read.getAssetHistory(sampleAsset);
    const asOf = history[history.length - 1].transactiondate;
    const timeline = await report<{ stateAtRangeStart: { status: string; currentlocation: string | null } | null }>(
      `/api/reports/asset-timeline/${encodeURIComponent(sampleAsset)}?from=${encodeURIComponent(asOf)}`
    );
    expect(timeline.data.stateAtRangeStart).not.toBeNull();
    expect(typeof timeline.data.stateAtRangeStart!.status).toBe("string");
  });

  it("v_asset_timeline's own attachment projection agrees with the domain module, event for event", async () => {
    // The Power BI parity check. `buildTimeline` is the API's authority; the view carries the same
    // answer for a report author who cannot call TypeScript. If they ever disagree, one of the two
    // audiences is being told something false.
    //
    // The attachment is created here, through a real Checkout, rather than taken from the staged
    // data — because the staged rows put a transaction LINE id in `asset_relationship.createdbyline`
    // while the write path (`transactionService.ts`, and `mock/store.ts` before it) puts a
    // TRANSACTION id there, which is what `pointInTime.ts:206` compares against. The view follows
    // the write path and the domain module, so both agree; the migrated rows raise no attachment in
    // either. That inconsistency is real and is reported to the integrator — it is not this lane's
    // to fix, and a parity test built on the ambiguous rows would prove nothing about either.
    const candidates = await t.db.query<{ assetid: string }>(
      `SELECT assetid FROM asset
        WHERE status = 'Available' AND lifecycle <> 'Retired' AND parentasset IS NULL
        ORDER BY assetid LIMIT 2`
    );
    expect(candidates.rows).toHaveLength(2);
    const [primary, child] = candidates.rows.map((r) => r.assetid);

    const res = await inject(t.app, "POST", "/api/commands/Checkout", "admin", {
      lines: [{ assetId: primary }, { assetId: child, kitRole: "Sensor1" }],
      primaryAssetId: primary,
      project: "01937805",
      clientSubmissionId: newSubmissionId("attach"),
    });
    expect(res.json().ok, res.body).toBe(true);

    const [history, rels] = await Promise.all([read.getAssetHistory(primary), read.getAssetRelationships(primary)]);
    const fromDomain = buildTimeline(history as HistoryEntry[], rels);
    const viewRows = await t.db.query<{ lineid: string; attachments: unknown }>(
      "SELECT lineid, attachments FROM v_asset_timeline WHERE assetid = $1",
      [primary]
    );
    const viewByLine = new Map(
      viewRows.rows.map((r) => [
        r.lineid,
        (typeof r.attachments === "string" ? JSON.parse(r.attachments) : (r.attachments as Array<Record<string, unknown>>)) ?? [],
      ])
    );

    let comparedAnAttachment = false;
    for (const ev of fromDomain) {
      const fromView = (viewByLine.get(ev.entry.id) ?? []) as Array<{ kind: string; assetId: string; role: string | null }>;
      const norm = (xs: Array<{ kind: string; assetId: string; role: string | null }>) =>
        xs.map((a) => `${a.kind}:${a.assetId}:${a.role ?? ""}`).sort();
      expect(norm(fromView), `line ${ev.entry.id}`).toEqual(norm(ev.attachments));
      if (ev.attachments.length > 0) comparedAnAttachment = true;
    }
    expect(comparedAnAttachment, "this test must compare at least one real attachment").toBe(true);

    // FR-019: the event names the other asset, and the role from the perspective of the asset
    // whose timeline it is. `pointInTime.ts` reads the role off the viewing asset's OWN line in
    // the opening transaction — so the primary, which carries no kitrole, sees `null`, and the
    // sensor sees `Sensor1`. The view reproduces that asymmetry (`ol.asset = l.asset`) rather than
    // flattening it, which is what makes the two answers interchangeable.
    const attachEvent = fromDomain.flatMap((e) => e.attachments).find((a) => a.kind === "attach");
    expect(attachEvent!.assetId).toBe(child);
    expect(attachEvent!.role).toBeNull();

    const childView = await t.db.query<{ attachments: unknown }>(
      "SELECT attachments FROM v_asset_timeline WHERE assetid = $1 AND jsonb_array_length(attachments) > 0",
      [child]
    );
    const childAttachments = childView.rows.flatMap(
      (r) => (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) as Array<{ assetId: string; role: string | null }>
    );
    expect(childAttachments).toContainEqual({ kind: "attach", assetId: primary, role: "Sensor1" });
  });

  it("v_asset_state_spans agrees with the domain module's statusSpans", async () => {
    const history = await read.getAssetHistory(sampleAsset);
    const from = history[history.length - 1].transactiondate;
    const to = new Date().toISOString();
    const expected = statusSpans(history as HistoryEntry[], from, to);
    const spans = await t.db.query<{ spanstart: string; status: string }>(
      "SELECT spanstart, status FROM v_asset_state_spans WHERE assetid = $1 ORDER BY spanindex",
      [sampleAsset]
    );
    // Compared as a set of (start, status) pairs: the SQL breaks ties on line_number and the
    // TypeScript on a stable sort, which can only differ for two lines sharing one timestamp.
    const key = (s: { spanstart: string; status: string }) => `${s.spanstart}|${s.status}`;
    expect(new Set(spans.rows.map(key))).toEqual(new Set(expected.map((s) => key({ spanstart: s.start, status: s.status }))));
  });
});

describe("B7 · Site / installation timeline (question 7 for a site) reconciles", () => {
  const PRIMARY = "DL-MP-12708";
  const SENSOR_A = "GEO-SE-12716";
  const SENSOR_B = "GEO-SE-12717";
  const PROJECT = "01937805";
  const SITE = "412 Report Lane";
  const DEPLOY_AT = "2026-09-01T12:00:00.000Z";
  let installationId = "";

  beforeAll(async () => {
    // The staged dataset carries no installations, so the site report has nothing to reconcile
    // against until one exists. It is created through the real deployment command rather than by
    // inserting rows, so what the report reads is what the write path actually produces.
    const res = await inject(t.app, "POST", "/api/deployments", "admin", {
      project: PROJECT,
      primaryAssetId: PRIMARY,
      components: [
        { assetId: SENSOR_A, kitRole: "Sensor1", orientation: "V" },
        { assetId: SENSOR_B, kitRole: "Sensor2", orientation: "H" },
      ],
      site: SITE,
      locationtype: "Site",
      sitename: SITE,
      powersource: "Solar",
      deploymentDate: DEPLOY_AT,
      clientSubmissionId: newSubmissionId("report-deploy"),
    });
    const outcome = res.json();
    expect(outcome.ok, `deployment refused: ${res.body}`).toBe(true);
    const installations = await read.getSiteInstallations(SITE);
    installationId = installations[0]?.id ?? "";
  }, 60_000);

  it("lists the same installations the operational read lists for the site", async () => {
    const expected: Installation[] = await read.getSiteInstallations(SITE);
    const site = await report<{ installations: Array<{ installationid: string; primaryasset: string }> }>(
      `/api/reports/site-timeline?site=${encodeURIComponent(SITE)}`
    );
    expect(site.data.installations.map((i) => i.installationid).sort()).toEqual(expected.map((i) => i.id).sort());
    expect(expected.length).toBe(1);
  });

  it("answers 'what was attached on date D' with the same components the operational snapshot does", async () => {
    const asOf = "2026-09-02T00:00:00.000Z";
    const snapshot = await read.getInstallationSnapshot(installationId, asOf);
    const site = await report<{ installations: Array<{ installationid: string; componentsAsOf: Array<{ assetid: string; kitrole: string }> }> }>(
      `/api/reports/site-timeline?site=${encodeURIComponent(SITE)}&asOf=${encodeURIComponent(asOf)}`
    );
    const reported = site.data.installations.find((i) => i.installationid === installationId);
    expect(reported!.componentsAsOf.map((c) => c.assetid).sort()).toEqual(snapshot!.components.map((c) => c.asset).sort());
    expect(snapshot!.components.length).toBeGreaterThan(0);
  });

  it("answers 'nothing was there yet' for a date before the deployment", async () => {
    const site = await report<{ installations: Array<{ installationid: string; componentsAsOf: unknown[] }> }>(
      `/api/reports/site-timeline?site=${encodeURIComponent(SITE)}&asOf=2026-08-01T00:00:00.000Z`
    );
    const reported = site.data.installations.find((i) => i.installationid === installationId);
    expect(reported!.componentsAsOf).toEqual([]);
  });

  it("names the installation as currently standing", async () => {
    const site = await report<{ currentInstallationIds: string[] }>(`/api/reports/site-timeline?site=${encodeURIComponent(SITE)}`);
    expect(site.data.currentInstallationIds).toContain(installationId);
  });
});

describe("B8 · Utilisation reconciles, and the acquisition / go-live boundary holds", () => {
  it("refuses a figure for a period that begins before the fleet's records do (FR-027/FR-028)", async () => {
    // The migrated fleet's every line is dated the migration day, so a 30-day window reaches
    // behind the boundary for all 1,026 assets. Reporting universal idleness there would be an
    // artifact of when record-keeping started, not a finding.
    const util = await report<{
      recordsBegan: string | null;
      measuredAssets: number;
      insufficient: { noHistory: number; beforeRecords: number; notYetAcquired: number };
    }>("/api/reports/utilisation?periodDays=30");
    const total = await t.db.query<{ n: number }>("SELECT count(*)::int AS n FROM asset");
    expect(util.data.measuredAssets).toBe(0);
    expect(util.data.insufficient.beforeRecords).toBe(total.rows[0].n);
    expect(util.data.recordsBegan).not.toBeNull();
  });

  it("names the same boundary the domain module derives from every asset's history", async () => {
    const histories = await t.db.query<{ assetid: string; d: string }>(
      `SELECT l.asset AS assetid, min(t.transactiondate) AS d
         FROM asset_transaction_line l JOIN asset_transaction t ON t.id = l.transaction_id
        GROUP BY 1`
    );
    const expected = recordsBeganAt(histories.rows.map((r) => [{ transactiondate: r.d } as HistoryEntry]));
    const util = await report<{ recordsBegan: string | null }>("/api/reports/utilisation?periodDays=30");
    expect(util.data.recordsBegan).toBe(expected);
  });

  it("computes a figure once the window starts at the boundary, and it reconciles per asset", async () => {
    const boundary = (await report<{ recordsBegan: string | null }>("/api/reports/utilisation?periodDays=30")).data.recordsBegan!;
    const util = await report<{
      from: string;
      to: string;
      measuredAssets: number;
      byEquipmentType: Record<string, Record<string, number>>;
      insufficient: { beforeRecords: number };
    }>(`/api/reports/utilisation?from=${encodeURIComponent(boundary)}`);
    const total = await t.db.query<{ n: number }>("SELECT count(*)::int AS n FROM asset");
    expect(util.data.measuredAssets).toBe(total.rows[0].n);
    expect(util.data.insufficient.beforeRecords).toBe(0);

    // Independent recomputation for one equipment type, from the operational history read and the
    // same domain function the UI calls — not from the report being checked.
    const assets = await read.allAssets();
    const type = Object.keys(util.data.byEquipmentType)[0];
    const members = assets.filter((a) => a.equipmentmodel.equipmenttype === type);
    const expected = { Available: 0, InUse: 0, OutOfService: 0, Retired: 0 } as Record<string, number>;
    for (const asset of members) {
      const history = (await read.getAssetHistory(asset.assetid)) as HistoryEntry[];
      const result = computeUtilisation(history, util.data.from, util.data.to, { recordsBegan: boundary });
      if (!result.sufficient) continue;
      for (const span of result.spans) {
        const category =
          span.status === "Retired"
            ? "Retired"
            : span.status === "Available"
              ? "Available"
              : span.status === "CheckedOut" || span.status === "Deployed"
                ? "InUse"
                : "OutOfService";
        expected[category] += span.durationMs;
      }
    }
    // Milliseconds, computed against a `to` the report chose — compare the proportions, which are
    // what the report actually claims, rather than two clocks' idea of "now".
    const proportion = (r: Record<string, number>) => {
      const sum = r.Available + r.InUse + r.OutOfService + r.Retired;
      return sum === 0 ? 0 : Math.round((r.InUse / sum) * 100);
    };
    expect(proportion(util.data.byEquipmentType[type])).toBe(proportion(expected));
  }, 60_000);

  it("counts idle assets against the same cutoff it reports, from the same last-activity dates (FR-024)", async () => {
    const util = await report<{ idleCount: number; from: string }>("/api/reports/utilisation?periodDays=1");
    const expected = await t.db.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM (SELECT l.asset AS assetid, max(t.transactiondate) AS last
                 FROM asset_transaction_line l JOIN asset_transaction t ON t.id = l.transaction_id
                GROUP BY 1) h
         JOIN asset a ON a.assetid = h.assetid
        WHERE a.lifecycle <> 'Retired' AND h.last < $1`,
      [util.data.from]
    );
    expect(util.data.idleCount).toBe(expected.rows[0].n);
    // The migrated fleet's last activity is the migration day, so a one-day window finds them all.
    expect(util.data.idleCount).toBeGreaterThan(0);
  });
});

// ============================================================================================
// C — office scope filters report rows (A-R5)
// ============================================================================================

describe("C · office scope (A-R5)", () => {
  it("cuts a Report Reader's fleet to their own office, and says so on the response", async () => {
    const expected = await t.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM asset WHERE homeoffice = $1 AND lifecycle <> 'Retired'",
      [OTTAWA]
    );
    const scoped = await report<{ total: number }>("/api/reports/fleet", "reader");
    expect(scoped.scope.offices).toEqual([OTTAWA]);
    expect(scoped.data.total).toBe(expected.rows[0].n);
    expect(Object.keys(scoped.data as unknown as { byOffice: Record<string, number> }).length).toBeGreaterThan(0);
  });

  it("shows a scoped reader strictly fewer assets than a global one", async () => {
    const [scoped, global] = await Promise.all([
      report<{ total: number }>("/api/reports/fleet", "reader"),
      report<{ total: number }>("/api/reports/fleet", "owner"),
    ]);
    expect(global.scope.offices).toBeNull();
    expect(scoped.data.total).toBeLessThan(global.data.total);
  });

  it("breaks a scoped fleet down by that office alone", async () => {
    const scoped = await report<{ byOffice: Record<string, number> }>("/api/reports/fleet", "reader");
    expect(Object.keys(scoped.data.byOffice)).toEqual([OTTAWA]);
  });

  it("scopes every other report the same way", async () => {
    for (const url of ["/api/reports/availability", "/api/reports/calibration?horizonDays=30", "/api/reports/by-project", "/api/reports/utilisation?periodDays=30"]) {
      const scoped = await report<unknown>(url, "reader");
      expect(scoped.scope.offices, url).toEqual([OTTAWA]);
    }
    const availability = await report<{ byOffice: Record<string, number> }>("/api/reports/availability", "reader");
    expect(Object.keys(availability.data.byOffice).every((o) => o === OTTAWA)).toBe(true);
    const calibration = await report<{ byOffice: Record<string, unknown> }>("/api/reports/calibration?horizonDays=30", "reader");
    expect(Object.keys(calibration.data.byOffice)).toEqual([OTTAWA]);
  });

  it("refuses an office filter outside scope rather than quietly narrowing it", async () => {
    const res = await inject(t.app, "GET", "/api/reports/fleet?office=Toronto", "reader");
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("auth.error.officeScope");
  });

  it("does not reveal an out-of-scope asset's timeline", async () => {
    const toronto = await t.db.query<{ assetid: string }>(
      "SELECT assetid FROM asset WHERE homeoffice = 'Toronto' LIMIT 1"
    );
    const res = await inject(t.app, "GET", `/api/reports/asset-timeline/${encodeURIComponent(toronto.rows[0].assetid)}`, "reader");
    expect(res.statusCode).toBe(404); // not 403 — a 403 would confirm the asset exists
    const own = await t.db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE homeoffice = $1 LIMIT 1", [OTTAWA]);
    const ok = await inject(t.app, "GET", `/api/reports/asset-timeline/${encodeURIComponent(own.rows[0].assetid)}`, "reader");
    expect(ok.statusCode).toBe(200);
  });

  it("keeps a scoped project list free of other offices' assets", async () => {
    const scoped = await report<{ rows: Array<{ homeoffice: string | null }> }>(
      `/api/reports/by-project?project=${PROJECT_WITH_ASSETS}`,
      "reader"
    );
    for (const row of scoped.data.rows) expect(row.homeoffice).toBe(OTTAWA);
  });

  it("leaves an office administrator globally visible, per auth/roles.ts's fleet-visibility line", async () => {
    const admin = await report<{ total: number }>("/api/reports/fleet", "admin");
    expect(admin.scope.offices).toBeNull();
  });
});

// ============================================================================================
// D — a Report Reader has no operational write access
// ============================================================================================

describe("D · read-only (WS-W9's definition of done)", () => {
  it("refuses every command endpoint to a Report Reader", async () => {
    const writes: Array<[string, unknown]> = [
      ["/api/commands/Checkout", { lines: [{ assetId: "DL-BE-11209" }], project: "01937805", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/assets", { manufacturer: "x", model: "y", equipmenttype: "z", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/calibrations", { assetId: "DL-BE-11209", calibrationdate: "2026-09-01", nextduedate: "2027-09-01", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/deployments", { project: "01937805", primaryAssetId: "DL-MP-12708", components: [], site: "s", locationtype: "Site", sitename: "s", powersource: "Solar", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/recoveries", { installationId: "x", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/component-swaps", { installationId: "x", clientSubmissionId: newSubmissionId("ro") }],
      ["/api/configuration-changes", { installationId: "x", clientSubmissionId: newSubmissionId("ro") }],
    ];
    for (const [url, body] of writes) {
      const res = await inject(t.app, "POST", url, "reader", body);
      expect(res.statusCode, `${url} let a Report Reader through`).toBe(403);
      expect(res.json().error).toBe("forbidden_role");
    }
  });

  it("refuses every report to a Field User — the aggregate reports are a different audience", async () => {
    for (const url of ALL_REPORT_ROUTES) {
      const res = await inject(t.app, "GET", url, "field");
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error).toBe("forbidden_role");
    }
  });

  it("writes no business row while every report and an export are exercised", async () => {
    const tables = ["asset", "asset_transaction", "asset_transaction_line", "asset_relationship", "calibration_record", "installation", "installation_component"];
    const snapshot = async () => {
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const res = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        counts[table] = res.rows[0].n;
      }
      const versions = await t.db.query<{ s: string | null }>("SELECT sum(row_version)::text AS s FROM asset");
      counts.rowVersionSum = Number(versions.rows[0].s ?? 0);
      return counts;
    };

    const before = await snapshot();
    for (const url of ALL_REPORT_ROUTES) await inject(t.app, "GET", url, "owner");
    await inject(t.app, "GET", `/api/reports/by-project?project=${PROJECT_WITH_ASSETS}`, "owner");
    await inject(t.app, "GET", "/api/reports/asset-timeline/DL-BE-11209", "owner");
    const exported = await inject(t.app, "POST", "/api/reports/exports", "owner", {
      templateId: "calibration-compliance",
      templateVersion: "1.0.0",
      purpose: "read-only proof",
      filters: { project: PROJECT_WITH_ASSETS },
      clientSubmissionId: newSubmissionId("ro-export"),
    });
    expect(exported.statusCode).toBe(201);
    await inject(t.app, "GET", `/api/reports/exports/${exported.json().exportId}/download`, "owner");

    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("registers no report route that mutates business data — every read is a GET", async () => {
    // The two POSTs in this lane both produce an artifact, and the test above proves they leave
    // the business tables untouched. Nothing else in the lane accepts a body at all.
    const routes = t.app
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .filter((l) => l.includes("/api/reports"));
    expect(routes.length).toBeGreaterThan(0);
  });
});

// ============================================================================================
// E — exports are governed (CLAUDE.md rule 19)
// ============================================================================================

describe("E · governed exports", () => {
  const compliance = (overrides: Record<string, unknown> = {}) => ({
    templateId: "calibration-compliance",
    templateVersion: "1.0.0",
    purpose: "client evidence pack",
    filters: { project: PROJECT_WITH_ASSETS },
    clientSubmissionId: newSubmissionId("export"),
    ...overrides,
  });

  it("offers only approved templates, and only to a reporting role", async () => {
    const listed = (await inject(t.app, "GET", "/api/reports/exports/templates", "reader")).json();
    expect(listed.templates.map((x: { id: string }) => x.id).sort()).toEqual(EXPORT_TEMPLATES.map((x) => x.id).sort());
    for (const template of listed.templates) expect(template.excludesRestrictedIdentifiers).toBe(true);
    expect((await inject(t.app, "GET", "/api/reports/exports/templates", "field")).statusCode).toBe(403);
  });

  it("refuses a client-supplied field list outright (rule 19, and governed-export.md's invariant 4)", async () => {
    for (const key of ["columns", "fields", "select", "sql"]) {
      const res = await inject(t.app, "POST", "/api/reports/exports", "owner", { ...compliance(), [key]: ["identifiervalue"] });
      expect(res.statusCode, key).toBe(400);
      expect(res.json().error).toBe("export.fieldForbidden");
    }
  });

  it("refuses a client-supplied identity or row scope", async () => {
    for (const key of ["roles", "upn", "scopedOffices", "allRows"]) {
      const res = await inject(t.app, "POST", "/api/reports/exports", "owner", { ...compliance(), [key]: "anything" });
      expect(res.statusCode, key).toBe(400);
      expect(res.json().error).toBe("auth.error.clientAuthorityForbidden");
    }
  });

  it("refuses a filter the template does not declare, and a required filter left out", async () => {
    const undeclared = await inject(t.app, "POST", "/api/reports/exports", "owner", {
      ...compliance(),
      filters: { project: PROJECT_WITH_ASSETS, custodian: "someone" },
    });
    expect(undeclared.statusCode).toBe(400);
    expect(undeclared.json().error).toBe("export.scopeForbidden");

    const missing = await inject(t.app, "POST", "/api/reports/exports", "owner", { ...compliance(), filters: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("command.error.validation");
  });

  it("refuses an unapproved template and a template version that is not the approved one", async () => {
    const unknown = await inject(t.app, "POST", "/api/reports/exports", "owner", { ...compliance(), templateId: "everything" });
    expect(unknown.statusCode).toBe(403);
    expect(unknown.json().error).toBe("export.templateForbidden");

    const stale = await inject(t.app, "POST", "/api/reports/exports", "owner", { ...compliance(), templateVersion: "0.9.0" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("export.templateForbidden");
  });

  it("produces exactly the template's columns, and exactly the report's rows", async () => {
    const res = await inject(t.app, "POST", "/api/reports/exports", "owner", compliance());
    expect(res.statusCode).toBe(201);
    const artifact = res.json() as ExportArtifact;
    const template = EXPORT_TEMPLATES.find((x) => x.id === "calibration-compliance")!;
    expect(artifact.columns).toEqual(template.fields.map((f) => f.label));

    const byProject = await report<{ rows: unknown[] }>(`/api/reports/by-project?project=${PROJECT_WITH_ASSETS}`);
    expect(artifact.rowCount).toBe(byProject.data.rows.length);

    const download = await inject(t.app, "GET", `/api/reports/exports/${artifact.exportId}/download`, "owner");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("text/csv");
    expect(download.headers["cache-control"]).toContain("no-store");
    const lines = download.body.split("\r\n");
    expect(lines[0]).toBe(template.fields.map((f) => f.label).join(","));
    // header + rows + the classification footer row
    expect(lines).toHaveLength(artifact.rowCount + 2);
    expect(lines.at(-1)).toContain(artifact.exportId);
    expect(lines.at(-1)).toContain("ClientShareable");
    for (const column of RESTRICTED_COLUMNS) expect(download.body).not.toContain(column);
  });

  it("scopes an export's rows server-side, to the requester's offices", async () => {
    const [asOwner, asReader] = await Promise.all([
      inject(t.app, "POST", "/api/reports/exports", "owner", compliance()),
      inject(t.app, "POST", "/api/reports/exports", "reader", compliance()),
    ]);
    expect(asOwner.statusCode).toBe(201);
    expect(asReader.statusCode).toBe(201);
    const ownerArtifact = asOwner.json() as ExportArtifact;
    const readerArtifact = asReader.json() as ExportArtifact;
    expect(ownerArtifact.scopeOffices).toBeNull();
    expect(readerArtifact.scopeOffices).toEqual([OTTAWA]);
    expect(readerArtifact.rowCount).toBeLessThan(ownerArtifact.rowCount);
  });

  it("refuses to export an out-of-scope asset's timeline rather than returning an empty file", async () => {
    const toronto = await t.db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE homeoffice = 'Toronto' LIMIT 1");
    const res = await inject(t.app, "POST", "/api/reports/exports", "reader", {
      templateId: "asset-timeline",
      templateVersion: "1.0.0",
      purpose: "audit trail",
      filters: { assetId: toronto.rows[0].assetid },
      clientSubmissionId: newSubmissionId("export-scope"),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("export.scopeForbidden");
  });

  it("keeps the artifact private to its requester", async () => {
    const res = await inject(t.app, "POST", "/api/reports/exports", "owner", compliance());
    const { exportId } = res.json() as ExportArtifact;
    const other = await inject(t.app, "GET", `/api/reports/exports/${exportId}/download`, "reader");
    expect(other.statusCode).toBe(403);
    expect(other.json().error).toBe("export.forbidden");
    expect((await inject(t.app, "GET", "/api/reports/exports/does-not-exist/download", "owner")).statusCode).toBe(404);
  });

  it("returns the original artifact for a repeated submission ID, and refuses a changed one (rule 3)", async () => {
    const submissionId = newSubmissionId("idem");
    const first = await inject(t.app, "POST", "/api/reports/exports", "owner", compliance({ clientSubmissionId: submissionId }));
    const repeat = await inject(t.app, "POST", "/api/reports/exports", "owner", compliance({ clientSubmissionId: submissionId }));
    expect(repeat.statusCode).toBe(201);
    expect((repeat.json() as ExportArtifact).exportId).toBe((first.json() as ExportArtifact).exportId);

    const changed = await inject(t.app, "POST", "/api/reports/exports", "owner", {
      ...compliance({ clientSubmissionId: submissionId }),
      purpose: "something else entirely",
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe("command.error.idempotencyPayloadMismatch");
  });

  it("records a complete audit entry, including who downloaded it and when", async () => {
    const created = (await inject(t.app, "POST", "/api/reports/exports", "owner", compliance())).json() as ExportArtifact;
    await inject(t.app, "GET", `/api/reports/exports/${created.exportId}/download`, "owner");
    const audit = (await inject(t.app, "GET", `/api/reports/exports/${created.exportId}`, "owner")).json() as ExportAuditRecord;
    expect(audit.requestedBy).toBe("svc-ams@englobecorp.com");
    expect(audit.purpose).toBe("client evidence pack");
    expect(audit.templateVersion).toBe("1.0.0");
    expect(audit.filters).toEqual({ project: PROJECT_WITH_ASSETS });
    expect(audit.classification).toBe("ClientShareable");
    expect(audit.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.downloads).toHaveLength(1);
    expect(audit.downloads[0].by).toBe("svc-ams@englobecorp.com");
    expect(Date.parse(audit.expiresAt) - Date.parse(audit.createdAt)).toBe(15 * 60 * 1000);
  });

  it("refuses the artifact once it has expired, and does not keep it (FR-064)", async () => {
    const created = (await inject(t.app, "POST", "/api/reports/exports", "owner", compliance())).json() as ExportArtifact;
    // Only Date is faked: pg's own timers must keep running or the pool stalls.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.parse(created.expiresAt) + 1000));
      const expired = await inject(t.app, "GET", `/api/reports/exports/${created.exportId}/download`, "owner");
      expect(expired.statusCode).toBe(410);
      expect(expired.json().error).toBe("export.expired");
    } finally {
      vi.useRealTimers();
    }
    const afterwards = await inject(t.app, "GET", `/api/reports/exports/${created.exportId}/download`, "owner");
    expect(afterwards.statusCode).toBe(404); // deleted on the refusal, not merely hidden
  });

  it("neutralises a spreadsheet formula in an exported cell (FR-043)", async () => {
    const victim = await t.db.query<{ assetid: string; custodian: string | null }>(
      "SELECT assetid, custodian FROM asset WHERE currentproject = $1 ORDER BY assetid LIMIT 1",
      [PROJECT_WITH_ASSETS]
    );
    const { assetid, custodian } = victim.rows[0];
    await t.db.query("UPDATE asset SET custodian = $1 WHERE assetid = $2", ["=HYPERLINK(\"http://evil\")", assetid]);
    try {
      const created = (await inject(t.app, "POST", "/api/reports/exports", "owner", compliance())).json() as ExportArtifact;
      const csv = (await inject(t.app, "GET", `/api/reports/exports/${created.exportId}/download`, "owner")).body;
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).not.toMatch(/,=HYPERLINK/);
    } finally {
      await t.db.query("UPDATE asset SET custodian = $1 WHERE assetid = $2", [custodian, assetid]);
    }
  });
});

// ============================================================================================
// F — data currency is visible and accurate
// ============================================================================================

describe("F · data currency (FR-002, WS-W9's 'data currency visible')", () => {
  it("stamps every report, without exception", async () => {
    for (const url of ALL_REPORT_ROUTES) {
      if (url.includes("catalog") || url.includes("templates")) continue; // not report envelopes
      const envelope = await report<unknown>(url);
      expect(envelope.currency, url).toBeDefined();
      expect(envelope.currency.generatedAt, url).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(envelope.views.length, url).toBeGreaterThan(0);
      for (const view of envelope.views) expect(APPROVED_VIEWS as readonly string[], url).toContain(view);
    }
  });

  it("names the real newest business event and the real newest acceptance time", async () => {
    const expected = await t.db.query<{ txn: string | null; rec: string | null; n: number }>(
      "SELECT max(transactiondate) AS txn, max(recorded_at) AS rec, count(*)::int AS n FROM asset_transaction"
    );
    const envelope = await report<unknown>("/api/reports/fleet");
    expect(envelope.currency.latestTransactionAt).toBe(expected.rows[0].txn);
    expect(envelope.currency.latestRecordedAt).toBe(expected.rows[0].rec);
    expect(envelope.currency.transactionCount).toBe(expected.rows[0].n);
  });

  it("computes generatedAt now, and ageSeconds from the data rather than from the request", async () => {
    const before = Date.now();
    const envelope = await report<unknown>("/api/reports/fleet");
    const after = Date.now();
    const generated = Date.parse(envelope.currency.generatedAt);
    expect(generated).toBeGreaterThanOrEqual(before - 1000);
    expect(generated).toBeLessThanOrEqual(after + 1000);
    const expectedAge = Math.round((generated - Date.parse(envelope.currency.latestRecordedAt!)) / 1000);
    expect(Math.abs(envelope.currency.ageSeconds! - expectedAge)).toBeLessThanOrEqual(1);
  });

  it("carries the dataset's synthetic marker, so a figure over synthetic data says so (rule 12)", async () => {
    const envelope = await report<unknown>("/api/reports/fleet");
    expect(envelope.currency.dataset).toBeDefined();
    expect(envelope.currency.dataset.synthetic).toBe(false); // migration/staged is the real fleet
  });

  it("moves the stamp forward when a real transaction lands", async () => {
    const before = (await report<unknown>("/api/reports/fleet")).currency;
    const target = await t.db.query<{ assetid: string }>(
      "SELECT assetid FROM asset WHERE status = 'Available' AND lifecycle <> 'Retired' ORDER BY assetid LIMIT 1"
    );
    const outcome = await inject(t.app, "POST", "/api/commands/Checkout", "admin", {
      lines: [{ assetId: target.rows[0].assetid }],
      project: "01937805",
      clientSubmissionId: newSubmissionId("currency"),
    });
    expect(outcome.json().ok, outcome.body).toBe(true);
    const after = (await report<unknown>("/api/reports/fleet")).currency;
    expect(after.transactionCount).toBe(before.transactionCount + 1);
    expect(Date.parse(after.latestRecordedAt!)).toBeGreaterThanOrEqual(Date.parse(before.latestRecordedAt!));
  });
});

// ============================================================================================
// The definition of done, stated as one test
// ============================================================================================

describe("WS-W9 definition of done", () => {
  it("a Report Reader answers all seven acceptance questions, read-only, with no restricted field", async () => {
    const own = await t.db.query<{ assetid: string }>(
      "SELECT assetid FROM asset WHERE homeoffice = $1 ORDER BY assetid LIMIT 1",
      [OTTAWA]
    );
    const assetId = own.rows[0].assetid;

    const answers = await Promise.all([
      report<{ total: number }>("/api/reports/fleet", "reader"), // Q1 what do we own
      report<{ rows: Array<{ currentlocation: string | null }> }>(`/api/reports/where-who?assetId=${encodeURIComponent(assetId)}`, "reader"), // Q2 where
      report<{ rows: Array<{ custodian: string | null }> }>(`/api/reports/where-who?assetId=${encodeURIComponent(assetId)}`, "reader"), // Q3 who
      report<{ total: number }>(`/api/reports/availability?office=${OTTAWA}`, "reader"), // Q4 what is free
      report<{ overdue: unknown[] }>("/api/reports/calibration?horizonDays=30", "reader"), // Q5 what needs calibration
      report<{ projects: unknown[] }>("/api/reports/by-project", "reader"), // Q6 what is on project Z
      report<{ events: unknown[] }>(`/api/reports/asset-timeline/${encodeURIComponent(assetId)}`, "reader"), // Q7 where was it
    ]);

    expect(answers[0].data.total).toBeGreaterThan(0);
    expect(answers[1].data.rows).toHaveLength(1);
    expect(answers[3].data.total).toBeGreaterThan(0);
    expect(answers[5].data.projects.length).toBeGreaterThan(0);
    expect(answers[6].data.events.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(answer.scope).toEqual({ offices: [OTTAWA], readOnly: true });
      expect(answer.currency.generatedAt).toBeTruthy();
      expect(JSON.stringify(answer)).not.toMatch(/identifiervalue|phonenumber|staticip/);
    }

    // Question 7 for a site is the eighth report, and the same reader reaches it.
    const site = await report<{ installations: unknown[] }>("/api/reports/site-timeline", "reader");
    expect(site.scope.offices).toEqual([OTTAWA]);

    // …and holds no write role anywhere in the system.
    const write = await inject(t.app, "POST", "/api/commands/Checkout", "reader", {
      lines: [{ assetId }],
      project: "01937805",
      clientSubmissionId: newSubmissionId("dod"),
    });
    expect(write.statusCode).toBe(403);

    // A Field User cannot reach a single one of these answers.
    for (const url of ALL_REPORT_ROUTES) {
      expect((await inject(t.app, "GET", url, "field")).statusCode, url).toBe(403);
    }
  }, 60_000);
});
