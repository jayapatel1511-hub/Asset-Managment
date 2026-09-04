# Englobe AMS — clickable UI mockup

A design artefact for reviewing every screen of the Englobe AMS phone app with Jay and the field
team. It is **not** the app: no backend, no Dataverse, no Power Apps SDK, no network calls, nothing
persisted. All data is fictional and reload resets it.

## Open it

Open `Englobe AMS Mockup.dc.html`. It needs its three siblings in the same folder:
`StatusPill.dc.html`, `AssetRow.dc.html`, `support.js`. No build step, no CDN, no web fonts.

Deep links work from the address bar: `#/asset/DL-UM-16984`, `#/checkout`, `#/site/337-POWER-ST`,
`#/reports/timeline/DL-UM-16984`, and so on for every route in § 3.2.

## How to drive it

The panel to the right of the phone is **not part of the app design**:

- **Screen** — S01–S20 and D01–D06 by ID and name. Picking a dialog opens it over its host screen.
- **State** — the states listed under that screen in § 5 (default, loading, empty, refused, overdue,
  no-results, offline, draft-restored, …).
- **Role** — Field User / Office Admin / System Owner. Switching redraws the current screen: the
  Admin nav item, admin-only actions on S03 and the SIM section appear or disappear immediately.
  Field Users get the "More" item instead (G-06).
- **Theme** — System / Light / Dark. System follows the OS.
- **Offline** — the next submit shows X02 and the item appears under Pending sync on S16, with a
  Pending sync badge on the affected assets.
- **Two-pane ≥ 900 px** — renders the optional G-01 desktop layout beside the phone. The phone
  layout stays canonical.
- **Q8 / Q9** — the two § 11 open questions rendered both ways; defaults match today's build.
- **Design notes** — the DECISIONS.md rows relevant to the screen you are on.

Everything inside the phone frame is tappable: rows open S03, actions run, submits change status.

## What is here

- `Englobe AMS Mockup.dc.html` — the mockup: 20 screens, 6 dialogs, X01 and X02, both themes.
- `StatusPill.dc.html`, `AssetRow.dc.html` — the two shared components used by every list.
- `DECISIONS.md` — one row per G-item plus the § 11 toggles.
- `proposed-strings.json` — every string the mockup needed that `en.json` does not have, plus the
  G-09 enum humanisation map.
- `shots/` — S01, S03, S04, S10, S17 in light and dark.
- `docs/12-ui-spec.md`, `app/src/i18n/en.json` — read-only copies of the two source files, imported
  so the mockup could be built against them verbatim.

## Sample data

41 fictional assets across six equipment types, four offices (Ottawa, Toronto, Sudbury, SWO), six
projects (one Inactive) and three sites. It includes, deliberately: one asset per status; two assets
sharing serial `UM16984` (DL-UM-16984 and GEO-V12-30220) for the scan-disambiguation case; two
temporary tags (TMP-0031, TMP-0044); three overdue calibrations; DL-UM-16984 with two closed
deployments; SIM-0007 with an obviously fake ICCID, a 555 phone number and an IP from the
documentation range 203.0.113.0/24; and DL-MP-11204 as CheckedOut with no custodian (the pilot-sweep
case).

### Real-data check — read this

`app/public/data/` and `migration/staged/` were **never read**. The only repository files pulled into
this project are `docs/12-ui-spec.md` and `app/src/i18n/en.json`.

I could not run the brief's proposed check (extract `identifiervalue`, `phonenumber` and `staticip`
from `migration/staged/assets.json`, then grep the mockup for them) without reading the file the
brief also forbids reading, and reading it would have pulled real ICCIDs and phone numbers into this
project. So the check was inverted: every identifier-shaped value in the mockup was grepped and
accounted for. Result — **1 match, 0 of them real**: `SIM-0007`, carrying
`8900 0000 0000 0000 007`, `+1 555-0100 (demo)` and `203.0.113.7 (demo range)`, all hand-authored
here. No other ICCID, phone number or static IP exists anywhere in the mockup. If you want the
literal check run against the staged file, run it on your side against `shots/` and the four source
files in this project; nothing in them came from staged data.

## § 12 handoff checklist — honest state

- [x] **§ 4 components with variants** — StatusPill ×7 statuses; AssetRow ×4 (default, overdue,
      incomplete-ID, pending-sync, and combinations); cart line ×4 (Checkout with pill + Role,
      Return with Condition, Transfer single-line, Deploy component with Role + Orientation);
      MessageBar ×4 intents; the badge set (count badges, Retired, Temporary tag, OVERDUE, Primary,
      Current installation, closed, large report totals, availability percentage).
      C4, C5, C7, C8, C9, C11, C12 all present.
- [x] **One frame per screen state** — every state listed under each § 5 screen is selectable from
      the panel and was opened in the preview.
- [x] **X01 / X02 designed once, referenced from every form** — one block, per-form label and
      destination.
- [x] **Both themes rendered for S01, S03, S04, S10, S17** — see `shots/`.
- [x] **Every string traced** — verbatim from `en.json`, or a § 9 provisional, or listed in
      `proposed-strings.json`.
- [x] **Each G-item resolved or explicitly left as-is** — DECISIONS.md, 21 rows.
- [ ] **Behaviour changes logged in `docs/08-decisions.md`** — not done: this project has read-only
      access to the repository, so nothing was appended and nothing was committed. The rows to paste
      are the "Resolved" lines of DECISIONS.md that change behaviour rather than appearance —
      G-06, G-08, G-11, G-12, G-13, G-15, G-16, G-17, G-18, G-20, G-21, Q8, Q9 — each to be marked
      "Proposed in design/mockup, needs Jay".

## Other deviations from the brief, stated plainly

- The mockup is a Design Component (`.dc.html` + two sibling components + `support.js`), not a single
  `design/mockup/index.html`. Same constraints honoured: plain HTML/CSS/JS, no framework in the page,
  no bundler, no CDN, no web fonts, no network access, hash routing, well under 600 KB.
- No `.claude/launch.json` entry and no `python -m http.server 3300`: this environment has no shell
  and no write access to the repository. The file was opened and walked in the built-in preview
  instead — every screen and state reported above was opened there.
- Fluent tokens are reproduced as CSS custom properties on `:root` with `[data-theme="dark"]` and a
  `prefers-color-scheme: dark` block, exactly as asked. Fluent publishes no dark MessageBar surface
  tokens; those five values are hand-picked approximations and are flagged in DECISIONS.md.
- The camera in D01 is a design of the camera version (viewfinder, torch, aiming copy) with the
  typed stand-in underneath, since no camera exists here.
