# S06 — Transfer

| | |
|---|---|
| **Screen ID** | S06 |
| **Route** | `/transfer` · optional `?asset=` |
| **Component** | `app/src/features/transfer/TransferPage.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all; Transaction date admin-only (Q9) |
| **One job** | Move custody/location/project without changing status |
| **Source** | `docs/12-ui-spec.md` § 5.7 · refreshed 2026-09-03 |

## Purpose

Transfer cart assets to new custodian and/or location and/or project. Reason required. Status unchanged.

## Entry points

| From | How |
|---|---|
| S03 Transfer only | Prefill asset (not in bottom nav) |

## Layout zones

Title → C11 add row (± Scan G-17) → lines with Delete → New custodian / location / project / Reason* → Submit → X01/X02.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Add / Enter | C11 | Top | always | non-empty | Add any status | Line | notFound / duplicate | Local |
| Scan (proposed) | Scan | Add row | G-17 | always | D01 | — | — | — |
| Remove | `cart.remove` | Line | lines | always | Remove | — | — | — |
| New custodian | `transfer.newCustodian` | Form | always | always | Free-text UPN today; blank = unchanged | — | Validation | — |
| People picker (proposed) | — | Form | G-18 | always | Directory pick | — | — | — |
| New location | `transfer.newLocation` | Form | always | always | Select; "—" unchanged | — | — | — |
| New project | `transfer.newProject` | Form | always | always | Active projects; "—" unchanged | — | — | — |
| Reason | `transfer.reason` | Form | always | always | Text required | — | `reasonRequired` | — |
| Transaction date | TBD | Form | Admin Q9 | visible | Date | — | Conflict refuse | — |
| Submit | `cart.submit` | Bottom | always | cart non-empty | Command | X01 `transfer.confirmation` | Server refuse | X02 |

## Data shown

Single-line cart (Asset ID + Delete). No status change messaging beyond confirmation.

## States

Empty · error · submitting · X01 · X02.

## Non-goals

- Status transitions
- Admin-only restriction (all roles)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-18 | Free-text UPN vs Entra picker | Keep free-text + hint |
| G-17 | Scan affordance | Omit until decided |

## Governing links

- `docs/12-ui-spec.md` § 5.7
- `app/src/features/transfer/`
