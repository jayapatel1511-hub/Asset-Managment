# S18 — Calibration compliance

| | |
|---|---|
| **Screen ID** | S18 |
| **Route** | `/reports/compliance` |
| **Component** | `app/src/features/reports/CompliancePage.tsx`, `governedExport.ts` |
| **Surfaces** | Desk |
| **Roles** | all (via S17) |
| **One job** | Evidence view of calibration overdue / due / in-cal / unknown by office and project |
| **Source** | `docs/12-ui-spec.md` § 5.19 · refreshed 2026-09-03 |

## Purpose

Read-only compliance evidence. Export must be a **governed** product (template, server scope, private artifact, audit) — not a client-side invent-a-CSV.

## Entry points

| From | How |
|---|---|
| S17 | Calibration compliance button |

## Layout zones

Title + data-as-of → By office card (badge counts) → By project (dropdown + Export + AssetRows) → footer.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Project Dropdown | — | By project | always | always | Select | Shows rows | — | Cached |
| Export | `reports.timeline.export` | By project | rows exist | authorized | Request governed export | Short-lived private artifact / download | 403 / expiry / audit deny | Fail closed |
| AssetRow | C2 + overdue text | List | rows | always | → S03 | — | — | — |
| Open certificate | `asset.history.openCertificate` | Row | URL | always | Private download | — | Auth | Fail offline |

## Data shown

Badges: Overdue, Due within 30 days, In calibration (fix G-07), Unknown (`reports.compliance.unknownCount`).

## States

Loading · empty project · export pending · error.

## Non-goals

- Editing calibration from this screen
- Browser-owned export of unrestricted fields

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Card title "Reports" | Label reuse noted in § 5.19 | Prefer `reports.compliance.title` for card |
| Export template id | Must match approved template registry | Wire to server export API when ready |

## Governing links

- `docs/12-ui-spec.md` § 5.19
- Specs 011 governed export contracts
- `app/src/features/reports/CompliancePage.tsx`
