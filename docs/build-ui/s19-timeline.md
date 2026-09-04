# S19 — Asset timeline

| | |
|---|---|
| **Screen ID** | S19 |
| **Route** | `/reports/timeline/:assetId` |
| **Component** | `app/src/features/reports/TimelinePage.tsx` |
| **Surfaces** | Desk |
| **Roles** | all |
| **One job** | Append-only history for one asset with optional range and governed export |
| **Source** | `docs/12-ui-spec.md` § 5.20 · refreshed 2026-09-03 |

## Purpose

Answer Q7 for an asset: events newest first, including attach/detach lines. Range start callout shows reconstructed state at from-date (derived — not user-authored).

## Entry points

| From | How |
|---|---|
| S17 timeline Confirm | Asset id |
| Deep link | `/reports/timeline/:assetId` |

## Layout zones

Back → Asset ID · pills → data-as-of → range card (from/to, All, Export, range-start callout) → event list.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Back | `common.back` | Top | always | always | Navigate back | — | — | — |
| From / To dates | — | Range card | always | always | Filter events | Updates list + callout | — | Cached |
| All | `common.all` | Range card | always | always | Clears range | Full history | — | — |
| Export | `reports.timeline.export` | Range card | always | authorized | Governed export | Private artifact | 403/expiry | Fail closed |

## Data shown

Status pills; range-start state (`reports.timeline.rangeStart`); event rows with ± component lines; performer · notes. Empty: `asset.history.empty`.

## States

Loading · empty · ranged · export pending · not found.

## Non-goals

- Editing or deleting history lines
- Client-side rewrite of statusBefore/After

## Conflicts / TBD

None critical.

## Governing links

- `docs/12-ui-spec.md` § 5.20
- `app/src/features/reports/TimelinePage.tsx`
