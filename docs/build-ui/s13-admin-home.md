# S13 — Admin home

| | |
|---|---|
| **Screen ID** | S13 |
| **Route** | `/admin` |
| **Component** | `app/src/features/admin/AdminHomePage.tsx` |
| **Surfaces** | Console · Desk (admin) |
| **Roles** | Office Admin, System Owner |
| **One job** | Hub for admin writes and pilot queues |
| **Source** | `docs/12-ui-spec.md` § 5.14 · refreshed 2026-09-03 |

## Purpose

Navigate to New asset, Office admins, Needs attention, Reports; surface field-completion and return-sweep queues (pilot tooling).

## Entry points

| From | How |
|---|---|
| Nav Admin | Role-gated |
| After New asset X01 | Back → Admin |

## Layout zones

Title → New asset card → Links card → Field-completion queue card → Return sweep card.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| New asset | `admin.newAsset` | Card 1 | always | always | → `/admin/new-asset` | S14 | — | — |
| Reports | `reports.title` | Links | always | always | → `/reports` | S17 | — | — |
| Office administrators | `admin.officeAdmins.title` | Links | always | always | → `/admin/office-admins` | S15 | — | — |
| Needs attention | `offline.needsAttention.title` | Links | always | always | → `/needs-attention` | S16 | — | — |
| Queue AssetRow | C2 | Queue lists | items | always | → S03 | — | — | Cached |

## Data shown

Temporary-tag / unassigned-office assets; CheckedOut with no custodian (return sweep). Copy still developer-facing (G-19) — mockup proposes "Tags to finish" / "Return sweep".

## States

Loading · empty queues · populated.

## Non-goals

- Full Console entity rail (see C01)
- Reference data CRUD (see `console-reference-data.md`)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-19 | Developer card copy | Keep until plain-language strings agreed |
| G-06 | Field Users reach S16/S17 only via Admin today | Keep; More nav is proposal |

## Governing links

- `docs/12-ui-spec.md` § 5.14
- `docs/17-ux-audit.md` § A, E
- `app/src/features/admin/AdminHomePage.tsx`
