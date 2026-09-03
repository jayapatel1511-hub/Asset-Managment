# 02 — App (Power Apps Code App)

React 18 + TypeScript + Vite. `@microsoft/power-apps` SDK for Dataverse. Fluent UI v9 components.
Dark mode follows OS.

UI specification for design tooling (screen inventory, tokens, components, states, exact copy): `docs/12-ui-spec.md`.

## Surfaces

*Decided 2026-09-03, in two steps. This replaces the earlier "phone-first, works to desktop" position
and resolves UI-spec gap G-01. See `docs/08-decisions.md` and `docs/17-ux-audit.md` § G.*

**One codebase, one deployed app, three surfaces.** A Code App is a single hosted SPA at a single URL —
the phone and the desktop browser load the same bundle. There is no second app to build or publish.

| | **Field** (mobile, < 768 px) | **Desk** (desktop, user) | **Console** (desktop, admin) |
|---|---|---|---|
| Who | Field technician, one-handed, on site or in a vehicle, sometimes offline | Anyone at a computer | Office Admin, System Owner |
| Purpose | **Get hold of an asset and record what you did with it.** Nothing else | The field workflows at full width, plus the read-heavy screens nobody can use one-handed | **Full control.** Maintain the data the other two surfaces read |
| Primitive | Find one thing, act on it | Find one thing, study it | **See many things, change them** |
| Layout | 390 px design width, content capped 480 px, centred | Two-pane (list + detail) above 900 px | Persistent entity nav, table-first, bulk select |

**Console is not Desk with extra buttons.** Its primitive is different, which is why it needs its own
layout rather than a role flag on the existing screens — see `docs/17-ux-audit.md` finding E2.

**Field carries exactly these**, and adding to the list is a decision, not a default:

| Screen | Why it belongs on a phone |
|---|---|
| S01 Search · D01 Scan | Finding the thing. The camera is phone-only anyway |
| S03 Asset detail *(trimmed)* | Where it is, who has it, is it due for calibration, is it reserved — plus the actions the state machine allows. The **full history tab is desktop**; the phone shows the last few events |
| S04 Checkout · S05 Return · S06 Transfer | Taking it out, bringing it back, handing it to another tech on site |
| Report fault (dialog off S03) | A fault can only be noticed in the field |
| S10 Deploy · S11 Recover | Inherently field work — the site coordinates and kit roles are captured standing at the site, or they are captured from memory and wrong |
| S16 Needs attention | The offline replay queue has to live where the offline work happens |
| Reserve a vehicle · My reservations | See § Reservations below. Booking the truck for Tuesday is "accessing equipment" |

**Desk** — everything above at full width, plus the read-heavy screens: S03's full history tab ·
S07 Calibration due · S08/S09 Sites · S17–S20 Reports (fleet, compliance, timeline, utilisation) ·
D06 Swap component / Change configuration · Record calibration + certificate upload.

**Console** — Desk, plus everything that maintains data: create/update/deactivate for categories,
locations and offices, equipment models and projects · staff attributes (home office, which offices
they administer) · S14 New asset · Retire and un-retire · S15 Office administrators · the
field-completion and return-sweep queues · bulk operations · reference-data change history · the
reservation calendar (everyone's bookings, cancellation, override).

Console's screen family is **not yet specified** — `docs/12-ui-spec.md` gap G-22 covers it, and the
capability gaps it has to close are `docs/17-ux-audit.md` § A, § D and § E.

**Mechanism.** Every route declares which surfaces it appears on in **one manifest** —
`surfaces: ("field" | "desk" | "console")[]` — not in three nav components and never in three
codebases. Forking would fork `domain/stateMachine.ts`, and CLAUDE.md
rule 5 requires the app and the flow to refuse the same things. A route reached directly on the wrong
surface (a deep link from a desktop email opened on a phone) renders a "this screen is on the desktop
app" page rather than 404 — the URL stays valid on both.

## Screens (Phase 1)

### Home / Search
- Search box: matches `eng_assetid`, `eng_serialnumber`, `eng_identifiervalue`, model name. Debounced, min 3 chars.
- Scan button → barcode scanner (SDK camera) → decodes Asset ID → opens Asset detail. If the code is a bare
  serial (e.g. `UM16984`) and matches >1 asset, show a picker ("Logger DL-UM-16984 / Geophone GEO-UM-16984").
- Quick filters: **My equipment** (custodian = me), **Available here** (status = Available, currentlocation = my home office), **Cal due ≤ 30 d**.
- Result row: Asset ID (mono, bold), model, status pill, current location, custodian.

### Asset detail
- Header: Asset ID, model, status pill, lifecycle badge if Retired.
- Now: location, custodian, project, parent asset (if child), children list (open relationships), next cal due (red if past).
- Actions (only those valid from current status per the state machine — disabled otherwise with reason tooltip):
  Checkout · Return · Transfer · Report fault · (Office Admin) Send to calibration, Record calibration, Retire, Attach component.
- History tab: Transaction Lines for this asset, newest first: date, type, from → to, performed by, notes.
  Include relationship open/close events inline ("Attached to DL-UM-16984 as Sensor 1").
- Calibration tab: records list + "Open certificate" link.

### Checkout (multi-asset)
1. Scan/search to add assets to a cart. Show status pill per item; **refuse to add** anything not Available, with reason.
2. First asset added is Primary by default; user can change. Optional kit roles per line (Sensor 1…, Modem, Cellular).
3. Fields: Project (lookup, required), Assigned to (default me), Expected return (date, optional), Notes.
4. Submit → create 1 `eng_transaction` (type Checkout, touser, toproject, primaryasset) + N `eng_transactionline`
   (statusbefore = Available, statusafter = CheckedOut, kitrole). Single batch request; all-or-nothing.
5. Confirmation screen listing lines + "Checkout TXN-000123 recorded. State updates within ~1 min."

### Return (multi-asset)
- Default cart = everything where custodian = me (or pick a primary asset → auto-adds its open Kit children).
- Per line: condition (Good / Damaged / NeedsService). NeedsService → statusafter = NeedsRepair instead of Available.
- Return location defaults to my home office.

### Transfer
- Cart as above. New custodian and/or new location and/or new project. Status unchanged. Reason required.

### Calibration due (list)
- All Active assets with nextcaldue ≤ today + N (N selectable 30/60/90), grouped by home office. Tap → Asset detail.

### Office Admin only (Phase 1 minimal, Phase 2 fuller)
- **New asset**: pick model → app mints Asset ID preview (`DL-UM-` + serial or next seq) → serial, home office, notes → creates `eng_asset` + one `eng_transaction`(AddToInventory) + line.
- **Record calibration**: date, next due (prefilled), lab, cert number, upload PDF → SharePoint `AMS Documents/{AssetID}/` → store URL.
- **Retire**: reason required.

### Reservations (added 2026-09-03)

A reservation is a **future claim**, not a status. An asset booked for next Tuesday is Available today,
and may be checked out today and returned Monday. `Reserved` is deliberately **not** an `eng_assetstatus`
value — see `docs/01-data-model.md` § eng_reservation.

- **Reserve** (mobile + desktop): pick asset → from/to date-time → project → notes. Reservable assets only
  (`eng_equipmentmodel.eng_isreservable`). On submit the app re-checks for an overlapping Confirmed
  reservation and names the conflict; the flow is the arbiter if two people confirm in the same second.
- **My reservations** (mobile): mine only, upcoming first, cancel my own.
- **Reservation calendar** (desktop): everyone's bookings per office, per asset group; cancel or override
  another user's with a reason.
- **At checkout**: an asset someone else has Confirmed for an overlapping window is **refused** in the app
  and in the flow — the same both-layers rule as a non-Available checkout (CLAUDE.md rule 5). Checking out
  your own reservation marks it Fulfilled.

## Validation (client side — the flow re-checks server side)

- Every action: asset.status must allow the transaction type (matrix in `01-data-model.md`).
- Checkout: project required; asset.lifecycle = Active; no conflicting Confirmed reservation held by
  someone else.
- Return: performed by must be custodian OR Office Admin.
- A child asset with an open Component relationship cannot be checked out alone — prompt to check out the parent.
- Concurrency: on submit, re-read status for each asset in the cart; if any changed since added, abort and show which.

## Offline (Phase 1 target, degrade gracefully)

- Cache: eng_asset (Active only), eng_equipmentmodel, eng_location, eng_project (Active), my open transaction lines.
- Queue Checkout/Return/Transfer submits when offline; show "Pending sync" badge; replay in order on reconnect.
- If replay is rejected (status changed while offline), surface it in an "Needs attention" list — do not silently drop.

## Structure

```
app/
  src/
    api/            typed Dataverse access (one file per table), batch helper
    domain/         stateMachine.ts (single source of truth for the matrix), assetId.ts (mint/parse)
    features/       search/ asset/ checkout/ return/ transfer/ calibration/ admin/ reservation/
    routes.ts       the route manifest — path, component, roles, surfaces (mobile | desktop)
    components/     StatusPill, AssetRow, Cart, Scanner
    i18n/           en.json (fr.json placeholder)
  tests/            vitest for domain/, Test Engine plans for screens
```

`domain/stateMachine.ts` must export the matrix as data (not code) so the same JSON can be pasted into the
flow's `Compose` action — one definition, two consumers.
