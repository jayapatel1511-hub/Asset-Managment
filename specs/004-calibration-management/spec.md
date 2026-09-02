# Feature Specification: Calibration Management

**Feature Branch**: `004-calibration-management` (directory-selected; set `SPECIFY_FEATURE=004-calibration-management`)

**Created**: 2026-09-02

**Status**: Draft — 2 blocking clarifications open (Q4, and the reminder cadence in US4). Q5 resolved 2026-09-02; see `docs/08-decisions.md`

**Input**: `IM30 - Asset Managment via M365.docx` § What We Need → Calibration Status, § Reporting ("What equipment requires calibration?"), § Future Enhancements (calibration reminders, document storage for certificates); `Asset AMS - SharePoint.xlsx` sheet *Assets - Calibration History* (253 records) and *Start Here* (Calibration form draft, Montreal Calibration Portal); `docs/01-data-model.md`, `docs/03-automation.md` (flows F2, F3)

## User Scenarios & Testing *(mandatory)*

Calibration is the one part of this system with an external consequence. An out-of-calibration
seismograph produces readings that a client, a consultant or a court can reject, and the instrument
gives no indication that anything is wrong. The current state of this data is the clearest argument for
the whole programme: the registry has a `Next Calibration Due` column that is empty in all 1,053 rows,
and a separate sheet of 253 calibration records that cannot be joined to any asset because it has no
Asset ID.

So the fleet's calibration status today is, in practice, unknown.

### User Story 1 - Know what is coming due (Priority: P1)

An office admin asks what needs calibration in the next 30, 60 or 90 days, and gets a list per office
with the overdue items at the top. They can plan a shipment to the lab instead of discovering the
problem when a technician is already on site.

**Why this priority**: This answers acceptance question 5, and it delivers value the moment 002's
history is loaded — with no new data entry at all. It is also the cheapest thing in the feature: a
filtered list over dates the migration already established.

**Independent Test**: Load the migrated calibration history, ask an admin to produce the next quarter's
calibration plan from the app alone, and check it against the lab's own records.

**Acceptance Scenarios**:

1. **Given** assets with next-due dates, **When** the admin selects a 30-day horizon, **Then** all
   Active assets due within 30 days are listed, grouped by home office, with a count per group.
2. **Given** an asset whose next-due date has passed, **When** the list is produced, **Then** it appears
   above the not-yet-due items and is marked overdue with the number of days.
3. **Given** an asset with no next-due date, **When** the list is produced, **Then** it appears in a
   distinct "calibration status unknown" group rather than being omitted, because omission is what
   made the old data untrustworthy.
4. **Given** a Retired asset, **When** any calibration list is produced, **Then** it is excluded.
5. **Given** an asset of a model that requires no calibration, **When** lists are produced, **Then** it
   never appears in a due or unknown group.
6. **Given** the admin changes the horizon to 90 days, **When** the list refreshes, **Then** it reflects
   the new horizon without reloading the application.
7. **Given** an item on the list, **When** the admin selects it, **Then** they reach that asset's detail
   and its calibration history.

---

### User Story 2 - Record a completed calibration and keep the certificate (Priority: P2)

An instrument comes back from the lab with a certificate. The admin records the calibration date, the
certificate number, the cost and the result, and attaches the PDF. The asset's next-due date updates
itself, and the certificate is retrievable years later by anyone who needs to prove the instrument was
in calibration on a given day.

**Why this priority**: This is what keeps US1 true over time. Without it, the due dates the migration
established decay and the list becomes wrong within a year. It is P2 rather than P1 only because US1
delivers standalone value from migrated data first.

**Independent Test**: Record calibrations for ten assets with certificates attached, then confirm each
asset's next-due date moved correctly and each certificate opens from the asset's detail screen.

**Acceptance Scenarios**:

1. **Given** an admin records a calibration with a date, **When** they save, **Then** the next-due date
   is prefilled from that model's calibration interval and remains editable.
2. **Given** a saved calibration record, **When** the asset is viewed, **Then** its last calibration and
   next-due dates match that record.
3. **Given** an asset with several calibration records, **When** the asset is viewed, **Then** its
   last-calibration and next-due dates reflect the most recent record by calibration date, not the most
   recently entered.
4. **Given** a certificate document, **When** the admin attaches it, **Then** it is stored and is
   openable from the asset's calibration history by any user permitted to see the asset.
5. **Given** a calibration whose result is a failure, **When** it is recorded, **Then** the asset does
   not return to service on the strength of it, and its condition is reflected rather than its date
   being advanced.
6. **Given** a calibration date in the future, **When** the admin attempts to save, **Then** it is
   refused.
7. **Given** a Field User, **When** they view an asset, **Then** they can read its calibration history
   and open certificates but cannot record a calibration.
8. **Given** a recorded calibration, **When** an admin discovers an error in it, **Then** it can be
   corrected, and the correction is attributable — calibration records are corrigible, unlike
   transaction lines, because they describe an external document rather than an internal event.

---

### User Story 3 - Send equipment to the lab and get it back (Priority: P3)

An instrument leaves for Montreal. While it is away it must not appear as available, must not be
packable, and its location must say where it actually is. When it returns calibrated, it rejoins the
pool.

**Why this priority**: Prevents the specific, expensive mistake of a technician packing an instrument
that is in a courier's van. But it is a small population at any moment, and the interim workaround —
the admin reports it as unavailable — is functional.

**Independent Test**: Send three assets to the lab, verify none can be checked out and all three show
the lab as their location, then record their calibrations and verify they return to Available.

**Acceptance Scenarios**:

1. **Given** an Available or NeedsRepair asset, **When** it is sent to the lab, **Then** its status
   becomes InCalibration, its location becomes the lab, and it has no custodian.
2. **Given** an asset in calibration, **When** anyone attempts to check it out, **Then** it is refused.
3. **Given** an asset in calibration, **When** its calibration is recorded, **Then** it returns to
   Available at its home office without an admin setting its status by hand.
4. **Given** an asset in calibration that the lab reports as unrepairable, **When** the admin retires
   it, **Then** the retirement is permitted directly from that state.
5. **Given** a shipment of eight assets to the lab, **When** it is recorded, **Then** it is one action
   producing one entry per asset, as with any other multi-asset transaction.

---

### User Story 4 - Be told before it is too late (Priority: P4)

Office admins receive a scheduled summary of what is coming due and what is overdue for their office,
in the tools they already have open, without logging into anything.

**Why this priority**: The brief lists calibration reminders under Future Enhancements, and US1 already
makes the information available on demand. Notification converts a pull into a push, which matters, but
it is the last thing that should be built and the first thing that should be switched off if it becomes
noisy.

**Independent Test**: Set an asset's next-due date to trigger each threshold, and verify the right
admin for the right office receives exactly one notification per threshold, and that nothing is sent
when nothing is due.

**Acceptance Scenarios**:

1. **Given** assets due within the reminder horizon, **When** the daily summary runs, **Then** each
   office's admins receive one notification listing their office's due and overdue assets.
2. **Given** nothing due for an office, **When** the summary runs, **Then** that office receives no
   notification.
3. **Given** an overdue asset, **When** the notification is produced, **Then** it is distinguished from
   the merely-due items.
4. **Given** a notification, **When** the admin opens it, **Then** it links directly to the due list in
   the app.
5. **Given** the same asset remains due for several days, **When** summaries run, **Then** the admin is
   not notified about it repeatedly beyond a defined cadence.
   [NEEDS CLARIFICATION: what cadence — daily until actioned, weekly, or once per threshold crossing?]

### Edge Cases

- **An asset whose model has no calibration interval set.** Recording a calibration cannot prefill a
  next-due date; the admin must supply one, and the asset must not silently acquire a null due date
  that hides it from US1.
- **A calibration recorded for an asset already past due.** The next-due date is computed from the
  calibration date, not from the old due date, so a late calibration does not stay late.
- **Components calibrated separately from their parent.** A microphone pre-amp and element carry their
  own certificates. If they are not separate assets, their calibration cannot be tracked at all.
- **Two calibrations recorded for the same asset on the same date**, typically a duplicate entry. Must
  be detectable.
- **A certificate uploaded against the wrong asset.** Must be correctable without deleting the
  calibration history.
- **An asset in calibration when the migration runs.** Its physical location is the lab but the source
  data will say an office.
- **The 40 calibration records with no calibration date** but a next-due date. The due date is still
  actionable; the history is incomplete. They must load, not be dropped.
- **An asset that is checked out and becomes due.** It cannot be sent to the lab until it returns; the
  due list must still show it, with its custodian, so someone can chase it.
- **Calibration intervals that differ by use rather than by model** — an instrument on a
  vibration-sensitive project may need more frequent checks. The model default must be overridable per
  asset or per record.

## Requirements *(mandatory)*

### Functional Requirements

**Due-date visibility**

- **FR-001**: Users MUST be able to list Active assets whose next calibration falls within a selectable
  horizon, grouped by home office with counts.
- **FR-002**: System MUST distinguish overdue assets from upcoming ones and MUST show how overdue.
- **FR-003**: System MUST list assets with no known next-due date as a distinct group rather than
  omitting them.
- **FR-004**: System MUST exclude Retired assets and assets of non-calibrated models from all due
  lists.
- **FR-005**: System MUST show, for each due asset, its current status and custodian, so an asset that
  is out can be chased.
- **FR-006**: Users MUST be able to reach an asset's detail and calibration history from any due list.
- **FR-007**: System MUST flag an overdue calibration wherever the asset is displayed, not only in the
  due list.

**Recording**

- **FR-008**: Administrators MUST be able to record a calibration with its date, next-due date,
  performing lab, certificate number, cost and result.
- **FR-009**: System MUST prefill the next-due date from the asset's model calibration interval and
  MUST allow it to be overridden.
- **FR-010**: System MUST require a next-due date when the model supplies no interval.
- **FR-011**: System MUST refuse a calibration date in the future.
- **FR-012**: System MUST derive each asset's last-calibration and next-due dates from its most recent
  calibration record by calibration date.
- **FR-013**: System MUST NOT accept last-calibration or next-due dates as direct user input on the
  asset.
- **FR-014**: Administrators MUST be able to correct a calibration record, and System MUST record who
  changed it and when.
- **FR-015**: System MUST detect and warn on a second calibration recorded for the same asset on the
  same date.
- **FR-016**: System MUST NOT advance an asset's next-due date on the strength of a failed calibration.

**Certificates**

- **FR-017**: Administrators MUST be able to attach a certificate document to a calibration record.
- **FR-018**: System MUST make an attached certificate openable from the asset's calibration history by
  any user permitted to view the asset.
- **FR-019**: System MUST retain certificates for the life of the asset and beyond its retirement.
- **FR-020**: System MUST allow a certificate to be replaced or re-associated without deleting the
  calibration record.

**Lab round-trip**

- **FR-021**: Users MUST be able to record the despatch of one or more assets to a calibration lab in a
  single action.
- **FR-022**: System MUST set a despatched asset's status to in-calibration, its location to the lab,
  and MUST clear its custodian.
- **FR-023**: System MUST refuse checkout, transfer and deployment of an asset in calibration.
- **FR-024**: System MUST return an asset from calibration to Available at its home office when its
  calibration is recorded, without an administrator setting status directly.
- **FR-025**: System MUST permit retirement of an asset directly from in-calibration.
- **FR-026**: System MUST record every lab despatch and return through the same transaction mechanism
  as every other state change.

**Notification**

- **FR-027**: System MUST notify each office's administrators, on a schedule, of that office's due and
  overdue assets, deriving the set of offices from the location table at run time so that a newly added
  office is covered without configuration.
- **FR-027a**: System MUST report an office that has no administrator assigned as a gap, rather than
  skipping it silently.
- **FR-028**: System MUST send nothing to an office with nothing due.
- **FR-029**: System MUST distinguish overdue from upcoming in the notification.
- **FR-030**: System MUST link from the notification to the due list.
- **FR-031**: System MUST limit repeat notification about the same asset to a defined cadence.
- **FR-032**: System MUST allow notification to be disabled without affecting US1.

**Model intervals**

- **FR-033**: Administrators MUST be able to set a default calibration interval per equipment model,
  including "not calibrated".
- **FR-034**: System MUST allow an interval to be overridden for an individual asset or record.

### Key Entities *(include if feature involves data)*

- **Calibration Record**: One calibration event for one asset — when it happened, when the next is due,
  which lab, the certificate reference and document, the cost, and the outcome. Unlike a transaction
  line, this is corrigible: it describes an external document that may itself be reissued.
- **Calibration Interval**: The default months-between-calibrations, carried by the equipment model,
  overridable per asset. The reason `Next Calibration Due` can be computed rather than typed — and
  computing it is why all 1,053 source rows could be blank without anyone noticing.
- **Calibration Lab**: Not a new entity — a location of type calibration lab. Montreal Calibration is
  the known one.
- **Certificate**: A stored document associated with a calibration record. Held in the document library,
  referenced from the record.
- **Due List**: Not stored — a defined query over assets and their next-due dates, so it cannot drift
  out of step with the records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An office admin produces a correct, complete list of what is due in the next 90 days for
  their office in under 30 seconds, with zero items missing when checked against the lab's records.
- **SC-002**: 100% of Active assets of calibrated models have either a next-due date or an explicit
  "unknown" classification. Zero assets are silently absent from calibration oversight.
  *(Baseline: 0 of 1,053 rows carry a next-due date.)*
- **SC-003**: 100% of the 253 migrated calibration records are either linked to an asset or listed as
  unmatched with a reason — inherited from feature 002's SC-005 and re-verified here.
- **SC-004**: An admin records a calibration including certificate upload in under 2 minutes.
- **SC-005**: Every asset's displayed last-calibration and next-due date agrees with its most recent
  calibration record, for 100% of a sampled 50 assets.
- **SC-006**: Zero assets in calibration are successfully checked out, verified by attempting it.
- **SC-007**: An asset returns from calibration to Available with zero direct status edits, verified by
  audit log.
- **SC-008**: A certificate from a calibration recorded at go-live is still retrievable, from the asset,
  12 months later.
- **SC-009**: Office admins report the calibration reminder as useful rather than noise at the end of
  the pilot month, and zero admins have muted it.
- **SC-010**: Acceptance question 5 is answered live from production data in a review meeting.

## Assumptions

- Calibration intervals are a property of the equipment model, with per-asset override as the exception.
  [NEEDS CLARIFICATION: Q4 — no intervals are set anywhere in the source data. Instantel and Sigicom
  loggers and sensors are assumed to be 12 months; sound level meters and acoustic calibrators may
  differ, and total stations may follow a different regime entirely. Without these, FR-009 cannot
  prefill and every calibration record requires a manually-entered due date]
- Calibration is tracked at the level of the asset that carries the certificate, and a sound level
  meter's pre-amp and element are each such an asset. *(Q5 resolved: they get their own Asset IDs and
  attach to the meter as permanent Components. So acoustic calibration is fully trackable — each
  component holds its own records, certificates and due date, and each appears in the due lists of US1
  in its own right. The registry holds roughly 1,150 assets. Note the consequence for FR-001: a due
  list will show a pre-amp due while its meter is not, and the admin must be able to see that the two
  travel together.)*
- The 40 calibration records carrying a next-due date but no calibration date are still worth loading —
  the actionable field is the due date.
- One external lab (Montreal Calibration) handles most work; the model supports others without change.
- Certificates arrive as PDFs and are small. Storage is the existing document library, and permissions
  follow the site rather than being managed per certificate.
- The reminder horizon is 30 days with overdue always included. Configurable, not hard-coded, because
  the right horizon will be argued about after the first shipment.
- Notification reaches office admins via the collaboration tools already in daily use. The admin-to-
  office mapping is **derived from the location table**, not from a fixed file. *(Consequence of the
  N-offices decision: `data/reference/office_admins.csv` holds four offices and is therefore replaced —
  a fixed list would mean a new office silently receives no calibration reminders. FR-027 must fan out
  to whatever offices exist at the time it runs, and an office with no admin assigned must be reported
  as a gap rather than skipped.)*
- Depends on 001 for models and intervals, 002 for the migrated history, and 003 for the transaction
  mechanism that moves assets to and from the lab. Nothing depends on this feature except 006's
  calibration reporting.
