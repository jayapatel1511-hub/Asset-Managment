# Englobe AMS — complete product UI

Click-through of **one application** with two shells:

- **Phone 390×844** — field technicians
- **Desktop 1440×900** — office, data admin, managers

Not the production app. No API. Reload or **Reset** restores the demo fleet.

## Open

```bash
cd docs/mockups/ams-ui
open index.html
# or
python3 -m http.server 8781
# → http://127.0.0.1:8781/
```

Studio bar (not part of the product): role, viewport, offline, empty/loading/error, reset.

---

## 1. Information architecture

```
FIND          → Search / scan / category browse → Asset
MOVE          → Checkout · Return · Transfer · Deploy · Recover
WATCH         → My equipment · Calibration · Sites · Needs attention
UNDERSTAND    → History · Lineage · Reports (read)
GOVERN        → Data quality · Imports · Duplicates · Reference
              → Corrections · Exports · Retention · People
```

Home answers the seven operational questions by **starting a path**, not by stacking KPIs.

| Question | Path |
|---|---|
| What do we own? | Browse equipment / Assets table |
| Where is Asset X? | Search → Now card |
| Who has Asset X? | Search → Now card / lineage |
| Available at Office Y? | Category + Available + My office |
| Calibration soon / overdue? | Needs attention → Calibration |
| Assigned to Project Z? | Projects / search project number |
| Where was it, and what was attached? | Asset History / Timeline / Site |

---

## 2. Role-based navigation

| | Field | Office Admin | Data Admin | Manager |
|---|---|---|---|---|
| **Mobile bottom** | Home · Search · Checkout · Return · More | same; More includes admin | Home · Search · More (console is desktop) | Home · Search · More → Reports |
| **Desktop rail** | Operations only | Operations + light admin + reports | Operations + Data Management + Administration + Reporting | Operations (read) + Reporting |
| **Home** | Search hero + my work + actions + categories | Office-scoped attention | Command center | Fleet overview |
| **Writes** | Custody / deploy / fault | + new asset, cal record, office inventory | + data commands | None |

A technician never sees Data Management or system configuration in primary nav.

---

## 3–4. Shells

**Mobile:** sticky header (identity), scroll main, bottom nav, offline bar, avatar badge for rejected sync.

**Desktop:** 232 px left rail (dark green-black), 56 px header with command search, wide content, tables and split panels.

Same tokens, type, pills, and Asset ID treatment. Desktop is not a squeezed phone.

---

## 5–8. Design system

| Token | Value |
|---|---|
| Brand | `#14713a` (four brand variables only) |
| Canvas | `#fafafa` / cards `#ffffff` |
| Text | `#242424` / secondary `#616161` |
| Type | Segoe UI 14/20 body; 12/16 caption; Asset IDs **Consolas bold** |
| Radius | 4–6 px |
| Touch | ≥ 44 px |
| Status | Available green · Checked out blue-grey · Deployed teal · In cal yellow · Repair red · Missing maroon · Retired outline |

Foundations screen: `#/foundations`.

---

## 9. Responsive rules

| Width | Shell |
|---|---|
| < 768 or Phone forced | Bottom nav, rows/cards, one primary action |
| ≥ 900 or Desktop forced | Left rail, tables, filter toolbars, bulk bar |
| Category grid | 2 col phone · 4 col desktop |
| Quick actions | 2 col phone · 5 col desktop |

---

## Screen catalogue

For every screen: purpose · primary user · primary action · empty / loading / error (studio toggles) · permission / surface notes.

| # | Screen | Route | Purpose | Primary user | Primary action | Mobile | Desktop |
|---|---|---|---|---|---|---|---|
| 1 | User Home | `#/home` | Start work | Field / Office | Search or checkout | Hero + sections | Two-column + category grid |
| 2 | System Admin Home | `#/home` as Data Admin | Command center | Data Admin | Open a queue | Compressed cards | Metrics + 3 panes + commands |
| 3 | Search | `#/search` | Find one asset | All | Open asset | Large field + chips | + advanced filter hint |
| 4 | Category | `#/category/seis` | Browse a family | All | Open listing | Rows | Table |
| 5 | Asset detail | `#/asset/DL-UM-16984` | Now + allowed acts | All | State-legal action | Trimmed history | Full tabs + lineage |
| 6 | Checkout | `#/checkout` | Multi-asset cart | Field+ | Submit cart | Full-width CTA | Same form, wider |
| 7 | Return | `#/return` | Return held kit | Field+ | Return N with condition | Condition chips | Same |
| 8 | Transfer | `#/transfer` | Current → new | Field+ | Transfer + reason | Stacked | Same |
| 9 | Sites | `#/sites` | Find an installation | Field+ | Open site | Cards | List + deploy |
| 10 | Site detail | `#/site/337-POWER-ST` | Kit on the ground | Field+ | Deploy / recover | Stacked | Same + history |
| 11 | Deploy | `#/deploy` | Install a kit | Field+ | Deploy kit | Form | Form |
| 12 | Calibration due | `#/calibration` | Horizons | Office / Field | Open asset | Chips + rows | Table + office counts |
| 13 | Record calibration | `#/record-cal` | Write a cal event | Office+ | Save | Form | Form |
| 14 | Assets table | `#/assets` | See many | Office / Data | Filter / select | Use search on phone | Enterprise table |
| 15 | Admin asset detail | same `#/asset/…` + admin role | Admin commands | Office / Data | Cal / correct / retire | Extra buttons | Extra + SIM |
| 16 | Reports home | `#/reports` | Pick a product | Manager / Office | Open report | Cards | Cards |
| 17 | Fleet | `#/fleet` | Status mix | Manager | Read | Stacked | Stats + bars |
| 18 | Data Management | `#/data` | Govern data | Data Admin | Open a command | Banner: use desktop | Health + modules |
| 19 | Data quality | `#/quality` | Issue queue | Data Admin | Open record | Rows | Table + filters |
| 20 | Import / dry run | `#/import` | Safe bulk load | Data Admin | Continue steps | Stepper | Jobs table + stepper |
| 21 | Duplicate review | `#/duplicates` | Human decision | Data Admin | Not duplicate / merge | Stacked compare | Side by side |
| 22 | Reference data | `#/reference` | Curate picks | Office / Data | Add / deactivate | Table | Table + panel |
| 23 | Correction | `#/corrections` | Old → new | Office / Data | Approve | Cards | Cards |
| 24 | Lineage | `#/lineage` | Why this fact | All (read) | Open source txn | Now + event | Same |
| 25 | Exports | `#/exports` | Governed file | Reports roles | Request | List | Table |
| 26 | Retention | `#/retention` | Policy / hold | Data Admin | Review | Table | Table |
| 27 | People & roles | `#/people` | Who can do what | Data Admin | Open permission summary | Table | Table |
| 28 | Needs attention | `#/attention` | Offline conflicts | Field | Retry / remove / view | Cards | Same |

**Empty:** “Nothing here” + clear filters.  
**Loading:** skeleton rows.  
**Error:** banner + retry; cached timestamp remains.  
**Offline:** header bar + queued result (X02) + Pending sync pills. Rejected items stay until the user acts.

---

## Home — how it stays operational

The hero is a **working search**, not a slogan.

Below it, in this order:

1. **My work** — only *my* kit (3 preview rows + counts)
2. **Quick actions** — labelled, not icon-only
3. **Browse equipment** — category counts, no asset detail in the tile
4. **Needs attention** — role-scoped, not every KPI
5. **Recent activity** — secondary

Field users do not get admin widgets on Home. Data Admin Home is a different page.

---

## Suggested click path

1. Phone + Field → Home → type `DL-UM` or **Scan asset** (`UM16984` disambiguation)
2. Open `DL-UM-16984` → Checkout → add available assets → submit
3. Toggle **Offline**, checkout again → queued + Needs attention
4. Sites → 337 Power Street → Recover / Deploy
5. Desktop + Office Admin → Assets table, Calibration, Record calibration
6. Desktop + Data Admin → Admin home → Data Management → Import stepper, Duplicate review, Retention
7. Manager → Fleet report (no write buttons)

---

## Files

```
ams-ui/
  index.html
  README.md
  css/tokens.css
  css/components.css
  css/shell.css
  css/screens.css
  js/data.js
  js/app.js
```

Authority: this brief + `docs/12-ui-spec.md` + `docs/build-ui/*`. Constitution still applies — the prototype only simulates client feedback. The earlier search-only phone is at `docs/mockups/mobile-prototype/` (D2). This pack implements the operational home requested here.
