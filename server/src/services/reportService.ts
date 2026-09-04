/**
 * Reporting service — WS-W9. The eight reports that answer `docs/00-brief.md`'s seven acceptance
 * questions, plus the governed export products built from them.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * The four rules this file exists to satisfy, and where each one lives
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Reports are read-only.** Nothing here opens a transaction, and no method writes a business
 *    row. `runExport` writes an artifact and an audit record into a process-local store, never
 *    into the asset, transaction, relationship, calibration or installation tables — which
 *    `server/tests/reports.test.ts` proves by counting those tables either side of a full sweep
 *    of every route. CLAUDE.md rule 4 is untouched: no report endpoint can write lifecycle,
 *    disposition, serviceability, location, custodian, project or parent.
 *
 * 2. **Every figure reconciles to operational data.** Every read below goes through
 *    `src/db/views.sql`, and every predicate in those views is a transcription of a predicate
 *    `services/readModel.ts` or `app/src/domain/*` already owns. Where arithmetic is involved —
 *    utilisation spans, timeline attachments, point-in-time state — the API's authority is the
 *    **tested domain module**, not a second implementation in SQL. FR-030 forbids "a separately
 *    maintained reporting copy that could disagree with the operational data"; two derivations of
 *    the same number are that copy, even when both are code.
 *
 * 3. **Manager views exclude sensitive identifiers.** `identifiervalue` (SIM ICCID),
 *    `phonenumber` and `staticip` are absent from every view, so they are absent from every DTO
 *    here by construction rather than by omission. There is no role that turns them back on in
 *    this module: a Report Reader who needs a SIM's ICCID is asking the wrong system
 *    (CLAUDE.md rule 10, WS-W9's "manager DTOs/views exclude sensitive identifiers", FR-003).
 *
 * 4. **Data currency is visible.** Every response carries a `currency` stamp naming when the
 *    answer was computed, the newest business event and the newest server acceptance time it
 *    includes, how stale that makes it, and the dataset's synthetic marker (feature 007 FR-056 /
 *    CLAUDE.md rule 12 — a figure computed over synthetic data must say so on its face). FR-002
 *    says "state the age of the data on every view"; a stamp the caller has to ask for separately
 *    is a stamp that will be dropped by the second consumer.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * Office scope (A-R5)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `specs/_planning/BUILD-FREEZE.md` settles that `ReportReader` is office-scoped and read-only,
 * `SystemOwner` is global, and a role row with `office IS NULL` means global. Scope is applied
 * **in SQL**, as a predicate on the view, not by filtering a full result set in TypeScript —
 * an out-of-scope row must never be loaded, let alone serialised and then removed.
 *
 * Scope filters on `homeoffice`, the office that OWNS the asset, not on where it currently sits.
 * An Ottawa reader keeps seeing an Ottawa logger while it is deployed at a Toronto site, and does
 * not acquire a Toronto logger merely because it is passing through Ottawa. The distinction is
 * visible in every response: `scope.offices` states the population the figures cover, so a scoped
 * total can never be misread as a fleet total.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * View application
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `ensureReportViews` applies `src/db/views.sql` once per database handle, idempotently. It is
 * deliberately not wired into `src/db/`'s driver loader: Agent 1 is converting `schema.sql` into
 * `db/migrations/**` with its own runner in parallel (BUILD-FREEZE file ownership), and a second
 * loader in that directory would collide. Folding `views.sql` into the migration set afterwards
 * is a move, not a rewrite.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  AssetRelationship,
  CalibrationCounts,
  CurrentUser,
  DatasetInfo,
  FleetCounts,
  HistoryEntry,
  InstallationComponent,
  KitRole,
  Orientation,
} from "../../../app/src/api/types";
import type { AssetStatus } from "../../../app/src/domain/stateMachine";
import { componentsAsOf } from "../../../app/src/domain/installation";
import type { AssetSnapshot } from "../../../app/src/domain/deriveState";
import { buildTimeline, stateAsOf } from "../../../app/src/domain/pointInTime";
import {
  categorize,
  computeUtilisation,
  isIdleSince,
  type InsufficientReason,
  type UtilisationCategory,
} from "../../../app/src/domain/utilisation";
import type { Database, Queryable } from "../db/database";

/**
 * The views are applied by `db/migrations/0012_reporting_views.sql`, like every other piece of
 * schema, so by the time any handle reaches this service they already exist.
 *
 * This used to read `src/db/views.sql` and `db.exec` it once per database handle. That was correct
 * while the database lane was still building the migration runner — two lanes cannot edit one
 * schema file at the same time — and wrong the moment the runner landed, because it left two files
 * describing the same eleven views. That is the drift a migration ledger exists to prevent, and
 * `server/src/db/schema.sql` was deleted for exactly the same reason rather than kept as a copy.
 *
 * The function is kept, rather than removing thirteen `await this.ready()` call sites, because it
 * is the honest place to fail if the views are ever missing: a report that returns a confusing SQL
 * error about an unknown relation is much harder to diagnose than one that says the database has
 * not been migrated.
 */
const viewsChecked = new WeakMap<Database, Promise<void>>();

export function ensureReportViews(db: Database): Promise<void> {
  let pending = viewsChecked.get(db);
  if (!pending) {
    pending = (async () => {
      const res = await db.query<{ present: string | null }>("SELECT to_regclass('public.v_asset_current_detail') AS present");
      if (!res.rows[0]?.present) {
        throw new Error(
          "The reporting views are missing. They are applied by db/migrations/0012_reporting_views.sql — " +
            "run `npm run db:migrate` (or open the database through src/db/open.ts, which migrates on open)."
        );
      }
    })();
    viewsChecked.set(db, pending);
  }
  return pending;
}

/** The approved view catalogue, in the spelling `docs/15-postgres-data-model.md` § 12 uses. Every
 * report below declares which of these it read, and reads nothing else. Power BI is permitted
 * over these and only these (WS-W9). */
export const APPROVED_VIEWS = [
  "v_asset_current_detail",
  "v_available_assets_by_office",
  "v_unknown_custodian_sweep",
  "v_calibration_currency",
  "v_calibration_due",
  "v_assets_by_project",
  "v_asset_timeline",
  "v_current_installations",
  "v_installation_timeline",
  "v_asset_state_spans",
  "v_utilisation",
] as const;

/** Columns that must never reach a reporting view, DTO or export (CLAUDE.md rule 10, FR-003). */
export const RESTRICTED_COLUMNS = ["identifiervalue", "phonenumber", "staticip"] as const;

// ============================================================================================
// DTOs
// ============================================================================================

export type ReportId =
  | "fleet"
  | "where-who"
  | "availability"
  | "calibration"
  | "by-project"
  | "asset-timeline"
  | "site-timeline"
  | "utilisation";

/** FR-002. `ageSeconds` is the number a manager actually needs — "is this stale?" — and is
 * computed here rather than left to each consumer to subtract two ISO strings correctly. */
export interface ReportCurrency {
  generatedAt: string;
  latestTransactionAt: string | null;
  latestRecordedAt: string | null;
  transactionCount: number;
  ageSeconds: number | null;
  dataset: DatasetInfo;
}

export interface ReportScope {
  /** `null` = global (SystemOwner). Otherwise the offices whose assets these figures cover. */
  offices: string[] | null;
  /** Always true. Stated in the payload so a consumer never has to infer it from the HTTP verb. */
  readOnly: true;
}

export interface ReportEnvelope<T> {
  report: ReportId;
  /** Which of `docs/00-brief.md`'s seven acceptance questions this answers. */
  questions: number[];
  /** The approved views this answer was read from — the Power BI parity contract. */
  views: string[];
  scope: ReportScope;
  currency: ReportCurrency;
  data: T;
}

export interface ReportFilter {
  office?: string;
  status?: string[];
  equipmenttype?: string;
  assetgroup?: string;
  custodian?: string;
  project?: string;
  includeRetired?: boolean;
}

/** Report 1 — acceptance question 1. Shape-compatible with `FleetCounts` so the existing screens
 * and `/api/reports/fleet-counts` speak the same vocabulary. */
export interface FleetReport extends FleetCounts {
  filter: ReportFilter;
}

/** Reports 2 — acceptance questions 2 and 3. No restricted identifiers: see the header. */
export interface AssetLocationRow {
  assetid: string;
  manufacturer: string;
  model: string;
  equipmenttype: string;
  assetgroup: string;
  serialnumber: string | null;
  homeoffice: string | null;
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  status: string;
  lifecycle: string;
  parentasset: string | null;
  nextcaldue: string | null;
  istemporarytag: boolean;
  isthirdpartyowned: boolean;
}

export interface WhereWhoReport {
  rows: AssetLocationRow[];
  /** FR-010 — out, but nobody knows with whom. Never folded into "in the office". */
  unknownCustodian: AssetLocationRow[];
  total: number;
  truncated: boolean;
}

/** Report 3 — acceptance question 4. */
export interface AvailabilityReport {
  total: number;
  byOffice: Record<string, number>;
  byEquipmentType: Record<string, number>;
  byOfficeAndType: Record<string, Record<string, number>>;
}

/** Report 4 — acceptance question 5. `byOffice` is shape-identical to `CalibrationCounts` so the
 * compliance screen's existing reading of the numbers holds. */
export interface CalibrationDueRow {
  assetid: string;
  homeoffice: string | null;
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  manufacturer: string;
  model: string;
  equipmenttype: string;
  status: string;
  lastcaldate: string | null;
  nextcaldue: string | null;
  /** Positive = overdue by that many days; negative = that many days left; null = unknown. */
  daysoverdue: number | null;
  certificatenumber: string | null;
  certificateurl: string | null;
  lab: string | null;
}

export interface CalibrationReport extends CalibrationCounts {
  horizonDays: number;
  overdue: CalibrationDueRow[];
  dueSoon: CalibrationDueRow[];
  unknownCount: number;
  truncated: boolean;
}

/** Report 5 — acceptance question 6. */
export interface ProjectSummaryRow {
  projectnumber: string;
  projectname: string | null;
  projectstatus: string | null;
  projectoffice: string | null;
  assetCount: number;
}

export interface ProjectAssetRow extends AssetLocationRow {
  projectnumber: string;
  projectname: string | null;
  lastcaldate: string | null;
  daysoverdue: number | null;
  certificatenumber: string | null;
  certificateurl: string | null;
  lab: string | null;
}

export interface ByProjectReport {
  projects: ProjectSummaryRow[];
  project: string | null;
  rows: ProjectAssetRow[];
}

/** Report 6 — acceptance question 7 for one asset. */
export interface TimelineAttachment {
  kind: "attach" | "detach";
  assetId: string;
  role: string | null;
}

export interface TimelineEventRow {
  lineid: string;
  transactionid: string;
  transactionname: string;
  transactiondate: string;
  recordedat: string;
  transactiontype: string;
  performedby: string;
  statusbefore: string;
  statusafter: string;
  fromlocation: string | null;
  tolocation: string | null;
  fromuser: string | null;
  touser: string | null;
  fromproject: string | null;
  toproject: string | null;
  kitrole: string | null;
  orientation: string | null;
  notes: string | null;
  attachments: TimelineAttachment[];
}

export interface AssetTimelineReport {
  assetId: string;
  from: string | null;
  to: string | null;
  events: TimelineEventRow[];
  /** FR-020 — what was true at the start of the requested range, so a filtered timeline never
   * reads as if nothing existed before it. Null when no range start was requested. */
  stateAtRangeStart: AssetSnapshot | null;
  eventCount: number;
}

/** Report 7 — acceptance question 7 for a site. */
export interface InstallationComponentRow {
  componentid: string;
  assetid: string;
  kitrole: string;
  orientation: string | null;
  componentstart: string;
  componentend: string | null;
  manufacturer: string | null;
  model: string | null;
  equipmenttype: string | null;
}

export interface InstallationTimelineRow {
  installationid: string;
  site: string;
  sitename: string;
  project: string;
  primaryasset: string;
  locationtype: string;
  installationstart: string;
  installationend: string | null;
  homeoffice: string | null;
  /** Every component membership ever recorded for this installation, open or closed. */
  components: InstallationComponentRow[];
  /** The subset standing at `asOf` — `componentsAsOf`, the same function the recovery path uses. */
  componentsAsOf: InstallationComponentRow[];
}

export interface SiteTimelineReport {
  site: string | null;
  asOf: string;
  installations: InstallationTimelineRow[];
  currentInstallationIds: string[];
}

/** Report 8 — utilisation. */
export type CategoryTotals = Record<UtilisationCategory, number>;

export interface UtilisationReport {
  from: string;
  to: string;
  periodDays: number;
  /** FR-028's real boundary: the date the reported population's records begin. */
  recordsBegan: string | null;
  measuredAssets: number;
  /** Assets whose window was shortened because they were acquired inside the period. */
  clippedToAcquisition: number;
  /** Why the remaining assets carry no figure. Counted, never silently dropped (FR-027). */
  insufficient: Record<InsufficientReason, number>;
  byEquipmentType: Record<string, CategoryTotals>;
  byOffice: Record<string, CategoryTotals>;
  /** FR-025 — the five office/type pairs with the least available time. */
  lowestAvailability: Array<{ key: string; availablePercent: number }>;
  /** FR-024 — nothing has happened to these since the period began. */
  idle: string[];
  idleCount: number;
}

// ============================================================================================
// Governed exports (CLAUDE.md rule 19, specs/011…/contracts/governed-export.md)
// ============================================================================================

export interface ExportField {
  /** Column header in the artifact. */
  label: string;
  /** Property on the report row. Server-owned: a client never names a column. */
  source: string;
}

export interface ReportExportTemplate {
  id: string;
  version: string;
  name: string;
  /** The approved view the rows come from. One template, one source. */
  view: string;
  classification: "Internal" | "ClientShareable";
  allowedRoles: string[];
  maxRows: number;
  fields: ExportField[];
  /** Filters the template accepts, and which are mandatory — the row scope is a template
   * property, never a client-chosen one. */
  requiredFilters: string[];
  optionalFilters: string[];
  excludesRestrictedIdentifiers: true;
}

export interface ExportArtifact {
  exportId: string;
  templateId: string;
  templateVersion: string;
  requestedBy: string;
  purpose: string;
  filters: Record<string, string>;
  /** Server-resolved. Echoed so the recipient can see the scope the artifact was cut to. */
  scopeOffices: string[] | null;
  columns: string[];
  rowCount: number;
  classification: string;
  createdAt: string;
  expiresAt: string;
  downloadPath: string;
  status: "Ready" | "Expired";
  contentHash: string;
  byteLength: number;
}

export interface ExportAuditRecord extends ExportArtifact {
  downloads: Array<{ at: string; by: string }>;
}

export interface ExportRequest {
  templateId: string;
  templateVersion: string;
  purpose: string;
  filters: Record<string, string>;
  clientSubmissionId: string;
}

/** How long a governed artifact stays reachable. Short by policy: the artifact is a snapshot of a
 * moving fleet, and a CSV that is still downloadable next month is a CSV that will be quoted next
 * month (contract § 5, FR-064). */
export const EXPORT_TTL_MS = 15 * 60 * 1000;

/**
 * The approved template set. This is deliberately a **constant, not a table**: an export template
 * is an approval, and an approval that can be edited through the running application is not an
 * approval (contract § "Approved templates only"; OD-8 records that the initial set is Jay's to
 * confirm). Adding one is a code change with a review, which is the intended cost.
 *
 * Both templates exist because the UI already offers exactly these two downloads today, assembled
 * in the browser from operational reads — `CompliancePage.exportPack` and
 * `TimelinePage.exportCsv`. That client-side assembly is the very substitute path
 * `governed-export.md`'s invariant 4 forbids, so the columns below are the columns those two
 * functions produce, moved to where the row and field scope can actually be enforced.
 */
export const EXPORT_TEMPLATES: ReportExportTemplate[] = [
  {
    id: "calibration-compliance",
    version: "1.0.0",
    name: "Project calibration compliance pack",
    view: "v_assets_by_project",
    classification: "ClientShareable",
    allowedRoles: ["ReportReader", "OfficeAdmin", "SystemOwner"],
    maxRows: 5000,
    // `project` is REQUIRED, and that is the governance, not a convenience: it is what bounds the
    // row scope to something a client is entitled to receive. There is no "whole fleet" variant.
    requiredFilters: ["project"],
    optionalFilters: [],
    fields: [
      { label: "Asset ID", source: "assetid" },
      { label: "Manufacturer", source: "manufacturer" },
      { label: "Model", source: "model" },
      { label: "Equipment type", source: "equipmenttype" },
      { label: "Status", source: "status" },
      { label: "Custodian", source: "custodian" },
      { label: "Location", source: "currentlocation" },
      { label: "Last calibrated", source: "lastcaldate" },
      { label: "Next due", source: "nextcaldue" },
      { label: "Days overdue", source: "daysoverdue" },
      { label: "Certificate", source: "certificatenumber" },
      { label: "Calibration lab", source: "lab" },
    ],
    excludesRestrictedIdentifiers: true,
  },
  {
    id: "asset-timeline",
    version: "1.0.0",
    name: "Asset timeline",
    view: "v_asset_timeline",
    classification: "Internal",
    allowedRoles: ["ReportReader", "OfficeAdmin", "SystemOwner"],
    maxRows: 5000,
    requiredFilters: ["assetId"],
    optionalFilters: ["from", "to"],
    fields: [
      { label: "Date", source: "transactiondate" },
      { label: "Type", source: "transactiontype" },
      { label: "Status before", source: "statusbefore" },
      { label: "Status after", source: "statusafter" },
      { label: "Location", source: "tolocation" },
      { label: "Custodian", source: "touser" },
      { label: "Project", source: "toproject" },
      { label: "Performed by", source: "performedby" },
      { label: "Notes", source: "notes" },
      { label: "Attachments", source: "attachmentsText" },
    ],
    excludesRestrictedIdentifiers: true,
  },
];

/** Structured refusals. Codes follow `specs/010…/contracts/error-codes.md` and
 * `governed-export.md`; the two marked NEW are recorded in the lane report. */
export class ReportRefusal extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = code;
  }
}

// ============================================================================================
// Helpers
// ============================================================================================

const UNKNOWN_KEY = "";

function nowIso(): string {
  return new Date().toISOString();
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function emptyCategoryTotals(): CategoryTotals {
  return { Available: 0, InUse: 0, OutOfService: 0, Retired: 0 };
}

/** ISO date-time `days` before now — the same arithmetic `UtilisationPage.periodStartIso` does. */
function periodStartIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The scope predicate, as a SQL fragment over `$1`. Always `$1`, in every query in this file, so
 * a reader checking that scope is enforced only has to look at one parameter position. `NULL`
 * means global; the cast is explicit because a bare `$1` with a null value has no type.
 */
function scopeSql(column = "homeoffice"): string {
  return `($1::text[] IS NULL OR COALESCE(${column}, '') = ANY($1::text[]))`;
}

interface FleetRow {
  assetid: string;
  homeoffice: string | null;
  assetgroup: string;
  equipmenttype: string;
  istemporarytag: boolean;
  isthirdpartyowned: boolean;
}

// ============================================================================================
// Service
// ============================================================================================

export class ReportService {
  /**
   * Artifacts live in the process, not on disk and not in a bucket. That is the local shape of
   * "private, short-lived artifact": nothing is written where a stray file-share ACL or a
   * container-registry layer could expose it, and a restart loses artifacts that were already
   * meant to expire in fifteen minutes. The production shape is the same interface over
   * `server/src/documents/` (BUILD-FREEZE § A-DOC, Agent 5) plus a migration-owned
   * `export_artifact` table for the audit rows — which is why the audit record below is a
   * complete, standalone value rather than a set of joins.
   */
  private readonly artifacts = new Map<string, { audit: ExportAuditRecord; csv: string }>();
  /** CLAUDE.md rule 3: same submission ID + same request returns the original result; same ID +
   * different request is refused. An export is an external write in every sense that matters — it
   * puts data outside the system — so it gets the same discipline the command path gets. */
  private readonly submissions = new Map<string, { hash: string; exportId: string }>();

  constructor(
    private readonly db: Database,
    private readonly dataset: DatasetInfo,
    /** Used for exactly one thing: an asset's relationships, which
     * `app/src/domain/pointInTime.ts` needs to name the other side of an attach/detach event and
     * to resolve `parentasset` at a past instant. Relationships carry no restricted field, and
     * borrowing the operational read is what keeps the timeline's authority in the tested domain
     * module instead of in a second SQL derivation (FR-030). */
    private readonly relationshipsOf: (assetId: string) => Promise<AssetRelationship[]>
  ) {}

  private ready(): Promise<void> {
    return ensureReportViews(this.db);
  }

  private get q(): Queryable {
    return this.db;
  }

  // ------------------------------------------------------------------ currency (FR-002)

  async currency(): Promise<ReportCurrency> {
    await this.ready();
    const res = await this.q.query<{ latesttxn: string | null; latestrecorded: string | null; n: number }>(
      `SELECT max(transactiondate) AS latesttxn, max(recorded_at) AS latestrecorded, count(*)::int AS n
         FROM asset_transaction`
    );
    const row = res.rows[0] ?? { latesttxn: null, latestrecorded: null, n: 0 };
    const generatedAt = nowIso();
    const recordedMs = row.latestrecorded ? new Date(row.latestrecorded).getTime() : NaN;
    return {
      generatedAt,
      latestTransactionAt: row.latesttxn,
      latestRecordedAt: row.latestrecorded,
      transactionCount: row.n,
      ageSeconds: Number.isNaN(recordedMs) ? null : Math.max(0, Math.round((Date.parse(generatedAt) - recordedMs) / 1000)),
      dataset: this.dataset,
    };
  }

  private async envelope<T>(
    report: ReportId,
    questions: number[],
    views: string[],
    offices: string[] | null,
    data: T
  ): Promise<ReportEnvelope<T>> {
    return { report, questions, views, scope: { offices, readOnly: true }, currency: await this.currency(), data };
  }

  // ------------------------------------------------------------------ 1. Fleet — question 1

  /**
   * FR-005, FR-011, FR-012. The eight filter predicates below are `readModel.filterAssets`
   * transcribed to SQL, in the same order, including the two that are easy to get subtly wrong:
   * `includeRetired` defaults to excluding retired rows (FR-029), and an asset whose model is
   * missing from the catalogue has an empty asset group and therefore matches no group filter.
   *
   * The breakdowns are tallied in TypeScript over the filtered projection rather than by three
   * more GROUP BY round trips. That is not a shortcut around the view — the rows come from
   * `v_asset_current_detail` and nowhere else — it is what guarantees
   * `sum(byOffice) === sum(byAssetGroup) === total` for the SAME row set, which is the invariant
   * `app/tests/api/reporting.test.ts` already asserts against the mock and which three
   * independently-filtered aggregate queries could break.
   */
  async fleet(offices: string[] | null, filter: ReportFilter): Promise<ReportEnvelope<FleetReport>> {
    await this.ready();
    const res = await this.q.query<FleetRow>(
      `SELECT assetid, homeoffice, assetgroup, equipmenttype, istemporarytag, isthirdpartyowned
         FROM v_asset_current_detail
        WHERE ${scopeSql()}
          AND ($2::boolean OR lifecycle <> 'Retired')
          AND ($3::text   IS NULL OR effectiveoffice = $3)
          AND ($4::text[] IS NULL OR status = ANY($4::text[]))
          AND ($5::text   IS NULL OR equipmenttype = $5)
          AND ($6::text   IS NULL OR custodian = $6)
          AND ($7::text   IS NULL OR currentproject = $7)
          AND ($8::text   IS NULL OR assetgroup = $8)
        ORDER BY assetid`,
      [
        offices,
        filter.includeRetired === true,
        filter.office ?? null,
        filter.status?.length ? filter.status : null,
        filter.equipmenttype ?? null,
        filter.custodian ?? null,
        filter.project ?? null,
        filter.assetgroup ?? null,
      ]
    );

    const byOffice: Record<string, number> = {};
    const byAssetGroup: Record<string, number> = {};
    const byEquipmentType: Record<string, number> = {};
    let temporaryTags = 0;
    let thirdPartyOwned = 0;
    for (const r of res.rows) {
      bump(byOffice, r.homeoffice ?? UNKNOWN_KEY);
      bump(byEquipmentType, r.equipmenttype || UNKNOWN_KEY);
      bump(byAssetGroup, r.assetgroup ?? UNKNOWN_KEY);
      if (r.istemporarytag) temporaryTags += 1;
      if (r.isthirdpartyowned) thirdPartyOwned += 1;
    }

    return this.envelope("fleet", [1], ["v_asset_current_detail"], offices, {
      byOffice,
      byAssetGroup,
      byEquipmentType,
      total: res.rows.length,
      temporaryTags,
      thirdPartyOwned,
      filter,
    });
  }

  // ------------------------------------------------------------------ 2. Where / Who — questions 2, 3

  /** FR-006 and FR-010. The unknown-custodian sweep is returned alongside the rows rather than as
   * a separate call, because the whole point of FR-010 is that the two facts are read together. */
  async whereWho(
    offices: string[] | null,
    filter: ReportFilter & { assetId?: string },
    limit = 500
  ): Promise<ReportEnvelope<WhereWhoReport>> {
    await this.ready();
    const params = [
      offices,
      filter.includeRetired === true,
      filter.office ?? null,
      filter.status?.length ? filter.status : null,
      filter.equipmenttype ?? null,
      filter.custodian ?? null,
      filter.project ?? null,
      filter.assetId ? filter.assetId.trim().toUpperCase() : null,
      limit + 1,
    ];
    const res = await this.q.query<AssetLocationRow>(
      `SELECT assetid, manufacturer, model, equipmenttype, assetgroup, serialnumber, homeoffice,
              currentlocation, custodian, currentproject, status, lifecycle, parentasset, nextcaldue,
              istemporarytag, isthirdpartyowned
         FROM v_asset_current_detail
        WHERE ${scopeSql()}
          AND ($2::boolean OR lifecycle <> 'Retired')
          AND ($3::text   IS NULL OR effectiveoffice = $3)
          AND ($4::text[] IS NULL OR status = ANY($4::text[]))
          AND ($5::text   IS NULL OR equipmenttype = $5)
          AND ($6::text   IS NULL OR custodian = $6)
          AND ($7::text   IS NULL OR currentproject = $7)
          AND ($8::text   IS NULL OR upper(assetid) = $8)
        ORDER BY assetid
        LIMIT $9`,
      params
    );
    const truncated = res.rows.length > limit;
    const rows = truncated ? res.rows.slice(0, limit) : res.rows;

    const sweep = await this.q.query<AssetLocationRow>(
      `SELECT assetid, manufacturer, model, equipmenttype, assetgroup, NULL::text AS serialnumber,
              homeoffice, currentlocation, NULL::text AS custodian, currentproject, status, lifecycle,
              NULL::text AS parentasset, NULL::text AS nextcaldue, false AS istemporarytag,
              false AS isthirdpartyowned
         FROM v_unknown_custodian_sweep
        WHERE ${scopeSql()}
        ORDER BY assetid`,
      [offices]
    );

    return this.envelope("where-who", [2, 3], ["v_asset_current_detail", "v_unknown_custodian_sweep"], offices, {
      rows,
      unknownCustodian: sweep.rows,
      total: rows.length,
      truncated,
    });
  }

  // ------------------------------------------------------------------ 3. Availability — question 4

  /** FR-007. The exclusions live in `v_available_assets_by_office`; this method only reshapes the
   * approved aggregate into the two breakdowns the screen asks for. */
  async availability(offices: string[] | null, filter: ReportFilter = {}): Promise<ReportEnvelope<AvailabilityReport>> {
    await this.ready();
    const res = await this.q.query<{ office: string; equipmenttype: string; available: number }>(
      `SELECT office, equipmenttype, sum(available)::int AS available
         FROM v_available_assets_by_office
        WHERE ${scopeSql()}
          AND ($2::text IS NULL OR office = $2)
          AND ($3::text IS NULL OR equipmenttype = $3)
          AND ($4::text IS NULL OR assetgroup = $4)
        GROUP BY office, equipmenttype
        ORDER BY office, equipmenttype`,
      [offices, filter.office ?? null, filter.equipmenttype ?? null, filter.assetgroup ?? null]
    );

    const byOffice: Record<string, number> = {};
    const byEquipmentType: Record<string, number> = {};
    const byOfficeAndType: Record<string, Record<string, number>> = {};
    let total = 0;
    for (const r of res.rows) {
      byOffice[r.office] = (byOffice[r.office] ?? 0) + r.available;
      byEquipmentType[r.equipmenttype] = (byEquipmentType[r.equipmenttype] ?? 0) + r.available;
      (byOfficeAndType[r.office] ??= {})[r.equipmenttype] = r.available;
      total += r.available;
    }
    return this.envelope("availability", [4], ["v_available_assets_by_office"], offices, {
      total,
      byOffice,
      byEquipmentType,
      byOfficeAndType,
    });
  }

  // ------------------------------------------------------------------ 4. Calibration — question 5

  /**
   * FR-013, FR-015, FR-016, FR-017. The bucket order is `readModel.getCalibrationCounts`'s order
   * exactly — at the lab first, then unknown, then overdue, then due-soon, and anything left is
   * simply current and uncounted. Order matters: an asset at the lab whose due date has already
   * passed is *at the lab*, not overdue, and swapping the first two branches would double-count
   * it into a compliance report a client reads.
   */
  async calibration(offices: string[] | null, horizonDays: number, limit = 1000): Promise<ReportEnvelope<CalibrationReport>> {
    await this.ready();
    const today = todayIso();
    const horizon = plusDaysIso(horizonDays);

    const counts = await this.q.query<{
      office: string;
      incalibration: number;
      unknown: number;
      overdue: number;
      duesoon: number;
    }>(
      `SELECT COALESCE(homeoffice, '') AS office,
              count(*) FILTER (WHERE status = 'InCalibration')::int AS incalibration,
              count(*) FILTER (WHERE status <> 'InCalibration' AND nextcaldue IS NULL)::int AS unknown,
              count(*) FILTER (WHERE status <> 'InCalibration' AND nextcaldue IS NOT NULL
                                 AND nextcaldue < $2)::int AS overdue,
              count(*) FILTER (WHERE status <> 'InCalibration' AND nextcaldue IS NOT NULL
                                 AND nextcaldue >= $2 AND nextcaldue <= $3)::int AS duesoon
         FROM v_calibration_currency
        WHERE ${scopeSql()}
        GROUP BY 1
        ORDER BY 1`,
      [offices, today, horizon]
    );

    const detail = await this.q.query<CalibrationDueRow & { bucket: string }>(
      `SELECT assetid, homeoffice, currentlocation, custodian, currentproject, manufacturer, model,
              equipmenttype, status, lastcaldate, nextcaldue, daysoverdue, certificatenumber,
              certificateurl, lab,
              CASE WHEN nextcaldue < $2 THEN 'overdue' ELSE 'dueSoon' END AS bucket
         FROM v_calibration_due
        WHERE ${scopeSql()}
          AND status <> 'InCalibration'
          AND nextcaldue IS NOT NULL
          AND nextcaldue <= $3
        ORDER BY nextcaldue, assetid
        LIMIT $4`,
      [offices, today, horizon, limit + 1]
    );
    const truncated = detail.rows.length > limit;
    const rows = truncated ? detail.rows.slice(0, limit) : detail.rows;

    const byOffice: CalibrationCounts["byOffice"] = {};
    let unknownCount = 0;
    for (const c of counts.rows) {
      byOffice[c.office] = {
        inCalibration: c.incalibration,
        dueSoon: c.duesoon,
        overdue: c.overdue,
        unknown: c.unknown,
      };
      unknownCount += c.unknown;
    }

    return this.envelope("calibration", [5], ["v_calibration_currency", "v_calibration_due"], offices, {
      byOffice,
      asOf: nowIso(),
      horizonDays,
      overdue: rows.filter((r) => r.bucket === "overdue").map(stripBucket),
      dueSoon: rows.filter((r) => r.bucket === "dueSoon").map(stripBucket),
      unknownCount,
      truncated,
    });
  }

  // ------------------------------------------------------------------ 5. By project — question 6

  /** FR-008 and FR-014. With no project named this is the per-project summary a manager scans;
   * with one named it is the asset list plus its calibration evidence. */
  async byProject(offices: string[] | null, project: string | null): Promise<ReportEnvelope<ByProjectReport>> {
    await this.ready();
    const summary = await this.q.query<ProjectSummaryRow>(
      `SELECT projectnumber, projectname, projectstatus, projectoffice, count(*)::int AS "assetCount"
         FROM v_assets_by_project
        WHERE ${scopeSql()}
        GROUP BY projectnumber, projectname, projectstatus, projectoffice
        ORDER BY count(*) DESC, projectnumber`,
      [offices]
    );

    let rows: ProjectAssetRow[] = [];
    if (project) {
      const res = await this.q.query<ProjectAssetRow>(
        `SELECT projectnumber, projectname, assetid, manufacturer, model, equipmenttype, assetgroup,
                serialnumber, homeoffice, currentlocation, custodian,
                projectnumber AS currentproject, status, lifecycle,
                NULL::text AS parentasset, lastcaldate, nextcaldue, daysoverdue, certificatenumber,
                certificateurl, lab, false AS istemporarytag, false AS isthirdpartyowned
           FROM v_assets_by_project
          WHERE ${scopeSql()}
            AND projectnumber = $2
          ORDER BY assetid`,
        [offices, project]
      );
      rows = res.rows;
    }

    return this.envelope("by-project", [6], ["v_assets_by_project"], offices, {
      projects: summary.rows,
      project,
      rows,
    });
  }

  // ------------------------------------------------------------------ 6. Asset timeline — question 7

  /** The office an asset's timeline belongs to, or `undefined` when there is no such asset.
   * Separate from the read so a route can refuse an out-of-scope asset before any history is
   * loaded — an out-of-scope row must not be fetched and then filtered. */
  async assetHomeOffice(assetId: string): Promise<string | null | undefined> {
    await this.ready();
    const res = await this.q.query<{ homeoffice: string | null }>(
      "SELECT homeoffice FROM v_asset_current_detail WHERE upper(assetid) = upper($1)",
      [assetId.trim()]
    );
    return res.rows.length === 0 ? undefined : res.rows[0].homeoffice;
  }

  /**
   * FR-018, FR-019, FR-020, FR-022.
   *
   * The events come from `v_asset_timeline`, but the *attachments* and the range-start state are
   * composed by `app/src/domain/pointInTime.ts` — `buildTimeline` and `stateAsOf`, the same two
   * functions `TimelinePage` calls. The view carries an `attachments` column too, for Power BI;
   * `reports.test.ts` asserts the two agree. One of them has to be authoritative and it is the
   * module with the tests, not the SQL (FR-030).
   */
  async assetTimeline(
    offices: string[] | null,
    assetId: string,
    range: { from?: string; to?: string } = {}
  ): Promise<ReportEnvelope<AssetTimelineReport>> {
    await this.ready();
    const rows = await this.timelineRows(assetId);
    const relationships = await this.relationshipsOf(assetId);
    const history = rows.map(toHistoryEntry);
    const events = buildTimeline(history, relationships);

    const from = range.from ?? null;
    const to = range.to ?? null;
    const filtered = events.filter(
      (ev) => (!from || ev.entry.transactiondate >= from) && (!to || ev.entry.transactiondate <= to)
    );
    const byLineId = new Map(rows.map((r) => [r.lineid, r]));

    return this.envelope("asset-timeline", [7], ["v_asset_timeline"], offices, {
      assetId,
      from,
      to,
      events: filtered.map((ev) => {
        const row = byLineId.get(ev.entry.id);
        return {
          lineid: ev.entry.id,
          transactionid: ev.entry.transaction,
          transactionname: row?.transactionname ?? "",
          transactiondate: ev.entry.transactiondate,
          recordedat: row?.recordedat ?? ev.entry.transactiondate,
          transactiontype: ev.entry.transactiontype,
          performedby: ev.entry.performedby,
          statusbefore: ev.entry.statusbefore,
          statusafter: ev.entry.statusafter,
          fromlocation: ev.entry.fromlocation,
          tolocation: ev.entry.tolocation,
          fromuser: ev.entry.fromuser,
          touser: ev.entry.touser,
          fromproject: ev.entry.fromproject,
          toproject: ev.entry.toproject,
          kitrole: ev.entry.kitrole,
          orientation: ev.entry.orientation,
          notes: ev.entry.notes,
          attachments: ev.attachments.map((a) => ({ kind: a.kind, assetId: a.assetId, role: a.role })),
        } satisfies TimelineEventRow;
      }),
      stateAtRangeStart: from ? stateAsOf(history, from, relationships) : null,
      eventCount: filtered.length,
    });
  }

  /** Raw rows from the approved timeline view, newest first — `getAssetHistory`'s own ordering
   * convention (FR-033), so a consumer that swaps one for the other sees the same sequence. */
  private async timelineRows(assetId: string): Promise<TimelineViewRow[]> {
    const res = await this.q.query<TimelineViewRow>(
      `SELECT assetid, lineid, transactionid, transactionname, transactiontype, transactiondate,
              recordedat, performedby, statusbefore, statusafter, fromlocation, tolocation, fromuser,
              touser, fromproject, toproject, kitrole, orientation, powersource, condition, processed,
              linenotes, transactionnotes, linenumber, attachments
         FROM v_asset_timeline
        WHERE upper(assetid) = upper($1)
        ORDER BY transactiondate DESC, linenumber DESC`,
      [assetId.trim()]
    );
    return res.rows;
  }

  /** Exposed for the reconciliation test: the view's own attachment projection, unmediated. */
  async timelineViewAttachments(assetId: string): Promise<Map<string, TimelineAttachment[]>> {
    await this.ready();
    const rows = await this.timelineRows(assetId);
    return new Map(rows.map((r) => [r.lineid, normaliseAttachments(r.attachments)]));
  }

  // ------------------------------------------------------------------ 7. Site timeline — question 7

  /**
   * The site half of acceptance question 7: what was installed here on date D, and what was
   * attached to it. `componentsAsOf` is `app/src/domain/installation.ts`'s — the same function
   * the recovery command uses to decide what is still open, so "what the report says was there"
   * and "what the system will let you recover" cannot diverge.
   */
  async siteTimeline(
    offices: string[] | null,
    site: string | null,
    asOf: string
  ): Promise<ReportEnvelope<SiteTimelineReport>> {
    await this.ready();
    const res = await this.q.query<InstallationTimelineViewRow>(
      `SELECT installationid, site, sitename, project, primaryasset, locationtype, installationstart,
              installationend, installationhomeoffice, componentid, assetid, kitrole, orientation,
              componentstart, componentend, manufacturer, model, equipmenttype
         FROM v_installation_timeline
        WHERE ${scopeSql("installationhomeoffice")}
          AND ($2::text IS NULL OR site = $2)
        ORDER BY installationstart DESC, installationid, componentstart`,
      [offices, site]
    );

    const current = await this.q.query<{ installationid: string }>(
      `SELECT installationid FROM v_current_installations
        WHERE ${scopeSql()} AND ($2::text IS NULL OR site = $2)`,
      [offices, site]
    );

    const byInstallation = new Map<string, InstallationTimelineRow>();
    for (const r of res.rows) {
      let entry = byInstallation.get(r.installationid);
      if (!entry) {
        entry = {
          installationid: r.installationid,
          site: r.site,
          sitename: r.sitename,
          project: r.project,
          primaryasset: r.primaryasset,
          locationtype: r.locationtype,
          installationstart: r.installationstart,
          installationend: r.installationend,
          homeoffice: r.installationhomeoffice,
          components: [],
          componentsAsOf: [],
        };
        byInstallation.set(r.installationid, entry);
      }
      // A LEFT JOIN keeps an installation with no component rows at all; its component id is null.
      if (r.componentid && r.assetid) {
        entry.components.push({
          componentid: r.componentid,
          assetid: r.assetid,
          kitrole: r.kitrole ?? "",
          orientation: r.orientation,
          componentstart: r.componentstart ?? entry.installationstart,
          componentend: r.componentend,
          manufacturer: r.manufacturer,
          model: r.model,
          equipmenttype: r.equipmenttype,
        });
      }
    }

    for (const entry of byInstallation.values()) {
      const asComponents: InstallationComponent[] = entry.components.map((c) => ({
        id: c.componentid,
        installation: entry.installationid,
        asset: c.assetid,
        kitrole: c.kitrole as KitRole,
        orientation: c.orientation as Orientation | null,
        start: c.componentstart,
        end: c.componentend,
        openedbyline: null,
        closedbyline: null,
      }));
      const openIds = new Set(componentsAsOf(asComponents, asOf).map((c) => c.id));
      entry.componentsAsOf = entry.components.filter((c) => openIds.has(c.componentid));
    }

    return this.envelope("site-timeline", [7], ["v_installation_timeline", "v_current_installations"], offices, {
      site,
      asOf,
      installations: [...byInstallation.values()],
      currentInstallationIds: current.rows.map((r) => r.installationid),
    });
  }

  // ------------------------------------------------------------------ 8. Utilisation

  /**
   * FR-023 through FR-028, and WS-W9's "acquisition/go-live boundaries protect utilisation".
   *
   * Not one line of the boundary logic is re-derived here. `computeUtilisation` from
   * `app/src/domain/utilisation.ts` — 24 tests, and a return type that makes it impossible to
   * reach `spans` without first handling the insufficient case — decides for every asset whether
   * a figure exists at all, and clips the window to the acquisition date when the asset was
   * bought inside the period. This method's whole job is to supply it with two things it cannot
   * know on its own: each asset's history, and the date the reported population's records began.
   *
   * `recordsBegan` is computed over the SCOPED population, which is the honest reading of "the
   * date the fleet's records began" for a reader who can only see one office's fleet. It is
   * returned in the payload so the boundary is never invisible.
   */
  async utilisation(
    offices: string[] | null,
    options: { periodDays?: number; from?: string; to?: string; idleLimit?: number } = {}
  ): Promise<ReportEnvelope<UtilisationReport>> {
    await this.ready();
    const periodDays = options.periodDays ?? 90;
    const to = options.to ?? nowIso();
    const from = options.from ?? periodStartIso(periodDays);
    const idleLimit = options.idleLimit ?? 200;

    const boundary = await this.q.query<{
      assetid: string;
      homeoffice: string | null;
      equipmenttype: string;
      lifecycle: string;
      firsttransactionat: string | null;
    }>(
      `SELECT assetid, homeoffice, equipmenttype, lifecycle, firsttransactionat
         FROM v_utilisation
        WHERE ${scopeSql()}
        ORDER BY assetid`,
      [offices]
    );

    // `recordsBeganAt` in the domain module folds a set of histories to their minimum ISO string;
    // `v_utilisation.firsttransactionat` is that minimum already computed per asset, so the fleet
    // boundary is one more min() over the same lexicographic comparison.
    let recordsBegan: string | null = null;
    for (const r of boundary.rows) {
      if (r.firsttransactionat !== null && (recordsBegan === null || r.firsttransactionat < recordsBegan)) {
        recordsBegan = r.firsttransactionat;
      }
    }

    const lines = await this.q.query<TimelineViewRow>(
      `SELECT t.assetid, t.lineid, t.transactionid, t.transactionname, t.transactiontype,
              t.transactiondate, t.recordedat, t.performedby, t.statusbefore, t.statusafter,
              t.fromlocation, t.tolocation, t.fromuser, t.touser, t.fromproject, t.toproject,
              t.kitrole, t.orientation, t.powersource, t.condition, t.processed, t.linenotes,
              t.transactionnotes, t.linenumber, t.attachments
         FROM v_asset_timeline t
         JOIN v_utilisation u ON u.assetid = t.assetid
        WHERE ${scopeSql("u.homeoffice")}`,
      [offices]
    );
    const historyByAsset = new Map<string, HistoryEntry[]>();
    for (const row of lines.rows) {
      const list = historyByAsset.get(row.assetid) ?? [];
      list.push(toHistoryEntry(row));
      historyByAsset.set(row.assetid, list);
    }

    const byEquipmentType: Record<string, CategoryTotals> = {};
    const byOffice: Record<string, CategoryTotals> = {};
    const byOfficeAndType = new Map<string, CategoryTotals>();
    const insufficient: Record<InsufficientReason, number> = { noHistory: 0, beforeRecords: 0, notYetAcquired: 0 };
    const idle: string[] = [];
    let measuredAssets = 0;
    let clippedToAcquisition = 0;

    for (const asset of boundary.rows) {
      const history = historyByAsset.get(asset.assetid) ?? [];
      const result = computeUtilisation(history, from, to, { recordsBegan });

      // FR-024 is not gated by FR-027: idleness needs only a last-activity date, not a window the
      // records can support, so it is counted even for an asset with no proportion figure.
      if (asset.lifecycle !== "Retired" && isIdleSince(history, from)) idle.push(asset.assetid);

      if (!result.sufficient) {
        insufficient[result.reason] += 1;
        continue;
      }
      measuredAssets += 1;
      if (result.clippedToAcquisition) clippedToAcquisition += 1;

      const typeKey = asset.equipmenttype || UNKNOWN_KEY;
      const officeKey = asset.homeoffice ?? UNKNOWN_KEY;
      const pairKey = `${officeKey || "—"} · ${typeKey || "—"}`;
      const typeTotals = (byEquipmentType[typeKey] ??= emptyCategoryTotals());
      const officeTotals = (byOffice[officeKey] ??= emptyCategoryTotals());
      let pairTotals = byOfficeAndType.get(pairKey);
      if (!pairTotals) {
        pairTotals = emptyCategoryTotals();
        byOfficeAndType.set(pairKey, pairTotals);
      }
      for (const span of result.spans) {
        const category = categorize(span.status);
        typeTotals[category] += span.durationMs;
        officeTotals[category] += span.durationMs;
        pairTotals[category] += span.durationMs;
      }
    }

    const lowestAvailability = [...byOfficeAndType.entries()]
      .map(([key, totals]) => {
        const total = totals.Available + totals.InUse + totals.OutOfService + totals.Retired;
        return { key, availablePercent: total === 0 ? 0 : Math.round((totals.Available / total) * 100) };
      })
      .sort((a, b) => a.availablePercent - b.availablePercent)
      .slice(0, 5);

    return this.envelope("utilisation", [1], ["v_utilisation", "v_asset_timeline", "v_asset_state_spans"], offices, {
      from,
      to,
      periodDays,
      recordsBegan,
      measuredAssets,
      clippedToAcquisition,
      insufficient,
      byEquipmentType,
      byOffice,
      lowestAvailability,
      idle: idle.slice(0, idleLimit),
      idleCount: idle.length,
    });
  }

  /** Exposed for the reconciliation test: the SQL span decomposition from `v_asset_state_spans`,
   * which Power BI reads and which must agree with `statusSpans`. */
  async stateSpans(assetId: string): Promise<Array<{ spanstart: string; spanend: string | null; status: string }>> {
    await this.ready();
    const res = await this.q.query<{ spanstart: string; spanend: string | null; status: string }>(
      `SELECT spanstart, spanend, status FROM v_asset_state_spans
        WHERE upper(assetid) = upper($1) ORDER BY spanindex`,
      [assetId.trim()]
    );
    return res.rows;
  }

  // ==========================================================================================
  // Governed exports
  // ==========================================================================================

  /** Contract § "GET templates returns only templates permitted to the caller's role". A template
   * the caller cannot use is not listed, so the UI cannot offer a button that must then refuse. */
  templatesFor(user: CurrentUser): ReportExportTemplate[] {
    const roles = new Set<string>(user.roles as unknown as string[]);
    return EXPORT_TEMPLATES.filter((t) => t.allowedRoles.some((r) => roles.has(r)));
  }

  /**
   * Build a governed artifact.
   *
   * Every one of the contract's server-enforcement clauses is a line here, in this order:
   *   1. the template must exist, at the exact version asked for, and be permitted to this role;
   *   2. the filters are the template's own — a filter it does not declare is refused, and one it
   *      requires cannot be omitted (this is what bounds the row scope server-side);
   *   3. an office filter outside the caller's scope is refused rather than silently narrowed;
   *   4. the rows are read from the template's single approved view, with the SAME scope predicate
   *      every report uses;
   *   5. the row cap is enforced before an artifact exists, not after it is downloaded;
   *   6. columns come from the template's field list. There is no code path by which a request
   *      can name a column — see `routes/reports.ts`, which refuses a body carrying one outright.
   */
  async runExport(user: CurrentUser, offices: string[] | null, req: ExportRequest): Promise<ExportArtifact> {
    await this.ready();
    const hash = createHash("sha256")
      .update(JSON.stringify({ t: req.templateId, v: req.templateVersion, f: req.filters, p: req.purpose, u: user.upn }))
      .digest("hex");
    const prior = this.submissions.get(req.clientSubmissionId);
    if (prior) {
      if (prior.hash !== hash) {
        throw new ReportRefusal(
          "command.error.idempotencyPayloadMismatch",
          409,
          "This submission ID was already used for a different export request."
        );
      }
      const stored = this.artifacts.get(prior.exportId);
      if (stored) return this.withFreshStatus(stored.audit);
    }

    const template = EXPORT_TEMPLATES.find((t) => t.id === req.templateId);
    const roles = new Set<string>(user.roles as unknown as string[]);
    if (!template || !template.allowedRoles.some((r) => roles.has(r))) {
      throw new ReportRefusal("export.templateForbidden", 403, `No approved export template "${req.templateId}" for this role.`);
    }
    if (template.version !== req.templateVersion) {
      throw new ReportRefusal("export.templateForbidden", 409, `Template ${template.id} is at version ${template.version}.`, {
        approvedVersion: template.version,
      });
    }

    const allowed = new Set([...template.requiredFilters, ...template.optionalFilters]);
    for (const key of Object.keys(req.filters)) {
      if (!allowed.has(key)) {
        throw new ReportRefusal("export.scopeForbidden", 400, `Filter "${key}" is not part of template ${template.id}.`);
      }
    }
    for (const key of template.requiredFilters) {
      if (!req.filters[key]) {
        throw new ReportRefusal("command.error.validation", 400, `Template ${template.id} requires filter "${key}".`);
      }
    }
    if (req.filters.office && offices !== null && !offices.includes(req.filters.office)) {
      throw new ReportRefusal("export.scopeForbidden", 403, "Requested office is outside your report scope.");
    }
    // A template filtered by asset id names a row directly, so office scope has to be resolved
    // from that row rather than from a filter the caller happened to supply. Refused here, and
    // ALSO enforced as a predicate inside `exportRows` — an artifact that silently came back with
    // zero rows would look like "this asset has no history", which is a different and wrong answer.
    if (req.filters.assetId && offices !== null) {
      const homeoffice = await this.assetHomeOffice(req.filters.assetId);
      if (homeoffice === undefined || !offices.includes(homeoffice ?? "")) {
        throw new ReportRefusal("export.scopeForbidden", 403, "That asset is outside your report scope.");
      }
    }

    const rows = await this.exportRows(template, offices, req.filters);
    if (rows.length > template.maxRows) {
      throw new ReportRefusal("export.rowLimitExceeded", 400, `Template ${template.id} is capped at ${template.maxRows} rows.`, {
        rowCount: rows.length,
        maxRows: template.maxRows,
      });
    }

    const exportId = randomUUID();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.parse(createdAt) + EXPORT_TTL_MS).toISOString();
    const columns = template.fields.map((f) => f.label);
    const csv = renderCsv(template, rows, { exportId, createdAt, expiresAt, scopeOffices: offices });

    const audit: ExportAuditRecord = {
      exportId,
      templateId: template.id,
      templateVersion: template.version,
      requestedBy: user.upn,
      purpose: req.purpose,
      filters: req.filters,
      scopeOffices: offices,
      columns,
      rowCount: rows.length,
      classification: template.classification,
      createdAt,
      expiresAt,
      downloadPath: `/api/reports/exports/${exportId}/download`,
      status: "Ready",
      contentHash: createHash("sha256").update(csv).digest("hex"),
      byteLength: Buffer.byteLength(csv, "utf8"),
      downloads: [],
    };
    this.artifacts.set(exportId, { audit, csv });
    this.submissions.set(req.clientSubmissionId, { hash, exportId });
    return this.withFreshStatus(audit);
  }

  /** The artifact is bound to the identity that requested it. A System Owner may inspect any
   * artifact's metadata for audit, which is a different power from downloading its contents. */
  auditFor(user: CurrentUser, exportId: string): ExportAuditRecord {
    const stored = this.artifacts.get(exportId);
    if (!stored) throw new ReportRefusal("export.notFound", 404, "No such export.");
    const isOwner = stored.audit.requestedBy === user.upn;
    const isSystemOwner = (user.roles as unknown as string[]).includes("SystemOwner");
    if (!isOwner && !isSystemOwner) throw new ReportRefusal("export.forbidden", 403, "This export belongs to another user.");
    return { ...this.withFreshStatus(stored.audit), downloads: stored.audit.downloads };
  }

  download(user: CurrentUser, exportId: string): { csv: string; artifact: ExportArtifact } {
    const stored = this.artifacts.get(exportId);
    if (!stored) throw new ReportRefusal("export.notFound", 404, "No such export.");
    if (stored.audit.requestedBy !== user.upn) {
      // Not "not found" — a governed artifact's existence is auditable, its contents are not.
      throw new ReportRefusal("export.forbidden", 403, "This export belongs to another user.");
    }
    if (Date.now() > Date.parse(stored.audit.expiresAt)) {
      // Contract § 5: after expiry, refuse and delete. Deleting on the refusal is what makes
      // "short-lived" true rather than merely stated.
      this.artifacts.delete(exportId);
      throw new ReportRefusal("export.expired", 410, "This export artifact has expired.");
    }
    stored.audit.downloads.push({ at: nowIso(), by: user.upn });
    return { csv: stored.csv, artifact: this.withFreshStatus(stored.audit) };
  }

  private withFreshStatus(audit: ExportAuditRecord): ExportArtifact {
    const { downloads: _downloads, ...artifact } = audit;
    return { ...artifact, status: Date.now() > Date.parse(audit.expiresAt) ? "Expired" : "Ready" };
  }

  private async exportRows(
    template: ReportExportTemplate,
    offices: string[] | null,
    filters: Record<string, string>
  ): Promise<Array<Record<string, unknown>>> {
    if (template.view === "v_assets_by_project") {
      const res = await this.q.query<Record<string, unknown>>(
        `SELECT assetid, manufacturer, model, equipmenttype, status, custodian, currentlocation,
                lastcaldate, nextcaldue, daysoverdue, certificatenumber, lab
           FROM v_assets_by_project
          WHERE ${scopeSql()} AND projectnumber = $2
          ORDER BY assetid`,
        [offices, filters.project]
      );
      return res.rows;
    }
    if (template.view === "v_asset_timeline") {
      const res = await this.q.query<Record<string, unknown>>(
        `SELECT t.transactiondate, t.transactiontype, t.statusbefore, t.statusafter, t.tolocation,
                t.touser, t.toproject, t.performedby,
                COALESCE(t.linenotes, t.transactionnotes) AS notes, t.attachments
           FROM v_asset_timeline t
           JOIN v_asset_current_detail d ON d.assetid = t.assetid
          WHERE ${scopeSql("d.homeoffice")}
            AND upper(t.assetid) = upper($2)
            AND ($3::text IS NULL OR t.transactiondate >= $3)
            AND ($4::text IS NULL OR t.transactiondate <= $4)
          ORDER BY t.transactiondate DESC, t.linenumber DESC`,
        [offices, filters.assetId, filters.from ?? null, filters.to ?? null]
      );
      return res.rows.map((r) => ({
        ...r,
        attachmentsText: normaliseAttachments(r.attachments)
          .map((a) => `${a.kind}:${a.assetId}${a.role ? ` (${a.role})` : ""}`)
          .join("; "),
      }));
    }
    /* istanbul ignore next — unreachable while EXPORT_TEMPLATES holds only the two above. */
    throw new ReportRefusal("export.templateForbidden", 500, `No row source for view ${template.view}.`);
  }
}

// ============================================================================================
// Row mapping and CSV rendering
// ============================================================================================

interface TimelineViewRow {
  assetid: string;
  lineid: string;
  transactionid: string;
  transactionname: string;
  transactiontype: string;
  transactiondate: string;
  recordedat: string;
  performedby: string;
  statusbefore: string;
  statusafter: string;
  fromlocation: string | null;
  tolocation: string | null;
  fromuser: string | null;
  touser: string | null;
  fromproject: string | null;
  toproject: string | null;
  kitrole: string | null;
  orientation: string | null;
  powersource: string | null;
  condition: string | null;
  processed: boolean;
  linenotes: string | null;
  transactionnotes: string | null;
  linenumber: number;
  attachments: unknown;
}

interface InstallationTimelineViewRow {
  installationid: string;
  site: string;
  sitename: string;
  project: string;
  primaryasset: string;
  locationtype: string;
  installationstart: string;
  installationend: string | null;
  installationhomeoffice: string | null;
  componentid: string | null;
  assetid: string | null;
  kitrole: string | null;
  orientation: string | null;
  componentstart: string | null;
  componentend: string | null;
  manufacturer: string | null;
  model: string | null;
  equipmenttype: string | null;
}

/** The view row shaped as the `HistoryEntry` every domain module consumes — the same mapping
 * `db/rows.ts#historyFromRow` performs for the operational path, kept here because the column
 * names differ (`linenotes`, `lineid`) and a shared mapper would have to know about both. */
function toHistoryEntry(r: TimelineViewRow): HistoryEntry {
  return {
    id: r.lineid,
    transaction: r.transactionid,
    asset: r.assetid,
    statusbefore: r.statusbefore as AssetStatus,
    statusafter: r.statusafter as AssetStatus,
    kitrole: r.kitrole as HistoryEntry["kitrole"],
    orientation: r.orientation,
    powersource: r.powersource,
    condition: r.condition as HistoryEntry["condition"],
    processed: r.processed,
    notes: r.linenotes,
    transactiondate: r.transactiondate,
    transactiontype: r.transactiontype,
    performedby: r.performedby,
    fromlocation: r.fromlocation,
    tolocation: r.tolocation,
    fromuser: r.fromuser,
    touser: r.touser,
    fromproject: r.fromproject,
    toproject: r.toproject,
  };
}

/** `jsonb` arrives as a parsed value on `pg` and on PGlite alike, but the column is nullable via
 * the LEFT JOIN LATERAL, and a string is what a driver that does not parse jsonb would hand back.
 * Both are normalised rather than trusted. */
function normaliseAttachments(value: unknown): TimelineAttachment[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      kind: a.kind === "detach" ? "detach" : "attach",
      assetId: String(a.assetId ?? ""),
      role: a.role == null ? null : String(a.role),
    }));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripBucket(row: CalibrationDueRow & { bucket: string }): CalibrationDueRow {
  const { bucket: _bucket, ...rest } = row;
  return rest;
}

/**
 * CSV cell escaping plus spreadsheet formula-injection protection (governed-export.md's last
 * line, feature 011 FR-043). A cell whose text begins `=`, `+`, `-`, `@`, a tab or a carriage
 * return is executed as a formula by Excel and Sheets when the file is opened, which turns a
 * compliance pack into a delivery mechanism. Prefixing an apostrophe neutralises it and is what
 * the recipient's spreadsheet strips on display.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function renderCsv(
  template: ReportExportTemplate,
  rows: Array<Record<string, unknown>>,
  meta: { exportId: string; createdAt: string; expiresAt: string; scopeOffices: string[] | null }
): string {
  const lines: string[] = [];
  lines.push(template.fields.map((f) => csvCell(f.label)).join(","));
  for (const row of rows) {
    lines.push(template.fields.map((f) => csvCell(row[f.source])).join(","));
  }
  // Contract § 7: a visible classification / export ID footer where the format supports it. Kept
  // as a well-formed final ROW rather than a `#` comment line, so a naive parser reads it as data
  // instead of choking on it — the recipient of a client-facing pack is not running a CSV dialect
  // negotiator.
  lines.push(
    [
      "Englobe AMS governed export",
      meta.exportId,
      `${template.id}@${template.version}`,
      template.classification,
      `generated ${meta.createdAt}`,
      `expires ${meta.expiresAt}`,
      `scope ${meta.scopeOffices ? meta.scopeOffices.join("|") : "all offices"}`,
      `rows ${rows.length}`,
    ]
      .map(csvCell)
      .join(",")
  );
  return lines.join("\r\n");
}
