# Feature Specification: Asset Transactions

**Feature Branch**: `003-asset-transactions` (directory-selected; set `SPECIFY_FEATURE=003-asset-transactions`)

**Created**: 2026-09-02

**Status**: Draft — 3 blocking clarifications open (Q8, Q9, and the inactive-project rule in FR-027). Q3 and Q7 resolved 2026-09-02; see `docs/08-decisions.md`

**Input**: `IM30 - Asset Managment via M365.docx` § What We Need → Asset Transactions, § Basic User Experience, § Key Design Principles; `Asset AMS - SharePoint.xlsx` sheets *Assets - Action History* (action taxonomy) and *Start Here* (Checkout / Return / Transfer form drafts, checkout→deployment→transfer→return→retirement flow); `docs/01-data-model.md` (state machine), `docs/03-automation.md` (flow F1)

## User Scenarios & Testing *(mandatory)*

This is the feature that makes the registry true. Everything in 001 displays state; this feature is the
only thing that changes it, and it does so by recording what happened rather than by editing what is.

The distinction matters more than it sounds. The legacy sheet let a user overwrite "Current Office" and
"Availability Status" directly, which is why 644 rows now read `Deployed or NOT Available` and nobody
can say by whom or since when. Here, a technician records "I am taking these five items to project
02208928 today", and status, location, custodian and project follow from that. The history is the
system of record; the current state is a cached conclusion.

### User Story 1 - Take equipment out (Priority: P1)

A technician is loading a truck. They add a data logger, two geophones, a microphone and a modem to a
cart by scanning or searching, name the project, and submit. All five items become theirs, on that
project, in one action. If any item is already out with someone else, they are told before they drive
away.

**Why this priority**: This is the single most frequent operation in the business and the origin of
almost every current data problem. It answers acceptance questions 2, 3 and 6 by *creating* the facts
they depend on. Nothing else in this feature has value without it — you cannot return what was never
checked out.

**Independent Test**: Give a technician five physical items and a project number and ask them to check
them out on a phone. Then verify from a second device that all five show as theirs, on that project,
and that a history entry exists for each. Fully testable with Return not yet built.

**Acceptance Scenarios**:

1. **Given** five Available assets, **When** the technician submits a checkout naming a project,
   **Then** one transaction and five lines are recorded, and all five assets show status CheckedOut with
   that technician as custodian and that project assigned.
2. **Given** any asset in the cart is not Available, **When** the technician tries to add it, **Then**
   it is refused at the point of adding, naming its current status and who holds it.
3. **Given** an asset became unavailable between being added to the cart and submission, **When**
   submission occurs, **Then** the whole submission is refused, the offending asset is named, and no
   asset in the cart is checked out.
4. **Given** a cart of five assets, **When** submission succeeds, **Then** either all five lines are
   recorded or none are — a partial checkout never occurs.
5. **Given** a checkout with no project named, **When** the technician submits, **Then** it is refused,
   because acceptance question 6 requires it.
6. **Given** the technician designates the data logger as the primary item and the others as its
   sensors and modem, **When** submission succeeds, **Then** those relationships are recorded so that
   returning the logger later also accounts for its sensors.
7. **Given** a Retired asset, **When** the technician searches for it in the cart, **Then** it cannot be
   added.
8. **Given** a valid submission, **When** it completes, **Then** the technician is shown a confirmation
   naming the transaction and listing what is now theirs.
9. **Given** a transaction line has been recorded, **When** any user with any role other than System
   Owner attempts to alter or delete it, **Then** it is refused by the data platform, not merely hidden
   in the interface.
10. **Given** a transaction line describing an illegal transition is inserted directly through the
    platform's API, bypassing the app entirely, **Then** it is rejected, logged with the asset and the
    submitter, and the asset's state is unchanged.

---

### User Story 2 - Bring equipment back (Priority: P2)

The technician is unloading. The app already knows what they hold, so the return cart starts prefilled.
They confirm, mark anything damaged, and submit. Everything comes back to their office and becomes
available to the next person — except what they flagged, which goes to the repair queue instead.

**Why this priority**: Without return, every asset checked out stays out forever and availability
becomes meaningless within a week. It ranks below checkout only because checkout must exist first.

**Independent Test**: Check out ten assets, return seven of them with one marked damaged, and verify
the seven changed state correctly, the damaged one is in the repair queue rather than available, and the
remaining three are still out.

**Acceptance Scenarios**:

1. **Given** the technician holds eight assets, **When** they open Return, **Then** all eight are
   prefilled in the cart and can be removed individually.
2. **Given** a returned asset marked in good condition, **When** submission succeeds, **Then** it becomes
   Available at the return location with no custodian and no assigned project.
3. **Given** a returned asset marked as needing service, **When** submission succeeds, **Then** it
   becomes NeedsRepair rather than Available and does not appear in availability lists.
4. **Given** a primary asset with sensors attached, **When** it is returned, **Then** its attached items
   are accounted for in the same return and their relationships are closed with an end date.
5. **Given** an asset held by another technician, **When** a technician who is not its custodian and not
   an administrator attempts to return it, **Then** it is refused.
6. **Given** an administrator, **When** they return an asset held by someone else, **Then** it is
   permitted, and the history records who performed the return as distinct from who held it.
7. **Given** the return location is not specified, **When** submission occurs, **Then** the technician's
   own office is used, and that choice is visible before they submit.

---

### User Story 3 - See everywhere an asset has been (Priority: P3)

A client disputes a reading, or an instrument comes back damaged, and someone needs to know where it
was, who had it, what project it was on, and what was attached to it — on a specific date months ago.
They open the asset and read its history.

**Why this priority**: This is acceptance question 7, and it is the reason the append-only design exists
at all. It is P3 only because it is a read over data US1 and US2 produce — it cannot be built first, and
it delivers nothing until there is history to read.

**Independent Test**: Perform a known sequence of twelve transactions across three assets over several
days, then ask someone who did not perform them to reconstruct, from the app alone, where each asset was
on a given date and what it was attached to.

**Acceptance Scenarios**:

1. **Given** an asset with history, **When** its history is opened, **Then** entries appear newest
   first, each showing date, action, from and to, who performed it, and notes.
2. **Given** an asset that was attached to another as a sensor, **When** its history is read, **Then**
   the attachment and its later detachment appear as events naming the other asset and the role it
   played.
3. **Given** any past date, **When** the asset's state on that date is requested, **Then** the status,
   location, custodian and project returned match what the derived values held at that time.
4. **Given** a correction was needed, **When** the history is read, **Then** the correcting transaction
   appears as an additional entry and the original entry is still present and unaltered.
5. **Given** an asset that has been migrated from the legacy system, **When** its history is read,
   **Then** its earliest entry is its addition to inventory at the migration date, so the record has a
   beginning rather than starting mid-story.

---

### User Story 4 - Move equipment to another person, office or project (Priority: P4)

Equipment already in the field changes hands, moves to another office, or gets rebilled to a different
project, without coming back first. A technician or admin records the move; the item does not become
available and does not stop being out.

**Why this priority**: Real and necessary — it is one of the five transaction types the brief names —
but lower frequency than checkout and return, and it can be approximated in the interim by a return
followed by a checkout. Deferring it does not block go-live.

**Independent Test**: Transfer an asset between two technicians, then between two offices, then between
two projects, and verify status never changed while custodian, location and project each did, with a
history entry for each move.

**Acceptance Scenarios**:

1. **Given** a CheckedOut asset, **When** it is transferred to another technician, **Then** its custodian
   changes, its status remains CheckedOut, and both the previous and new custodian appear in the history
   entry.
2. **Given** a transfer that names a new project only, **When** it is submitted, **Then** the project
   changes and custodian and location are untouched.
3. **Given** a transfer, **When** it is submitted with no reason given, **Then** it is refused — a move
   without a reason is the ambiguity this system exists to remove.
4. **Given** an Available asset, **When** it is transferred between offices, **Then** it remains
   Available at its new location.
5. **Given** a transfer of a primary asset with attached sensors, **When** it is submitted, **Then** the
   attached items move with it and each has its own history entry, or the technician is required to
   choose explicitly which items move.

---

### User Story 5 - Work in a basement with no signal (Priority: P5)

A technician checks equipment out of a storage room, a pier, or a mine access with no connectivity. The
app accepts the checkout, holds it, and submits it when signal returns. If the world changed while they
were offline, they are told — the submission is never silently dropped and never silently overwritten.

**Why this priority**: Genuinely important for field credibility, and named in the brief's user
description. P5 because the offline case is a minority of sessions and the failure mode without it — the
technician records it when they get back to the truck — is tolerable, whereas a *wrong* offline
implementation that loses or duplicates transactions is not.

**Independent Test**: Put a device in airplane mode, perform a checkout, a return and a transfer,
restore connectivity, and verify all three arrive exactly once and in order. Then repeat with a
deliberate conflict introduced from another device while offline, and verify the conflict surfaces.

**Acceptance Scenarios**:

1. **Given** no connectivity, **When** the technician submits a checkout, **Then** it is accepted, marked
   as pending, and visible as pending on the affected assets.
2. **Given** queued submissions, **When** connectivity returns, **Then** they are submitted in the order
   they were made.
3. **Given** a queued submission that is rejected on replay because the asset's status changed, **When**
   replay occurs, **Then** it appears in a list requiring the technician's attention and is never
   silently discarded.
4. **Given** a queued submission, **When** the app is closed and reopened before connectivity returns,
   **Then** the submission is still queued.
5. **Given** a submission that has been sent but not acknowledged, **When** connectivity is
   intermittent, **Then** it is not recorded twice.
6. **Given** offline search, **When** the technician searches, **Then** cached assets are searchable and
   the technician is told the data is cached and as of when.

---

### User Story 6 - Report that something is broken or lost (Priority: P6)

An instrument stops working in the field, or cannot be found. The technician says so from the app. It
leaves the available pool immediately, so nobody packs it tomorrow, and the fault is on record with who
reported it and when.

**Why this priority**: Small, valuable, and independent, but the fleet operates without it — three
assets today carry `Needs Repair / Calibration` set by hand. Last because it is the least frequent and
the workaround (tell the office admin) is functional.

**Independent Test**: Report a fault on a checked-out asset and confirm it leaves availability, appears
in a repair queue, and can later be marked repaired and returned to service.

**Acceptance Scenarios**:

1. **Given** an asset in any active state, **When** a technician reports a fault, **Then** it becomes
   NeedsRepair, leaves availability lists, and the report is recorded with reporter, date and notes.
2. **Given** a NeedsRepair asset, **When** an administrator records the repair as complete, **Then** it
   becomes Available.
3. **Given** an asset that cannot be found, **When** it is marked missing, **Then** it leaves
   availability and remains in the registry rather than being deleted.
4. **Given** a Missing asset, **When** it is later found, **Then** it returns to Available with both the
   loss and the recovery in its history.
5. **Given** a NeedsRepair or Missing asset, **When** anyone attempts to check it out, **Then** it is
   refused.

### Edge Cases

- **Two technicians check out the same asset within the same second.** One succeeds, one is refused
  with a clear reason. This cannot be resolved by the app alone; the arbitration must be server-side.
- **Cart submitted twice** by an impatient double-tap, or by a retry after a timeout whose response was
  lost. Must record one transaction, not two.
- **A child asset checked out alone** while it is a permanent component of a parent — a microphone
  element, or a SIM inside a modem. Must be refused or must escalate to the parent, not silently
  separate them.
- **Returning an asset whose primary was already returned** by someone else. Must not fail obscurely.
- **A transaction that arrives out of order** after an offline replay, describing a transition that was
  legal when made but is not now. Must be surfaced to a human, never force-applied.
- **The derived-state processor fails partway** through a multi-line transaction. Unprocessed lines must
  be identifiable and reprocessable, and the asset must not be left in a half-updated state.
- **A transaction backdated across another transaction.** Recording Monday's return on Wednesday, when
  a Tuesday checkout already exists, produces a history that does not replay cleanly.
- **An asset transferred to a location that is later deactivated.** History keeps the reference.
- **A custodian who leaves the company** while holding twelve assets. Must be findable and reassignable
  without editing asset records directly.
- **A transaction naming a closed project.** Refuse, or permit with a warning for legitimate late
  charges — but decide, do not leave it to chance.
- **Retiring an asset that is currently checked out to someone.** Must either be refused or must
  explicitly account for the open custody.

## Requirements *(mandatory)*

### Functional Requirements

**Recording**

- **FR-001**: Users MUST be able to record a checkout, return and transfer covering multiple assets in a
  single action.
- **FR-002**: System MUST record every such action as one transaction header plus one immutable line per
  asset.
- **FR-003**: System MUST apply a multi-asset submission atomically — all lines are recorded, or none
  are.
- **FR-004**: System MUST capture, per transaction: type, timestamp, who performed it, and the from and
  to values for location, custodian and project as applicable.
- **FR-005**: System MUST capture, per line: the asset, its status before, its status after, and where
  applicable its role in a kit and its condition.
- **FR-006**: System MUST record the addition of an asset to inventory, a fault report, a repair
  completion, a loss, a recovery and a retirement using the same transaction mechanism, so that every
  state change has one representation.
- **FR-007**: System MUST prevent duplicate recording of the same submission when it is retried.
- **FR-008**: System MUST require a project on checkout.
- **FR-009**: System MUST require a reason on transfer.
- **FR-010**: System MUST default the return location to the returning user's office and MUST display
  that default before submission.

**Immutability**

- **FR-011**: System MUST deny update and delete on transaction lines to every role except System Owner,
  enforced by the data platform.
- **FR-012**: System MUST support correction only by recording a further transaction, never by altering
  a recorded line.
- **FR-013**: System MUST retain transaction history for the life of the asset and beyond its
  retirement.

**Derivation of current state**

- **FR-014**: System MUST derive asset status, current location, custodian, assigned project and parent
  from recorded transaction lines, and MUST NOT accept those values as direct user input.
- **FR-015**: System MUST process the lines of one transaction in order, and MUST NOT process two
  transactions for the same asset concurrently.
- **FR-016**: System MUST mark each line as processed once its effects are applied, and MUST make
  unprocessed lines identifiable and reprocessable.
- **FR-017**: System MUST clear custodian and assigned project on return, and MUST set the current
  location to the return location.
- **FR-018**: System MUST leave status unchanged on transfer while updating whichever of custodian,
  location and project the transfer names.
- **FR-019**: System MUST reach the same current state whether a transaction's lines are processed
  immediately or after a delay.

**Validation and conflict prevention**

- **FR-020**: System MUST define the allowed status transitions once, as data, and MUST enforce them
  both in the interface and independently at the point of recording.
- **FR-021**: System MUST refuse a checkout of any asset that is not Available.
- **FR-022**: System MUST refuse any action on a Retired asset other than viewing it.
- **FR-023**: System MUST re-verify every asset's status at submission and MUST refuse the whole
  submission if any asset changed since it entered the cart, naming the asset.
- **FR-024**: System MUST reject a line describing a disallowed transition even when it arrives through
  the platform API rather than the application, MUST log the rejection with asset and submitter, and
  MUST leave asset state unchanged.
- **FR-025**: System MUST restrict returning an asset to its custodian or an administrator.
- **FR-026**: System MUST refuse to check out an asset that is a permanent component of another asset,
  directing the user to the parent instead.
- **FR-027**: System MUST refuse a checkout, transfer or deployment naming an inactive project.
  [NEEDS CLARIFICATION: refuse outright, or warn and permit for legitimate late charges?]

**Kits and attachments**

- **FR-028**: Users MUST be able to designate one asset in a checkout as primary and assign the others
  roles relative to it.
- **FR-029**: System MUST record an attachment relationship with a start date when a kit is formed, and
  MUST close it with an end date when the kit is broken.
- **FR-030**: System MUST ensure an asset has at most one open attachment at a time.
- **FR-031**: System MUST account for a primary asset's attached items when the primary is returned,
  either by including them or by requiring the user to decide explicitly.
- **FR-032**: System MUST apply state changes to permanent components of an asset when the asset itself
  changes state, without creating separate lines for them — the parent's line is their history.
  *(Q7 resolved: a SIM is a permanent Component of its modem, not a per-deployment Kit member. It moves
  with the modem automatically, is never separately transacted, and never appears in a picker. The same
  rule now carries the SLM pre-amp and element from Q5. This keeps the deployment form short and makes
  FR-026 — refusing to check out a component alone — the operative rule for 232 SIM records.)*
- **FR-032a**: System MUST record a permanent component relationship as standing rather than
  per-transaction, and MUST allow an administrator to attach and detach one — a SIM is moved between
  modems rarely, but it is not immovable.

**History**

- **FR-033**: Users MUST be able to view an asset's complete history, newest first, showing date,
  action, from, to, performer and notes.
- **FR-034**: System MUST show attachment and detachment as history events naming the other asset and
  the role.
- **FR-035**: System MUST support reconstructing an asset's status, location, custodian and project as
  at any past timestamp, and that reconstruction MUST agree with what the derived values held then.

**Offline**

- **FR-036**: Users MUST be able to record a checkout, return and transfer without connectivity.
- **FR-037**: System MUST persist queued submissions across application restarts.
- **FR-038**: System MUST submit queued submissions in the order they were made.
- **FR-039**: System MUST surface a rejected replay to the user for resolution and MUST NOT discard it.
- **FR-040**: System MUST indicate pending submissions on the affected assets.

**Timing and authority**

- **FR-041**: System MUST default a transaction's timestamp to the moment of recording.
- **FR-042**: Administrators MUST be able to record a transaction with a past date, within a bounded
  window. [NEEDS CLARIFICATION: Q9 — permitted at all? The proposal is administrators only, up to 30
  days back. Backdating across an existing later transaction also needs a rule: refuse, or accept and
  flag the asset's history as non-linear]
- **FR-043**: Users MUST be able to record an expected return date on checkout.
  [NEEDS CLARIFICATION: Q8 — required or optional? Required makes overdue-return notification reliable
  and adds friction to every checkout; optional means the notification covers only part of the fleet]
- **FR-044**: System MUST record who performed a transaction distinctly from whom it affected, so that
  an administrator acting for a technician is visible as such.

**Failure handling**

- **FR-045**: System MUST retry transient failures in deriving state, and MUST raise an operational
  alert on terminal failure rather than failing silently.
- **FR-046**: System MUST allow unprocessed lines to be reprocessed on demand and on a schedule.

### Key Entities *(include if feature involves data)*

- **Transaction**: One recorded event — a person did something to some equipment at a time. Holds type,
  timestamp, performer, the from/to values, the primary asset if the event forms a kit, the reason, and
  the expected return. The header exists so that checking out five items is one event with five lines,
  not five unrelated events.
- **Transaction Line**: One asset's participation in one transaction, with its status before and after,
  its role in the kit, and its condition. Append-only. This is the system of record; everything else is
  derived from it or is reference data.
- **Asset Relationship**: A dated attachment between two assets — which was the parent, which the child,
  what role, when it started, when it ended, and which lines opened and closed it. Dated rather than
  current-only, because acceptance question 7 asks what was attached on a past date.
- **Transition Matrix**: The allowed status changes, expressed as data rather than code, so the
  interface and the derivation process enforce one definition. Already drafted at
  `data/reference/state_machine.json`.
- **Pending Submission**: A transaction recorded on a device but not yet accepted by the server. Exists
  only on the device; not part of the shared data model.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A technician checks out five assets to a project in under 60 seconds on a phone, including
  scanning.
- **SC-002**: Zero manual edits to asset status, location, custodian, project or parent occur during the
  pilot month — verified by audit log, not by policy.
- **SC-003**: 20 or more real checkouts and returns are performed by technicians during the Ottawa pilot
  with zero support escalations about incorrect resulting state.
- **SC-004**: 100% of attempted double-bookings are refused, with the refusal naming the current holder.
  Verified by deliberate concurrent submission from two devices.
- **SC-005**: Every cell of the transition matrix — allowed and disallowed — is exercised by an automated
  test, and every disallowed transition submitted directly to the platform API is rejected and logged.
- **SC-006**: Current state is correct within 60 seconds of a submission being accepted, at the 95th
  percentile.
- **SC-007**: An asset's state at any past timestamp, reconstructed from its lines, matches the derived
  values recorded at that time, for 100% of a sampled 50 assets across 30 days.
- **SC-008**: Zero transaction lines are updated or deleted by any non-System-Owner principal, verified
  by audit log over the pilot.
- **SC-009**: A partial multi-asset submission never occurs — zero transactions exist with fewer lines
  than the user submitted, across the pilot.
- **SC-010**: 100% of submissions made offline arrive exactly once, in order, verified over 30 queued
  submissions including at least 5 with intermittent connectivity.
- **SC-011**: Zero queued submissions are lost or silently discarded during the pilot.
- **SC-012**: Acceptance questions 2, 3, 6 and 7 are answered live from production data in a review
  meeting.

## Assumptions

- Every state change worth knowing about is worth recording as a transaction. There is no "quick fix"
  path that adjusts state without a history entry, for anyone, including the System Owner — who repairs
  defects by recording compensating transactions.
- A short delay between submission and visible state change is acceptable, provided the app confirms
  the submission immediately and shows the pending state. Technicians will not wait on a spinner, but
  they will accept "recorded, updating shortly".
- The interface is not a security boundary. Every rule stated here is enforced where the data is
  written, and the interface's checks exist to give a fast, explained refusal rather than to provide
  the guarantee.
- Kit composition is captured at checkout and deployment rather than maintained as a standing record.
  This is the *Start Here* sheet's own stated design: "Equipment relationships will be captured during
  checkout and deployment. This ensures the system reflects the equipment currently in use without
  maintaining separate relationship records." Permanent components are the exception and are standing.
- Technicians hold assets; clients and subcontractors do not. Equipment left with a third party is
  modelled as a location.
- Migrated assets begin with an inventory-addition entry at the migration date, so history has a
  beginning. The 644 assets migrating in an unknown state inherit that ambiguity.
  *(Q3 resolved: they migrate as CheckedOut with no custodian, and the consequence is accepted — FR-025
  means an administrator performs the 644 sweep returns, since there is no custodian to authorise them.
  FR-015a in feature 002 supplies the working checklist for that sweep. This is intended, not
  discovered.)*
- The overdue-return notification, the calibration round-trip and the deployment transaction types are
  specified here as transaction *types* but their user-facing screens belong to features 004 and 005.
  This feature owns the recording mechanism and the derivation; those features own their journeys.
- Depends on 001 for identity, reference data and the read model, and on 002 for data worth transacting
  against. Blocks 004 and 005, which both record transactions through this mechanism.
