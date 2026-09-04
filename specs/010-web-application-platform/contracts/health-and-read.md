# Contract: Health and Read APIs

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Transition/derivation authority**: `transition-table.md` (all four axes, including the calibration-currency
derivation and the display-pill precedence order).  
**Consumers**: WS-W1 smoke, Container Apps probes, `app/src/api/http/` initial reads, offline cache
hydration (approved projections only).

**D18 amendment (2026-09-04):** [the need-to-know contract](../../../docs/25-need-to-know-access-ux.md)
supersedes the former universal asset DTO. This contract now owns the Work read projection only;
Reports and Administration use separate route-owned contracts and responses.

## Health

```http
GET /health
GET /api/health
```

Unauthenticated liveness. No secrets, no data rows.

```ts
export interface HealthResponse {
  status: "ok" | "degraded" | "unavailable";
  version: string;          // app/API revision or git SHA injected at build
  schemaVersion?: string;   // latest applied migration id when DB reachable
  checks: {
    database: "ok" | "fail";
    // blob?: "ok" | "fail";  // optional until WS-W7
  };
  time: string;             // ISO UTC
}
```

- Liveness: process up → `200` with `status: "ok"` even if DB briefly fails **or** split
  `/health/live` vs `/health/ready` — implementers pick one pair and document in server README.
- Readiness: database must be `ok` for traffic promotion.

## Who am I

```http
GET /api/me
```

Requires session.

```ts
export interface MeResponse {
  user: {
    userId: string;
    displayName: string;
    upn: string;
    roles: Array<"FieldUser" | "OfficeAdmin" | "SystemOwner" | "ReportReader">;
    capabilities: string[]; // navigation hints only; API recomputes authorization
    eligibleWorkspaces: Array<"Work" | "Reports" | "Administration">;
    primaryWorkspace: "Work" | "Reports" | "Administration";
    officeScopes: Array<{
      officeLocationId: string;
      officeName: string;
      scopeType: "Member" | "Administer" | "Report";
    }>;
  };
  /** Decided R5 ceiling mirrored for UI affordances only — not security. */
  adminScopeMode: "global" | "office";
}
```

## Work asset search (minimal)

```http
GET /api/assets?q=&officeId=&disposition=&serviceability=&categoryId=&limit=&cursor=
```

Authenticated and Work-only. Before querying, the server validates active workspace, route purpose,
`asset.operational.read`, row scope, and the applicable Field/Desk Work projection. ReportReader-only
and Administration-only callers are refused before any asset row/count is fetched. An A/S role in
Work receives the same Work projection; role does not enrich it.

```ts
export interface RecordedReadinessSummary {
  state: "NoRecordedBlocker" | "AttentionDue" | "Blocked" | "Unknown" | "NotApplicable";
  reasonCode: string;
  dueDate?: string;
  allowedActions: string[];
  policyVersion: string;
  evaluatedAt: string;
}

export interface WorkAssetSearchHit {
  assetId: string;            // canonical tag
  friendlyLabel: string;
  serial?: string | null;     // only when needed for identification/disambiguation
  modelName: string;
  categoryName: string;
  lifecycle: string;
  disposition: string;
  serviceability: string;
  /** Presentation only — from view; never write target. Precedence: `transition-table.md` §7.1 (DC-21) */
  displayStatus: string;
  currentContext?: {
    label: "At" | "With" | "Installed at" | "En route to" | "At calibration lab" | "Last known at";
    displayValue: string;
    asOf?: string;
  };
  /** Returned only when the recorded result changes this Work decision/next action. */
  readiness?: RecordedReadinessSummary;
}

export interface WorkAssetSearchResponse {
  dataProjectionId: "field_work_asset_v1" | "desk_work_asset_v1";
  scopeLabel: "Me" | "Office" | "Project";
  items: WorkAssetSearchHit[];
  nextCursor: string | null;
  generatedAt: string;
}
```

The response contains no database UUID, raw calibration currency/date/history, home-office fallback,
custodian UPN/user ID, project internal ID, row version, certificate metadata, cost, SIM/network
field, free-text note, audit metadata, or data-quality field. A workflow-specific command contract
may return an opaque concurrency token only when that workflow requires one; search does not.

### Query rules

- `q` matches canonical id, aliases, serial (non-unique), model text — server-side.
- `disposition`, `serviceability`, and `categoryId` are governed Work filters. Calibration planning
  and `calibrationCurrency` filtering belong only to Administration → Calibration operations.
- Values are validated against the owning contracts; an unknown value is
  `command.error.validation`, never a silent empty result.
- Default `limit` ≤ 50; hard max 100.
- Unauthorized → `401` / `403` with `auth.error.*` codes, empty body for data.
- ReportReader-only callers use report-owned endpoints/projections; they do not receive this route.

## Work asset detail (read)

```http
GET /api/assets/:id
```

Eligibility and supported surface are evaluated before the asset is fetched. A denied or out-of-scope
identifier receives the non-disclosing route policy, so the response cannot confirm whether the
asset exists. The permitted response answers
identity, qualified current context, recorded blocker, permitted next action, and a small relevant
activity subset only. Reports use S19/report routes; Administration uses module-owned routes.

```ts
export interface WorkAssetDetailResponse {
  dataProjectionId: "field_work_asset_v1" | "desk_work_asset_v1";
  asset: WorkAssetSearchHit & {
    aliases?: Array<{ value: string; kind: "Temporary" | "Legacy" | "Other" }>;
    recentActivity: Array<{
      occurredAt: string;
      summary: string;
    }>;
  };
}
```

Aliases and recent activity are separately minimized for the route purpose. There is no optional
rich block that appears merely because the caller has an admin role.

## Non-goals for this contract

- Generic `PATCH /api/assets/:id`
- Arbitrary SQL / filter DSLs
- Bulk export (feature 011 / governed exports)
- Filtering on `displayStatus` — it is a projection, not state; filter the axes instead
- Reports or Administration DTOs; each has its own route/projection contract
- Offline cache schema (WS-W6) — may cache only the exact approved Work projection, partitioned by
  environment, tenant, identity, workspace, and projection version; never a richer DTO or raw table

---

## Amendments made 2026-09-03 (demo-scoped, reversible)

`docs/19-state-model-decision.md` §9 found three defects in the pre-D18 universal contract against
the approved R1 model. The historical calls below remain as provenance, but D18 supersedes their use
in Work responses and filters: raw calibration currency is consumed only by an authorized
maintenance/report projection, while Work receives `RecordedReadinessSummary`.

> **DEMO CALL 2026-09-03 (DC-23)** — `AssetSearchHit` gains `calibrationCurrency`.
> **Reason:** `docs/19` §9.1 — the read contract exposed 3 of the 4 approved axes. Calibration currency is the
> input to feature 004's entire due/overdue workflow and feature 006's compliance report, and across all three
> features' contracts `calibrationCurrency` appeared exactly once, at
> `specs/011-data-management/contracts/duplicate-redirect.md:64`. Every screen that needs it gets it from the
> read API, and the read API did not carry it. The field name matches that existing usage deliberately.
> **Reversal cost:** removing an added response field before any client reads it is one line.

> **DEMO CALL 2026-09-03 (DC-24)** — `GET /api/assets` gains `serviceability` and `calibrationCurrency` filters.
> **Reason:** `docs/19` §9.3 — "show me everything broken" and "show me everything overdue" are the two queries
> the R1 split exists to enable, and neither was expressible. The old query string filtered on `disposition`
> alone, which is the single-`status` filter projected onto one axis rather than a filter written from the new
> model. **Reversal cost:** one line each; no stored state involved.
