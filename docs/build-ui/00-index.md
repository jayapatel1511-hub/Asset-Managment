# UI build playbooks — index

**Home:** `docs/build-ui/`  
**What this is:** Implementation-ready, button-by-button screen playbooks for engineers.  
**What this is not:** A redesign brief and not a replacement for `docs/12-ui-spec.md` (design-tool authority).

**Derived from (2026-09-03):**

| Authority | Role |
|---|---|
| `docs/12-ui-spec.md` | Screen inventory (§ 3.2), layouts (§ 5), shared components (§ 4), states (§ 6) |
| `app/src/App.tsx` + `app/src/features/` | Live routes and components |
| `app/src/i18n/en.json` | Exact copy keys |
| `docs/02-app.md` § Surfaces | Field / Desk / Console ownership |
| `docs/20-mockup-review.md`, `docs/mockups/` | Mockup proposals; **not agreed** until in `docs/08-decisions.md` |
| `docs/mockups/review-ref/DECISIONS.md` | G-gap proposals (proposed only) |
| `docs/17-ux-audit.md` | Missing Console / reference-data screens |

**No prior `docs/build-ui/` or `docs/screens/` set existed** — this folder is the first playbook home.

**Refresh:** When `docs/12-ui-spec.md` changes, update the cited § and the control tables. Keep TBD rows until Jay records a decision.

**Constitution reminder:** The browser owns no business authority. Client checks are feedback only; the API/database refuse invalid transitions, concurrency clashes and unauthorized fields.

---

## How to use

1. Build shared shell + § 4 components first (`shared-shell.md`).
2. Follow **Suggested build order** below.
3. Open one screen doc; implement every row in **Interactive controls**.
4. Where **Conflicts / TBD** lists mockup vs build, do **not** invent — implement the Prefer column or leave gated behind a decision.
5. Console / reservations / reference stewardship screens marked **STUB** need Jay or further design before full build.

---

## Screen inventory

### Shell and cross-cutting

| Doc | ID | Route | Surfaces | Status |
|---|---|---|---|---|
| [shared-shell.md](./shared-shell.md) | SHELL, X01, X02 | — | all | Complete |
| [_TEMPLATE.md](./_TEMPLATE.md) | — | — | — | Template |

### Field + Desk screens (from `docs/12-ui-spec.md` § 3.2)

| Doc | ID | Name | Route | Component | Surfaces | Status |
|---|---|---|---|---|---|---|
| [s01-search-home.md](./s01-search-home.md) | S01 | Search / Home | `/` | `SearchPage` | Field · Desk | Complete |
| (nested in S01) | D01 | Scan a tag | — | `ScanDialog` | Field | Complete |
| [s03-asset-detail.md](./s03-asset-detail.md) | S03 | Asset detail | `/asset/:assetId` | `AssetDetailPage` | Field (trimmed) · Desk (full) | Complete |
| (nested in S03) | D02–D05 | Fault / Cal / Retire dialogs | — | feature dialogs | Field · Desk | Complete |
| [s04-checkout.md](./s04-checkout.md) | S04 | Checkout | `/checkout` | `CheckoutPage` | Field · Desk | Complete |
| [s05-return.md](./s05-return.md) | S05 | Return | `/return` | `ReturnPage` | Field · Desk | Complete |
| [s06-transfer.md](./s06-transfer.md) | S06 | Transfer | `/transfer` | `TransferPage` | Field · Desk | Complete |
| [s07-calibration-due.md](./s07-calibration-due.md) | S07 | Calibration due | `/calibration` | `CalibrationDuePage` | Desk (primary) · Field (nav today) | Complete |
| [s08-sites.md](./s08-sites.md) | S08 | Sites | `/sites` | `SiteListPage` | Desk (primary) · Field (nav today) | Complete |
| [s09-site-detail.md](./s09-site-detail.md) | S09 | Site detail | `/site/:site` | `SiteDetailPage` | Desk · Field | Complete |
| (nested in S09) | D06 | Swap / Change configuration | — | `SwapDialog` | Desk | Complete |
| [s10-deploy.md](./s10-deploy.md) | S10 | Deploy | `/deploy` | `DeployPage` | Field · Desk | Complete |
| [s11-recover.md](./s11-recover.md) | S11 | Recover | `/recover/:installationId` | `RecoverPage` | Field · Desk | Complete |
| [s13-admin-home.md](./s13-admin-home.md) | S13 | Admin home | `/admin` | `AdminHomePage` | Console · Desk (admin) | Complete |
| [s14-new-asset.md](./s14-new-asset.md) | S14 | New asset | `/admin/new-asset` | `NewAssetPage` | Console | Complete |
| [s15-office-admins.md](./s15-office-admins.md) | S15 | Office administrators | `/admin/office-admins` | `OfficeAdminsPage` | Console | Complete |
| [s16-needs-attention.md](./s16-needs-attention.md) | S16 | Needs attention | `/needs-attention` | `NeedsAttentionPage` | Field · Desk | Complete |
| [s17-reports-home.md](./s17-reports-home.md) | S17 | Reports home | `/reports` | `ReportsHomePage` | Desk | Complete |
| [s18-compliance.md](./s18-compliance.md) | S18 | Calibration compliance | `/reports/compliance` | `CompliancePage` | Desk | Complete |
| [s19-timeline.md](./s19-timeline.md) | S19 | Asset timeline | `/reports/timeline/:assetId` | `TimelinePage` | Desk | Complete |
| [s20-utilisation.md](./s20-utilisation.md) | S20 | Utilisation | `/reports/utilisation` | `UtilisationPage` | Desk | Complete |

### Proposed / not yet in route manifest

| Doc | ID | Name | Route | Status |
|---|---|---|---|---|
| [c01-assets-console.md](./c01-assets-console.md) | C01 | Assets Console (desktop) | TBD — likely `/console/assets` | Partial (from mockup) |
| [s01b-field-home-proposed.md](./s01b-field-home-proposed.md) | S01b | Field home (proposed S01 replacement) | would replace `/` | Stub — open decision D2 |
| [reservations.md](./reservations.md) | R01–R03 | Reserve / My reservations / Calendar | TBD | Stub — `docs/02-app.md` |
| [console-reference-data.md](./console-reference-data.md) | C-REF | Reference stewardship screens | TBD | Stub — `docs/17-ux-audit.md` § A |

---

## Suggested build order

Order follows dependency and delivery value (field workflows first, then desk reads, then console writes). **G-24 (design system) blocks visual polish** but does not block wiring routes and controls against Fluent.

| Phase | Screens | Why |
|---|---|---|
| 0 | Shared shell, StatusPill, AssetRow, Cart line, MessageBar, X01/X02 | Everything composes these |
| 1 | S01 + D01 → S03 + D02 | Find and inspect — core Field loop |
| 2 | S04 → S05 → S06 | Custody transactions (five-asset race proof path) |
| 3 | S16 | Offline queue / conflict surface |
| 4 | S10 → S11 → S08 → S09 + D06 | Deploy / recover / sites |
| 5 | S07 | Calibration due list |
| 6 | S13 → S14 → S15 + D03–D05 | Admin writes |
| 7 | S17 → S18 → S19 → S20 | Desk reports (governed export on S18/S19) |
| 8 | C01 Assets Console | After G-24 + G-22 scope confirmation |
| 9 | S01b (if Jay accepts D2), R01–R03, C-REF | Only after product decisions |

---

## Cross-cutting TBDs that need Jay

| ID | Question | Blocks |
|---|---|---|
| **G-24 / D1** | Which design system wins — Fluent + Englobe green `#14713a`, or Console teal/warm-stone? | Further mockup work; token work on all screens |
| **G-03** | Real Englobe brand hex (placeholder `#14713a`) | Brand tokens |
| **G-12** | Hide invalid S03 actions vs disable + `asset.actions.notAllowed` | S03 action row |
| **G-02** | Show signed-in user / office in header? | Shell |
| **G-06** | How Field Users reach Needs attention / Reports (More nav vs other) | Nav IA |
| **D2** | Accept S01b Field home as replacement for S01? | S01 layout |
| **G-16** | Assigned-to picker + kit role on Checkout? | S04 |
| **G-17** | Scan on Checkout / Transfer / Deploy add rows? | S04, S06, S10 |
| **G-18** | Entra people picker vs free-text UPN | S06, S15 |
| **G-14** | Certificate PDF upload (private blob, not SharePoint) | D04 |
| **Q9 UI** | Admin "Transaction date" + conflict refusal copy | S04, S05, S06 |
| **Inactive project** | Refuse vs warn-and-permit | S10 |
| **Coordinates** | Device, hand, or both primary | S10 |
| **G-22 remainder** | Console family beyond Assets table (reports desktop, reservation calendar, reference CRUD) | C01+, C-REF, R03 |
| **G-23** | Vehicle identity (icon, plate on row) | C2, S01, S03, C01 |

Closed for build (do not re-open without amending decisions): **Q8** expected return optional; **Q9** admins may backdate ≤ 30 days; **G-01** desktop is full-function surface.

---

## Conflicts: build vs mockup (default preference)

Until Jay records otherwise in `docs/08-decisions.md`:

| Topic | Prefer | Note |
|---|---|---|
| Surface priority | `docs/12-ui-spec.md` § 1 + `docs/02-app.md` Surfaces | Mockup G-01 ("phone canonical") **superseded** |
| Field screen behaviour / copy | Built app + `en.json` + § 5 | Mockup proposals are optional improvements |
| Desktop Console layout | `Assets Console.dc.html` structure | Tokens subject to G-24 |
| Asset ID scheme in samples | `docs/12-ui-spec.md` § 0 (`DL-UM-…`) | Console mockup invented `SEIS-…` — keep coverage, drop scheme |
| Certificate store | Private Azure Blob (`CLAUDE.md` stack) | Spec text still mentions SharePoint in places — parked |
