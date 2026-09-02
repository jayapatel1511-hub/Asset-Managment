# 02 — App (Power Apps Code App)

React 18 + TypeScript + Vite. `@microsoft/power-apps` SDK for Dataverse. Fluent UI v9 components.
Phone-first (390px design width), works to desktop. Dark mode follows OS.

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

## Validation (client side — the flow re-checks server side)

- Every action: asset.status must allow the transaction type (matrix in `01-data-model.md`).
- Checkout: project required; asset.lifecycle = Active.
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
    features/       search/ asset/ checkout/ return/ transfer/ calibration/ admin/
    components/     StatusPill, AssetRow, Cart, Scanner
    i18n/           en.json (fr.json placeholder)
  tests/            vitest for domain/, Test Engine plans for screens
```

`domain/stateMachine.ts` must export the matrix as data (not code) so the same JSON can be pasted into the
flow's `Compose` action — one definition, two consumers.
