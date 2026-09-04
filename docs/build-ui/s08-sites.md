# S08 — Sites

| | |
|---|---|
| **Screen ID** | S08 |
| **Route** | `/sites` |
| **Component** | `app/src/features/site/SiteListPage.tsx` |
| **Surfaces** | Desk (primary) · Field (nav today) |
| **Roles** | all |
| **One job** | List installation sites and start Deploy |
| **Source** | `docs/12-ui-spec.md` § 5.9 · refreshed 2026-09-03 |

## Purpose

Browse sites; filter to currently installed; launch Deploy.

## Entry points

| From | How |
|---|---|
| Nav Sites | Direct |
| After Deploy X01 | Button → Sites |

## Layout zones

Title → Deploy primary button → Currently installed only checkbox → site rows · empty.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Deploy | `deploy.title` "Deploy" · Location icon | Top | always | always | → `/deploy` | S10 | — | Draft may restore |
| Filter current | `site.filterCurrentOnly` | Below Deploy | always | always | Toggle | Filters rows | — | Cached |
| Site row | name + "{n} current/past" | List | rows | always | → `/site/:site` | S09 | — | Cached |

## Data shown

Site name; current vs past count (hard-coded phrasing). Empty: `site.listEmpty`.

## States

Loading · empty · filtered · offline.

## Non-goals

- Creating sites here (created on Deploy)
- Map view

## Conflicts / TBD

None critical.

## Governing links

- `docs/12-ui-spec.md` § 5.9
- `app/src/features/site/SiteListPage.tsx`
