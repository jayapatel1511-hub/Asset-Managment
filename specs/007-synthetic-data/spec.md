# Feature Specification: Synthetic Fleet History

**Feature Branch**: `007-synthetic-data` (directory-selected; set `SPECIFY_FEATURE=007-synthetic-data`)

**Created**: 2026-09-02

**Status**: **Built** 2026-09-02 (WS-G). Generator `app/scripts/synthetic/`, inputs `data/synthetic/`, output `migration/synthetic/<profile>/`, reports `migration/reports/07_synthetic_<profile>_report.md`. All three profiles (`demo`, `standard`, `large`) pass every check, determinism included; US1–US4 delivered, US5 still blocked on Q14. **No plan.md** — the spec was implemented directly. Open: Q14 (US5 only), Q18 (implemented on the no-lines reading, see FR-019). Q15 and Q16 proceeded on their recommendation. Amended 2026-09-02 twice: after spec review (US3, US4 citation, FR-010a (new), FR-019, FR-026, FR-039, FR-041, FR-049, FR-060, SC-005, Key Entities) and after the build (volume table, SC-003, FR-019, this line) — re-read before relying on an earlier copy

**Input**: User description: "write synthetic data spec — have at least 20 years of historic data and
5 years of data for stuff in use". Context: `docs/00-brief.md` (the seven acceptance questions),
`specs/006-fleet-reporting/spec.md` FR-027/FR-028 and SC-010, `docs/10-integration.md` § "Never push
with the mock backend", `docs/09-build-report.md` (what the real migrated dataset can and cannot show).

## Why this feature exists

The real migrated dataset is honest and therefore thin. Every one of its 1,026 assets has exactly one
transaction line, dated the migration day. Nothing in it can show a technician a timeline, a manager a
utilisation chart, a report author a compliance pack for a finished project, or a flow developer an
overdue return. Feature 006 refuses, correctly, to compute utilisation across that boundary (FR-028),
so the utilisation screens and the Power BI utilisation page cannot be demonstrated or tested at all
until years of live use have accumulated.

The real dataset is also unpublishable: it carries SIM ICCIDs, phone numbers and static IPs. A demo
build, a training environment or a shared screenshot must never be made from it.

This feature specifies a **fictional fleet with a fictional twenty-year history** that is shaped
exactly like the real one, is valid under every rule the system enforces, contains nothing real, and
is impossible to mistake for real data. It exists to be demonstrated, tested against, trained on and
loaded into development environments. It never touches production.

## Interpretation of the brief

The request names two horizons. This specification reads them as two tiers of one continuous
history, both measured back from a chosen **as-of date** (default: the date of generation):

| Tier | Window | What it contains |
|---|---|---|
| **Deep history** | at least 20 years before as-of → as-of | Every asset the fictional company ever owned: acquisition, every status change it ever had, calibrations, transfers, faults, losses, retirements, annual stocktakes. Complete, but at a lower per-asset activity rate. |
| **Operational detail** | at least 5 years before as-of → as-of | Full-fidelity day-to-day use of everything in service: every checkout and return, every deployment to a site and recovery, every calibration despatch, at realistic frequency, by named (fictional) people on named (fictional) projects. |

"Stuff in use" is read as **every asset that is Active at the as-of date**. An asset acquired five or
more years before as-of therefore carries at least five years of detailed operational history; one
acquired later carries detailed history from its acquisition. Both horizons are parameters with these
defaults, not constants.

The tiers differ only in activity rate. In both, every status an asset ever held has the transaction
that put it there. There is no period in which the fictional company "was not keeping records" — that
is the pathology this whole system exists to end, and the synthetic history must not reproduce it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Demonstrate and test the app against a fleet with a past (Priority: P1)

A technician, an admin or a manager opens the app loaded with the synthetic dataset and finds a fleet
that behaves like a real one that has been running for twenty years: loggers with dozens of
deployments, a geophone that has been to four sites this year, a sound level meter with fourteen
calibration certificates, a Minimate Plus retired in 2019 after thirteen years, an asset that went
missing and was found, a site with three installations across two projects. Every screen that shows
history has history to show. Every report that needs a year of data has twenty.

**Why this priority**: This is the reason the feature exists. Nothing else in the programme can show
the history-dependent screens (asset timeline, site history, utilisation, compliance) doing what they
are for, and the sales, training and acceptance conversations all need to see them doing it.

**Independent Test**: Load the dataset into the app's mock backend. Open any active data logger:
its history spans at least five years and includes deployments, recoveries, calibrations and
checkouts. Open the utilisation view for the five years before as-of: it computes a figure rather
than reporting insufficient history. Open a site: it lists past and current installations with
dates. Every page carries the synthetic-data indicator.

**Acceptance Scenarios**:

1. **Given** the synthetic dataset, **When** any Active asset acquired at least five years before
   as-of is opened, **Then** its history contains transactions in every year of the five-year detail
   window, newest first, each with date, type, from, to and performer.
2. **Given** the synthetic dataset, **When** the utilisation view is opened for the five years before
   as-of, **Then** it presents a figure by equipment type and office rather than stating history is
   insufficient.
3. **Given** the synthetic dataset, **When** the earliest transaction in the whole dataset is found,
   **Then** it is dated at least twenty years before as-of.
4. **Given** a retired synthetic asset, **When** its timeline is opened, **Then** the full history
   from acquisition to retirement is present, and the asset is absent from every current count.
5. **Given** any screen or report, **When** it renders synthetic data, **Then** a visible indicator
   states the data is synthetic and names the generation seed and as-of date.
6. **Given** the seven acceptance questions from `docs/00-brief.md`, **When** each is asked of the app
   against the synthetic dataset, **Then** each is answerable, including question 7 for a date ten
   years before as-of.

---

### User Story 2 - Verify reports against a known answer (Priority: P2)

A report author building the Power BI visuals, or a developer writing a reporting test, needs to know
what the right answer is. The dataset ships with an **answer key**: for a set of probe assets, probe
dates and probe projects, the counts and states the seven acceptance questions should return,
computed by the generator from its own model of events — independently of the application's replay
logic — so that the two can be reconciled and any disagreement is a finding.

**Why this priority**: Feature 006's SC-003 demands that every reported figure reconcile exactly with
the operational data. Against the real dataset that reconciliation is trivial (one line per asset).
Against twenty years of history it is the whole test, and it cannot be run without an independent
source of truth. This is also what lets the Power BI semantic model be validated offline, which its
own README says it currently cannot be.

**Independent Test**: For every probe in the answer key, compute the same answer through the
application's own point-in-time and aggregate logic. Zero discrepancies. Repeat against the Power BI
model once it is bound to the dataset.

**Acceptance Scenarios**:

1. **Given** the answer key, **When** a probe asset's state at a probe date is reconstructed by
   replaying its history, **Then** status, location, custodian, project and parent match the key.
2. **Given** the answer key, **When** fleet counts by office, asset group and equipment type at as-of
   are computed from the dataset, **Then** they match the key.
3. **Given** the answer key, **When** calibration due, due-soon and overdue counts per office at
   as-of are computed at 30, 60 and 90 day horizons, **Then** they match the key.
4. **Given** a probe project in the key, **When** the assets assigned to it at as-of and the assets
   ever used on it are listed, **Then** both lists match the key.
5. **Given** a probe site and date, **When** the installed composition and configuration as at that
   date is reconstructed, **Then** the components, roles and orientations match the key.
6. **Given** the dataset is regenerated with the same seed and parameters, **Then** the dataset and
   the answer key are byte-identical to the previous generation.

---

### User Story 3 - Prove the system scales (Priority: P3)

Feature 006 sets a performance target of 5,000 assets and 100,000 transaction lines with report load
under ten seconds (SC-010). The app's search, history and reporting paths have only ever seen 1,026
assets and 1,026 lines. A scale parameter produces datasets large enough to find out, with the same
shape and the same validity guarantees.

**Why this priority**: A performance problem found before the tenant exists is a design change; one
found in the Ottawa pilot is an incident. Below US1 and US2 because it needs them to exist first.

**Independent Test**: Generate at the large profile. Search, asset detail with history, the
calibration due list and each report view are timed against it and the timings recorded.

**Acceptance Scenarios**:

1. **Given** the large profile, **When** generation completes, **Then** the dataset holds at least
   5,000 Active assets and at least 100,000 transaction lines, and passes every validity check that
   the default profile passes.
2. **Given** the large profile served from static files (FR-060), **When** an asset with the most
   history is opened, **Then** its detail and timeline render within the feature 006 SC-010 budget.
3. **Given** the large profile, **When** each report view is opened, **Then** the load time is
   recorded and compared with SC-010, and any breach is reported as a finding rather than hidden.
4. **Given** the large profile, **When** a browser cannot load it at all, **Then** that is recorded as
   the first US3 finding, and the SC-010 timings are taken against the reporting extract (FR-059)
   and, once available, the development environment (US5) instead.

*Sizing note (2026-09-02)*: lines scale with assets, so `large` is roughly four times `standard` — on
the order of 600,000 lines and 260 MB of JSON at the row sizes measured in Assumptions. Whether a
browser holds that is itself a question this story answers; the profile exists as much for FR-059 and
US5 as for the app.

---

### User Story 4 - Train and test against planted situations (Priority: P4)

Training scripts, acceptance walkthroughs and edge-case tests need specific situations to exist at
known, stable Asset IDs: an overdue calibration at every office, a checkout whose expected return
passed months ago, a station half-recovered from site, a component swapped mid-installation, a
missing asset, a temporary-tagged asset never completed, an asset noted as owned by a third party, an
asset holding at an office that is not its home office, an office with no administrator. Randomness
would eventually produce most of these; training needs them on demand and at the same address every
time.

**Why this priority**: These are the situations the system's honesty rules exist for (feature 006's
edge cases, feature 005's FR-030 and FR-015, feature 004's FR-003). A trainer who cannot find one during a
session teaches the happy path only.

**Independent Test**: Every planted scenario in the manifest is opened at its documented Asset ID (or
site, project or office) and shows the described situation at as-of.

**Acceptance Scenarios**:

1. **Given** the manifest's planted-scenario list, **When** each entry is opened at its documented
   identifier, **Then** the described situation is present at as-of.
2. **Given** a regeneration with the same seed, **When** the planted identifiers are opened again,
   **Then** they are unchanged.
3. **Given** the planted scenarios, **When** the fleet is otherwise inspected, **Then** they read as
   ordinary members of the fleet, not as an appendix of test cases.

---

### User Story 5 - Exercise the flows and the Power BI model in a development environment (Priority: P5)

Once the development Dataverse environment exists, the synthetic dataset is loaded into it through
the same loader the migration uses, so that flows F1 to F5 process realistic volume, calibration and
overdue-return reminders have something to remind about, and the Power BI project can be bound to
data with twenty years of depth before any production history exists.

**Why this priority**: Genuinely valuable and genuinely tenant-bound. Nothing about it can be verified
in a session without a tenant; it is specified so that the dataset is built loadable from the start
rather than retrofitted.

**Independent Test**: Load into the development environment. Every synthetic row is identifiable as
synthetic; the flows process the load without illegal-transition rejections; a subsequent removal of
every synthetic row leaves the environment as it was.

**Acceptance Scenarios**:

1. **Given** the development environment, **When** the synthetic dataset is loaded, **Then** every
   loaded asset, transaction, project, site and calibration record carries a marker identifying it as
   synthetic and naming the generation seed.
2. **Given** the loaded dataset, **When** flow F1 processes its lines, **Then** zero lines are
   rejected as illegal transitions.
3. **Given** the loaded dataset, **When** the synthetic rows are removed by their marker, **Then**
   no synthetic row remains and no non-synthetic row was touched.
4. **Given** the production environment, **When** a load is attempted against it, **Then** the loader
   refuses.
5. [NEEDS CLARIFICATION: Q14 — may the synthetic dataset be loaded into `Englobe-AMS-Dev` at all, and
   may it be bulk-removed afterwards? `CLAUDE.md` requires asking before anything that deletes data in
   Dev. This gates US5 only; US1 to US4 are entirely local.]

### Edge Cases

- **Two events for one asset at the same instant.** Replay sorts by timestamp; a tie makes the order,
  and therefore the reconstructed state, ambiguous. Must not occur.
- **Timestamps that do not sort chronologically as text.** The application orders history by comparing
  timestamps as strings. Mixed time-zone offsets, which the Toronto clock changes twice a year, break
  that ordering around the changeover. Every timestamp must be in one uniform form.
- **An asset acquired before its model existed.** A fleet in which a 2013 product was bought in 2006
  is fiction of the wrong kind. Each model carries an availability window.
- **A person who left the company while still holding assets.** Realistic, and exactly what a manager
  needs to see. Planted deliberately, once; otherwise people return what they hold before they leave.
- **A project that closed while assets were still deployed on it.** The application refuses new
  assignments to a closed project but cannot un-deploy a station. Planted deliberately.
- **A site name reused across two projects.** Site is a location; two projects at one site over the
  years is ordinary. Site history must show both.
- **A shared serial between a logger and its sensor.** The real fleet has 132 of these and the
  constitution's Principle III is built around them. The synthetic fleet must have them in proportion.
- **A permanent component transacted on its own.** Forbidden by feature 003 FR-026. The generator must
  never emit one; components follow their parent and carry no lines of their own beyond registration.
  *Pending Q18, the one candidate exception is the calibration despatch pair — see FR-019.*
- **A kit child with two open attachments.** Forbidden by feature 003 FR-030. Must not occur.
- **A calibration recorded as Failed.** The next-due date must not advance (feature 004 FR-016), and
  the asset's subsequent history must be consistent with a failed instrument.
- **An idle asset.** Utilisation reporting must have idle stock to find (feature 006 FR-024). A dataset
  in which everything is always busy is as misleading as one in which nothing is.
- **Regeneration producing a different dataset.** Any test or training script that names an Asset ID
  breaks. Determinism is a requirement, not a convenience.
- **The synthetic dataset mistaken for the real one**, in a screenshot, a demo or a development
  environment. This is the failure mode with the worst consequences and it is addressed at every layer:
  in the data, in the app, in the loader.
- **The dataset silently replacing the real migrated data** as the app's default. The real data stays
  the default; synthetic is opt-in.
- **Fabricated history attached to real assets.** Out of scope by design (see Assumptions). A real
  Asset ID with invented transactions in a development environment is indistinguishable from fact.

## Requirements *(mandatory)*

### Functional Requirements

**Provenance and safety**

- **FR-001**: The dataset MUST contain no value copied from the source registry, the calibration
  history, or the migrated dataset for any of: Asset ID, serial number, secondary identifier, phone
  number, static IP, staff name, project number, project name, site name or free-text note.
- **FR-002**: Every Asset ID, serial number, project number and project name in the dataset MUST be
  disjoint from every value present in the real migrated dataset, verified at generation and reported.
- **FR-003**: Every person in the dataset MUST be fictional, drawn from a committed roster, and no
  fictional name MUST match any staff name present in the source registry.
- **FR-004**: Every secured attribute (SIM ICCID, phone number, static IP) MUST be format-valid and
  drawn only from ranges reserved for fiction or documentation, so that no value can belong to a real
  subscriber or host.
- **FR-005**: Every asset MUST carry a machine-readable marker in its migration-source attribute
  identifying it as synthetic and naming the generation seed. Every transaction header, project,
  site and calibration record MUST carry an equivalent marker in an attribute the loader can select on.
- **FR-006**: The dataset MUST include a manifest stating: that it is synthetic, the generator
  version, the seed, every parameter value, the as-of date, generation time, row counts per table, and
  the planted-scenario index (FR-050).
- **FR-007**: The application, when loaded with a dataset whose manifest declares it synthetic, MUST
  display a persistent indicator on every screen naming the seed and as-of date. The absence of a
  manifest MUST be treated as real data.
- **FR-008**: The real migrated dataset MUST remain the application's default. Selecting the synthetic
  dataset MUST be an explicit, per-environment choice.
- **FR-009**: The loader MUST refuse to load the synthetic dataset into any environment other than a
  development environment, and MUST refuse to load it into an environment that already contains rows
  from a different synthetic seed unless told to remove those first.
- **FR-010**: The generator MUST NOT read, and the dataset MUST NOT depend on, the source exports
  under `data/source/` except to perform the disjointness checks of FR-002 and FR-003.
- **FR-010a**: Synthetic outputs MUST NOT reach a release bundle any more than the real staged data
  may. The release build's bundle scan (feature 008 FR-002 and FR-003) MUST cover the synthetic
  output paths once they are fixed, and the generator MUST write its outputs only to paths that scan
  covers. Fictional or not, a dataset shaped like the fleet does not belong in a public bundle.
  *(Added 2026-09-02 at WS-H's request.)*
- **FR-010a**: Synthetic outputs MUST be excluded from any release bundle exactly as the staged real
  data is (feature 008 FR-002, FR-003), and the release-bundle scan MUST cover the synthetic output
  paths once they are settled. A fictional fleet on a public endpoint discloses nothing, but it is
  indistinguishable from a real one to whoever finds it, and it would defeat FR-007's indicator.
  *(Added 2026-09-02 at WS-H's request; WS-H extends the scanner, WS-G fixes the output paths.)*

**Shape and validity**

- **FR-011**: Every row MUST be one the application's own write path could have produced: same
  entities, same attributes, same conventions for nulls, same identifier formats, same relationship
  between a transaction header and its lines.
- **FR-012**: Every transaction line MUST describe a transition allowed by the transition matrix
  (`data/reference/state_machine.json`) for the asset's status immediately before it.
- **FR-013**: Every asset's current status, location, custodian, project and parent at as-of MUST be
  the result of replaying its transaction lines in order — derived, never assigned — and MUST equal
  what the application's own derivation produces from the same lines (feature 003 FR-035, feature 006
  SC-003).
- **FR-014**: The derivation the generator applies MUST be the system's single definition of it, or
  MUST be verified against it line for line after generation; there MUST NOT be a third, unverified
  copy of the state rules.
- **FR-015**: Every asset's first transaction MUST be an addition to inventory at its acquisition date,
  recording its home office as the destination and Available as the resulting status.
- **FR-016**: No two transaction lines for the same asset MUST share a timestamp; consecutive lines for
  one asset MUST be at least one minute apart.
- **FR-017**: Every timestamp MUST be in one uniform form whose text ordering equals its chronological
  ordering.
- **FR-018**: Every transaction header MUST be dated within working hours in the Toronto time zone for
  the vast majority of transactions, with a realistic minority outside them.
- **FR-019**: A kit child MUST have at most one open attachment at any instant; a permanent component
  MUST carry no transaction line of its own after registration and MUST mirror its parent's state.
  *Implemented on the no-lines reading, pending Q18:* a pre-amp, element or SIM carries no
  transaction line after its registration, and its calibration record is written when its parent
  goes to the lab, carrying the same date and its own certificate number. FR-034 and FR-045 are
  satisfied without a detach / despatch / re-attach sequence, and the rule is enforced structurally
  (`Ledger.apply` refuses any line naming an open component child). [NEEDS CLARIFICATION: Q18 —
  feature 003 FR-032b. If Jay confirms a component may be despatched on its own, this requirement
  must allow exactly that pair of lines on a component and must suspend parent-mirroring while it
  is in calibration; that changes the generator, not the data model.]
- **FR-020**: Each asset's last-calibration and next-due dates MUST agree with its most recent
  calibration record, and a Failed result MUST NOT advance the next-due date.
- **FR-021**: Every installation MUST have exactly one primary data logger, MUST record orientation for
  every component whose role requires it, and MUST have component spans that neither gap nor overlap
  across a swap.
- **FR-022**: The next-value sequence for every non-serialised Asset ID prefix MUST exceed every
  sequence-based Asset ID in the dataset, so a new registration in the app cannot collide.
- **FR-023**: Every stored date/time MUST be UTC; every date-only attribute MUST be a calendar date in
  Toronto local time, matching the application's conventions.

**Time horizon and density**

- **FR-024**: The earliest transaction in the dataset MUST be dated at least the configured history
  horizon (default 20 years) before as-of, and every calendar quarter between that date and as-of
  MUST contain transactions.
- **FR-025**: Every asset that is Active at as-of and was acquired at least the configured detail
  horizon (default 5 years) before as-of MUST have transactions in every year of that detail window.
- **FR-026**: At least 90% of Active, transactable assets (excluding permanent components; the three
  kept server appliances of the Q6 decision are deployed only as kit members and fall in the idle
  remainder rather than being "never transacted") MUST have at least eight transaction lines within
  the detail window. The remainder are idle stock and MUST exist.
- **FR-027**: Per-asset activity rates in the deep-history tier MUST be a configurable fraction (default
  40%) of the detail-tier rates, and MUST NOT be zero for any asset class that is transacted at all.
- **FR-028**: The fleet MUST grow over the horizon from a small initial fleet to the target size at
  as-of, with acquisitions in every year and retirements concentrated in the models whose availability
  window has closed.

**Fleet composition**

- **FR-029**: The number of Active assets at as-of MUST match the real fleet's post-decision size
  (approximately 1,150) within 10% at scale 1.0, and MUST scale linearly with the scale parameter.
- **FR-030**: The distribution of Active assets by asset group, equipment type and home office at
  as-of MUST match the real migrated dataset's distribution within 10 percentage points per category.
- **FR-031**: The equipment model catalogue MUST be the real curated catalogue. The generator MAY extend
  it only where the real catalogue has a structural gap that prevents a decided pattern from existing
  (today: no modem model, though a SIM is decided to be a permanent component of a modem), and every
  such extension MUST be listed in the manifest and MUST use a real, publicly documented product.
- **FR-032**: Every model MUST carry a configured availability window (first and optional last year of
  purchase), and no asset MUST be acquired outside its model's window.
- **FR-033**: Logger-and-sensor pairs that share a serial number in the real fleet (the Micromate
  family above all) MUST share one in the synthetic fleet, in proportion — at least 100 shared-serial
  pairs at scale 1.0.
- **FR-034**: Permanent component patterns decided in `docs/08-decisions.md` MUST exist: a sound level
  meter with its own-tagged pre-amp and element, and a SIM inside its modem or logger, each with
  their own calibration records where the real decision says they are calibrated separately.
- **FR-035**: A small number of assets (default 1%) MUST carry temporary tags never completed, and a
  small number MUST carry a note recording third-party ownership, so feature 006 FR-011 and FR-012
  have something to count.
- **FR-036**: The location hierarchy MUST be the real seeded hierarchy. Sites MUST be created only by
  deployment transactions, exactly as the application creates them. Offices MAY become active at
  configurable dates across the horizon, and no asset MUST be homed at an office before it is active.

**People, projects and sites**

- **FR-037**: The roster MUST contain fictional field technicians, office administrators and a system
  owner in the proportions `docs/00-brief.md` gives, each with an office, a role, a start date and an
  optional leave date across the horizon, so that custodianship turns over realistically.
- **FR-038**: Every roster member who leaves MUST return everything they hold before leaving, except
  the one planted exception (FR-050).
- **FR-039**: The three demo identities the application already recognises MUST be roster members, so
  that switching role in the app shows real holdings and real due lists. The system-owner demo
  identity is the real service account's address; the roster MUST carry it as a **role**, not as a
  person, and FR-001 to FR-003 apply unchanged to every other member. The fictional system owner of
  FR-037 is a separate roster member.
- **FR-040**: Projects MUST be fictional, plausible for the fleet's disciplines, carry a project number
  from a range reserved for synthetic data and disjoint from every real number, belong to an office,
  have start and end dates across the horizon, and be Closed after their end date.
- **FR-041**: At any instant in the horizon at least one project per active office MUST be Active;
  every checkout and deployment MUST name a project that is Active at that instant, and every
  transfer that names a project MUST name an Active one, except the planted exception (FR-050).
  *(Aligned 2026-09-02 with feature 003, which requires a project on checkout only — a custody-only
  transfer names none, and FR-011 forbids generating rows the application could not.)*
- **FR-042**: Sites MUST be fictional, named as an address or landmark plausible for the deploying
  office's region, with coordinates within that region, and MUST be reused across installations and
  projects over the years.

**Workflow realism**

- **FR-043**: The dataset MUST contain the canonical station job cycle at realistic frequency: a
  technician checks out a kit, deploys it to a site with roles, orientations and a power source,
  recovers it whole or in part weeks later into their own custody, and returns it to the office; with
  variants in which a station is deployed directly from the office, moved to another project without
  recovery, has a component swapped mid-installation, or has its configuration changed in place.
- **FR-044**: The dataset MUST contain standalone checkout and return of non-kit equipment, transfers of
  custody and of project, and inter-office loans in which an asset is returned to an office that is not
  its home.
- **FR-045**: The dataset MUST contain the calibration round trip at realistic frequency: despatch to a
  lab, weeks in calibration, a record with lab, certificate number, cost and result, and return to the
  home office; with a realistic result mix (mostly Pass, some Adjusted, a few Fail), calibrations
  recorded without despatch, and a realistic fraction of instruments that fall overdue.
- **FR-046**: The dataset MUST contain fault reports leading to repair, to calibration or to
  retirement; losses leading to recovery or to retirement as Lost; and retirements for every reason the
  system offers, with the reasons in realistic proportion.
- **FR-047**: The dataset MUST contain an annual stocktake per office as Audit transactions that change
  no status, with a line per asset present at the office.
- **FR-048**: Expected return dates MUST be present on a realistic majority of checkouts and absent on
  the rest, with some past due at as-of, so that overdue-return reporting has cases.
- **FR-049**: Every allowed cell of the transition matrix MUST occur at least ten times in the dataset
  at scale 1.0, except the Audit cells for statuses in which an asset is not at an office
  (CheckedOut, Deployed, InCalibration, Missing, Retired), which FR-047's stocktake cannot reach and
  which MAY be absent; zero lines MUST describe a disallowed transition. *(Amended 2026-09-02: as
  written, FR-047 and this requirement could not both hold.)*

**Planted scenarios**

- **FR-050**: The dataset MUST contain, at identifiers that are stable for a given seed and listed in
  the manifest, at least the following situations as at as-of: an overdue calibration at every active
  office; a deployed asset that is overdue for calibration; a checkout with an expected return more
  than 90 days past; a partially recovered installation; an installation with a component swapped
  mid-life; an asset Missing; an asset retired after at least fifteen years with a full history; a
  Failed calibration followed by repair; a temporary-tagged asset; a third-party-owned asset; an asset
  currently at an office other than its home; a person who left while holding assets; a project that
  closed with a station still deployed; a site with installations on two projects; a shared-serial
  logger-and-sensor pair currently at different locations; an office with no administrator assigned.
- **FR-051**: Planted scenarios MUST be produced through the same event generation as everything
  else, differing only in that their occurrence is forced, so that they are indistinguishable in form
  from emergent history.

**Determinism and parameters**

- **FR-052**: Generation MUST be deterministic: the same seed and parameters MUST produce a
  byte-identical dataset, answer key and manifest, including every surrogate identifier.
- **FR-053**: The generator MUST accept at least: seed, as-of date, history horizon, detail horizon,
  deep-tier rate fraction, scale, and profile; and MUST offer named profiles `demo` (a smaller fleet
  for a browser), `standard` (the real fleet's size) and `large` (at least 5,000 Active assets).
- **FR-054**: The generator MUST be idempotent in the migration pipeline's sense: re-running with the
  same inputs overwrites its own outputs and nothing else, and writes a report of what it produced.

**Verification and the answer key**

- **FR-055**: The generator MUST emit an answer key computed from its own event model, independent of
  the application's replay code, containing: fleet counts by office, asset group and equipment type at
  as-of; available counts by office and type; calibration in-progress, due-soon (30/60/90 days),
  overdue and unknown counts by office; for at least 20 probe assets, state at as-of and at three
  earlier probe dates including one at least ten years before as-of; for at least 10 probe projects,
  assets assigned at as-of and assets ever used; for at least 10 probe sites and dates, installed
  composition and configuration.
- **FR-056**: A verification step MUST replay every asset's lines through the application's own
  derivation and compare with the generated state (FR-013), check every invariant in FR-012 and FR-015
  to FR-023, check every distribution in FR-024 to FR-035, check every planted scenario in FR-050, and
  reconcile the answer key against the application's own logic (US2). Generation MUST fail, not warn,
  on any violation.
- **FR-057**: The verification MUST write a report stating each check, its measured value and its
  pass/fail, in the same place and form as the migration pipeline's reports.

**Packaging and loading**

- **FR-058**: The dataset MUST be emitted in the same per-table form the migration pipeline stages, so
  that the application's mock backend and the future Dataverse loader consume it unchanged.
- **FR-059**: The dataset MUST also be emitted in a form the Power BI semantic model can be bound to
  without a Dataverse connection, one table per model table with the model's column names, so that
  visuals can be authored and measures validated offline.
- **FR-060**: The dataset MUST be loadable into the mock backend at the `demo` and `standard` profiles
  without depending on browser local storage for the base data, and a user's own writes on top of it
  MUST still survive a reload. The `large` profile MUST use the same mechanism; if a browser cannot
  hold it, the loader MUST say so plainly and US3 records it as a finding — it is not a generator
  error. (See Assumptions: the current store persists the whole snapshot to local storage, which
  cannot hold this volume.)

### Key Entities *(include if feature involves data)*

This feature introduces no new stored entities. It produces rows in the existing ones — Asset,
Transaction, Transaction Line, Asset Relationship, Calibration Record, Installation, Installation
Component, Project, Location (sites) — and reads Equipment Model and the office hierarchy. Note that
Installation and Installation Component are the two tables feature 005 requested beyond
`docs/01-data-model.md`, still pending Jay's agreement (`docs/08-decisions.md`); the migration
pipeline stages no files for them, so for those two FR-058's "same per-table form" follows the
application's own types until the schema is agreed.

Two artefacts accompany the dataset and are files, not tables:

- **Manifest**: identity and provenance of one generated dataset — synthetic flag, generator
  version, seed, parameters, as-of, row counts, catalogue extensions, planted-scenario index.
- **Answer key**: the independently computed expected answers to the seven acceptance questions for
  the probes named in FR-055.

Three committed inputs drive generation and are the only place fiction is authored by hand:

- **Roster**: fictional people with office, role, start and leave dates.
- **Project and site pools**: fictional project titles by discipline and fictional site names by
  region, from which the generator draws.
- **Model availability windows**: first and optional last purchase year per catalogue model, plus any
  catalogue extension under FR-031.

## Volume at scale 1.0

**Measured** from the built generator (seed `englobe-ams-007`, as-of 2026-09-02), replacing the
pre-build estimate this section first carried. That estimate assumed 3.5 deployments per logger per
year; the simulation produces about 1.5, because instrumentation deployments last months (median
137 days, mean 183) and 61% of the fleet is Deployed at as-of — which is the real registry's own
proportion, 644 of its 1,053 rows reading "Deployed or NOT Available". The correction is to the
arithmetic, not to the data: raising the figure would mean a fleet cycling twice as fast as the
real one. Recorded in `docs/08-decisions.md`.

| Table | Measured (scale 1.0) | `demo` (0.25) | `large` (4.5) |
|---|---|---|---|
| Assets ever owned / Active at as-of | 1,459 / 1,138 | 371 / 285 | 6,626 / 5,312 |
| Transaction headers / lines | 62,969 / 91,616 | 16,836 / 23,022 | 295,355 / 438,619 |
| Installations / installation components | 8,062 / 13,246 | 2,022 / 3,138 | 39,838 / 65,550 |
| Calibration records | 7,567 | 1,877 | 34,914 |
| Projects / sites / roster | 625 / 2,542 / 123 | 260 / 686 / 123 | 2,501 / 12,069 / 123 |
| Serialised JSON, all tables | 65 MB | 17 MB | 418 MB |
| Generation time | 37 s | 3 s | 20 min |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The earliest transaction is at least 20 years before as-of; every quarter in between has
  transactions.
- **SC-002**: 100% of Active assets acquired at least 5 years before as-of have transactions in every
  year of the 5-year detail window; at least 90% of Active transactable assets have at least 8 lines in
  it.
- **SC-003**: At scale 1.0 the dataset holds at least 1,400 assets ever owned, 1,050 to 1,250 Active at
  as-of, at least 85,000 transaction lines, at least 6,000 installations, at least 7,000 calibration
  records, at least 40 roster members, at least 150 projects and at least 300 sites. At the `large`
  profile: at least 5,000 Active assets **and** at least 100,000 transaction lines — feature 006's
  SC-010 threshold, which belongs to the profile that exists to test it rather than to every scale.
  *(Amended 2026-09-02 from 100,000 lines and 8,000 calibration records: those came from this spec's
  own pre-build estimate, whose deployments-per-logger assumption was more than twice what a
  realistic deployment duration allows — see "Volume at scale 1.0" above.)*
- **SC-004**: Replaying every asset's lines through the application's own derivation reproduces its
  generated state for 100% of assets — zero mismatches on status, location, custodian, project or
  parent.
- **SC-005**: Zero disallowed transitions; every one of the 28 allowed transition-matrix cells
  reachable under FR-047 occurs at least 10 times (the 33 allowed cells minus the five Audit cells
  FR-049 exempts).
- **SC-006**: Zero timestamp ties per asset; 100% of timestamps in the uniform UTC form.
- **SC-007**: The answer key reconciles with the application's own point-in-time and aggregate logic
  with zero discrepancies, for every probe.
- **SC-008**: Two generations with the same seed and parameters are byte-identical.
- **SC-009**: Zero values in the dataset match a real Asset ID, serial, project number, project name,
  staff name, ICCID, phone number or static IP from the source or migrated data.
- **SC-010**: 100% of assets carry the synthetic marker; the manifest is present; the app shows the
  indicator on every screen when the dataset is loaded and on none when the real data is loaded.
- **SC-011**: Every planted scenario in FR-050 is present at its documented identifier at as-of, on
  first generation and after regeneration.
- **SC-012**: Distribution by asset group, equipment type and home office at as-of is within 10
  percentage points of the real migrated dataset per category; at least 100 shared-serial pairs exist.
- **SC-013**: The seven acceptance questions are each answered from the app against the synthetic
  dataset in a walkthrough, including question 7 at a date ten years before as-of, and the utilisation
  view computes for the full 5-year detail window without an insufficient-history refusal.
- **SC-014**: A user's own transaction recorded on top of the loaded `standard` dataset survives a
  reload of the application.

## Assumptions

- **Standalone, not backfill.** The synthetic fleet is fictional from the first asset. This
  specification deliberately excludes generating invented history for the 1,026 real assets: a real
  Asset ID with fabricated transactions, loaded anywhere, is a Principle II violation waiting to be
  read as fact. Composition is matched statistically (FR-030), not asset by asset.
- **Production is out of scope entirely.** No profile, flag or parameter loads synthetic data into
  production. FR-009 makes the loader refuse; this assumption makes it a requirement rather than a
  courtesy.
- **Fictional identities use the company's real e-mail domain**, following the precedent of the three
  demo identities the application already ships with, because a placeholder domain reads as broken in
  a demo. Roster names are checked against the source registry's staff column (FR-003); they cannot be
  checked against the whole organisation. Q15 asks whether Jay prefers a placeholder domain instead.
- **The catalogue extension for modems is on by default** (FR-031). The real fleet has 232 SIMs and no
  modem, yet `docs/08-decisions.md` decided a SIM is a permanent component of its modem. Sigicom D10
  loggers have an integral modem, so SIMs there are components of the logger; Micromate stations need
  an external modem. One real, commonly paired modem product is added, marked in the manifest. Q16 asks
  whether that is acceptable or whether the real catalogue should be extended by an admin first.
- **Volume forces a change to how the mock backend persists.** Measured against the staged data, a
  transaction line is roughly 300 bytes and a header roughly 430 bytes as stored. The `standard`
  profile is on the order of 140,000 lines and 47,000 headers — roughly 60 MB — against a browser
  local-storage ceiling of about 5 MB. The current store writes the entire snapshot to local storage
  on every write and silently keeps going in memory when that fails, so a reload would lose the
  user's own transactions. FR-060 and SC-014 require that the base dataset be served from static files
  and only the user's own writes be persisted, or an equivalent. This touches a file the workstream map
  treats as frozen and is therefore orchestrator work, recorded in `specs/REMAINING-WORK.md`.
- **Certificates are numbers, not documents.** Calibration records carry certificate numbers; the
  certificate link is empty, because there is no document library to point at and a placeholder link
  would be a dead one in every demo. Feature 006 FR-016 is therefore demonstrable only for the field's
  presence, not for opening a file.
- **The generator's language is a plan decision.** The migration pipeline is Python; the derivation
  logic the generator must agree with is TypeScript. Generating in TypeScript against the domain layer
  guarantees FR-014 by construction; generating in Python guarantees it only through the FR-056 replay
  verification. Either satisfies this specification; the plan chooses and records why.
- **Office activation dates are parameters with defaults, not claims about the company's history.**
  Two offices active from the start, the rest joining across the horizon, is a shape that exercises
  the N-offices decision; it is not asserted to be what happened.
- **The as-of date defaults to the generation date** so that "overdue" and "due soon" mean what they
  say when the dataset is opened; a fixed as-of is available for reproducible tests.
- Depends on 001 to 006 for every entity and rule it produces rows against. Nothing in the programme
  depends on this feature; the real migrated dataset remains the path to production. This is a
  development, demonstration and verification instrument.

## Notes for the plan

Not requirements — pointers so the plan does not rediscover them.

- Committed inputs (roster, pools, model windows) belong in a directory that cannot be mistaken for
  the real seed CSVs in `data/reference/`, which the migration loads; `data/synthetic/` is suggested.
- Outputs belong beside, not inside, `migration/staged/`, so the copy step that feeds the app can be
  pointed at one or the other and the default stays real.
- The app already treats `migrationsource` as free provenance text and already has an
  `isTemporaryAssetId` and a third-party-ownership pattern in its reporting code; the markers and
  planted notes should satisfy those existing detectors rather than introduce new ones.
- The application's point-in-time replay treats the first line's destination as the home office and
  its status as the seed; FR-015 exists so that convention holds.
- `specs/006-fleet-reporting/spec.md` SC-010 (5,000 assets, 100,000 lines, ten seconds) is the
  performance target the `large` profile exists to test.
