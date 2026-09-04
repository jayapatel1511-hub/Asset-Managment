# S17 — Reports home

| | |
|---|---|
| **Screen ID** | S17 |
| **Route** | `/reports` |
| **Component** | `app/src/features/reports/ReportsHomePage.tsx` |
| **Surfaces** | Desk |
| **Roles** | all (linked from S13 today) |
| **One job** | In-app interim fleet / availability / project / timeline entry |
| **Source** | `docs/12-ui-spec.md` § 5.18 · refreshed 2026-09-03 |

## Purpose

Read-only aggregates for Q1–Q6 until Power BI optional views. Not a licence-free substitute (`reports.notPublished`).

## Entry points

| From | How |
|---|---|
| S13 Reports | Button |

## Layout zones

Title + data-as-of → filter card → Fleet → Availability → By project → Asset timeline jump → Compliance / Utilisation buttons → footer.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Home office filter | `asset.homeOffice` Dropdown | Filter card | always | always | Filter All/office | Refresh cards | — | Cached aggregates |
| Equipment type filter | `reports.fleet.byType` | Filter card | always | always | Filter | Refresh | — | Cached |
| Project picker | By project card | Card | always | always | Select project | AssetRow list | — | Cached |
| Timeline Asset ID | `search.placeholder` | Timeline card | always | always | Type id | — | — | — |
| Confirm | `common.confirm` | Timeline card | always | non-empty | → `/reports/timeline/:assetId` | S19 | notFound handling on S19 | — |
| Calibration compliance | `reports.compliance.title` | Bottom | always | always | → `/reports/compliance` | S18 | — | — |
| Utilisation | `reports.utilisation.title` | Bottom | always | always | → `/reports/utilisation` | S20 | — | — |
| Project AssetRow | C2 | By project | project chosen | always | → S03 | — | — | — |

## Data shown

Fleet totals/lists; availability; temporary tags; third-party owned; `reports.dataAsOf`.

## States

Loading (inline spinners) · filtered · empty project list · offline.

## Non-goals

- Mutating fleet
- Ungoverned CSV dump from this home (exports live on S18/S19 with rules)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-22 | Desktop table layouts for reports | Phone-column layout until Desk redesign |
| G-06 | Field access | Admin link only |

## Governing links

- `docs/12-ui-spec.md` § 5.18
- `app/src/features/reports/ReportsHomePage.tsx`
