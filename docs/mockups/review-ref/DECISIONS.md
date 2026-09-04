# Design decisions — Englobe AMS clickable mockup

Every gap from `docs/12-ui-spec.md` § 10, plus the § 11 open questions that change the UI.
"Resolved" means the mockup proposes something new; "kept as-is" means the build's behaviour was
reproduced deliberately. Nothing here is agreed — all of it needs Jay.

| # | Gap | Verdict | What the mockup does |
|---|---|---|---|
| G-01 | No layout above 480 px | Resolved (optional) | Phone at 390 px stays canonical. A two-pane option (list 360 px + detail) is available from the control panel and rendered beside the phone, labelled "not canonical". No behaviour differs between the two. |
| G-02 | No signed-in user or office shown | Resolved | Header right slot holds a 32 px initials avatar plus home office (Caption1). Tapping it opens an identity sheet: name, UPN, home office, demo role, Close. The dev role picker is gone from the app header and lives in the mockup panel instead. |
| G-03 | Stock Fluent blue; no Englobe brand | Resolved (needs brand confirmation) | Brand ramp is Englobe green on white: `#14713a` foreground/background with an `#eaf4ee` tint in light, `#5cc27f` / `#14683a` / `#0e3520` in dark. It lives in four CSS variables (`--brandFg`, `--brandBg`, `--brandTint`, `--brandFgOn`) and nowhere else, so exact hexes can be swapped in one place once brand supplies them. `[data-theme="fluent-blue"]` keeps the stock Fluent ramp for comparison. Status colours stay semantic. |
| G-04 | Checked out ≡ Deployed, Needs repair ≡ Missing | Resolved | Deployed gets its own hue (brand tint background, brand foreground) and a location-pin icon; Checked out keeps the neutral grey pill with an export-arrow icon. Needs repair keeps a warning-triangle icon, Missing gets a circle-with-slash. All pills stay text-labelled. |
| G-05 | Retire is `outline`, not destructive | Resolved | Retire renders as a danger-outline button: 1 px `--red` border, red label, neutral background. Same 32 px height as other row actions. |
| G-06 | Field Users cannot reach Needs attention or Reports | Resolved | Field Users get a sixth nav item "More" (three-dot icon) in the Admin slot, leading to Needs attention and Reports. It carries a red count badge when anything is pending or rejected. Admins still see Admin in that slot. |
| G-07 | Label reuse and developer copy | Resolved | Deploy's primary picker button reads "Pick logger" (`deploy.pickPrimary`); Recover's date reads "Recovery date" (`recover.recoveryDate`); the Compliance card title reads "Calibration compliance"; the In-calibration badge reads "In calibration: n"; the utilisation option reads "365 days"; the confirmation button after checkout reads "Back". All five proposed keys are in `proposed-strings.json`. |
| G-08 | "Pending sync" badge not placed | Resolved | A warning-tone "Pending sync" badge sits immediately left of the StatusPill on AssetRow, and beside the pill in the S03 header. Submitting while the panel is offline sets the flag on every affected asset. |
| G-09 | Raw enum labels | Resolved | Equipment types and statuses are humanised for display only ("DataLogger" → "Data logger", "CheckedOut → Deployed" → "Checked out → Deployed"). Full mapping in `proposed-strings.json` under `_enumLabels`. Asset IDs, project numbers and site keys are never rewritten. |
| G-10 | Shared-serial disambiguation | Resolved | Resolving serial `UM16984` (shared by DL-UM-16984 and GEO-V12-30220) returns to Search with only those rows and `asset.disambiguate` rendered above the list. Panel state "disambiguate" on S01 shows it without scanning. |
| G-11 | Attached items, Last calibrated, SIM fields | Resolved | The Now card is a 4-row, 2-column grid: Location / Home office, Custodian / Project, Parent asset / Next calibration due, **Last calibrated / Attached items** (child Asset IDs, monospace). A separate SIM card (ICCID, phone number, static IP, carrier) renders only for Office Admin and System Owner, with an "Office Admin and System Owner only" badge on the heading. |
| G-12 | Invalid actions hidden | Resolved | Every action from § 5.3 is always rendered. Invalid ones are disabled at 50 % opacity with `title`/`aria-label` = `asset.actions.notAllowed` ("Not available from {status}"), as `docs/02-app.md` asked. Nothing is hidden except by role. |
| G-13 | Mark found / Repair complete use `alert()` | Resolved | Failures render an inline `error` MessageBar above the action row on S03. No browser dialogs anywhere in the mockup. |
| G-14 | No certificate upload on Record calibration | Resolved | A "Certificate (PDF)" mock control: dashed frame, "Choose file" button, caption "Saved to AMS Documents/{assetId}/". Static — it never opens a file dialog. |
| G-15 | Retire has no second confirmation | Resolved | Retire is two steps in one dialog: reason (required) → "Continue" → `admin.retire.confirm` text → "Retire". Cancel is available at both steps. |
| G-16 | Checkout has no "Assigned to", no kit role | Resolved | "Assigned to" renders as a mock people picker defaulted to the signed-in UPN with a "Change" affordance. Each cart line gains an optional Role select (`checkout.kitRole`), default "—". |
| G-17 | No Scan on Checkout / Transfer / Deploy | Resolved | A 32 × 32 camera icon button with `aria-label="Scan"` sits between the input and the Add button on every add row (S04, S06, S10 twice). It opens D01. |
| G-18 | Custodian and administrator are free-text UPNs | Resolved | Both are mock pickers: a select listing five directory people as "Name — upn", first option "Leave unchanged" (Transfer) or "Pick a person…" (Office administrators). Hint copy replaces the developer wording about user principal names. |
| G-19 | Admin home cards carry developer copy | Resolved | "Field-completion queue" → "Tags to finish" with plain-language caption; "Return sweep (Q3 / pilot week)" → "Return sweep" with "Assets that came across as checked out with nobody named." FR numbers and quarter references are gone. |
| G-20 | Validation is a banner only | Resolved | Every required field that can fail also shows a field-level message under its control (Project, Reason, Home office, Lab, Calibration date), in addition to the MessageBar above Submit. |
| G-21 | Most screens have no Back | Resolved | A slim page header (Background1, 1 px bottom stroke) with a transparent Back button and the screen name renders on every non-root screen. Back pops the mockup's own history stack. |
| Q8 | Expected return required on checkout? | Both rendered | Panel toggle "Q8 expected return required". Default off = today's build: "Expected return (optional)", prefilled +14 days. On = "Expected return *". |
| Q9 | May admins backdate? | Both rendered | Panel toggle "Q9 admin transaction date". Default off = no field, as built. On, and only for Office Admin / System Owner, adds "Transaction date" to Checkout and Return with a 30-day floor (`min`) and the caption "Admins may backdate up to 30 days (Q9)." |
| § 11 | Inactive project: refuse or warn? | Kept as-is | Refusal, as built: `deploy.error.inactiveProject` in an error MessageBar. Project 02205512 (Kitchener transit) is Inactive in the sample data and is absent from every Active-projects select. |
| § 11 | Site coordinates: device, hand, or both? | Kept as-is | Both, as built: two hand-entry inputs plus a transparent "Use device location" button and the `deploy.coordinateSource.device` caption. Capture is not made primary. |

## Deliberate deviations from the build (not gaps)

- **Statuses drive the state machine in memory.** Checkout, Return, Transfer, Deploy, Recover, Record
  calibration, Send to calibration, Mark found, Repair complete and Retire all mutate the sample data
  following § 5.3 and then show X01. Reload resets everything.
- **X01 / X02 are one block**, rendered in place of the whole form for any submit, with the
  per-screen button label and destination from § 5.
- **Dark mode** follows the OS under theme "System" and can be forced Light or Dark from the panel.
  Fluent publishes no MessageBar surface tokens for dark; those five backgrounds/borders are
  hand-picked to hold AA contrast against `#1f1f1f` and are flagged here as approximations.
- **Scroll region** is the phone's `main` only, as specified; the header, page header and bottom nav
  never scroll.
