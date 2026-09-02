# Feature Specification: Deployment & Kits

**Feature Branch**: `005-deployment-and-kits` (directory-selected; set `SPECIFY_FEATURE=005-deployment-and-kits`)

**Created**: 2026-09-02

**Status**: Draft — Phase 2. 1 blocking clarification open (site-coordinate scope, FR-006). Q7 resolved 2026-09-02; see `docs/08-decisions.md`

**Input**: `IM30 - Asset Managment via M365.docx` § What We Need → Asset Transactions (Assignment, Transfer), § Future Enhancements; `Asset AMS - SharePoint.xlsx` sheets *Assets - Current Deployment* (16 defined columns) and *Start Here* (Deployment Form draft, Configuration form draft, checkout→deployment→transfer→return→retirement flow, coordinate fields)

## User Scenarios & Testing *(mandatory)*

Checkout says an instrument left the office with a person. Deployment says it is bolted to a pier at
POR-403, facing north, on solar power, logging to a modem on a Bell SIM, as part of project 02208928.
That second statement is what a client asks about, what a damage claim turns on, and what a technician
returning to site six months later needs.

The legacy sheet designed for this — *Assets - Current Deployment* — has 16 well-considered columns and
**zero data rows**. The registry's own `Location Type`, `Location` and `Deployment Date` columns are
empty in 1,050 of 1,053 rows. Deployment detail has never been captured, which is why site history
starts at go-live rather than being migrated.

This is Phase 2 by deliberate choice: Phase 1 must first make checkout, return and calibration
reliable. Deploying to a site that the system tracks incorrectly would only add precision to a wrong
answer.

### User Story 1 - Install a monitoring kit at a site (Priority: P1)

A technician installs a seismograph station: one data logger, up to four geophones, a microphone, a
modem and a SIM. They record it once — the site, the project, the orientation of each sensor, the power
source, the position — and the system knows the whole station as a unit, at that place, from that date.

**Why this priority**: This is the feature. Everything else here refines or reverses it. It converts
"James has a Micromate" into "a Micromate is monitoring 337 Power Street for project 02208928", which
is the answer the business actually needs.

**Independent Test**: Install a real station of seven components, then ask someone who was not present
to state from the app what is at that site, how each sensor is oriented, and what it is logging
through. Testable with Undeploy not yet built.

**Acceptance Scenarios**:

1. **Given** a technician holds the components, **When** they record a deployment naming the site, the
   project and the primary data logger, **Then** all components become Deployed at that site on that
   project in a single action.
2. **Given** a deployment, **When** it is recorded, **Then** each component's role in the station is
   captured — primary, which sensor position, microphone, modem. The modem's SIM is a permanent
   component and is not chosen here; it follows the modem.
3. **Given** sensors that must be oriented, **When** the deployment is recorded, **Then** each carries
   its orientation, and a sensor with no orientation given is refused rather than recorded as unknown.
4. **Given** a deployment, **When** it is recorded, **Then** the power source and the site detail —
   location type, site name, specific position — are captured.
5. **Given** a component that is not currently held by the person deploying it, **When** they attempt to
   include it, **Then** it is refused, naming who holds it.
6. **Given** a data logger already deployed elsewhere, **When** it is included in a new deployment,
   **Then** it is refused until it is recovered.
7. **Given** a deployment naming no data logger, **When** it is submitted, **Then** it is refused — a
   station without a logger records nothing.
8. **Given** a successful deployment, **When** the site is viewed, **Then** the whole station is listed
   as one installation rather than seven unrelated assets that happen to share a project.
9. **Given** a deployment, **When** any component's detail is viewed, **Then** the site and the other
   components of its station are visible from it.

---

### User Story 2 - Recover a station from site (Priority: P2)

The project ends or the station moves. The technician recovers it — all of it, or part — and the
components return to their custody, ready to be returned to the office. Nothing is left recorded as
installed at a site it is no longer at.

**Why this priority**: Without recovery, every deployment is permanent and the site record becomes
fiction within one project cycle. Below US1 only because deployment must exist first.

**Independent Test**: Recover a station of seven components, three of them only, and verify the site
record shows the remaining four and the recovered three are back in the technician's custody.

**Acceptance Scenarios**:

1. **Given** a deployed station, **When** the technician recovers it, **Then** the components return to
   their custody, the site installation is closed with an end date, and their component relationships
   are closed.
2. **Given** a partial recovery, **When** it is recorded, **Then** only the named components are
   recovered and the site record accurately shows what remains.
3. **Given** a recovery in which a component is missing from site, **When** it is recorded, **Then** that
   component can be marked missing in the same action rather than being falsely recovered.
4. **Given** a recovered component that is damaged, **When** it is recorded, **Then** its condition is
   captured and it does not become available for the next deployment.
5. **Given** a fully recovered station, **When** the site is viewed, **Then** the installation appears as
   historical, with its start and end dates, not as current.
6. **Given** the primary logger is recovered but its sensors are not, **When** it is submitted, **Then**
   the technician is required to say explicitly what happens to the orphaned sensors.

---

### User Story 3 - Know what was installed where, and when (Priority: P3)

Someone asks what was monitoring 50 Diorite Street last October, how the geophones were oriented, and
which SIM the data came through. The answer comes from the record, not from a technician's memory.

**Why this priority**: This is acceptance question 7 in its fullest form and the feature's long-term
justification. P3 because it is a read over data US1 and US2 produce and delivers nothing until there
is deployment history to read.

**Independent Test**: Deploy, modify and recover a station over several weeks, then ask someone to
reconstruct its composition and configuration as at three specific past dates.

**Acceptance Scenarios**:

1. **Given** a site with past installations, **When** its history is opened, **Then** each installation
   appears with its dates, project, components and configuration.
2. **Given** any past date, **When** a site's state on that date is requested, **Then** the components
   installed, their roles, orientations and power source as at that date are returned.
3. **Given** an asset, **When** its history is opened, **Then** its deployments appear as events naming
   the site, the project and its role.
4. **Given** a component swapped mid-installation, **When** the site history is read, **Then** both the
   removed and the replacement component appear with the dates each was in service.
5. **Given** a site whose project has closed, **When** its history is requested, **Then** it remains
   fully readable.

---

### User Story 4 - Change a station without taking it down (Priority: P4)

A modem fails and is swapped. A geophone is reoriented. The station stays in service; the record keeps
up, and the change is dated so that data recorded before and after can be interpreted correctly.

**Why this priority**: Real and frequent enough to matter, but the workaround — recover and redeploy —
produces a correct if clumsy history. Last because it is the most intricate to get right and the least
damaging to defer.

**Independent Test**: Swap a modem, reorient a sensor and change a power source on a live station, then
verify the station stayed deployed throughout and each change is separately dated in its history.

**Acceptance Scenarios**:

1. **Given** a deployed station, **When** a component is swapped, **Then** the outgoing component is
   recovered, the incoming one is deployed, the station remains in service, and both changes carry the
   same effective date.
2. **Given** a deployed sensor, **When** its orientation is corrected, **Then** the change is recorded
   with its date and the previous value remains in history.
3. **Given** a configuration change, **When** it is recorded, **Then** it does not alter the
   installation's original start date.
4. **Given** a station whose project number changes, **When** it is recorded, **Then** all its
   components move to the new project in one action.

### Edge Cases

- **A SIM inside a modem.** *(Q7 resolved: permanent Component. The SIM therefore does **not** appear on
  the deployment form at all — the technician deploys the modem and the SIM follows automatically. The
  edge case that remains is the rare deliberate swap, which is an administrative attach/detach under
  feature 003's FR-032a, not a deployment field.)*
- **A station deployed across a site boundary** — sensors in a building, logger in a utility room.
  One installation, or two?
- **Two stations at one site on one project**, distinguished only by position. Site name alone cannot
  identify an installation.
- **A site that is also an office** — equipment monitoring the office building it is stored in.
- **Deployment while offline**, which is the normal case: sites frequently have no signal, and a
  deployment form is longer than a checkout, so a partially completed form must survive interruption.
- **A component deployed by one technician and recovered by another**, months later, after the first has
  left the company.
- **An asset that goes overdue for calibration while deployed**, and cannot be recovered until the
  project allows it.
- **Coordinates recorded by hand versus captured from the device**, differing by enough to matter.
- **Retiring an asset that is still recorded as deployed.** Must be refused or must force a recovery.
- **A site with no civic address** — a mine level, a pier number, a chainage. Free-text position is
  unavoidable here; the location *type* is not.

## Requirements *(mandatory)*

### Functional Requirements

**Deploying**

- **FR-001**: Users MUST be able to record the deployment of multiple assets to one site in a single
  action.
- **FR-002**: System MUST require a project, a site, a primary data logger and a deployment date.
- **FR-003**: System MUST capture each component's role within the station.
- **FR-004**: System MUST require an orientation for each component whose role requires one, and MUST
  refuse a deployment that omits it.
- **FR-005**: System MUST capture power source, location type, site name and specific position.
- **FR-006**: System MUST capture the site's coordinates.
  [NEEDS CLARIFICATION: captured automatically from the device, entered by hand, or both? The
  *Start Here* sheet lists latitude, longitude, coordinate system and civic address as candidates.
  Automatic capture is unreliable underground and indoors, which is where much of this fleet lives]
- **FR-007**: System MUST refuse to deploy an asset the deploying user does not hold, unless they are an
  administrator.
- **FR-008**: System MUST refuse to deploy an asset that is already deployed elsewhere.
- **FR-009**: System MUST refuse a deployment that names no data logger.
- **FR-010**: System MUST record a deployment through the same transaction mechanism as every other
  state change, producing one line per asset.
- **FR-011**: System MUST record the station's composition as dated relationships between the primary
  asset and its components.

**Recovering**

- **FR-012**: Users MUST be able to recover all or part of a station in a single action.
- **FR-013**: System MUST return recovered components to the recovering user's custody.
- **FR-014**: System MUST close the installation record and the component relationships with an end
  date.
- **FR-015**: System MUST accurately reflect what remains on site after a partial recovery.
- **FR-016**: Users MUST be able to mark a component missing rather than recovered, within the same
  action.
- **FR-017**: Users MUST be able to record a recovered component's condition, and System MUST keep a
  damaged component out of the available pool.
- **FR-018**: System MUST require an explicit decision about components left behind when a primary
  asset is recovered without them.

**Site history**

- **FR-019**: Users MUST be able to view a site's current and past installations with their dates,
  projects, components and configuration.
- **FR-020**: System MUST support reconstructing a site's installed composition and configuration as at
  any past date.
- **FR-021**: System MUST show deployments in an asset's own history, naming site, project and role.
- **FR-022**: System MUST show both outgoing and incoming components of a mid-installation swap, with
  the dates each was in service.
- **FR-023**: System MUST keep site history readable after the project closes.

**Modifying in service**

- **FR-024**: Users MUST be able to swap a component without ending the installation.
- **FR-025**: Users MUST be able to change orientation, power source and position on a live
  installation, with each change dated and the previous value retained.
- **FR-026**: System MUST NOT alter an installation's start date when its configuration changes.
- **FR-027**: Users MUST be able to move an entire station to a different project in one action.

**Cross-cutting**

- **FR-028**: System MUST support recording a deployment and a recovery without connectivity, and MUST
  preserve a partially completed form across interruption.
- **FR-029**: System MUST refuse retirement of an asset recorded as deployed until it is recovered.
- **FR-030**: System MUST continue to show a deployed asset in calibration due lists, with its site and
  project, so it can be scheduled for recovery.

### Key Entities *(include if feature involves data)*

- **Installation**: One station at one site for one project over one span of time — its position,
  location type, coordinates, power source, and its start and end dates. The thing the
  *Assets - Current Deployment* sheet was reaching for, made dated rather than current-only so that
  history survives.
- **Station Composition**: The dated set of assets making up an installation and the role each plays.
  Not a new entity — the asset relationship from feature 003, used with kit roles.
- **Site**: A location of type site, created as deployments are recorded rather than pre-populated,
  since the fleet's sites are project-driven and short-lived.
- **Configuration Change**: A dated amendment to a live installation — a swap, a reorientation, a power
  change. Recorded as a transaction, not as an edit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A technician records a seven-component station deployment on site, on a phone, offline, in
  under 4 minutes.
- **SC-002**: Someone who was not present states a site's full installed composition and each sensor's
  orientation from the app alone, with zero errors, for 100% of a sampled 10 installations.
- **SC-003**: Zero assets are recorded as deployed at a site they are not physically at, verified by a
  physical audit of 10 sites at the end of the pilot.
- **SC-004**: A site's installed composition as at any past date, reconstructed from the record, matches
  the technician's own account for 100% of a sampled 10 site-date pairs.
- **SC-005**: Zero installations are left open after their equipment has been recovered, verified
  monthly.
- **SC-006**: A component swap is recorded without the installation showing any interruption in service.
- **SC-007**: 100% of deployments recorded offline arrive exactly once.
- **SC-008**: Acceptance question 7 is answered live, in full — location, custodian, project and attached
  components as at a past date — from production data.

## Assumptions

- Site history begins at go-live. The source data carries no deployment detail at all — three rows out
  of 1,053 have any location value — so there is nothing to migrate and no expectation of back-history.
- Sites are created as they are used, not maintained as a master list, because they follow projects.
- A station has exactly one primary data logger. Every station type in the current fleet fits this.
- Free-text position detail is unavoidable — `POR-403`, `Pier 3`, `M South West lobe`, `1124 Perreault
  Garage` are all real values from the current notes field — but location *type* is a curated list, so
  the data remains groupable even where the position is prose.
- Orientation matters for geophones and is meaningless for modems and SIMs; the form asks only where it
  applies.
- Deployment forms are long, sites often have no signal, and interruption is normal. Draft preservation
  is a requirement, not a nicety.
- Component swaps are more common than full redeployments, which is why US4 exists at all rather than
  being folded into recover-and-redeploy.
- Depends on 003 for the transaction mechanism and relationship model, and on 001 for locations and
  identity. Feature 006 reports on this feature's output but does not block it.
- Deliberately deferred to Phase 2. Building it before checkout and return are trustworthy would add
  detail to an unreliable base.
