# 17 — UX audit of the specs

**Requested** 2026-09-03 by Jay, alongside two scope decisions recorded the same day in
`docs/08-decisions.md`: the desktop app splits into a **user** version and an **admin** version, and
**nothing is to be static** — categories, employees, offices and assets must all be addable by an
administrator, in the app.

**Method.** Audited `docs/01-data-model.md`, `02-app.md`, `05-security.md` and `12-ui-spec.md` against
the built app under `app/src/`, and against the API surface in `app/src/api/AmsBackend.ts`. Every
finding below was checked in the code, not inferred from the spec. Severity:

| | Meaning |
|---|---|
| **S1** | Blocks a requirement Jay has now stated, or contradicts a decision already recorded |
| **S2** | Will bite in ordinary operation, without anyone having done anything wrong |
| **S3** | Friction, inconsistency or missing affordance |

---

## The headline finding

**Every reference table in this system is read-only in the app.** `AmsBackend` exposes
`listLocations`, `listEquipmentModels` and `listProjects` — and no create, update or deactivate for
any of them. The only reference-data write in the entire API is `setOfficeAdmins`.

Reference data is loaded once by `migration/` and cannot be changed afterwards except by editing a
CSV and re-running a migration script. That single fact produces findings A1 through A4, and it is
the thing Jay is reacting to.

---

## A. Systemic — the "nothing is static" requirement

### A1 · S1 · An administrator cannot add an office, though a recorded decision says they can

`docs/05-security.md` corrected itself on 2026-09-02 with the reasoning that *"an eleventh office can
be created in the app by an administrator"*, and dropped per-office Entra groups on that basis. The
whole N-offices decision (`docs/08-decisions.md`, 2026-09-02) rests on it. **There is no screen and no
API method that creates a location.** `app/src/features/admin/` holds four files: `AdminHomePage`,
`NewAssetPage`, `OfficeAdminsPage`, `RetireDialog`.

The decision is real, the schema supports it (`eng_location` is hierarchical and self-referential), the
security role grants it (Office Admin has CRU on `eng_location`) — only the UI and the API are absent.
The migration was even designed around it: offices are *"seeded flat under Ontario and reparented by an
admin afterwards"*, and that reparenting screen does not exist. **Nothing has re-parented SWO,
Mississauga or Thunder Bay, and nothing can.**

### A2 · S1 · Adding a category is a software release, not an admin action

`eng_assetgroup` and `eng_equipmenttype` are Dataverse **global option sets**. Adding a value means
editing the solution in Dev, exporting managed, and importing to Prod — a deployment, gated on whoever
holds `pac auth`. CLAUDE.md's own convention makes this explicit ("Choice columns are global option
sets named `eng_<column>` so flows and app share them") and its "Ask before doing" list contains
*"changing a choice value that is already referenced by data"*.

This is directly incompatible with "ability to add that category". Categories have to become **rows**.
See § F for the proposal.

### A3 · S2 · The app and the store disagree about how open these fields are

`app/src/api/types.ts:28-29` types `equipmenttype` and `assetgroup` as plain `string`, while
`docs/01-data-model.md` makes both a `Choice`. The app would render a brand-new category without
complaint; Dataverse would reject the write. The looser layer is hiding the constraint, so this will
present as a runtime error from the store rather than a validation message from the app — and only
once the Dataverse backend is live, which it is not yet (`api/dataverse/` is a typed stub). **It will
surface for the first time in the tenant, during the pilot.**

### A4 · S2 · No deactivate path anywhere, for anything

`eng_location.eng_isactive` and `eng_project.eng_status` exist in the schema and are typed in the app
(`types.ts:42`). **Neither is read by any screen.** There is no way to retire an office, close a
project, or stop a discontinued equipment model appearing in the New asset picker.

This matters more once categories are addable, because the correct answer to "delete a category that
assets reference" is *never delete — deactivate, and show the usage count*. That rule needs to exist
in the admin UI before the first admin adds a category by mistake. Related: there is **no un-retire**
for an asset either (`RetireDialog` is one-way; no reinstate path exists anywhere in the app), so a
mis-clicked Retire is permanent from the app's point of view.

---

## B. Closed enumerations that will need to change

Each is a closed TypeScript union **and** a Dataverse option set, so each costs a code change plus a
solution deployment.

> **Resolved 2026-09-03 (§ I).** **B1, B2 and B4 change**: the sensor cap is removed by decomposition
> (fixed role types + `eng_kitroleindex` 1..N), and carrier and retirement reason become reference
> tables. **B3, B5, B6 and B7 stay closed unions** — stable vocabularies, and the aggregate conversion
> cost is not small. The rows below are kept as the record of what was weighed.

| # | Sev | Enumeration | Where | Why it bites |
|---|---|---|---|---|
| B1 | **S1** | `KitRole` caps sensors at **four** — `Sensor1…Sensor4` | `types.ts:13-23`, and the four-value test is **duplicated in three places**: `domain/installation.ts:22`, `features/deploy/ComponentPicker.tsx:16`, `features/deploy/DeployPage.tsx:135` | A six-geophone array cannot be expressed. **This is the same defect as the four hard-coded offices**, which Jay already ruled on: "we need ability to add offices that we need, it can be n numbers." Sensor count is an N, hard-coded as 4, in three files plus an option set |
| B2 | **S2** | `eng_carrier` — **Bell / Rogers** only | `docs/01-data-model.md` | Telus, Freedom and Videotron all sell M2M SIMs. A two-value list of suppliers is a list that changes with a procurement decision |
| B3 | S2 | `LocationType` — 7 values | `types.ts:10` | "Yard", "Client site", "In transit" are all plausible; each is a release |
| B4 | S2 | `RetirementReason` — Sold / Lost / Damaged / Obsolete | `types.ts:11` | No "Stolen", no "Traded in", no "Written off". Stolen vs Lost is a genuine distinction for an insurance claim |
| B5 | S3 | `Condition` — Good / Damaged / NeedsService | `types.ts:12` | Returned-condition vocabulary is exactly the kind of thing a QA process refines in year two |
| B6 | S3 | `identifiertype` — Serial / ICCID / IMEI / None / Plate | `types.ts:32` | Grew by one this morning for vehicles, which is the demonstration that it grows |
| B7 | S3 | `CalibrationResult`, `Orientation`, `PowerSource` | `types.ts:24,182,183` | `Orientation` is 7 single letters; `PowerSource` omits "Generator" and "PoE" |

---

## C. Fixed by design — and the audit says so deliberately

Jay's instruction is "everything should not be static". These four are the exception, and the reason
needs writing down so a later session does not helpfully make them dynamic:

| Enumeration | Why it must stay closed |
|---|---|
| `eng_assetstatus` | The state machine is **code and flow logic**, not data. `domain/stateMachine.json` is generated by `app/scripts/generate-state-machine.mjs` and the same JSON is pasted into flow F1's `Compose` — one definition, two consumers. A status added as data would have no defined transition from or to anything, and CLAUDE.md rule 1 means nobody may write it by hand. Adding a status is a design change to the state machine, correctly |
| `eng_transactiontype` | Same reason, from the other axis. Each type has specific behaviour in F1 — which fields it writes, which relationships it closes |
| `Lifecycle` — Active / Retired | Binary and load-bearing in nearly every query. A third value would silently change the meaning of every "Active assets" count in the reports |
| The three security roles | Dataverse security roles are solution artefacts by nature. Role *assignment* is already data (Entra groups + the office→admin mapping), which is the part that needed to be dynamic and already is |

---

## D. Employees — "add new employees" has a real obstacle

### D1 · S1 · Identity is Entra, and the app cannot mint an identity

CLAUDE.md is explicit: *"Users (custodian, performed by) are the built-in `systemuser` table — do
**not** create a staff table."* A `systemuser` row appears when an Entra account is licensed and
assigned a security role. **Adding an employee is a tenant-administration action** — Entra account,
Power Apps licence, security group — and cannot be done from a Code App by an office admin.

So "ability to add new employees" has to resolve into one of three quite different things, and they
are not interchangeable:

1. **Manage app-relevant attributes of existing staff** — home office, which offices they administer,
   role. The office→admin half already exists (`setOfficeAdmins`); home office does not, and it is
   used by the "Available here" filter and by calibration reminders.
2. **Onboarding checklist** — the app shows what an admin must ask IT to do, and reflects the state
   once done. Honest, and no licence implications.
3. **Custodians who are not system users** — a subcontractor or a labourer who can *hold* equipment
   but never signs in. This is the one that genuinely needs a new table, and it directly contradicts
   the CLAUDE.md rule above, so it is Jay's call, not a design decision.

**This interacts with unresolved Q17** (per-app vs Premium licensing, roughly 4× the programme's
dominant cost). If not every technician gets a licence, option 3 stops being optional — you cannot
record custody for a person the system has no row for. **Q17 now blocks more than budgeting.**

### D2 · S2 · Administrators are added by typing an email address

`OfficeAdminsPage` takes a free-text UPN (`docs/12-ui-spec.md` § 5.16; gap G-18). A typo produces an
office whose administrator does not exist — and `docs/03-automation.md` F3 reports an office with *no*
administrator as a gap, but an office with a **misspelled** one looks correctly configured and silently
sends calibration reminders nowhere. Same failure the per-office Entra groups were dropped to avoid.

---

## E. Admin UX — what a full-control console is missing

Findings A–D are capability gaps. These are experience gaps, and they are why "admin should have full
control" cannot be delivered by adding buttons to the current screen.

| # | Sev | Finding |
|---|---|---|
| E1 | **S1** | **There is no admin console.** `S13 Admin home` is one action (New asset), three links, and two pilot-period queues whose copy is developer-facing (FR numbers, "Q3" — gap G-19). It is a launcher, not a workspace |
| E2 | **S1** | **An admin gets the field technician's screens.** There is no entity list, no multi-column table, no sort, no column chooser, no saved view, no export. An office admin auditing 1,026 assets uses the same 390 px search box and grouped result list as a technician looking for one logger |
| E3 | **S2** | **No bulk operations at all.** Every correction is one asset at a time. The migration left 35 temporary tags and a return-sweep list; both are worked one row per submit. A bulk edit is the single highest-value admin affordance and nothing in the spec mentions one |
| E4 | S2 | **No change history for reference data.** Auditing is specified for `eng_asset`, `eng_assetrelationship` and `eng_calibrationrecord` (`docs/05-security.md`) — **not** for the reference tables. Once an admin can rename a model or re-parent an office, "who changed this and when" becomes unanswerable at exactly the moment it starts to matter |
| E5 | S2 | **No usage count before a destructive reference edit.** Renaming or deactivating a category that 300 assets point at should say so first. Nothing computes that today |
| E6 | S3 | **Reference data has no home in the IA.** Adding four CRUD areas (categories, locations, models, projects) to a screen that is already a card stack will not scale; this needs a nav region, not more cards |
| E7 | S3 | **No empty states for admin-created things.** Every list in the app assumes migrated data exists. A freshly created category with no models, or a new office with no assets, has no designed state |

---

## F. Recommendation — one hierarchical category table

**Follow the `eng_location` precedent exactly.** Locations are already a single self-referential,
hierarchical, admin-managed table with N levels, and Jay approved that shape on 2026-09-02. Categories
should be the same table shape rather than a second, different mechanism:

```
eng_category  (self-referential, hierarchical, admin-managed)
  eng_name           Text        primary
  eng_parentcategory Lookup → eng_category
  eng_isactive       Yes/No
  eng_sortorder      Whole number
```

Root rows are what `eng_assetgroup` holds today (Seismographs, Communications, … Vehicles); their
children are what `eng_equipmenttype` holds (DataLogger, Geophone, … PickupTruck). `eng_equipmentmodel`
replaces its two choice columns with **one lookup to the leaf category**, and the group is derived by
walking up — the same way an asset's region is derived from its office today.

**Why one hierarchy rather than two flat tables:** it is the pattern already in the system, already
understood, already tested; it makes a third level possible without another schema change; and it means
one admin screen instead of two.

**The consequence to accept:** `getFleetCounts` currently returns `byAssetGroup` and `byEquipmentType`
as flat `Record<string, number>` (`types.ts:235-236`). Against a hierarchy these become "count by
level-1 ancestor" and "count by leaf", which is a real change to the reporting domain and its tests.
Cheaper now than after Power BI is authored against the flat shape.

> **Approved 2026-09-03.** Jay chose the hierarchy over two flat tables. `eng_category` is now in
> `docs/01-data-model.md`, `eng_equipmentmodel`'s alternate key becomes
> `manufacturer + model + eng_category`, and the `getFleetCounts` reporting change is carried in WS-L.

---

## G. Recommendation — three surfaces, not two

Jay's decisions of 2026-09-03 stack: mobile is a field slice, and desktop splits into user and admin.

| Surface | Who | What it is |
|---|---|---|
| **Field** (mobile, < 768 px) | Field technician | Already specified — `docs/02-app.md` § Surfaces. Find, check out, return, transfer, report fault, deploy/recover, reserve. Unchanged by this audit |
| **Desk** (desktop, user) | Anyone, at a computer | The field workflows at full width, plus the read-heavy screens a technician legitimately needs but cannot use one-handed: full asset history, calibration due, sites, the four reports |
| **Console** (desktop, admin) | Office Admin, System Owner | Reference-data CRUD, employees, bulk operations, the field-completion and return-sweep queues, audit history, reservation calendar. **A workspace with its own IA** — persistent left nav of entity types, list-and-detail, table-first |

**Console is not "Desk plus extra buttons."** Its primitives are different: Desk is
find-one-thing-and-act; Console is see-many-things-and-change-them. That difference is E2, and it is
why the mechanism has to be a distinct layout, not a role flag on the existing screens.

The route manifest from WS-J carries this with no new mechanism — `surfaces` becomes
`("field" | "desk" | "console")[]` instead of `("mobile" | "desktop")[]`. **This should be settled
before WS-J is built, because it changes that manifest's shape.**

---

## H. What this changes in the existing docs

| Doc | Change |
|---|---|
| `docs/01-data-model.md` | `eng_category` (if § F is approved); B1–B7 choice sets become tables or stay, per Jay |
| `docs/02-app.md` | § Surfaces becomes three surfaces, not two |
| `docs/05-security.md` | Auditing extended to the reference tables (E4); reference-data CRUD is already granted to Office Admin, so no role change needed |
| `docs/12-ui-spec.md` | A whole new screen family for Console. G-22 (no desktop screens to design against) widens |
| `specs/REMAINING-WORK.md` | WS-J's manifest becomes three-valued; a new workstream for the admin console |
| `CLAUDE.md` | Rule 4 ("reference data is picked, not typed") stays true and gains a clause: *and is maintained in the app, not in a CSV* |

## I. Answered by Jay, 2026-09-03

All five settled the same day this audit was written. Recorded in `docs/08-decisions.md`; the schema is
in `docs/01-data-model.md`.

| | Question | Answer |
|---|---|---|
| **§ F** | One hierarchical `eng_category`, or two flat tables? | **One hierarchical table.** Roots = former asset groups, children = former equipment types; `eng_equipmentmodel` takes one lookup to the leaf |
| **§ D1** | Which meaning of "add an employee"? | **Attributes of existing staff only** — home office, offices administered. No staff table, no onboarding checklist, no non-user custodians. **Q17 coupling stays live**: per-app licensing would force the third option |
| **B1** | Sensor roles become N? | **Yes**, by decomposition — fixed role *types* plus `eng_kitroleindex` 1..N. `ASSUMED, pending Jay` on the decomposition itself |
| **B2–B7** | All become tables, or only the volatile ones? | **`eng_carrier` and `eng_retirementreason` only.** The other six stay closed unions — stable vocabularies, and the aggregate cost is not small |
| **§ G** | Three surfaces? | **Confirmed** before WS-J was built, so the route manifest gets the right shape first time |

Still open and now more sharply coupled: **Q17** (per-app vs Premium licensing). It was a budgeting
question; § D1's answer makes it a schema question too.
