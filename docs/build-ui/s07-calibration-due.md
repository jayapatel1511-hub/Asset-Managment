# S07 — Calibration due

| | |
|---|---|
| **Screen ID** | S07 |
| **Route** | `/calibration` |
| **Component** | `app/src/features/calibration/CalibrationDuePage.tsx` |
| **Surfaces** | Desk (primary per Surfaces) · Field (in nav today) |
| **Roles** | all |
| **One job** | List assets needing calibration attention by horizon |
| **Source** | `docs/12-ui-spec.md` § 5.8 · refreshed 2026-09-03 |

## Purpose

Read-only queue for Q5: overdue, due within N days, unknown. Tap opens S03. No writes.

## Entry points

| From | How |
|---|---|
| Nav Cal Due | Direct |
| Deep link | `/calibration` |

## Layout zones

1. Title + horizon Dropdown
2. Section Overdue (C4 danger) · office subgroups · AssetRows
3. Section Due within N (C4 warning)
4. Section Calibration status unknown (C4 subtle)
5. Hidden sections when count 0

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Horizon | `calibration.horizon30/60/90` | Header right | always | always | Sets N days | Regroups list | — | Cached |
| AssetRow | C2 | Lists | items | always | → S03 | — | — | Cached |

## Data shown

Grouped by home office under each urgency band. Overdue line `calibration.overdueBy`.

## States

Loading · empty (all groups hidden / none) · populated · offline cache.

## Non-goals

- Recording calibration (that is D04 from S03)
- Bulk send to lab

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Surface | On Field nav though Surfaces says Desk | Keep route; optional Field hide later via manifest |

## Governing links

- `docs/12-ui-spec.md` § 5.8
- `app/src/features/calibration/CalibrationDuePage.tsx`
