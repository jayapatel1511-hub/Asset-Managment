# S01b — Field home (proposed S01 replacement)

| | |
|---|---|
| **Screen ID** | S01b |
| **Route** | Would replace `/` if accepted |
| **Component** | Not built — mockup `Assets Console Mobile.dc.html` |
| **Surfaces** | Field |
| **Roles** | all |
| **One job** | Orient the field user: custody, quick actions, due counts, recent activity |
| **Source** | `docs/mockups/README.md` D2 · **STUB** · refreshed 2026-09-03 |
| **Status** | STUB — open product decision **D2**; not approved |

## Purpose

Mockup proposes a denser Field home than list-first S01: greeting, Scan / Check out / Return tiles, recent activity, cal due / overdue counts, office scope, asset bottom sheet.

**Per `docs/20-mockup-review.md` M2:** this file is **not** a Console. Renaming in docs already treats it as Field home proposal.

## Entry points

Would become default Field `/` if Jay accepts D2.

## Layout zones (mockup)

1. Greeting + custody count + overflow
2. Quick actions: Scan · Check out · Return
3. Recent activity list
4. Scope chips (office) + Show all offices
5. Due soon / Overdue counts + due groups
6. Bottom nav (Home / Assets / … / More)
7. Asset bottom sheet: primary / secondary / more

## Interactive controls (inventory only — behaviours TBD)

| Control | Label | Location | On activate (proposed) | Notes |
|---|---|---|---|---|
| Scan | Scan | Quick actions | D01 | Primary tile |
| Check out | Check out | Quick actions | S04 | — |
| Return | Return | Quick actions | S05 | — |
| Activity row | asset id | Recent | Sheet or S03 | — |
| Scope chip | Office name | Scope | Filter | — |
| Show all offices | Show all offices | Scope | Clear office filter | — |
| Due row | asset | Due lists | Sheet / S03 | — |
| Sheet primary | dynamic e.g. Check out | Sheet | Status-based | Mockup maps Available→Check out, Deployed→Return |
| Sheet secondary | dynamic | Sheet | TBD | — |
| More actions | aria More | Sheet | TBD menu | — |
| More nav | More | Bottom | Needs attention / Reports | Aligns with G-06 |

## Data shown

Mockup uses alternate ID scheme — **do not ship**; remap to § 0 samples.

## States

STUB — not specified to production depth.

## Non-goals

- Building this before D2 decision
- Treating it as admin Console

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| **D2** | Replace S01 with this IA? | **Keep S01** |
| G-24 | Teal tokens | Inherit decided system |
| Nav IA | More item vs Admin slot | Tied to G-06 |

## Governing links

- `docs/mockups/review-ref/Assets Console Mobile.dc.html`
- `docs/mockups/README.md`
- `docs/20-mockup-review.md` M2
