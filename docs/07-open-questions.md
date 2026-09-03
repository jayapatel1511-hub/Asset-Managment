# 07 — Open questions (need Jay, not a guess)

**Status legend** (added 2026-09-02): **RESOLVED** = Jay decided, recorded in `docs/08-decisions.md`.
**PROCEEDED ON** = built on the recorded recommendation under the System Owner's one-time waiver,
marked `// ASSUMPTION` in code — needs confirming or reversing, not deciding from scratch. **OPEN** =
nothing built depends on it yet. Full reasoning per question: `specs/clarifications.md`.

Blocking Step 1–2:

1. **SWO.** Is SWO an office (assets physically at one place) or a region containing London / Kitchener / Waterloo /
   Stoney Creek? 113 rows say "SWO", 155 say one of the four towns. Proposed: Region *SWO* → Offices *London, Kitchener,
   Waterloo, Stoney Creek*; the 113 "SWO" rows get homeoffice = **London** unless told otherwise. Confirm or correct.
   **RESOLVED 2026-09-02** — neither: the hierarchy takes N offices, admin-managed and re-parented in-app. All ten
   source values seeded flat under Ontario with no inference; SWO re-parented on a screen afterwards.
2. **Mississauga / Thunder Bay.** Mississauga (22 rows) under Toronto? Thunder Bay (3 rows) under Sudbury, Ottawa, or its own?
   **RESOLVED 2026-09-02** — dissolved by Q1: seeded flat under Ontario, re-parented by an admin when known.
3. **"Deployed or NOT Available" (644 rows).** Migrate as *CheckedOut* with custodian = null (we don't know who/where),
   or as *Available* and let the first real transaction fix it? Proposed: CheckedOut, and the Ottawa pilot includes
   a one-week "return everything you're not holding" sweep.
   **RESOLVED 2026-09-02** — CheckedOut with no custodian, plus the pilot sweep (feature 002 FR-015a supplies the list).
4. **Equipment model catalogue.** `data/reference/equipment_models_draft.csv` has 65 rows straight from the data, including
   the mislabels. Please correct in place (especially: Larson Davis 831C tagged as `DST-LD`; Instantel "Series IV"
   as manufacturer; Sigicom V12 listed as Data Logger 4×). Add default calibration interval per model (12 months for
   Instantel/Sigicom sensors and loggers? SLMs?).
   **DONE 2026-09-02, awaiting read-through** — 35 of 64 rows corrected and intervals set; review
   `migration/reports/03_models_review.md`. A hard gate before the production load, not a build blocker.

Before Step 4:

5. **Microphone components.** Does an SLM (S50 / 831C) travel as one asset, or do pre-amp and element get their own
   Asset IDs (they are calibrated separately)? Proposed: own IDs, attached as *Component* children.
   **RESOLVED 2026-09-02** — own Asset IDs, permanent Components. Fleet is roughly 1,150. See Q18 for the consequence.
6. **Servers (16 × "Azure" / THOR / Vision / INFRANet).** Are these really trackable assets, or configuration? Proposed:
   keep as assets, type Server, non-serialised, never checked out — only referenced as Kit role *Server* on a Deploy.
   **PROCEEDED ON 2026-09-02** — 13 `Microsoft/Azure` rows excluded as configuration; 3 named appliances kept as Server.
   Confirm.
7. **SIMs.** Is a SIM ever moved between modems, or does it live in one modem permanently? Decides whether it is a
   *Component* child of the modem (permanent) or a *Kit* member (per deployment).
   **RESOLVED 2026-09-02** — permanent Component of its modem; never in a picker; admin attach/detach for a rare swap.
8. **Expected return.** Required on checkout, or optional? Drives F4 overdue notifications.
   **PROCEEDED ON 2026-09-02** — optional, prefilled at +14 days, editable. Confirm.
9. **Backdating.** Can Office Admins record a transaction with a past date (e.g. entering last week's return)? Proposed yes,
   Office Admin only, max 30 days back. **OPEN** — no backdating is built; the recommendation also refuses a
   backdated transaction that would land before an existing one for the same asset.

Unnumbered items proceeded on during the build (recorded in `docs/08-decisions.md`, confirm or reverse):

- **Inactive-project rule** (feature 003 FR-027): refuse outright, or warn and permit late charges? **PROCEEDED ON**: refuse outright.
- **Calibration reminder cadence** (feature 004 US4): daily, weekly, or once per threshold? **PROCEEDED ON**: once per threshold crossing.
- **Site coordinates** (feature 005 FR-006): device capture, hand entry, or both? **PROCEEDED ON**: hand-entered with optional device capture.

Before Step 6:

10. **Project master.** Is there a system (ERP / Deltek / Vision) we can export active project numbers from, or do we
    seed from the ~80 distinct IDs in the registry and let admins add? **OPEN** — seeded from the 79 distinct IDs meanwhile.
11. **Who gets Power BI Pro?** List of managers/PMs who need reports. **OPEN** — also decides whether readers are free on
    a Fabric F64+ capacity or need Pro each (`docs/10-integration.md` § Licensing).

Later:

12. French labels — needed for Ontario users, or only if the system expands to Quebec? **OPEN** (Phase 3; strings are
    already in a string table).
13. Retention: keep Retired assets and their history forever (recommended) or archive after N years?
    **RESOLVED 2026-09-02** — indefinite.

Synthetic dataset (`specs/007-synthetic-data/spec.md`) — none of these block local build; Q14 blocks its Dev load only:

14. **Synthetic data in Dev.** May the synthetic fleet (fictional assets, twenty years of fictional history, every row
    marked with its seed) be loaded into `Englobe-AMS-Dev` to exercise flows F1–F5 and the Power BI model, and may it
    be bulk-removed by its marker afterwards? `CLAUDE.md` requires asking before anything deletes data in Dev.
    Production is excluded outright by the spec.
15. **Fictional identities.** The roster is fictional and checked against the registry's Staff column, but it cannot be
    checked against the whole organisation. Use `@englobecorp.com` (matches the three demo identities the app already
    has) or a placeholder domain? Proposed: real domain.
16. **Catalogue extension.** The real catalogue has 232 SIMs and no modem, yet the decided pattern is "SIM is a permanent
    Component of its modem". May the synthetic catalogue add one real, commonly paired modem model, marked in its
    manifest? Proposed: yes; alternatively an admin adds the real modem models to `equipment_models.csv` first.
    *(Q15 and Q16 were proceeded on their recommendation by the WS-G session on 2026-09-02; confirm.)*

Added 2026-09-02 by the spec review:

17. **Licensing: per-app or Premium for code apps?** The code-apps documentation says every end user needs Power Apps
    Premium; the Dataverse licensing documentation says "per app or per user". Roughly four times the programme's
    dominant cost (about $5 vs $20 per user per month across ~45 users). Sat as an OPEN row in `docs/08-decisions.md`
    with no owner. **OPEN** — needs the reseller in writing before Step 0 commits to a count.
18. **How does a permanent component get to the lab without its parent?** Q5 says the SLM pre-amp and element are
    calibrated separately with their own due dates; Q7 says a SIM is a permanent Component; feature 003 FR-032 says a
    component carries no transaction lines of its own. Nothing says how a pre-amp is despatched to Montreal while its
    meter stays in Ottawa. Proposed: allow exactly the SendToCalibration / ReturnFromCalibration pair on a component,
    and suspend parent-to-component mirroring while it is InCalibration. Alternative: admin detach → despatch →
    re-attach, three steps per routine event. **OPEN** — marked in 003 FR-032b, 004 FR-021, 007 FR-019.

Added 2026-09-03 by the mobile/desktop split and the vehicles decision (`docs/08-decisions.md`):

19. **Do vehicles need attributes that equipment does not?** Trucks are now ordinary assets and deliberately added
    **no columns** — VIN in `eng_serialnumber`, plate in `eng_identifiervalue`. Three candidates were left out
    because they were not asked for, and each is cheap now and awkward later:
    (a) **odometer reading at checkout and return** — a whole-number field on `eng_transactionline`, which is the
    only place it can honestly live (it is a fact about a movement, not about the asset);
    (b) **safety-inspection / registration due date** — structurally identical to `eng_nextcaldue`, so it could
    reuse the calibration machinery (F2, F3 reminders, the compliance report) with a renamed label, or get its own
    pair of columns;
    (c) **insurance expiry**. Proposed: (a) yes if anyone will actually read the numbers, (b) reuse the calibration
    machinery rather than duplicate it, (c) no — that is a fleet-administration fact, not an asset-tracking one.
    **OPEN** — nothing built depends on it.
20. **Reservation override and no-show policy.** Three sub-questions the design cannot invent:
    (a) **Who may cancel or override someone else's booking?** Proposed: Office Admin and above, reason required
    (`eng_cancelreason` already exists for it). A field user cancels only their own.
    (b) **What happens to a no-show?** A Confirmed booking whose window passes with no checkout goes `Expired` and
    the count is reported (F7). Should the asset be freed earlier than `endtime` — e.g. 2 h after `starttime` — so a
    truck is not held all day by someone who never collected it? Proposed: yes, with an admin-set grace period,
    following the N-offices precedent that the number is configuration rather than code.
    (c) **Is a booking per asset, or per model pool?** Today it is per asset: you book *truck DL-… specifically*.
    "Any pickup at Ottawa on Tuesday" is a different and more useful request, and a bigger build (allocation at
    pickup time, not at booking time). Proposed: per asset for Phase 1, pooled bookings recorded as a known
    follow-on. **OPEN** — (a) and (b) block F6/F7's README; (c) blocks nothing yet but changes the table if answered
    late.

Added 2026-09-03 by the UX audit (`docs/17-ux-audit.md` § I):

21. **Category shape.** `eng_assetgroup` and `eng_equipmenttype` are global option sets, so adding a category
    is a solution deployment, not an admin action — incompatible with "ability to add that category". They have
    to become rows. Two shapes: **(a) one hierarchical `eng_category`** (self-referential parent, roots = today's
    asset groups, children = today's equipment types), which is exactly the `eng_location` pattern already
    approved and understood, allows a third level later, and needs one admin screen; or **(b) two flat tables**,
    a smaller change to the reporting domain. Proposed: (a). Either way it **adds a table**, which CLAUDE.md
    gates on your approval, and either way `getFleetCounts`'s flat `byAssetGroup`/`byEquipmentType` shape changes
    — cheaper before Power BI is authored against it than after. **RESOLVED 2026-09-03** — (a), one
    hierarchical `eng_category`. Recorded in `docs/08-decisions.md`; the table is in `docs/01-data-model.md`.
22. **What does "add new employees" mean?** Identity is Entra: a `systemuser` row exists because an account was
    licensed and given a role, and a Code App cannot mint one. So this resolves to one of three things, which are
    not interchangeable: **(a)** manage app-relevant attributes of existing staff — home office (used by the
    "Available here" filter and by calibration reminders) and which offices they administer; **(b)** an onboarding
    checklist that shows what IT must do and reflects it once done; **(c)** custodians who are **not** system
    users — a subcontractor who can hold equipment but never signs in. (c) needs a table CLAUDE.md currently
    forbids ("do **not** create a staff table"), so it is your call rather than a design decision. Proposed:
    (a) now, (b) if useful, (c) only if needed — **but Q17 may force (c)**: if not every technician gets a
    licence, custody cannot be recorded for a person the system has no row for.
    **RESOLVED 2026-09-03** — (a) only. No staff table, no onboarding checklist, no non-user custodians;
    CLAUDE.md's "do not create a staff table" stands. **The Q17 coupling is still live**: if licensing lands
    per-app and some technicians get no licence, (c) stops being optional and this answer must be revisited.
