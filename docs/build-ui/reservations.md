# R01–R03 — Reservations (stub)

| | |
|---|---|
| **Screen ID** | R01 Reserve · R02 My reservations · R03 Reservation calendar |
| **Route** | TBD — not in `App.tsx` |
| **Component** | Not built |
| **Surfaces** | R01/R02 Field+Desk · R03 Desk/Console |
| **Roles** | all (calendar override admin) |
| **One job** | Future claim on reservable assets — **not** an asset status |
| **Source** | `docs/02-app.md` § Reservations · **STUB** · refreshed 2026-09-03 |
| **Status** | STUB — behaviour outlined; no button-level UI spec in § 5 |

## Purpose

Reservation = future claim. Asset remains Available today. Checkout refuses conflicting Confirmed reservation held by someone else (app + server).

## Entry points (intended)

| Screen | From |
|---|---|
| R01 Reserve | Asset detail / vehicle flows |
| R02 My reservations | Field nav or More |
| R03 Calendar | Console / Desk admin |

## Interactive controls

**Insufficient UI evidence for a full control table.** Intended fields from `docs/02-app.md`:

| Screen | Intended controls (outline) | Notes |
|---|---|---|
| R01 | Asset (reservable only) · from/to · project · notes · Submit | Overlap check names conflict |
| R02 | List upcoming · Cancel mine | — |
| R03 | Calendar by office/group · Cancel/override with reason | Admin |

## States

STUB.

## Non-goals

- Adding `Reserved` to `eng_assetstatus`
- Building before G-22 remainder / product scheduling

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Routes & nav placement | Unspecified | TBD |
| Vehicle booking UX | Tied to G-23 | TBD |

## Governing links

- `docs/02-app.md` § Reservations
- `docs/12-ui-spec.md` G-22
