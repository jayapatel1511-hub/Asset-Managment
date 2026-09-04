# UI mockup reference (from Downloads)

**Imported**: 2026-09-03 from `~/Downloads/Englobe AMS mockup review.zip`
**Location**: `docs/mockups/review-ref/`
**Role**: Clickable design reference for the end-to-end Azure web build. **Not** the production app.

Narrowed 2026-09-03 to **the two newest mockups**, on Jay's instruction — see *Removed* below.

## What is here — the second-drop Console pair

| File | Surface | Needs alongside it |
|---|---|---|
| `review-ref/Assets Console.dc.html` | **Desktop — Console.** Entity rail (OPERATIONS / REFERENCE DATA), sortable table, filter chips, multi-select with a bulk bar, pagination. First concrete answer to G-22 | `support.js` |
| `review-ref/Assets Console Mobile.dc.html` | **Mobile.** Despite the name, not a Console — a redesigned Field home: greeting and custody count, Scan / Check out / Return quick actions, recent activity, due-soon and overdue counts, asset bottom sheet, office scoping | `support.js` |

These are the only two files the second drop touched — a flexbox fix to `Assets Console.dc.html`
and the new `Assets Console Mobile.dc.html`. Everything else in the package was byte-identical to
the first drop, which is why the phone mockup was the oldest of the three and is the one removed.

Both are on the **teal `#0F5F55` + Inter + warm-stone** system with **zero brand tokens** — the
Englobe-green `--brandFg/Bg/Tint/FgOn` pattern lived only in the removed phone mockup. Retheming
these two means hand-editing hardcoded hexes in both files. That is open decision **G-24 / D1**.

## Open

```bash
cd docs/mockups/review-ref
python3 -m http.server 8770
# → http://127.0.0.1:8770/Assets%20Console.dc.html
# → http://127.0.0.1:8770/Assets%20Console%20Mobile.dc.html
```

Or use the `englobe-ams-mockups` entry in `.claude/launch.json`, which serves this folder on 8770.

Console Mobile logs three harmless SVG parse errors (`{{ a.d }}`, `{{ c.d }}`, `{{ t.d }}`): the
browser reads the literal `<path d>` before `support.js` binds the `sc-for` loops. Icons render
correctly. Not a defect.

### Removed 2026-09-03

| Removed | Why | Recoverable from |
|---|---|---|
| `review-ref/Englobe AMS Mockup.dc.html` | The oldest of the three — byte-identical between both drops. 20 screens, 6 dialogs. **The only file implementing G-03** (brand isolated to four CSS variables) | `Englobe AMS mockup review.zip` at the repo root |
| `review-ref/StatusPill.dc.html`, `review-ref/AssetRow.dc.html` | Shared components used only by the phone mockup above; nothing else references them | same zip |
| `ams-field-ui.html` | Stock Fluent blue — did not implement G-03 at all, and carried a third token vocabulary for the same four concepts (`docs/20-mockup-review.md` § G-24). Provenance never recorded | **Nothing in-repo** — untracked, and never in the zip |

`review-ref/` is therefore **no longer byte-identical to that zip** — three files are deliberately
absent. `docs/20-mockup-review.md`, `docs/08-decisions.md` and `docs/12-ui-spec.md` still discuss
every removed file; those are dated findings and were left as written.

**`shots/` is now orphaned.** All ten PNGs are of the removed phone mockup, and they were already
stale — captured on stock Fluent blue before its brand ramp landed. Kept because
`docs/20-mockup-review.md` cites them as evidence. Do not review from them.

## How this drives the E2E build

| Layer | Authority |
|---|---|
| Business rules / API / DB | Constitution, features 009–011, `docs/14–16`, R1–R4 decisions |
| Desktop Console layout | `Assets Console.dc.html` + `docs/12-ui-spec.md` (G-22) |
| Mobile Field home layout | `Assets Console Mobile.dc.html` — **proposed replacement for S01**, open decision **D2** |
| Copy | `docs/12-ui-spec.md` + `app/src/i18n/en.json`; `review-ref/proposed-strings.json` has 50 proposals, 11 of which collide with keys that shipped 2026-09-03 |
| Design gap proposals (G-01…G-21) | `review-ref/DECISIONS.md` — **proposed until Jay confirms** each row into `docs/08-decisions.md`. Written against the removed phone mockup, so G-01 through G-21 describe a file no longer here |
| **Engineer build playbooks** (button-by-button) | [`docs/build-ui/00-index.md`](../build-ui/00-index.md) — screen inventory, control tables, stubs for Console / S01b / reservations / reference data |

## End-to-end vertical slice (order)

1. Local Postgres (`docker compose up`) + server integration tests
2. Four-axis state migrations (R1) + frozen checkout command (R2)
3. Five-asset race proof (009 contracts)
4. `app` HTTP adapter → server
5. Settle **G-24 / D1** (which design system wins) — it blocks further screen work — then align the UI

Power Platform and Zite remain parked.
