# S05 — Return

| | |
|---|---|
| **Screen ID** | S05 |
| **Route** | `/return` · optional `?asset=` |
| **Component** | `app/src/features/return/ReturnPage.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all; Transaction date admin-only (Q9) |
| **One job** | Return assets the user holds (or an added asset) with per-line condition |
| **Source** | `docs/12-ui-spec.md` § 5.6 · refreshed 2026-09-03 |

## Purpose

Atomic return: condition per line; Needs service → NeedsRepair after accept. Location fixed to home office.

## Entry points

| From | How |
|---|---|
| Nav Return | Prefills custody set |
| S03 Return | Adds `?asset=` |

## Layout zones

1. Title `return.title`
2. Caption `return.prefilledFromCustody`
3. Caption `return.location` with home office
4. Cart lines (condition select + remove)
5. Transaction date (admin Q9) TBD placement
6. Error · Submit · X01/X02

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Remove line | `cart.remove` | Line | lines | always | Remove from cart | — | — | — |
| Condition | `return.condition` + good/damaged/needsService | Line | lines | always | Select | Affects proposed statusafter (server confirms) | — | — |
| Transaction date | TBD | Form | Admin (Q9) | visible | Date ≥ today−30 | — | Conflict refuse | — |
| Submit | `cart.submit` | Bottom | always | cart non-empty | Command | X01 `return.confirmation` | changedSinceAdded / auth / concurrency | X02 |

## Data shown

Lines default: custodian = me, condition Good. Empty: `cart.empty`.

## States

Empty · prefilled · error · submitting · X01 · X02.

## Non-goals

- Editable return location
- Kit-children auto-add (specified in `docs/02-app.md`, **not built**)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Kit auto-add | Spec vs build | Do not auto-add until implemented + tested |
| Q9 | Transaction date UI | Add when designing admin backdate |

## Governing links

- `docs/12-ui-spec.md` § 5.6
- `app/src/features/return/`
