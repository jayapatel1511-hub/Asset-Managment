# 20 — Review of the clickable mockup deliverable

**Reviewed** 2026-09-03. **Artefact:** `Englobe AMS mockup review.zip`, received twice — a first
drop and a second that added one file. Built in a separate Claude Design project with read-only
access to this repository.

**Verdict.** Careful, honest work that is aimed at a target this repository moved on 2026-09-03.
Nothing in it should be discarded; three things in it must not be built from as-is. Every finding
below was checked against the files, not inferred.

| | Meaning |
|---|---|
| **M1** | Contradicts a decision already recorded here, or would mislead a reviewer |
| **M2** | Will cost rework if built from as-is |
| **M3** | Worth fixing, no downstream consequence |

---

## What is in the package

| File | What it is |
|---|---|
| `Englobe AMS Mockup.dc.html` | 20 screens, 6 dialogs, X01/X02, light + dark. Fluent tokens reproduced by hand |
| `StatusPill.dc.html`, `AssetRow.dc.html` | The two shared components |
| `Assets Console.dc.html` | **A desktop Console** — entity rail, sortable table, bulk select, filter chips, pagination |
| `Assets Console Mobile.dc.html` | Added in the second drop. Despite the name, **not a Console** — see M4 |
| `DECISIONS.md` | 21 rows, G-01 to G-21 plus the § 11 questions |
| `proposed-strings.json` | 50 strings and the G-09 enum humanisation map |
| `shots/01–10` | S01, S03, S04, S10, S17, light and dark |
| `docs/12-ui-spec.md`, `app/src/i18n/en.json` | Read-only copies imported as the source of truth |

**Not from the package, but in the repository:** `docs/mockups/ams-field-ui.html`, added 2026-09-03
20:06, provenance unrecorded. A 390 × 844 Field UI mockup carrying a **third** token vocabulary — see
the design-system finding below.

Only two files changed between the first and second drop: a one-line flexbox fix to the filter-chip
remove button in `Assets Console.dc.html`, and the new `Assets Console Mobile.dc.html`. Everything
else — shots, `DECISIONS.md`, `proposed-strings.json`, the phone mockup — is byte-identical, so every
M1 below still stands against the second drop.

---

## M1 · The imported spec predates 2026-09-03, so the surface decision is inverted

The imported `docs/12-ui-spec.md` still reads `Primary device | Phone`. This repository's copy, edited
the same day, reads *"Desktop is the full-function surface and needs designing."* `DECISIONS.md` G-01
therefore proposes the opposite of the decision:

> "Phone at 390 px stays canonical. A two-pane option is available… labelled **'not canonical'**."

Against § 1 and § 8 here: *"RESOLVED 2026-09-03, and inverted… Not optional."*

**Consequence.** All 20 screens are phone screens. `docs/02-app.md` § Surfaces puts roughly nine on
Field; Calibration due, Sites, the four reports and the three admin screens are Desk or Console. The
mockup also never saw G-22 or G-23, both added the same day.

**Action.** Treat `DECISIONS.md` G-01 as superseded. The 20 phone screens remain valid as the
**Field** slice; they are not the canonical screen set.

## M1 · The screenshots contradict the file on the brand ramp

`Englobe AMS Mockup.dc.html` sets Englobe green `#14713a` as the `:root` default (`--brandFg`,
`--brandBg`, `--brandTint`, `--brandFgOn`). Every shot renders stock Fluent blue. Brand-pixel counts
across all ten:

| | fluent blue | englobe green |
|---|---:|---:|
| shots 01–10 | 2,400 – 9,300 px | 0 – 1,464 px |

The residual green is the semantic *Available* pill, which is correct and unrelated. The shots were
captured before the brand ramp landed.

**Why it matters.** G-03 — stock Fluent blue, no brand — is the specific complaint that started this
work. A reviewer reading `shots/` sees the unfixed version and concludes G-03 was never addressed.

**Action.** Re-export all ten before the review meeting. Do not review from the current `shots/`.

## M2 · `DECISIONS.md` G-03 describes a theme that does not exist

The row claims `[data-theme="fluent-blue"]` is retained for comparison. The file's only themes are
`light`, `dark`, `system` and `englobe-placeholder`. Either add the comparison theme or drop the claim.

## M1 · Three design systems now exist, with three token vocabularies

| | `Englobe AMS Mockup.dc.html` | Both `Assets Console*` files | `docs/mockups/ams-field-ui.html` |
|---|---|---|---|
| Brand tokens | `--brandFg` / `--brandBg` / `--brandTint` / `--brandFgOn` | **none** — hardcoded hexes | `--brand` / `--brand-fg` / `--brand-soft` |
| Accent | Englobe green `#14713a` | teal `#0F5F55` | **stock Fluent blue `#0f6cbd`** |
| Type | Segoe UI (Fluent stack) | Inter + IBM Plex Mono | Segoe UI + Consolas |
| Neutrals | Fluent v9 web theme | warm stone | Fluent v9 web theme |
| Status pills | Fluent semantic `#0e700e` / `#bc2f32` | a separate ramp, `#ECFDF3` / `#067647` / `#ABEFC6` … | Fluent semantic |
| Page ground | Fluent `--bg2 #fafafa` | `#FAFAF9` desktop, `#EFEEEB` mobile | Fluent `--bg2 #fafafa` |

The third file shares the Fluent neutrals and the semantic pills with the phone mockup, so it is the
closest of the three to the built app — but it is on **stock Fluent blue**, meaning it does not
implement G-03 at all, and it names the same four concepts with a third set of variable names.

G-03's whole value was that brand lives in four variables **and nowhere else**, so swapping the real
Englobe hex is one edit. The Console files discard that: retheming now means hand-editing two more
files, and the deliverable carries two different greens each claiming to be the accent.

**Cause, recorded so it is not repeated.** The Console was generated from the image-prompt pack in
`specs/_planning/VISUAL-DIRECTION-PROMPTS.md`, which specifies a warm-neutral ground and a "deep
teal-green" accent. That prompt collided with the Fluent tokens and Englobe green the mockup had
already established. The prompt should have said *inherit the four brand variables from the existing
mockup*; it has been corrected.

**Action.** This is the decision that unblocks everything else — see § Open decisions below. Until it
is made, no further screens should be drawn in either system.

## M2 · The sample data forked into two Asset ID schemes

§ 0 of `docs/12-ui-spec.md` fixes the review data: `DL-UM-16984`, `GEO-V12-30220`, `SLM-S50-13595`,
`DST-0246`, `TMP-0031`, project numbers shaped `02208928`, offices Ottawa / Toronto / Sudbury / SWO.

The Console files invent a second scheme: `SEIS-4128`, `GEO-0917`, `SLM-2240`, `TS-0331`, `VEH-1042`,
projects shaped `24-1187`, locations "Ottawa Yard", "Barrhaven Trunk Sewer", "Hwy 417 Widening".

Two identity shapes for one fleet in one review pack invites comment on the wrong thing, and rule 6
makes the canonical Asset ID the identity.

**Worth keeping.** The Console data covers **total stations** (`TS-`) and **vehicles** (`VEH-`), which
the phone mockup's 41-asset set never did, and both are real fleet categories per `CLAUDE.md`. Keep
the coverage; drop the scheme. § 0 has been hardened to say the scheme is not a design choice.

## M2 · `Assets Console Mobile.dc.html` is not a Console

It contains no entity rail and no bulk select — zero occurrences of either. What it does contain:
Scan / Check out / Return quick actions, a recent-activity list, due-in-30 and overdue counts, an
asset bottom sheet, and office scoping with a "Show all offices" escape.

That is a **redesigned Field home**, and a better one than S01, which today is a search field over a
list with no summary and no quick actions.

But `docs/02-app.md` § Surfaces defines Console as desktop-admin — *"See many things, change them"* —
and states that *"Field carries exactly these, and adding to the list is a decision, not a default."*
As named, the file reads as admin bulk operation migrating onto a phone, which the surfaces table
rules out.

**Action.** Rename it to "S01 Field home — proposed replacement" and it becomes a real proposal
needing a yes/no. Its IA is not affected by the design-system decision; only its tokens are.

## M2 · `proposed-strings.json` collides with strings that shipped the same day

Seven gaps the mockup resolves — G-07, G-08, G-09, G-10, G-11, G-13, G-15 — were closed in commits
`f09f0ee` / `7b37683` while it was being built. 39 of the 50 proposed strings are genuinely new and
clean. These 11 are not:

| Proposed | Already in `en.json` | Collision |
|---|---|---|
| `deploy.pickPrimary` "Pick logger" | `deploy.addPrimary` "Add data logger" | different key **and** text |
| `asset.sim.title` "SIM" | `asset.sim.title` "SIM / connectivity" | **same key, different text** |
| `recover.recoveryDate` | `recover.date` | same text, different key |
| `asset.sim.phoneNumber` | `asset.sim.phone` | same text, different key |
| `reports.utilisation.horizon365` | `reports.utilisation.period365` | same text, different key |
| `reports.utilisation.horizon30` / `horizon90` | `calibration.horizon30` / `horizon90` | same text, different key |
| `cart.scan` | `search.scan` | same text, different key |
| `cart.backToForm` | `common.back` | same text, different key |

**Action.** Reconcile before any of these reach `en.json`; two keys for one string is how a copy file
rots. Not yet applied — it is a code change, not a doc change.

## M2 · Q8 and Q9 were decided after the mockup was built

`DECISIONS.md` renders both "needs Jay". Both were decided the same day in `docs/08-decisions.md`:

- **Q8 — CONFIRMED optional**, prefill +14 days, editable and clearable. The mockup's default state
  matches. No change needed.
- **Q9 — DECIDED**: admins may backdate up to 30 days, Field Users may not, **and any backdate
  landing at or before an existing transaction line for the same asset is refused, naming the
  conflicting transaction.** The mockup has the 30-day floor and the admin-only gate but **not the
  conflict refusal**, which is the part with a failure mode.

**Action.** The Q9 state needs the refusal path and its error copy before it is built from.

## M3 · Vehicles now exist in the data but still have no visual identity

G-23 is unchanged: `VEH-1042 Ford F-250 XL 4x4` renders in the Console table with the same treatment
as a data logger, and the plate is nowhere. Vehicles appearing in sample data at all is progress.

---

## What the mockup got right and should be kept

- **G-03's structure.** Brand isolated to four CSS variables in the phone mockup, so the real Englobe
  hex is a one-line swap. The right pattern, whichever system wins.
- **G-04.** Deployed gets brand tint plus a location pin; Missing gets a circle-with-slash. Those two
  collisions were real and are now distinguishable.
- **G-12.** Decided as disable-with-tooltip rather than hide, matching what `docs/02-app.md` asked
  for. § 10 had deliberately left this open; the mockup answers it with a reason.
- **The desktop Console itself.** Entity rail grouped OPERATIONS / REFERENCE DATA, sortable columns,
  filter chips, multi-select revealing a bulk bar with a separated destructive action, pagination.
  This is the first concrete answer to G-22.
- **Q8/Q9 rendered both ways, neither decided.** It did not take Jay's decision for him.
- **The real-data check.** It refused to read `migration/staged/` and inverted the check instead —
  grepping its own output for identifier-shaped values rather than reading the file the brief forbids.
  One match, `SIM-0007`, hand-authored, with a documentation-range IP. That is rules 10 and 12
  applied correctly under pressure to do the easy thing.

---

## Open decisions — Jay

### D1 · Which design system wins *(blocks all further screen work)*

| Option | Consequence |
|---|---|
| **A — Fluent + Englobe green.** Retrofit both Console files onto the four brand variables | Honours § 1's fixed constraint *"Component library: Fluent UI v9 … do not re-litigate"*. Cheapest. Keeps the built app and the mockup aligned. Console loses the Inter/stone look |
| **B — Console's Inter + stone system.** Move the phone onto it | Better answers the complaint that started this work. Costs a formal amendment to § 1, and means Fluent v9 components get restyled rather than used stock — a real, ongoing maintenance commitment |

Recorded as **G-24**. No further screens should be drawn until this is answered.

### D2 · Is `Assets Console Mobile.dc.html` accepted as the new S01 Field home?

Independent of D1. If yes, it replaces S01 and § 5.1 is rewritten; if no, the file is withdrawn so it
stops implying admin-on-phone.

### D3 · Confirm the Englobe brand hex

`#14713a` is the mockup's placeholder, explicitly flagged as needing brand confirmation. G-03 cannot
close until a real value exists.

---

## Not done here

- `proposed-strings.json` has **not** been merged into `app/src/i18n/en.json`. It is a code change and
  it depends on D1 for none of its 11 collisions but on wording review for all of them.
- The shots have **not** been re-exported; this repository does not hold the design project.
