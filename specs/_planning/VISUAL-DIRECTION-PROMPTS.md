# Image-generation prompts — Englobe AMS visual direction

**Revised 2026-09-03, desktop-first.** The first version of this file led with the phone. That
contradicted the decision recorded the same day in `docs/12-ui-spec.md` § 1 and `docs/02-app.md`
§ Surfaces: **desktop is the full-function surface**, and G-01 is resolved *and inverted*.

**Order of work follows the size of the hole.** Console has no design at all (`docs/12-ui-spec.md`
G-22; `docs/02-app.md`: *"Console's screen family is not yet specified"*). Desk exists only as a
phone column stretched on a wide canvas. Field is the only surface actually built. So: Console,
then Desk, then Field.

These are **inspiration**, not specifications. Image models cannot render accurate UI text. Take
colour, weight, spacing and hierarchy from the output; build the real screens against
`docs/12-ui-spec.md`.

---

## The density problem is not one problem

"Too much information" means the opposite thing on each surface. Using one rule set for both is
what produced a phone column stretched across a 1440 px monitor.

| | Field | Desk / Console |
|---|---|---|
| Failure today | 8 data points per `AssetRow`; 6 stacked sections on Asset detail | A 480 px column centred in a 1440 px window; no table, no bulk action, no filters |
| The fix | **Remove.** 3 facts per row, one primary action, progressive disclosure | **Structure.** Sortable columns, persistent filters, bulk select, detail pane |
| Wrong fix | Adding a table | Stripping to 3 facts per row |

---

## Block D-C — Console density rules (paste into Console prompts)

    DENSITY RULES — this is a professional management console. Density is the point.
    Information is not reduced, it is made scannable and actionable:
    - One row is one object. The table is the primary interface, not a fallback.
    - 6 to 9 columns, every one sortable. Column headers are small uppercase grey.
    - Rows are tall and airy: hairline separators only, no zebra striping, no vertical gridlines.
    - Filters are persistent and visible as removable chips, not hidden behind a funnel icon.
    - Multi-select checkboxes in the first column. Selecting rows reveals a bulk action bar
      that replaces the toolbar and states the count: "12 selected".
    - Numbers right-aligned and tabular. Identifiers monospaced. Dates relative when recent.
    - Destructive and irreversible actions are visually distinct and never adjacent to routine ones.
    - Empty space is allowed. A dense table does not mean a full screen.

## Block D-F — Field density rules (paste into Field prompts only)

    DENSITY RULES — one-handed, in gloves, in sunlight. Remove, do not arrange:
    - Each screen answers exactly ONE question. Everything else is one tap away.
    - A list row carries at most 3 pieces of information plus one status indicator.
    - Exactly one primary button per screen.
    - Secondary detail is progressively disclosed: collapsed sections or a second screen.
    - Numbers and identifiers are big; their labels are small. Never the reverse.
    - No tables.

## Block V — Visual direction: two variants, pick one

> **Read this before using Block V.** *(added 2026-09-03 after `docs/20-mockup-review.md` G-24.)*
> The first version of this block specified a fresh palette — warm neutrals, "deep teal-green" accent,
> Inter + IBM Plex Mono — and a Console generated from it duly ignored the design system the clickable
> mockup had already established (Fluent tokens, Englobe green `#14713a`, brand isolated to four CSS
> variables). The result was a second design system, and there is now a third in
> `docs/mockups/ams-field-ui.html` — three token vocabularies for the same four concepts, on three
> different accents (Englobe green, teal, stock Fluent blue). That is gap **G-24** in
> `docs/12-ui-spec.md`.
>
> **A prompt that seeds a screen alongside an existing design must inherit that design, not restate one.**
> Use Block V-INHERIT below for anything that will sit next to the existing mockup. Use Block V-FRESH
> only for genuinely greenfield exploration, and expect to reconcile it afterwards.

## Block V-INHERIT — use this by default

    VISUAL DIRECTION — match an existing design system exactly. Do not invent a palette.
    - Accent, and the ONLY brand colour: {{BRAND_HEX}}. Every interactive element uses it.
      There is no second accent. Do not introduce teal, indigo or purple.
    - Type: {{UI_FONT}} for all UI text, {{MONO_FONT}} for asset IDs, serials and project numbers only.
    - Neutrals, surfaces and borders: {{NEUTRAL_RAMP}}. Do not substitute a warmer or cooler ramp.
    - Status pills use the existing semantic ramp {{STATUS_RAMP}} and no other colours.
      Status colour appears only inside pills; it never floods a row or a card.
    - Monochrome line icons, Regular weight, 16-20px. No 3D or coloured icons.
    - Reference feel: calm, confident, high contrast, industrial. NOT consumer-playful,
      NOT corporate-2015, NOT glassmorphism.

    Fill the four placeholders from the system you are matching before generating. For Englobe AMS
    today that is: BRAND_HEX #14713a (placeholder, G-03 still needs the real Englobe hex),
    UI_FONT Segoe UI, MONO_FONT IBM Plex Mono, NEUTRAL_RAMP the Fluent v9 web theme neutrals,
    STATUS_RAMP the Fluent semantic set in `docs/12-ui-spec.md` § 2.5.

## Block V-FRESH — greenfield exploration only

    VISUAL DIRECTION — modern enterprise tool for an engineering firm:
    - Reference feel: Linear, Vercel dashboard, Retool done tastefully. Calm, confident,
      high contrast. NOT consumer-playful, NOT corporate-2015, NOT glassmorphism.
    - Background warm off-white #FAFAF9. Surfaces pure white, 8px radius, 1px #E7E5E4 hairline
      borders. One very soft shadow, on floating surfaces only. No gradients anywhere.
    - ONE accent colour used sparingly for interactive elements: {{BRAND_HEX}} (deep teal-green).
    - Status colour appears ONLY inside small pills: green Available, blue Deployed,
      amber Calibration due, red Needs repair, grey Retired. Status colour never floods a row.
    - Type: Inter for UI, IBM Plex Mono for asset IDs, serials and project numbers.
      Secondary text #78716C. Nothing lighter than #57534E.
    - Fluent UI System Icons, Regular weight, 16-20px, monochrome. No 3D or coloured icons.

## Block X — Negative constraints (paste into every prompt)

    DO NOT INCLUDE: browser chrome, device bezels, phone frames, hands, desks, perspective or
    3D tilt, marketing copy, hero headlines, lorem ipsum, stock-photo people, decorative
    illustrations, pie charts, donut charts, gauge widgets, fake charts as filler, gradient or
    glossy buttons, neumorphism, glassmorphism, purple/indigo SaaS palettes, duplicated
    navigation, drop shadows on text.
    Render flat and straight-on, edge to edge, as a pure UI design file export.

---

## Prompt 1 — CONSOLE: asset table with bulk select

The core Console primitive: see many things, change them. Nothing like this exists in the build.

    A desktop web application UI design, 1440x900, flat straight-on render, no browser chrome.
    Product: the administrator console of an asset-management system for an engineering firm
    tracking about 1,050 field instruments — seismographs, geophones, sound level meters,
    total stations, vehicles.

    SCREEN: "Assets" in an admin console.
    - Persistent left entity rail, 220px, warm off-white, small monochrome icons with labels,
      grouped under two quiet uppercase headings.
      OPERATIONS: Assets, Sites, Calibration, Reservations, Queues.
      REFERENCE DATA: Locations, Equipment models, Projects, People, Categories.
      "Assets" is active, marked by a 2px accent bar and near-black weight.
    - Top bar: page title "Assets", a count "1,048", a search field, a secondary button
      "Import", one primary button "New asset".
    - A filter row of removable chips: "Office: Ottawa x", "Status: Deployed x",
      "Cal due: next 30 days x", plus a quiet "+ Add filter".
    - A wide data table, 8 columns with small uppercase grey sortable headers:
      checkbox, ASSET ID (monospace), MODEL, STATUS (pill), LOCATION, CUSTODIAN,
      CAL DUE, PROJECT. About 14 tall airy rows, hairline separators, no zebra striping,
      no vertical gridlines.
    - Three rows are selected, their checkboxes filled in the accent colour, those rows
      tinted very faintly. A bulk action bar has replaced the top bar and reads
      "3 selected" on the left, with buttons "Transfer", "Send to calibration", "Export",
      and a visually distinct red-outlined "Retire" separated by a divider.
    - Bottom: quiet pagination "1-50 of 1,048".

    [Block D-C] [Block V-INHERIT] [Block X]

## Prompt 2 — CONSOLE: reference data management

This closes the audit's headline finding: every reference table is read-only today
(`docs/17-ux-audit.md` § A). The screen must teach *deactivate, never delete*.

    Same product and visual system. A desktop web application UI design, 1440x900,
    flat straight-on, no browser chrome.

    SCREEN: "Locations" under REFERENCE DATA in the same left entity rail as before.
    - Top bar: title "Locations", subtitle "10 active, 2 inactive", primary button "New location".
    - A two-level indented tree table showing hierarchy: a parent row "Ontario" with child
      rows indented beneath it: "Ottawa", "Toronto", "Sudbury", "SWO", "Mississauga",
      "Thunder Bay". Columns: NAME, TYPE, PARENT, ASSETS (a right-aligned count like 214),
      STATUS, and a trailing overflow menu on each row.
    - Two rows carry a grey "Inactive" pill and their text is dimmed but still legible.
    - One row is expanded into an inline edit state: labelled fields for Name, Type
      (a select), Parent (a select), and a toggle switch labelled "Active".
      Below the toggle, a small amber inline note: "214 assets reference this location.
      Deactivating hides it from pickers; existing records keep it."
      Two buttons: a primary "Save" and a text "Cancel". There is NO delete button anywhere.
    - Right side of the row, a quiet text link "Change history".

    [Block D-C] [Block V-INHERIT] [Block X]

## Prompt 3 — CONSOLE: reservation calendar

Called out in `docs/12-ui-spec.md` G-22 as one of the screens that most needs width.

    Same product and visual system. A desktop web application UI design, 1440x900,
    flat straight-on, no browser chrome.

    SCREEN: "Reservations" — a resource calendar showing everyone's bookings.
    - Same persistent left entity rail, "Reservations" active.
    - Top bar: title "Reservations", a week range "8 - 14 September", back and forward
      chevrons, a "Today" button, a segmented control reading Week / Month,
      and a primary button "New reservation".
    - A horizontal resource timeline: rows are assets down the left in monospace
      (TRK-0114 Ford F-150, TRK-0119 Ford Ranger, DL-UM-16984, GEO-V12-30220,
      SLM-S50-13595), columns are the seven days of the week.
    - Booking bars span days as soft rounded rectangles in a muted accent tint,
      each labelled with a person's name and a project number like 02208928.
      One bar is hatched and outlined in amber, labelled "Maintenance".
      Two bars on the same row nearly touch, showing a tight turnaround.
    - Today's column has a very faint tinted background and a thin accent top border.
    - A quiet legend bottom-left: Booked, Maintenance, Overdue return.

    [Block D-C] [Block V-INHERIT] [Block X]

## Prompt 4 — DESK: two-pane study and reports

Desk is Field at full width plus the read-heavy screens. Its primitive is study, not bulk change.

    Same product and visual system. A desktop web application UI design, 1440x900,
    flat straight-on, no browser chrome.

    SCREEN: "Asset detail" on a two-pane layout for a non-admin user.
    - Slim left nav, 200px, monochrome icons with labels: Search, Calibration, Check out,
      Return, Sites, Reports.
    - Middle list pane, 380px: a search field and a scrollable list of compact asset rows,
      each with a monospace asset ID, a grey model line and a small status pill.
      One row is selected and tinted.
    - Right detail pane taking the remaining width, for asset DL-UM-16984:
      a hero block with the monospace ID as the title, "Nomis Minimate Pro4" beneath it,
      and one large blue "Deployed" pill.
      Four label-over-value facts in a row, values large, labels tiny uppercase grey:
      WHERE, WHO, CAL DUE, PROJECT.
      One primary button "Return" and two secondary buttons "Transfer", "Report fault".
      Below, a horizontal tab strip: History, Calibration, Attached items, Documents.
      History is active, showing a vertical timeline of about 8 events, each a small
      monochrome icon, a bold event name, a person and a relative date.
    - Above the timeline, four small stat tiles, each one large number and one tiny label:
      "1,048 assets", "37 deployed", "12 cal due", "3 needs repair". Plain numbers only.

    [Block D-C] [Block V-INHERIT] [Block X]

## Prompt 5 — FIELD: the phone slice

Only after the two desktop surfaces have a direction. Field inherits the tokens; it does not set them.

    A single mobile UI screen design, 390x844, flat straight-on render, no device frame.
    Same product and visual system as the desktop console, scaled down to one hand,
    in gloves, in direct sunlight.

    SCREEN: "Find an asset."
    - 56px header: wordmark "Englobe AMS" left, circular avatar with initials "JP" and
      "Ottawa" beneath it, right. Hairline bottom border.
    - One large search field, magnifier left, camera/scan icon right,
      placeholder "Asset ID, serial or model".
    - One row of three filter chips: "My office", "Checked out", "Cal due".
    - Five generously spaced result cards. Each shows ONLY a large monospaced asset ID
      (DL-UM-16984, GEO-V12-30220, SLM-S50-13595, DST-0246, TMP-0031), one grey subtitle
      line ("Nomis - Minimate Pro4"), and one small status pill top-right. Nothing else.
    - Sticky bottom tab bar, five monochrome icons with 11px labels:
      Search, Calibration, Check out, Return, Sites. Active tab in the accent colour.
    - 44px minimum touch targets throughout.

    [Block D-F] [Block V-INHERIT] [Block X]

## Prompt 6 — Moodboard, not UI

    A design-system moodboard sheet, flat 16:9, for an enterprise field-operations tool used
    by engineering crews in Canada, primarily at a desk and secondarily outdoors.
    Show, arranged on a warm off-white board: a colour ramp of one deep teal-green accent with
    five neutral warm greys; five small semantic status pills (green, blue, amber, red, grey);
    a type specimen pairing a geometric sans with a monospace, showing "DL-UM-16984" large;
    one data table row treatment at three densities; an icon row of monochrome line icons for
    search, calendar, export, import, location, settings, bulk select; button states including
    a destructive variant.
    Calm, precise, industrial rather than playful. Swatches labelled with hex codes.

    [Block X]

---

## Tool-specific tails

| Tool | Append |
|---|---|
| Midjourney v7 | `--ar 16:9 --style raw --stylize 150` (use `--ar 9:19` for Prompt 5) |
| Nano Banana / Gemini | Paste as-is. Follow with "now the same screen in dark mode" to test the token swap |
| GPT-Image / DALL-E | Paste as-is; it honours long constraint lists well |
| Figma AI / Galileo | Drop Block X; those tools already output flat frames |

## After the images

Image models cannot render correct UI text, and they are worst at exactly the thing Console needs —
a table with real column semantics. Take **colour, weight, spacing and hierarchy** from the output,
nothing else. Then:

1. Record the chosen direction in `docs/12-ui-spec.md` § 2 (tokens) and close G-03, G-04, G-23.
2. Write Console's screen family into `docs/12-ui-spec.md` § 5, which closes G-22. It does not
   exist yet, and it is the prerequisite for `docs/17-ux-audit.md` findings A1-A4 (an admin can
   create an office, a category, a model, and can deactivate but never delete).
3. Run `/design` for an editable multi-artboard canvas built from the real `en.json` strings
   and the real state machine.

`{{BRAND_HEX}}` is a placeholder — G-03 is still open. Substitute the Englobe hex before
generating, or let the model choose and pin the value in the spec afterwards.

**And settle G-24 first.** Until Jay picks option A or B in `docs/20-mockup-review.md` § D1, a new
screen generated from any of these prompts adds to the reconciliation debt rather than reducing it.
