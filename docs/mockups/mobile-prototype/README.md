# Englobe AMS — mobile prototype

Click-through Field UI so Jay can think through home, workflows, settings, and admin without running the production app.

**Not** the app: no API, no auth session, no persistence. Reload or **Reset data** restores the demo set.

## How to open

From this folder:

```bash
cd docs/mockups/mobile-prototype
# Option A — double-click / open in browser
open index.html

# Option B — local server (optional)
python3 -m http.server 8780
# → http://127.0.0.1:8780/
```

Works offline as static HTML/CSS/JS. Viewport is designed for **390px** (phone frame on desktop; full-bleed on narrow windows).

Deep links (address bar):

| Hash | Screen |
|---|---|
| `#/` | Search / Home |
| `#/asset/DL-UM-16984` | Asset detail |
| `#/checkout` | Checkout |
| `#/return` | Return |
| `#/transfer` | Transfer |
| `#/calibration` | Calibration due |
| `#/sites` | Sites |
| `#/site/337-POWER-ST` | Site detail |
| `#/deploy` | Deploy |
| `#/recover/INST-004` | Recover |
| `#/admin` | Admin home |
| `#/admin/new-asset` | New asset |
| `#/admin/office-admins` | Office admins |
| `#/needs-attention` | Needs attention |
| `#/reports` | Reports hub |
| `#/settings` | Settings |
| `#/more` | More (Field User) |

## Screen map

```
Home (Search) ──scan/type──► Asset detail ──► Checkout / Return / Transfer
     │                              │              Fault / Missing / Found / Repair
     │                              │              Send/Record cal · Retire (admin)
     │                              └── sites ──► Site detail ──► Deploy / Recover
     │
     ├── Cal Due ──► asset detail / record cal (admin)
     ├── Checkout / Return (nav)
     ├── Sites ──► Deploy
     └── Admin (admin) or More (field)
              ├── New asset
              ├── Office administrators
              ├── Needs attention (retry / pending)
              ├── Reports (compliance · timeline · utilisation)
              └── Settings (language · offline · about · sign out stubs)
```

Avatar (header) opens an identity sheet → Settings / Admin / Needs attention.

Outside the phone: **Field User / Office Admin / System Owner**, **Toggle offline**, **Reset data**.

## Design choices — keeping home focused

Home is **S01 Search**, not the denser S01b Field home proposal (`Assets Console Mobile.dc.html` / D2).

- One job: find an asset (type ≥ 3 chars, Scan, or a quick filter).
- Idle state is a short hint only — no stats strip, due counts, recent-activity feed, or admin cards.
- Quick filters stay secondary to search (`My equipment`, `Available here`, `Cal due ≤ 30d`).
- Needs attention is reachable via avatar badge / More / Admin — not a home widget.
- Common writes stay on bottom nav (Checkout, Return) and on asset actions — not stacked as home tiles.

Visual language follows the **removed phone mockup** tokens (Fluent neutrals + Englobe green `#14713a` in four `--brand*` variables), not the Console teal/Inter pack (open G-24).

## What is clickable vs stubbed

| Area | Behaviour |
|---|---|
| Navigation, Back, hash routes | Fully wired |
| Search / Scan / shared-serial disambiguation (`UM16984`) | Wired against demo data |
| Asset actions by status (+ admin gates) | Enabled/disabled per matrix; writes mutate local demo state |
| Checkout / Return / Transfer / Deploy / Recover / New asset | Forms + validation + X01 success; offline → X02 queue + Pending sync |
| Fault / Missing / Send cal / Record cal / Retire (2-step) | Dialogs wired |
| Sites → detail → Recover / Deploy here | Wired |
| Needs attention Retry | Clears rejected item when “online” |
| Office admins Add | Mutates local admin map |
| Camera scan | Typed stand-in only |
| Certificate file / people Change / governed Export | Toast stubs |
| Language / Sign out / About | Toast stubs |
| Reports utilisation % | Illustrative placeholder |
| Server refusal / concurrency | Simulated lightly (e.g. cart refused when not Available); not a real API |

Demo copy prefers `en.json` / `proposed-strings.json` where applicable. Asset IDs follow `docs/12-ui-spec.md` § 0 (`DL-UM-…`), not the Console `SEIS-…` scheme.

## Open questions (product thinking)

Surfaced by assembling the flows; already tracked in `docs/build-ui/00-index.md` where noted:

1. **D2** — Keep focused Search home, or accept S01b (greeting + quick tiles + activity)?
2. **G-06** — Field discovery of Needs attention / Reports via More nav (as in this prototype) vs Admin-only?
3. **G-12** — Hide invalid asset actions (current build) vs always show disabled + “Not available from {status}” (this prototype / mockup)?
4. **G-24 / D1** — Fluent + Englobe green vs Console teal/warm stone for Field?
5. **Deploy from Site detail** — Prefill site is assumed here; confirm product expectation.
6. **Home CTAs** — Are bottom-nav Checkout/Return enough for field users, or does home need one quiet secondary path (e.g. “Needs attention”) without becoming a dashboard?

## Files

```
mobile-prototype/
  index.html          Entry
  css/prototype.css   Tokens + components
  js/data.js          Fictional demo fleet
  js/app.js           Hash router + screens
  README.md           This file
```

Authority for behaviour: `docs/build-ui/*`, `docs/12-ui-spec.md`, `docs/mockups/review-ref/DECISIONS.md` (proposed). Constitution: browser owns no business authority — this prototype only simulates client feedback.
