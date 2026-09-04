# C01 — Assets Console (desktop)

| | |
|---|---|
| **Screen ID** | C01 |
| **Route** | TBD — not in `App.tsx` yet (candidate `/console/assets`) |
| **Component** | Not built — mockup `docs/mockups/review-ref/Assets Console.dc.html` |
| **Surfaces** | Console only |
| **Roles** | Office Admin, System Owner |
| **One job** | See many assets; filter/sort/select; launch bulk-safe actions |
| **Source** | Mockup + `docs/12-ui-spec.md` G-22 · **partial** · refreshed 2026-09-03 |
| **Status** | PARTIAL — layout from mockup; tokens blocked on G-24; behaviours TBD |

## Purpose

Console primitive: table-first fleet operations. Not Desk-with-extra-buttons (`docs/02-app.md`).

## Entry points

| From | How |
|---|---|
| Console entity rail | Assets under OPERATIONS (mockup) |
| Deep link | TBD |

## Layout zones (from mockup)

1. **Left rail** — brand mark · OPERATIONS · REFERENCE DATA
2. **Toolbar** (none selected) — title "Assets" + count · search · Import · New asset
3. **Bulk bar** (selection > 0) — "{n} selected" · Clear · Transfer · Send to calibration · Export · Retire (destructive, separated)
4. **Filter chips** — removable + Add filter
5. **Table** — select-all · sortable headers · checkbox rows
6. **Pagination** — prev/next
7. Detail pane — not in this mockup (table-primary)

### Rail entities (mockup labels — routes TBD)

| Group | Items |
|---|---|
| OPERATIONS | Assets (this screen) · Sites · Calibration · Reservations · Queues |
| REFERENCE DATA | Locations · Equipment models · Projects · People · Categories |

## Interactive controls (mockup inventory)

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Rail Assets | "Assets" | Left rail | Console | always | Load Assets table | — | — | Prefer online |
| Rail Sites / Calibration / Reservations / Queues | mockup labels | Left rail | Console | always | → corresponding Console/Desk screens TBD | TBD | TBD | — |
| Rail Locations / Equipment models / Projects / People / Categories | mockup labels | Left rail | Console | always | → C-REF screens | TBD named commands | TBD | — |
| Search | placeholder "Search asset ID, serial, model" | Toolbar | none selected | always | Filter rows | — | — | Cached subset TBD |
| Import | "Import" | Toolbar | none selected | authorized | → data-management import job UI TBD | Dry-run required | Row-level outcomes | Prefer online |
| New asset | "New asset" | Toolbar | none selected | always | → S14 | — | — | — |
| Row checkbox | aria-label "Select row" | Col 1 | always | always | Toggle selection | Shows bulk bar | — | — |
| Select all | aria-label "Select all rows" | Header | always | always | Toggle page/all TBD | — | — | — |
| Sortable header | Column name | Header | always | always | Toggle sort | Reorder | — | — |
| Clear selection | "Clear" | Bulk bar | selection > 0 | always | Clears | Hides bulk bar | — | — |
| Transfer | "Transfer" | Bulk bar | selection > 0 | valid set | Multi-asset transfer command TBD | Atomic group | Per-row refuse | Prefer online |
| Send to calibration | "Send to calibration" | Bulk bar | selection > 0 | admin + valid | Bulk send TBD | Atomic / row results | Refuse invalid | Prefer online |
| Export | "Export" | Bulk bar | selection > 0 | authorized | **Governed** export | Private artifact | 403 | Fail closed |
| Retire | "Retire" | Bulk bar (separated) | selection > 0 | admin + valid | Confirm + reasons TBD | Atomic group rules | Partial refuse | Prefer online |
| Remove filter chip | aria-label "Remove filter" | Chip | chips | always | Remove chip | Refresh | — | — |
| Add filter | "Add filter" | Chip row | always | always | Add chip | — | — | — |
| Prev / Next page | aria-labels | Footer | always | page bounds | Page | — | — | — |
| Row open | Asset ID cell | Row | always | always | → S03 or Console detail TBD | — | — | — |

## Data shown

Mockup columns include Asset ID, model, status, location, custodian, days, project — **use § 0 ID scheme** (`DL-UM-…`), not mockup `SEIS-…`. Status pills per § 2.5 / G-04 when decided.

## States

Loading · empty fleet · filtered empty · selecting · bulk running · export pending · error.

## Non-goals

- Generic `PATCH /table/{id}`
- Auto-merge duplicates
- Field phone layout for this screen

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-24 | Teal/Inter mockup vs Fluent+Englobe | Structure yes; **do not copy teal tokens** until D1 |
| Sample IDs | `SEIS-4128` vs `DL-UM-16984` | Canonical scheme only |
| Bulk command set | Mockup shows actions without API mapping | TBD named commands + dry-run for multi |
| Route / rail IA | Not in app | Confirm OPERATIONS / REFERENCE list |
| G-23 | Vehicle row treatment | Same row until decided |

## Governing links

- `docs/mockups/review-ref/Assets Console.dc.html`
- `docs/12-ui-spec.md` G-22, G-24
- `docs/02-app.md` § Surfaces Console
- `docs/20-mockup-review.md` M1/M2
