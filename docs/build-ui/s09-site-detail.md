# S09 — Site detail

| | |
|---|---|
| **Screen ID** | S09 (+ D06) |
| **Route** | `/site/:site` |
| **Component** | `app/src/features/site/SiteDetailPage.tsx`, `SwapDialog.tsx` |
| **Surfaces** | Desk · Field |
| **Roles** | all |
| **One job** | Inspect an installation at a site and recover / swap / redeploy |
| **Source** | `docs/12-ui-spec.md` § 5.10, § 5.13 · refreshed 2026-09-03 |

## Purpose

Show current and past installations, components as-of a date, and actions Deploy here / Swap / Recover.

## Entry points

| From | How |
|---|---|
| S08 row | Tap site |
| S03 deployment row | Tap |
| After Recover | Navigate to site |

## Layout zones

1. Site key Title2 mono
2. Deploy here primary
3. Current installation list (selected styling)
4. Past installations
5. As of date
6. Components list
7. Info card (power, position, location type, lat/long)

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Deploy here | `site.deployAction` | Top | always | always | → `/deploy` (site context TBD if prefilled) | S10 | — | Draft |
| Select installation row | — | Current/past lists | rows | always | Selects; recomputes components for As of | Updates components | — | Cached |
| Swap component | `swap.title` / "Swap component" | Current row actions | current selected | always | Opens **D06** | Dialog | — | May queue |
| Recover | `site.recoverAction` | Current row | current | always | → `/recover/:installationId` | S11 | — | — |
| As of | `site.detail.asOfDate` | Below lists | always | always | Date change | Half-open component set | — | — |

## Data shown

Installation: site name · project · since/dates · primary Asset ID · closed badge on past. Components: Asset ID · role · orientation. Info card labels from `deploy.*`.

## States

Loading · no current · with history · offline.

## Related dialogs / sheets

### D06 — Swap component / Change configuration (§ 5.13)

TabList: Swap component · `config.title` "Change configuration".

**Swap tab**

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Outgoing | `swap.outgoing` Select non-primary | required | — | — |
| Incoming | `swap.incoming` Input | required | Resolve asset | `swap.error.incomingUnavailable` |
| Orientation | `deploy.orientation` | when role needs it | — | Required rule |
| Effective date | `swap.effectiveDate` | required | — | — |
| Reason | `swap.reason` | required | — | — |
| Cancel / Save | `common.cancel` / `common.save` | always | Submit | Toast/`swap.confirmation`; close; server refuse |

**Change configuration tab**

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| New power source | `config.powerSourceChange` | optional | — | At least one change |
| New position | `config.positionChange` | optional | — | — |
| Move to project | `config.projectChange` | optional | — | — |
| New orientation | `config.orientationChange` | **string exists, not rendered** | TBD | — |
| Effective date / Reason | `swap.effectiveDate` / `config.reason` | required reason | — | `config.error.noChange` |
| Cancel / Save | | | Submit | `config.confirmation` |

## Non-goals

- Editing installation history rows in place
- Map

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Deploy prefill | Does Deploy here pass site? | TBD — today may open blank S10 |
| `config.orientationChange` | Not rendered | Omit until product asks |

## Governing links

- `docs/12-ui-spec.md` § 5.10, § 5.13
- `app/src/features/site/`
