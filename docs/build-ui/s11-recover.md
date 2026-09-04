# S11 — Recover

| | |
|---|---|
| **Screen ID** | S11 |
| **Route** | `/recover/:installationId` |
| **Component** | `app/src/features/recover/RecoverPage.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all |
| **One job** | Close or partially recover an installation with per-component disposition |
| **Source** | `docs/12-ui-spec.md` § 5.12 · refreshed 2026-09-03 |

## Purpose

Recover components (or mark missing); require leave-behind reasons when primary recovers and others stay.

## Entry points

| From | How |
|---|---|
| S09 Recover | Installation id in path |

## Layout zones

Title → site · project caption → per-component blocks (include switch, disposition, condition, leave-behind reason) → leave-behind warning → recovery date → notes → Submit → X01 (→ site) / X02.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Include switch | Recovered / — | Per component | always | always | Include/exclude | Shows disposition fields when included | — | — |
| Disposition | `recover.disposition` recovered/missing | Included | included | always | Select | Condition hidden if Missing | — | — |
| Condition | `recover.condition` | Included & not Missing | visible | always | Good/Damaged/Needs service | — | — | — |
| Leave-behind reason | `recover.leaveBehindReason` | Excluded while primary included | rule | always | Text required | — | leaveBehindUndecided | — |
| Recovery date | `recover.date` "Recovery date" | Form | always | always | Date | — | — | — |
| Notes | — | Form | always | always | Text | — | — | — |
| Submit | `cart.submit` | Bottom | always | ≥1 included + rules | Command | X01 `recover.confirmation` → S09 | notInstalled / hard-coded min one | X02 |

## Data shown

Warning `recover.leaveBehindPrompt` when leave-behinds exist.

## States

Validating · error · submitting · X01 · X02.

## Non-goals

- Recovering assets not on the installation
- Silent drop of leave-behinds

## Conflicts / TBD

None beyond copy already closed (G-07 recovery date label).

## Governing links

- `docs/12-ui-spec.md` § 5.12
- `app/src/features/recover/`
