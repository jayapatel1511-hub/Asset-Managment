# S15 — Office administrators

| | |
|---|---|
| **Screen ID** | S15 |
| **Route** | `/admin/office-admins` |
| **Component** | `app/src/features/admin/OfficeAdminsPage.tsx` |
| **Surfaces** | Console |
| **Roles** | Office Admin, System Owner |
| **One job** | Assign who administers each office |
| **Source** | `docs/12-ui-spec.md` § 5.16 · refreshed 2026-09-03 |

## Purpose

Maintain office→admin UPN lists. Saves immediately on add/remove (still a named admin command server-side — not a generic table patch).

## Entry points

| From | How |
|---|---|
| S13 | Office administrators button |

## Layout zones

Title → gap summary (danger cards or success MessageBar) → per-office card (list + add row).

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Remove admin | Delete icon | UPN row | rows | always | Remove + save | `admin.officeAdmins.saved` | Error MessageBar | Prefer online |
| Add input | placeholder name@… | Card | always | always | Type UPN | — | — | — |
| Add administrator | `admin.officeAdmins.addAdmin` | Card | always | non-empty | Add + save | Saved | Validation / auth | Prefer online |
| People picker (proposed) | G-18 | Card | TBD | always | Directory | — | — | — |

## Data shown

`admin.officeAdmins.gap` / `noGaps`. UPN monospace.

## States

Gaps · no gaps · saving · error.

## Non-goals

- Creating offices (missing — audit A1; see C-REF)
- Generic user admin directory

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-18 | Free-text vs picker | Keep free-text |

## Governing links

- `docs/12-ui-spec.md` § 5.16
- `app/src/features/admin/OfficeAdminsPage.tsx`
