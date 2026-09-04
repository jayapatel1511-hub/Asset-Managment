# Feature Specification: Asset Registry

**Feature Branch**: `001-asset-registry` (directory-selected; set `SPECIFY_FEATURE=001-asset-registry`)

**Created**: 2026-09-02

**Status**: Draft — built 2026-09-02. Open: Q6 (proceeded on: Azure rows excluded, three appliances kept), Q10. Q4 done as data work, awaiting sign-off. Q1, Q2, Q5 and Q13 resolved. FR-010 corrected 2026-09-02 to the three-part catalogue key — see `docs/08-decisions.md`

**Input**: `IM30 - Asset Managment via M365.docx` § Objective, § What We Need → Asset Registry; `Asset AMS - SharePoint.xlsx` sheets *IM Asset Registry* (1,053 rows) and *Start Here* (Asset ID conventions, asset group taxonomy); `docs/00-brief.md`, `docs/01-data-model.md`

> **D18 access/presentation amendment (2026-09-04):**
> [`docs/25-need-to-know-access-ux.md`](../../docs/25-need-to-know-access-ux.md) governs what each
> workspace may fetch and display. Registry truth remains complete server-side; Field Work receives a
> purpose-sized identity/current-context/readiness projection, not the full asset record.

## User Scenarios & Testing *(mandatory)*

A technician standing in a storage room with a phone, and an office admin at a desk, are the two
people this feature serves. Everything below is written from their position, not the system's.

### User Story 1 - Find one asset and see what it is and where it is (Priority: P1)

A technician has a physical instrument in front of them, or a serial number written on a work order,
and needs to know: what is this, whose is it, where does the system think it is, and is it due for
calibration. They type or scan an identifier and get one screen with the answer.

**Why this priority**: This is the first independently testable read slice and the screen every other
feature launches from. It is not a viable operating release on its own: pilot scope must include the
truth-restoring Checkout + Return loop so the catalogue does not decay after launch.

**Independent Test**: Load the migrated inventory, hand a technician a physical instrument, and ask
them to identify it and state only the Work-authorized current context without opening Excel or asking
a colleague. This verifies the read slice; it does not qualify a pilot without transactions.

**Acceptance Scenarios**:

1. **Given** an asset tagged `DL-UM-16984` is in the technician's authorized Work scope, **When** the
   technician enters `16984` in search, **Then** the asset appears within 2 seconds showing its
   friendly equipment label, Asset ID and only the qualified current context/readiness fields allowed
   by the Work projection.
2. **Given** the serial `UM16984` belongs to both a data logger and a geophone, **When** the
   technician searches `UM16984`, **Then** both assets are listed and visually distinguished by
   equipment type and Asset ID, and neither is silently preferred.
3. **Given** a Field Work asset detail is open, **When** the technician looks at it, **Then** identity,
   qualified current context, one server-derived recorded-readiness message, permitted actions and a
   short relevant activity summary are visible without a tab maze; maintenance records, certificate
   links, costs, audit detail, data-quality entities and unrelated people are absent from the response.
4. **Given** an asset whose recorded calibration policy blocks use, **When** its Field detail opens,
   **Then** it shows `Use blocked — {reason}` and the permitted next action. A due date may be shown
   when policy permits, but no calibration history or evidence metadata is returned.
5. **Given** a search term matching nothing, **When** it is submitted, **Then** the technician is told
   nothing matched and is offered the option to search by model instead — not shown an empty screen.
6. **Given** a Field User is viewing a SIM asset, **When** the detail screen renders, **Then** ICCID,
   phone number, static IP, internal identifiers and other Administration-only fields are absent from
   the server response, cache and DOM rather than merely hidden.

---

### User Story 2 - See what is available at my office right now (Priority: P2)

A technician is packing for tomorrow's site visit and needs to know what usable equipment is sitting
in their office: three loggers, four geophones, a working modem. They filter to their own office and
to Available, and get a list they can pack from.

**Why this priority**: Answers acceptance question 4. It is the second-most-used screen and it is what
turns the registry from a lookup tool into a planning tool. It depends on US1's read model but is
independently valuable and independently testable.

**Independent Test**: Ask a technician to produce tomorrow's packing list from the app alone, then
physically verify the listed items are in the room.

**Acceptance Scenarios**:

1. **Given** the technician's home office is Ottawa, **When** they open the availability filter,
   **Then** only Active assets whose current location is Ottawa and whose status is Available are
   listed, grouped by equipment type with a count per group.
2. **Given** an asset is Retired, **When** any availability list is produced, **Then** it never
   appears.
3. **Given** an asset is CheckedOut, Deployed, at the lab, blocked by a recorded repair state or
   Missing, **When** the availability list is produced, **Then** it is excluded. Work does not reveal
   an unrelated custodian merely to explain unavailability.
4. **Given** the technician attempts to choose an office outside their authorized Work row scope,
   **When** the filter opens or a direct request is made, **Then** that office is unavailable and no
   protected count or row is fetched.

---

### User Story 3 - Add a new asset with a correct, unique, permanent tag (Priority: P2)

An office admin unboxes a new Instantel Micromate. They pick the model from the catalogue, enter the
serial, and the system proposes the Asset ID that must be printed on the label. The admin cannot
create a duplicate, cannot invent a model, and cannot encode the current office into the tag.

**Why this priority**: Without this, the registry decays from the day it launches — new equipment
arrives weekly. It is also where Principles III and IV are enforced at the point of entry, which is
far cheaper than enforcing them in a cleanup script later.

**Independent Test**: Give an admin three real new instruments and a label printer, and confirm the
three resulting Asset IDs are unique, correctly prefixed, and match the physical labels.

**Acceptance Scenarios**:

1. **Given** the admin selects model *Instantel Micromate* (prefix `DL-UM`) and enters serial
   `UM21999`, **When** the ID is proposed, **Then** it is `DL-UM-21999` — the manufacturer code is not
   duplicated into the tag.
2. **Given** the admin selects a non-serialised model such as a SIM (prefix `DST`), **When** the ID is
   proposed, **Then** it is the next unused sequence value for that prefix, zero-padded, and that
   value is not offered to a second admin working at the same moment.
3. **Given** the proposed Asset ID already exists, **When** the admin attempts to save, **Then** the
   save is refused with the existing asset shown, so the admin can tell a duplicate from a
   re-registration.
4. **Given** the admin tries to type a manufacturer or model that is not in the catalogue, **When**
   they attempt it, **Then** there is no free-text field. They receive an explicit handoff to the
   governed Feature 011 reference workflow only if authorized, otherwise instructions to request a
   steward change.
5. **Given** a new asset is created, **When** it is saved, **Then** a history entry recording its
   addition to inventory exists, and its status is Available at its home office.
6. **Given** an existing asset, **When** any user with any role attempts to change its Asset ID,
   **Then** the field is not editable.

---

### User Story 4 - Consume a governed model catalogue and location hierarchy (Priority: P3)

The registry consumes the governed lists everything else picks from: equipment models with their
manufacturer, category, ID prefix and default calibration interval; and the location tree of regions,
offices, sites, calibration labs and vehicles. Feature 011 owns create/edit/deactivate/re-parent/merge
commands, impact previews and approvals in Administration; this feature owns lookup integrity and
correct registry behavior after those commands succeed.

**Why this priority**: Curated references are a prerequisite, but the registry must not create a
second, weaker administration path. Phase 1 may consume reviewed migration seeds while the governed
Feature 011 Administration workflow is gated.

**Independent Test**: Add a genuinely new model (a manufacturer the fleet has never held) and confirm
an asset of that model can then be registered, calibrated and reported on with no other change.

**Acceptance Scenarios**:

1. **Given** a new model is added, **When** the admin saves it, **Then** manufacturer, model, equipment
   type, asset group, ID prefix, whether it is serialised, and its identifier type are all required.
2. **Given** a model whose manufacturer, model name and equipment type duplicate an existing row,
   **When** it is saved, **Then** the save is refused.
3. **Given** a model with a default calibration interval of 12 months, **When** an asset of that model
   has a calibration recorded, **Then** the next due date defaults to 12 months later.
4. **Given** an office is added under a region, **When** the location tree is displayed, **Then** the
   parent relationship is visible and an office may not be its own ancestor.
5. **Given** a location is referenced by at least one asset, **When** an admin attempts to delete it,
   **Then** the deletion is refused and deactivation is offered instead.

---

### User Story 5 - Retire an asset without losing its record (Priority: P3)

An instrument is sold, lost, damaged beyond repair, or obsolete. An office admin retires it with a
reason. It leaves every operational list but its history remains queryable forever.

**Why this priority**: Needed for the registry to stay credible — five assets in the current data are
already Retired and 121 have no status at all. Low frequency, so P3.

**Independent Test**: Retire an asset, confirm it disappears from search defaults and availability
lists, and confirm its full history is still reachable by direct lookup and by report.

**Acceptance Scenarios**:

1. **Given** an admin retires an asset, **When** they submit, **Then** a retirement reason is required
   from a fixed list (Sold / Lost / Damaged / Obsolete).
2. **Given** an asset is Retired, **When** it is retired, **Then** its custodian, project and current
   location are cleared and its history entries are unchanged.
3. **Given** a Retired asset, **When** a technician searches its Asset ID exactly, **Then** it is
   found and clearly badged as Retired, so a physical instrument found in a cupboard can still be
   identified.
4. **Given** a Retired asset, **When** any user attempts to check it out, **Then** the action is
   unavailable.
5. **Given** a Field User, **When** they view any asset, **Then** no retire action is offered.

---

### User Story 6 - Scan a tag instead of typing (Priority: P3)

A technician points the phone camera at a label and the asset opens. Where the code on the label is a
bare manufacturer serial rather than an Asset ID, the system resolves the ambiguity by asking rather
than guessing.

**Why this priority**: Meaningful speed and accuracy gain in the field, but strictly an accelerator —
US1 already works by typing. Depends on labels existing, which depends on 002 completing.

**Independent Test**: Print labels for twenty assets including at least two that share a serial, and
confirm each scan reaches the right asset in one action, or one action plus one disambiguating tap.

**Acceptance Scenarios**:

1. **Given** a label encoding `DL-UM-16984`, **When** it is scanned, **Then** that asset's detail
   screen opens directly.
2. **Given** a label encoding the bare serial `UM16984`, which matches two assets, **When** it is
   scanned, **Then** both candidates are offered with their equipment type, and the technician picks.
3. **Given** a scanned code matching no asset, **When** the scan resolves, **Then** the technician is
   told the tag is unknown and offered a search prefilled with the scanned text.
4. **Given** the device has no camera permission, **When** the scan action is used, **Then** the
   technician is told why and returned to text search rather than shown a blank camera view.

### Edge Cases

- **Asset with no serial number.** 26% of current rows have none. It must still be registerable and
  findable — by Asset ID, model and location — and a sequence-based tag must be available for it.
- **Two physically distinct assets sharing one serial.** Expected in 132 cases. Search must present
  both; nothing may treat serial as unique.
- **Prefix-only legacy tag** (`GEO-`, `DL-` — 27 rows). Must be findable and visibly flagged as
  needing completion, not hidden and not silently renamed.
- **An asset whose model is later reclassified** (e.g. a Sigicom V12 corrected from Data Logger to
  Geophone). The asset keeps its Asset ID; the change is to the model record, and the asset's history
  is not rewritten.
- **Concurrent registration of two non-serialised assets of the same prefix.** Two admins must not
  receive the same sequence number.
- **Search while offline.** Cached Active assets remain searchable; the technician is told the data is
  cached and as of when.
- **Field User attempting to read a secured attribute via export or report.** Must be denied by the
  data layer, not by the absence of a UI control.
- **Location deactivated while assets still reference it.** Assets keep the reference; the location
  stops being offered for new assignments.
- **An asset group or equipment type that has no assets.** Must not break grouped counts or produce an
  empty group row.

## Requirements *(mandatory)*

### Functional Requirements

**Identity and integrity**

- **FR-001**: System MUST assign every asset an immutable, unique, human-readable Asset ID that is
  distinct from its internal primary key.
- **FR-002**: System MUST refuse creation of a second asset bearing an existing Asset ID.
- **FR-003**: System MUST prevent modification of an Asset ID after creation, for every role.
- **FR-004**: System MUST NOT encode office, project, custodian, status, or any other mutable
  attribute in the Asset ID.
- **FR-005**: System MUST store serial number as a searchable, indexed, **non-unique** attribute, and
  MUST support two or more assets sharing one serial.
- **FR-006**: System MUST mint Asset IDs as `{model prefix}-{serial digits}` for serialised models and
  `{model prefix}-{zero-padded sequence}` for non-serialised models, and MUST NOT repeat the
  manufacturer code already present in the serial.
- **FR-007**: System MUST guarantee that a sequence value is issued to at most one asset, under
  concurrent creation.

**Reference data**

- **FR-008**: System MUST hold manufacturer, model, equipment type, asset group, location, project and
  staff as lookups to curated records, with no free-text alternative on the asset.
- **FR-009**: System MUST require every asset to reference exactly one equipment model.
- **FR-010**: System MUST enforce uniqueness of manufacturer + model + equipment type in the model
  catalogue. *(Corrected 2026-09-02: manufacturer + model alone would merge three real catalogue rows
  in which one product is classified under different equipment types — see `docs/08-decisions.md`.
  The display name carries the type where needed so the rows stay distinguishable.)*
- **FR-011**: System MUST support a hierarchical location structure covering region, office, site,
  vehicle, calibration lab, client premises and storage, and MUST prevent cyclic parentage.
- **FR-011a**: System MUST support an unbounded number of offices, at any level of the hierarchy,
  added, deactivated or moved through governed Feature 011 reference commands without a configuration
  or code change. No fixed office list may exist
  anywhere — not in the schema, the interface, the automation, the notification configuration, or a
  reference file.
- **FR-011b**: A caller with the exact Feature 011 reference capability, approved Administration
  purpose and impact preview MUST be able to re-parent a location—move an office under a different
  region, or promote it—without altering any asset that references it or editing asset records.
- **FR-011c**: System MUST derive every per-office behaviour, including notification recipients and
  availability grouping, from the location table as it stands, so that a newly added office is served
  immediately.
- **FR-012**: System MUST allow reference records to be deactivated but MUST refuse deletion of any
  record still referenced by an asset or a history entry.
- **FR-013**: Users MUST be able to add an equipment model or location only in Administration with the
  exact approved reference-data purpose, named capability and row scope. An administrative role label
  alone is insufficient.

**Read model and search**

- **FR-014**: Users MUST be able to search assets by Asset ID, serial number, secondary identifier and
  equipment model name or equipment type, matching partial values without requiring enum casing or
  punctuation.
- **FR-015**: System MUST maintain the complete registry facts but return only the versioned
  workspace/purpose projection for each asset. Field Work is limited to identity, qualified current
  context, recorded readiness, permitted actions and short relevant activity; Reports and
  Administration use their own explicit allowlists.
- **FR-016**: System MUST exclude Retired assets from default search results and from all availability
  lists, while keeping them retrievable by exact Asset ID and by report.
- **FR-017**: Users MUST be able to filter only the asset rows and dimensions authorized for the active
  workspace and purpose. Field Work MUST NOT expose organization-wide custodian, maintenance or
  governance facets; Reports and Administration define separate scoped facets.
- **FR-018**: System MUST provide a filter for assets currently held by the signed-in user.
- **FR-019**: Work MUST present calibration only through the signed, server-derived recorded-readiness
  result and permitted next action; technical maintenance records and evidence remain in
  Administration or an approved evidential purpose.
- **FR-020**: System MUST indicate, when displaying cached data, that the data is cached and the time
  it was retrieved.
- **FR-021**: Users MUST be able to open an asset by scanning a machine-readable tag, and System MUST
  present a choice rather than a guess when a scanned value resolves to more than one asset.

**Lifecycle**

- **FR-022**: A user in Administration with `asset.register` and matching row scope MUST be able to
  register a new asset, and System MUST record that registration as a history entry.
- **FR-023**: System MUST set a newly registered asset to Available at its home office.
- **FR-024**: A user in Administration with `asset.retire` and matching row scope MUST be able to
  retire an asset, and System MUST require a reason from a fixed list.
- **FR-025**: System MUST clear custodian, assigned project and current location on retirement, and
  MUST leave all history entries intact.
- **FR-026**: System MUST retain a retired asset and its complete history indefinitely. *(Q13 resolved:
  indefinite. The fleet is small and the history is text; a damage claim can arrive years after an
  instrument is sold. An archive policy is a later decision, not a design constraint now.)*

**State ownership** *(this feature displays state; feature 003 produces it)*

- **FR-027**: System MUST NOT expose any user-facing write path to current status, current location,
  custodian, assigned project or parent asset.
- **FR-028**: System MUST deny direct update privileges on those derived attributes to every principal,
  including SystemOwner. Only named server-authoritative business commands may change their source
  facts.

**Sensitive data**

- **FR-029**: System MUST NOT store login credentials or passwords in any field, note or attachment.
- **FR-030**: System MUST return SIM ICCID, phone number and static IP only from a named Administration
  projection when the request has `network.asset.read`, matching row scope and an approved purpose;
  role membership alone never releases them.

**Localisation**

- **FR-031**: System MUST source all user-facing labels from a string table, so a second language can
  be added without changing screens.

### Key Entities *(include if feature involves data)*

- **Asset**: One physical, individually trackable item. Carries its permanent tag, the model it is an
  instance of, its identifying serial or secondary identifier, the office it belongs to, its lifecycle
  state, its notes, and — as derived values it never writes itself — where it is, who has it, what
  project it is on, and what it is attached to.
- **Equipment Model**: A manufacturer-and-model combination the fleet holds one or more of. Owns the
  classification (equipment type, asset group), the Asset ID prefix, whether instances are serialised,
  what kind of identifier they carry, and the default calibration interval. This is the record that
  makes `Geohpone` and `Air Quailty Monitroing` impossible.
- **Location**: A place an asset can be, arranged as a tree — region contains offices, an office
  contains sites and vehicles — and typed, so that a calibration lab and a client site are
  distinguishable. Used for both home office and current location. The tree is open-ended: any number
  of offices, added and re-parented by administrators, with every per-office behaviour derived from it
  rather than configured against a fixed list.
- **Project**: A project number and name assets can be assigned to, with a status so closed projects
  stop being offered.
- **ID Sequence**: The next unused number per Asset ID prefix. Exists solely so that FR-007 holds.
- **Staff**: Not a new entity — the existing directory identity. Custodians are directory users, never
  typed names. The current data holds `James Ross`, `JR`, and `Noah M` as three separate spellings;
  this is why.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A technician locates a specific asset and reads its current location and custodian in
  under 10 seconds from opening the app, on a phone, having been given only a serial number.
- **SC-002**: 100% of registered assets resolve to exactly one curated equipment model; zero assets
  carry a free-text manufacturer, model, type or group value.
- **SC-003**: Zero duplicate Asset IDs and zero blank or prefix-only Asset IDs exist in the registry at
  any time after go-live. *(Baseline: 29 duplicates and 27 blank/prefix-only today.)*
- **SC-004**: 100% of the 132 shared-serial cases resolve to two distinct assets, both findable by that
  serial, with neither hidden.
- **SC-005**: A technician produces a correct packing list of available equipment at their office
  without consulting a colleague or a spreadsheet, verified against physical stock with zero
  discrepancies attributable to the registry's display.
- **SC-006**: An office admin registers a new asset, including choosing its model and obtaining its
  printable tag, in under 90 seconds.
- **SC-007**: Zero credential-bearing fields exist in the schema, verified by schema review at each
  release.
- **SC-008**: A Field User cannot retrieve ICCID, phone number or static IP by any means available to
  them, verified by attempting it through search, detail, export and report.
- **SC-009**: Search returns first results within 2 seconds at 1,500 assets, and within 3 seconds at
  5,000.
- **SC-010**: Acceptance questions 1, 2, 3 and 4 are answered live from this feature alone, in a review
  meeting, using migrated production data.
- **SC-011**: An administrator adds a new office and re-parents an existing one entirely from the app,
  in under 5 minutes, with zero configuration changes, zero deployments and zero developer involvement.
  Verified by adding an eleventh office and confirming it immediately appears in availability grouping
  and receives calibration notifications.

## Assumptions

- Every asset in scope is individually and physically tagged, or will be during the 002 migration and
  its follow-up audit. Untagged items get a temporary tag rather than being omitted.
- Custodians are Englobe staff with directory accounts. Equipment lent to a client or a subcontractor
  is modelled as a location, not as a custodian. *(No current row contradicts this.)*
- Technicians have smartphones capable of running the app and, for US6, of scanning a code; a phone
  with no camera degrades to typed search rather than losing the feature.
- Reference data volumes stay small — under 200 equipment models, under 100 locations, under 2,000
  projects — so a picker over the full list is acceptable without server-side paging.
- The fleet grows to roughly 5,000 assets within five years. Design targets that, not 50,000.
- Project numbers are seeded from the ~80 distinct values present in the export and thereafter added by
  admins. [NEEDS CLARIFICATION: Q10 — is there an ERP or project system to sync from instead? If so,
  US4's project screens change from create-and-edit to read-only-plus-refresh]
- The office structure is not fixed and is not the migration's business. *(Q1 and Q2 resolved: the
  hierarchy supports N offices, admin-managed and re-parentable in-app — FR-011a to FR-011c. All ten
  distinct source office values are therefore seeded as offices under Ontario, one for one, with no
  inference; SWO, Mississauga and Thunder Bay are re-parented by an admin afterwards on a screen. This
  is strictly better than deciding it in a script: no asset receives a guessed home office, and the
  structure stays changeable as the business changes.)*
- The equipment model catalogue is corrected before migration. *(Q4 done 2026-09-02: 35 of 64 draft
  rows corrected — the Larson Davis 831C prefix, the swapped manufacturer/model columns, the Sigicom
  V12 type — and calibration intervals set or explicitly nulled; reviewable at
  `migration/reports/03_models_review.md`, awaiting Jay's read-through. FR-009 holds against the
  corrected catalogue.)*
- Servers are treated as assets of equipment type Server, non-serialised, never checked out.
  [NEEDS CLARIFICATION: Q6 — the 16 rows naming `Azure`, `THOR`, `Vision` and `INFRANet` may be
  configuration rather than trackable equipment. If they are configuration, they leave this feature
  entirely] *(Proceeded on 2026-09-02: the 13 `Azure` rows excluded as configuration; the 3 named
  appliances kept as Server — `docs/08-decisions.md`. Needs Jay's confirmation.)*
- A sound level meter is three assets: the meter, its pre-amp and its element. *(Q5 resolved: separate
  Asset IDs, attached to the meter as permanent Components. They move with the meter automatically and
  never appear in a checkout cart, but each holds its own calibration records and certificates — which
  is the point, since they are calibrated separately. The registry therefore holds roughly 1,150
  assets, not 1,050, and feature 004 tracks calibration per component.)*
- Labels for US6 encode the Asset ID. Legacy labels encoding a bare serial exist in the field and are
  handled by the disambiguation in FR-021 rather than by a relabelling programme.
- This feature depends on 002 for its initial contents and on 003 to keep its derived state true. It
  is specified and testable without either: with an empty registry it supports US3 and US4, and with a
  migrated registry it supports US1, US2, US5 and US6.
