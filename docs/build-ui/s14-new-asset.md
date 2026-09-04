# S14 — New asset

| | |
|---|---|
| **Screen ID** | S14 |
| **Route** | `/admin/new-asset` |
| **Component** | `app/src/features/admin/NewAssetPage.tsx` |
| **Surfaces** | Console |
| **Roles** | Office Admin, System Owner |
| **One job** | Register a catalogue model instance and set it Available |
| **Source** | `docs/12-ui-spec.md` § 5.15 · refreshed 2026-09-03 |

## Purpose

Admin creates asset from model catalogue (no free-text model). Server mints identity / AddToInventory event.

## Entry points

| From | How |
|---|---|
| S13 New asset | Button |

## Layout zones

Title → no-free-text caption → Model* → Serial (if needed) → ID preview → Home office* → Notes → error → Save → X01 (→ Admin).

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Model | `admin.newAsset.model` | Form | always | always | Select catalogue | Shows preview/serial rules | — | Cached models |
| Serial | `admin.newAsset.serial` | Form | serialised models | always | Text | Updates preview | — | — |
| Home office | `admin.newAsset.homeOffice` | Form | always | always | Office/Storage select | — | "Pick a home office." | — |
| Notes | `admin.newAsset.notes` | Form | always | always | Textarea | — | — | — |
| Save | `common.save` | Bottom | always | valid | Command | X01 `admin.newAsset.confirmation` | Server validation | Prefer online |

## Data shown

`admin.newAsset.previewedId` "Asset ID: {id}". Caption `admin.newAsset.noFreeText`.

## States

Incomplete · validating · X01 · error.

## Non-goals

- Free-text manufacturer/model
- Editing identity after create
- Un-retire

## Conflicts / TBD

None beyond catalogue stewardship living on C-REF screens later.

## Governing links

- `docs/12-ui-spec.md` § 5.15
- `app/src/features/admin/NewAssetPage.tsx`
