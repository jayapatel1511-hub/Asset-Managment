# Feature Specification: Fleet Reporting

**Feature Branch**: `006-fleet-reporting` (directory-selected; set `SPECIFY_FEATURE=006-fleet-reporting`)

**Created**: 2026-09-02

**Status**: Draft — 1 blocking clarification open (Q11)

**Input**: `IM30 - Asset Managment via M365.docx` § Reporting (the five questions), § Future Enhancements (dashboards and analytics); `Asset AMS - SharePoint.xlsx` sheet *Start Here* (Metrics & Reporting, Equipment Dashboards, Upcoming Calibrations wishlist); `docs/00-brief.md` (the seven acceptance questions), `docs/06-delivery-plan.md` Step 6

## User Scenarios & Testing *(mandatory)*

The app serves people who touch equipment. This feature serves people who do not: project managers
deciding whether to rent or reallocate, a regional manager asking why three offices each hold spare
loggers, an admin preparing a client's compliance evidence. They will not have an app licence and
should not need one.

It is also the only place where all seven acceptance questions are answered together, including
question 7 — the historical one that the app answers per asset but nobody can answer in aggregate.

The programme's definition of done is that these seven questions are answered live, from production
data, in a review meeting. This feature is where that happens.

### User Story 1 - Answer the fleet questions without an app licence (Priority: P1)

A manager opens one report and can say what the company owns, where it is, who has it, and what is free
at each office — broken down by office, asset group and equipment type, without asking anyone.

**Why this priority**: It covers acceptance questions 1 through 4 and 6, serves the largest group of
users by headcount, and requires no new data — only what 001, 002 and 003 already hold. It is the
cheapest large win in the programme.

**Independent Test**: Hand the report to a manager who has never seen the system, ask them the five
questions, and time them. No app access, no training.

**Acceptance Scenarios**:

1. **Given** the migrated fleet, **When** the manager opens the report, **Then** total assets owned is
   shown, broken down by office, asset group and equipment type.
2. **Given** the report, **When** the manager filters to one office, **Then** every view respects that
   filter.
3. **Given** the report, **When** the manager looks for a specific asset, **Then** its current status,
   location, custodian and project are shown.
4. **Given** the report, **When** the manager asks what is available at an office, **Then** available
   counts by equipment type are shown, excluding retired, deployed, in-calibration, needing-repair and
   missing assets.
5. **Given** the report, **When** the manager filters to a project, **Then** every asset currently
   assigned to it is listed with its custodian and location.
6. **Given** a manager without an app licence, **When** they open the report, **Then** it works.
7. **Given** an asset carrying secured attributes, **When** a manager views the report, **Then** ICCID,
   phone number and static IP are not shown unless their role permits it.
8. **Given** the report, **When** it is opened, **Then** the age of the data is stated, so nobody acts
   on a stale figure believing it is live.

---

### User Story 2 - Prove calibration compliance (Priority: P2)

An admin produces, for a client or an auditor, the calibration status of every instrument used on a
project: what was in calibration, what was overdue, and the certificate for each.

**Why this priority**: This is the report with an external consequence — it is client-facing and
occasionally dispute-facing. It ranks below US1 because feature 004 already answers the operational
question on demand, and this is the aggregated, evidential version.

**Independent Test**: Produce a compliance pack for a real completed project and have the admin who
would send it to a client confirm it is sufficient.

**Acceptance Scenarios**:

1. **Given** a project, **When** the compliance view is filtered to it, **Then** every asset used on it
   is listed with its calibration status at that time.
2. **Given** the fleet, **When** the calibration view is opened, **Then** counts of in-calibration,
   due soon, overdue and unknown are shown by office.
3. **Given** an overdue asset, **When** it appears, **Then** its days overdue, custodian and location
   are shown so it can be chased.
4. **Given** an asset with a certificate, **When** it appears, **Then** the certificate is reachable.
5. **Given** assets whose calibration status is unknown, **When** the view is opened, **Then** they are
   counted explicitly rather than omitted.

---

### User Story 3 - Reconstruct where an asset has been (Priority: P3)

Someone needs an asset's full timeline — every movement, custodian, project and site, with dates — as a
document they can attach to a claim or an email.

**Why this priority**: Acceptance question 7. Low frequency, high stakes. P3 because the app already
answers it per asset for people who have access, and this adds aggregate access and exportability.

**Independent Test**: Produce a timeline for an asset with at least twenty transactions and have
someone reconstruct its year from the document alone.

**Acceptance Scenarios**:

1. **Given** an asset, **When** its timeline is opened, **Then** every transaction is listed
   chronologically with date, action, from, to, performer and notes.
2. **Given** an asset that has been part of a station, **When** its timeline is read, **Then** the
   attachments and detachments appear with the other assets and roles named.
3. **Given** a date range, **When** the timeline is filtered to it, **Then** only events within it are
   shown, with the asset's state at the range's start stated.
4. **Given** a timeline, **When** the user exports it, **Then** it is a document they can send.
5. **Given** a retired asset, **When** its timeline is requested, **Then** it is fully available.

---

### User Story 4 - See what the fleet is actually doing (Priority: P4)

A regional manager sees utilisation: what sits idle, what is always out, where the shortages and the
surpluses are, and how long returns take. Purchasing decisions stop being anecdotal.

**Why this priority**: The highest-value question strategically and the lowest-value operationally.
It also needs a year of transaction history to say anything true, so building it early would produce a
confident chart drawn from three weeks of pilot data — worse than no chart.

**Independent Test**: After six months of live use, ask a manager to identify the three most and least
utilised equipment types per office, and check the answer against the technicians' own view.

**Acceptance Scenarios**:

1. **Given** at least one quarter of history, **When** the utilisation view is opened, **Then** the
   proportion of time assets spent available, out, deployed and unavailable is shown by equipment type
   and office.
2. **Given** the view, **When** a manager looks for idle stock, **Then** assets not transacted within a
   selectable period are listed.
3. **Given** the view, **When** a manager looks for pressure, **Then** equipment types with the lowest
   availability are identified per office.
4. **Given** insufficient history for a reliable figure, **When** the view is opened, **Then** it says
   so rather than presenting a misleading number.
5. **Given** the view, **When** repair and calibration downtime is examined, **Then** time out of
   service is distinguished from time in productive use.

### Edge Cases

- **A manager acting on a figure that is hours old**, believing it is live. Data currency must be stated,
  not implied.
- **An asset transferred between offices mid-period.** Which office does it count towards in a
  point-in-time count versus a period utilisation figure? The two answers differ legitimately and must
  not be presented identically.
- **Retired assets in historical reporting.** Excluded from current counts, required in historical ones.
- **The 644 assets migrating with an unknown custodian.** They will dominate any day-one "who has what"
  view. The report must show them as unknown rather than as a person's holdings.
- **Assets carrying temporary tags** appearing in a fleet count as if they were fully catalogued.
- **A project with no assets**, and an office with no assets of a type, producing zero-rows that either
  vanish or mislead.
- **Secured attributes reaching a manager** through a report that bypasses the app's field security.
  This is the most likely route for a Principle VII breach.
- **Equipment recorded in the registry but owned by a third party** — the notes field names at least
  two — counted as company assets in a valuation-adjacent figure.
- **Utilisation computed across the migration boundary**, where pre-go-live history does not exist and
  would read as universal idleness.

## Requirements *(mandatory)*

### Functional Requirements

**Access and currency**

- **FR-001**: Users MUST be able to read every view in this feature without an application licence.
- **FR-002**: System MUST state the age of the data on every view.
- **FR-003**: System MUST enforce the same field-level restrictions on secured attributes as the
  application, so that reporting is not a route around them.
- **FR-004**: System MUST restrict access to the reports to named recipients rather than publishing them
  broadly. [NEEDS CLARIFICATION: Q11 — which managers and project managers need access, and does the
  organisation hold the licences? This determines the distribution mechanism, not just the recipient
  list]

**Fleet views**

- **FR-005**: System MUST report total assets owned, broken down by office, asset group and equipment
  type.
- **FR-006**: System MUST report each asset's current status, location, custodian and assigned project.
- **FR-007**: System MUST report available counts by office and equipment type, excluding retired,
  deployed, in-calibration, needing-repair and missing assets.
- **FR-008**: System MUST report all assets currently assigned to a given project, with custodian and
  location.
- **FR-009**: System MUST apply a selected office, project, asset group or equipment type filter
  consistently across all views.
- **FR-010**: System MUST distinguish assets whose custodian is unknown from assets that are in the
  office, rather than conflating the two.
- **FR-011**: System MUST identify assets carrying temporary tags separately from fully catalogued
  assets.
- **FR-012**: System MUST exclude, or clearly mark, assets recorded as owned by a third party.

**Calibration views**

- **FR-013**: System MUST report counts of in-calibration, due-soon, overdue and unknown-status assets
  by office.
- **FR-014**: System MUST report the calibration status of every asset assigned to a given project.
- **FR-015**: System MUST report days overdue, custodian and location for each overdue asset.
- **FR-016**: System MUST make a calibration certificate reachable from the calibration view.
- **FR-017**: System MUST count assets of unknown calibration status explicitly rather than omitting
  them.

**Timeline views**

- **FR-018**: System MUST report an asset's complete transaction history chronologically, with date,
  action, from, to, performer and notes.
- **FR-019**: System MUST include attachment and detachment events, naming the other asset and the role.
- **FR-020**: System MUST support filtering a timeline to a date range and MUST state the asset's state
  at the start of that range.
- **FR-021**: Users MUST be able to export a timeline as a document.
- **FR-022**: System MUST report timelines for retired assets.

**Utilisation views**

- **FR-023**: System MUST report the proportion of time assets spent in each status, by equipment type
  and office, over a selectable period.
- **FR-024**: System MUST identify assets not transacted within a selectable period.
- **FR-025**: System MUST identify equipment types with the lowest availability per office.
- **FR-026**: System MUST distinguish time out of service for repair or calibration from time in
  productive use.
- **FR-027**: System MUST state when available history is insufficient for a reliable figure rather
  than presenting one.
- **FR-028**: System MUST NOT compute utilisation across the migration boundary as though pre-go-live
  history existed.

**Historical integrity**

- **FR-029**: System MUST include retired assets in historical views and exclude them from current
  counts.
- **FR-030**: System MUST derive every figure from recorded transactions and reference data, and MUST
  NOT hold any separately maintained reporting copy that could disagree with the operational data.

### Key Entities *(include if feature involves data)*

This feature introduces no new stored entities. It reads what features 001 through 005 produce. That is
deliberate: a reporting layer with its own tables is a reporting layer that will eventually disagree
with the system it reports on.

- **Asset**, **Transaction**, **Transaction Line**, **Asset Relationship**, **Calibration Record**,
  **Installation**, and the reference tables — all read-only here.
- **Point-in-time state**: a derivation, not a table — an asset's status, location, custodian and
  project as at a chosen timestamp, computed by replaying its lines. What questions 7 and US4 both
  depend on.
- **Utilisation period**: a derivation — the spans an asset spent in each status, computed from
  consecutive transactions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager who has never used the system answers acceptance questions 1, 2, 3, 4 and 6
  from the report, unaided, in under 5 minutes total.
- **SC-002**: All seven acceptance questions are answered live from production data in the go-live
  review meeting. This is the programme's definition of done.
- **SC-003**: Every figure in the report reconciles exactly with the same query run against the
  operational data — zero discrepancies.
- **SC-004**: Zero managers require an application licence to read any report.
- **SC-005**: Zero secured attributes are visible to a recipient not permitted to see them, verified by
  opening the report as each role.
- **SC-006**: A calibration compliance pack for a completed project is accepted as sufficient by the
  admin who would send it to a client, with zero manual supplementation.
- **SC-007**: An asset timeline covering a year is produced and exported in under 2 minutes.
- **SC-008**: Data currency is stated on 100% of views, and no view presents a figure whose age is
  unstated.
- **SC-009**: Zero utilisation figures are presented that span the migration boundary or draw on less
  history than they require.
- **SC-010**: Report load time stays under 10 seconds at 5,000 assets and 100,000 transaction lines.

## Assumptions

- Managers read; they do not write. There is no editing capability in this feature, which is what makes
  licence-free access acceptable.
- Reporting reads the operational data directly rather than a copy. At this scale — thousands of assets,
  low tens of thousands of transactions a year — this is comfortable, and it removes any possibility of
  the report and the app disagreeing. Should scale ever make it uncomfortable, that is a decision to
  record, not a default to drift into.
- Near-real-time is sufficient. Nobody makes a decision on a figure that is minutes rather than seconds
  old, provided the age is visible.
- Utilisation reporting is honest about its own limits. It needs at least a quarter of real history, and
  it says so until it has one. This is why US4 is P4 rather than an early win.
- The compliance pack's audience is a client or an auditor, so it must stand alone as a document rather
  than requiring the recipient to have access to anything.
- Question 7's aggregate form depends on feature 005 for site detail. Until 005 ships, timelines cover
  custody, location and project but not site position and orientation. US3 is specified to degrade
  cleanly rather than to wait.
- Depends on 001, 002 and 003 for everything; on 004 for US2; on 005 for the fullest form of US3.
  Nothing depends on this feature — it is the programme's output, not its input.
