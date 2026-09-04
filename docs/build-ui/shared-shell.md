# SHELL — App shell, navigation, X01 / X02

| | |
|---|---|
| **Screen ID** | SHELL · X01 · X02 |
| **Route** | wraps all routes |
| **Component** | `app/src/App.tsx`, bottom nav, header |
| **Surfaces** | Field · Desk · Console (shell adapts) |
| **Roles** | all (Admin nav item role-gated) |
| **One job** | Frame every screen; never own business state |
| **Source** | `docs/12-ui-spec.md` § 2.1, § 3.1, § 4 C8, § 6 · refreshed 2026-09-03 |

## Purpose

Provide a stable chrome: app title, (future) identity, scrollable main, sticky bottom nav on Field. Host confirmation (X01) and queued-offline (X02) result blocks used by every write screen.

## Entry points

App load; every authenticated session.

## Layout zones

```
┌ Header 56px — "Englobe AMS" (app.title) · right slot ─┐
│ Main (only scroll region) — Background2               │
│ BottomNav ~56px + safe-area (Field; Desk/Console TBD) │
└───────────────────────────────────────────────────────┘
```

| Zone | Spec | Build today |
|---|---|---|
| Header left | Title3 `app.title` "Englobe AMS" | Same |
| Header right | Production: empty or identity (G-02). Dev: `RoleSwitcher` | Dev role picker present; delete in production |
| Main | flex 1, vertical scroll only | Same |
| Bottom nav | Six items max; sixth admin-only | Same |

## Interactive controls

### Bottom navigation (`docs/12-ui-spec.md` § 3.1)

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure | Offline |
|---|---|---|---|---|---|---|---|---|
| Nav Search | `nav.search` "Search" | Bottom 1 | always | always | → `/` | — | — | Works on cache |
| Nav Cal Due | `nav.calibration` "Cal Due" | Bottom 2 | always | always | → `/calibration` | — | — | Cached list if available |
| Nav Checkout | `nav.checkout` "Checkout" | Bottom 3 | always | always | → `/checkout` | — | — | Form usable; submit → X02 |
| Nav Return | `nav.return` "Return" | Bottom 4 | always | always | → `/return` | — | — | Same |
| Nav Sites | `nav.sites` "Sites" | Bottom 5 | always | always | → `/sites` | — | — | Cached |
| Nav Admin | `nav.admin` "Admin" | Bottom 6 | Office Admin, System Owner | always when visible | → `/admin` | — | — | — |
| More (proposed) | TBD | Bottom 6 for Field User | **Mockup G-06** | TBD | → Needs attention / Reports | TBD | TBD | Badge count |

Active item: brand colour. Others: Foreground3. Icon 20px Regular above 11px label.

### Header

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Outcomes | Offline |
|---|---|---|---|---|---|---|---|
| RoleSwitcher | `search.role` / `admin.roleSwitcher` | Header right | Dev / demo only | always | Changes demo persona | Re-renders role-gated UI | Local only |
| Identity avatar (proposed) | Initials + home office | Header right | **Mockup G-02** | always | Opens identity sheet | Sheet: name, UPN, office, role, Close | — |

### X01 — Confirmation state (§ 4 C8 / § 6)

Replaces the whole form body after accepted submit.

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Outcomes | Offline |
|---|---|---|---|---|---|---|---|
| Success banner | Screen-specific `*.confirmation` | Main | After 2xx / accepted | — | — | Shows txn id | N/A (already accepted) |
| Primary button | Usually `common.back` "Back" (Deploy → Sites; Recover → site; New asset → Admin) | Below banner | X01 showing | always | Clears form / navigates per screen | Returns to empty form or listed destination | — |

### X02 — Queued offline (§ 6)

Same layout as X01 with `warning` intent.

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Outcomes | Offline |
|---|---|---|---|---|---|---|---|
| Warning banner | `offline.submissionQueued` | Main | Submit while offline / queue path | — | — | Item on S16 Pending sync; badge assets (C10) | Persist queue across SW updates |
| Primary button | Same as X01 for that screen | Below banner | X02 showing | always | Clears form / navigates | — | — |

## Data shown

None owned by shell. Synthetic-data banner keys (`dataset.synthetic*`) may appear when seed markers say so — never in production.

## States

| State | Treatment |
|---|---|
| Loading route | Child screen Spinner |
| Wrong surface deep-link | TBD page: "this screen is on the desktop app" — URL stays valid (`docs/02-app.md`) |
| Offline browsing | Child screens; Search shows cached banner |
| Auth | Server session; never trust browser-provided role |

## Non-goals

- Deciding role, office scope, or asset state in the client
- Second codebase for mobile vs desktop
- In-app dark-mode toggle (OS only)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-02 | No production identity in header | Keep empty right slot in prod; RoleSwitcher dev-only |
| G-06 | Field Users cannot reach S16/S17 from nav | Keep Admin-only links until More-nav accepted |
| G-21 | Most screens lack Back | Optional page header Back per mockup; not required to ship custody flows |
| G-24 | Three token systems | Fluent v9 + brand remap when G-03/G-24 decided |
| Desk/Console nav | Bottom nav is phone IA | TBD persistent side/rail for Console (see C01) |

## Governing links

- `docs/12-ui-spec.md` § 2.1, § 3.1, § 3.4, § 4 C8, § 6, § 8
- `docs/02-app.md` § Surfaces
- `docs/mockups/review-ref/DECISIONS.md` G-02, G-06, G-21
