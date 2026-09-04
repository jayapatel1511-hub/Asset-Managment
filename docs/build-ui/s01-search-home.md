# S01 — Search / Home

| | |
|---|---|
| **Screen ID** | S01 (+ nested D01) |
| **Route** | `/` |
| **Component** | `app/src/features/search/SearchPage.tsx`, `ScanDialog.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all |
| **One job** | Find one asset (or a short filtered set) and open it |
| **Source** | `docs/12-ui-spec.md` § 5.1, § 5.2 · refreshed 2026-09-03 |

## Purpose

Answer “where is / who has / is it available?” by search, scan, or quick filters. Does not change asset state.

## Entry points

| From | How |
|---|---|
| Bottom nav Search | Default home |
| D01 unknown / multi-match | Lands with query or disambiguation set |
| After many flows | User returns via nav |

## Layout zones

1. Offline banner (conditional)
2. Search row + Scan
3. Quick filter chips
4. Hint / loading / results grouped by equipment type / no-results
5. Disambiguation line when shared serial (G-10 closed in build)

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Search input | placeholder `search.placeholder` | Top row | always | always | Debounce 250 ms; search from **3** chars; clears active filter on type | Grouped AssetRows | Hint if 1–2 chars | Searches cached projection |
| Scan | `search.scan` "Scan" · Camera icon | Right of search | always | always | Opens **D01** | — | — | Opens typed stand-in |
| Filter My equipment | `search.filter.myEquipment` | Chip row | always | always | Toggle; exclusive | Filtered list | — | Uses cached custodian |
| Filter Available here | `search.filter.availableHere` | Chip row | always | always | Toggle; exclusive | Available @ home office | — | Cached |
| Filter Cal due ≤ 30d | `search.filter.calDue30` | Chip row | always | always | Toggle; exclusive | Due within 30d | — | Cached |
| Clear active filter | (tap active chip again) | Chip row | filter on | always | Clears filter | Idle/results | — | — |
| Search by model instead | `search.searchByModelInstead` | No-results | no match | always | Re-search first word only | New results | — | — |
| AssetRow | (C2) | Results | results | always | → `/asset/:assetId` | S03 | — | Pending sync badge if flagged |

## Data shown

| Field | Notes |
|---|---|
| Offline banner | `search.cached` "Showing cached data from {time}." |
| Group header | Humanised equipment type (G-09 closed) + count |
| AssetRow | Asset ID mono, model, StatusPill, location, custodian, overdue line, pending badge |

## States

| State | Treatment |
|---|---|
| Idle | Empty main (no forced empty copy) |
| Hint | `search.minChars` |
| Loading | Spinner `common.loading` |
| Results | Grouped list |
| No results | `search.noResults` + model button |
| Offline | Warning banner |
| Disambiguate | `asset.disambiguate` above list |

## Related dialogs / sheets

### D01 — Scan a tag (`docs/12-ui-spec.md` § 5.2)

Camera is production target; local build uses typed stand-in (Power Apps SDK parked — use device camera / Web BarcodeDetector TBD).

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Title | "Scan a tag" (hard-coded today) | always | — | — |
| Body | Stand-in copy about SDK | local build | — | — |
| Input | "Asset ID or serial" | always; autofocus | Enter submits | Same resolution as Resolve |
| Cancel | `common.cancel` | always | Closes | — |
| Resolve | "Resolve" primary | disabled while empty | Resolve code | (1) exact Asset ID → S03 (2) unique serial → S03 (3) shared serial → S01 disambiguate (4) unknown → S01 prefilled |

## Non-goals

- Bulk edit, tables, admin reference CRUD
- S01b Field home redesign (see `s01b-field-home-proposed.md`) unless Jay accepts D2

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| D2 / S01b | Mockup Field home vs list-first S01 | Keep S01; S01b is optional proposal |
| G-23 | Vehicles look like loggers | Same AssetRow until decided |
| Camera stack | Spec mentions Power Apps SDK | TBD Web/native camera for Azure PWA |

## Governing links

- `docs/12-ui-spec.md` § 5.1–5.2, § 4 C2/C10
- `docs/02-app.md` Field table
- `app/src/features/search/`
