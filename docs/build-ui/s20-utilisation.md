# S20 — Utilisation

| | |
|---|---|
| **Screen ID** | S20 |
| **Route** | `/reports/utilisation` |
| **Component** | `app/src/features/reports/UtilisationPage.tsx` |
| **Surfaces** | Desk |
| **Roles** | all |
| **One job** | Show availability / idle figures only when history is sufficient |
| **Source** | `docs/12-ui-spec.md` § 5.21 · refreshed 2026-09-03 |

## Purpose

Honest utilisation: refuse unreliable post-migration figures rather than inventing them.

## Entry points

| From | How |
|---|---|
| S17 Utilisation | Button |

## Layout zones

Title + data-as-of + period Dropdown → either insufficient-history card **or** By type / By office / Lowest availability / Idle lists → footer.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Period | 30 / 90 / `reports.utilisation.period365` | Header | always | always | Change window | Recompute | — | Cached |
| Idle AssetRow | C2 | Idle card | items | always | → S03 | — | — | — |

## Data shown

C12 proportion bars; lowest availability % badges; idle list; clipping captions `clippedToAcquisition` / `notYetOwned` when present. Insufficient: `reports.utilisation.insufficientHistory`.

## States

Insufficient history (expected early) · populated · loading · offline.

## Non-goals

- Forcing percentages when history is inadequate
- Writes

## Conflicts / TBD

None.

## Governing links

- `docs/12-ui-spec.md` § 5.21, § 4 C12
- `app/src/features/reports/UtilisationPage.tsx`
