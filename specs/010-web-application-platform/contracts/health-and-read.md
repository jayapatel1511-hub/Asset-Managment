# Contract: Health and Read APIs

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Transition/derivation authority**: `transition-table.md` (all four axes, including the calibration-currency
derivation and the display-pill precedence order).  
**Consumers**: WS-W1 smoke, Container Apps probes, `app/src/api/http/` initial reads, offline cache
hydration (approved projections only).

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
    officeScopes: Array<{
      officeLocationId: string;
      officeName: string;
      scopeType: "Member" | "Administer" | "Report";
    }>;
  };
  /** ASSUMPTION: R5 mirrored for UI affordances only — not security. */
  adminScopeMode: "global" | "office";
}
```

## Asset search (minimal)

```http
GET /api/assets?q=&officeId=&disposition=&serviceability=&calibrationCurrency=&limit=&cursor=
```

Authenticated. Server applies role + office scope. Field User responses **omit** secured
identifiers (ICCID, phone, static IP, etc.).

```ts
export interface AssetSearchHit {
  id: string;                 // UUID
  assetId: string;            // canonical tag
  serial: string | null;
  modelName: string;
  manufacturer: string;
  lifecycle: string;          // R1 APPROVED 2026-09-03
  disposition: string;        // R1 APPROVED 2026-09-03
  serviceability: string;     // R1 APPROVED 2026-09-03
  /**
   * Fourth approved axis — **derived, never a stored column**.
   * `NotRequired | Unknown | Current | DueSoon | Overdue | Failed`
   * Derivation and precedence: `transition-table.md` §6 (DC-18, DC-19, DC-20).
   * DEMO CALL 2026-09-03 (DC-18): `InCalibration` is NOT a currency value — read "at the lab"
   * off `disposition === "AtCalibrationLab"`.
   */
  calibrationCurrency: string;
  /** Presentation only — from view; never write target. Precedence: `transition-table.md` §7.1 (DC-21) */
  displayStatus: string;
  homeOfficeId: string | null;
  currentLocationId: string | null;
  custodianUserId: string | null;
  projectId: string | null;
  rowVersion: number;
  // no certificate URLs, no SIM fields
}

export interface AssetSearchResponse {
  items: AssetSearchHit[];
  nextCursor: string | null;
  generatedAt: string;
}
```

### Query rules

- `q` matches canonical id, aliases, serial (non-unique), model text — server-side.
- `disposition`, `serviceability` and `calibrationCurrency` are **fixed-enum filters**, repeatable for OR
  within one axis and ANDed across axes. They are not a filter DSL — that remains a non-goal below.
- Values are validated against `transition-table.md` §2 and §6; an unknown value is
  `command.error.validation`, never a silent empty result.
- Default `limit` ≤ 50; hard max 100.
- Unauthorized → `401` / `403` with `auth.error.*` codes, empty body for data.
- ReportReader: read-only; same omissions for secured fields.

## Asset detail (read)

```http
GET /api/assets/:id
```

Same field-security rules. Includes alias list and recent transaction summary **without** allowing
edits. Full timeline endpoints may arrive with WS-W9; minimal detail is enough for deep link US1.

```ts
export interface AssetDetailResponse {
  asset: AssetSearchHit & {
    aliases: Array<{ value: string; kind: "Temporary" | "Legacy" | "Other" }>;
  };
  // sensitiveNetwork?: never for FieldUser
}
```

## Non-goals for this contract

- Generic `PATCH /api/assets/:id`
- Arbitrary SQL / filter DSLs
- Bulk export (feature 011 / governed exports)
- Filtering on `displayStatus` — it is a projection, not state; filter the axes instead
- Offline cache schema (WS-W6) — must project from these DTOs, not raw tables

---

## Amendments made 2026-09-03 (demo-scoped, reversible)

`docs/19-state-model-decision.md` §9 found three defects in this contract against the approved R1 model. All
three are fixed above.

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
