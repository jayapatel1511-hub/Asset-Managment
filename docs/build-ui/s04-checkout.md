# S04 — Checkout

| | |
|---|---|
| **Screen ID** | S04 |
| **Route** | `/checkout` · optional `?asset=` |
| **Component** | `app/src/features/checkout/CheckoutPage.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all; Transaction date admin-only (Q9) |
| **One job** | Check out one or more Available assets to a project in one atomic submit |
| **Source** | `docs/12-ui-spec.md` § 5.5 · refreshed 2026-09-03 |

## Purpose

Primary field custody write: cart of assets → project → submit. Server commits all lines or none. Client re-check is feedback only.

## Entry points

| From | How |
|---|---|
| Nav Checkout | Empty cart |
| S03 Checkout | Prefills `?asset=` |

## Layout zones

1. Title `checkout.title`
2. Add-by-ID row (C11) ± Scan (G-17 TBD)
3. Error MessageBar
4. Cart (C3) with Primary badge
5. Fields: Project*, Assigned to (G-16 TBD), Expected return, Notes, Transaction date (admin Q9)
6. Submit
7. X01 / X02 replace form

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Add input | `search.placeholder` | Add row | always | always | Enter adds | Line in cart | notFound / refused / duplicate | Local cart |
| Add button | "Add" (hard-coded) | Add row | always | non-empty | Exact Asset ID add | Same | `cart.refusedNotAvailable`; duplicate hard-coded | — |
| Scan (proposed) | aria-label Scan | Between input & Add | **G-17** | always | Opens D01 add-to-cart | — | — | — |
| Remove line | `cart.remove` | Cart line | lines | always | Removes; clears Primary if removed | — | — | — |
| Kit role (proposed) | `checkout.kitRole` | Per line | **G-16** | always | Select role | — | — | — |
| Project | `checkout.project` | Form | always | always | Select Active project | — | `projectRequired`; inactive refuse TBD | Cached projects |
| Assigned to (proposed) | `checkout.assignedTo` | Form | **G-16** | always | People picker default me | — | — | — |
| Expected return | `checkout.expectedReturn` | Form | always | always | Date; prefilled +14; **optional (Q8)** | — | — | — |
| Transaction date | TBD copy | Form | Admin only (Q9) | always when visible | Date; min today−30 | — | Server refuse if ≤ existing line | — |
| Notes | `checkout.notes` | Form | always | always | Text | — | — | — |
| Submit | `cart.submit` / `cart.submitting` | Bottom | always | cart non-empty, not busy | Re-read statuses → command | X01 `checkout.confirmation` | `cart.changedSinceAdded`; validation banner; server codes | X02 queue |

## Data shown

Cart: Asset ID, Primary badge, model, StatusPill. Confirmation txn id.

## States

Loading (if prefill fetch) · empty cart · error · submitting · X01 · X02.

## Non-goals

- Changing status locally before server accept
- Auto-merge of duplicates
- Partial multi-asset success

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-16 | No Assigned to / kit role in build | Omit until decided; strings exist |
| G-17 | No Scan on add row | Omit until decided |
| Q9 copy | Backdate conflict refusal message | TBD design + i18n |

## Governing links

- `docs/12-ui-spec.md` § 5.5; Q8/Q9 in § 11
- Specs 009/010 transaction command / five-asset race
- `app/src/features/checkout/`
