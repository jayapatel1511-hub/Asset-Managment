# Feature Specification: Release & Operations

**Feature Branch**: `008-release-and-operations` (directory-selected; set `SPECIFY_FEATURE=008-release-and-operations`)

**Created**: 2026-09-02

**Status**: Draft — US1 built 2026-09-02 (WS-H; T012 deferred on a shared file, T032 blocked on WS-G's in-progress `tsc` errors). 3 clarifications open (offline support, mobile-player support, IP/location restriction policy) — they gate the pilot rollout and US2, **not US1**. plan.md added 2026-09-02; FR-001 reworded the same day

**Input**: Microsoft Learn `code-apps/overview`, `code-apps/how-to/create-an-app-from-scratch`, `code-apps/system-limits-configuration` (all verified 2026-08-19); `docs/10-integration.md`; `docs/06-delivery-plan.md` Step 0 and § "Definition of done"; `CLAUDE.md` ALM row; constitution Principle VI (maintainable by a successor) and Principle VII (no credentials, minimum sensitive data)

## User Scenarios & Testing *(mandatory)*

Every other feature in this programme serves a technician or an admin. This one serves the person
who has to **run** the system — the System Owner today, and the competent Power Platform
administrator who inherits it and has never met anyone who built it. Principle VI says the system
must be operable by that person. Until now nothing specified what "operable" means.

It earns a feature rather than a documentation section for two reasons. It has a real user with
real journeys — publish, verify, roll back, promote, monitor. And it has one requirement that is
genuinely safety-critical rather than procedural: **a release must be incapable of publishing the
fleet's data to a public endpoint**, which is a property of the system, not a note in a runbook.

That risk is concrete. Compiled app assets are served from a publicly accessible endpoint with no
IP-based restriction, and Microsoft's own guidance is explicit: *"Don't store sensitive user or
organizational data in the app."* The local mock backend loads 1,026 real assets — including SIM
ICCIDs, phone numbers and static IPs, the three attributes the sensitive-field profile exists to
protect — from files that the production build would bundle. One wrong environment variable
publishes them.

### User Story 1 - Publish a release that cannot leak data (Priority: P1)

The System Owner publishes a new version of the app. The build refuses to produce a publishable
bundle that contains fleet data or points at the local mock backend. They cannot make the
dangerous mistake, because the tooling will not let them.

**Why this priority**: It is the only requirement here that protects something irreversible.
Publishing is a one-way door — assets served from a public endpoint may be cached or retrieved
before anyone notices, and there is no recall. Every other story in this feature is about
convenience or confidence; this one is about not causing harm.

**Independent Test**: Attempt a release build with the local mock backend selected, and with the
staged fleet data present. Both must fail with a message naming the cause. Then inspect a
successfully produced bundle and confirm it contains no asset, ICCID, phone number or IP value.

**Acceptance Scenarios**:

1. **Given** a release build is started with the data backend unset or set to the local mock
   backend, **When** it runs, **Then** it fails with a message naming the variable and the correct
   value, and produces no publishable output.
2. **Given** a release build, **When** it runs, **Then** no staged fleet data file is copied into
   or bundled with the output, regardless of what is present in the working tree.
3. **Given** a produced release bundle, **When** it is searched for known values — a real Asset ID,
   an ICCID, a phone number, a static IP — **Then** none is present.
4. **Given** development-only affordances that stand in for tenant capabilities, **When** a release
   bundle is produced, **Then** they are absent from it, not merely hidden.
5. **Given** a release build, **When** it completes, **Then** it reports what backend it targeted
   and what it excluded, so the operator can see the safety checks ran rather than assuming they
   did.
6. **Given** a publish, **When** it succeeds, **Then** the operator is given the URL the app now
   runs at, and a record of which version is live.

---

### User Story 2 - Verify a release before anyone uses it (Priority: P2)

Before technicians see a new version, the System Owner confirms it actually works against real
data: the app loads, identity resolves, the seven acceptance questions still answer, and nothing
regressed.

**Why this priority**: Publishing without verification is how a field team loses a morning. It
ranks below US1 because a bad release is recoverable and a leaked release is not.

**Independent Test**: Publish to the development environment, run the verification list end to
end, and confirm each item passes or fails explicitly. Then deliberately break one thing and
confirm the list catches it.

**Acceptance Scenarios**:

1. **Given** a published release, **When** the operator opens it, **Then** identity resolves to
   their own account with their real role, without a development role picker.
2. **Given** a published release, **When** the operator exercises search, checkout, return and the
   calibration due list against real data, **Then** each behaves as its feature specifies.
3. **Given** a published release, **When** the operator navigates to a deep link and reloads the
   page, **Then** the app resolves it rather than failing — the app runs under a hosted sub-path,
   and absolute routing is the most likely thing to break on first publish.
4. **Given** a published release, **When** it is opened on a phone, **Then** the layout is usable at
   390 px and the platform header can be suppressed.
5. **Given** a verification run, **When** any item fails, **Then** the release is not promoted
   further until it is fixed or rolled back.

---

### User Story 3 - Roll back a bad release (Priority: P3)

Something is wrong in production. The System Owner returns users to the previous working version
quickly, without a rebuild and without waiting for a fix.

**Why this priority**: The safety net that makes US1 and US2 survivable. P3 because it is only
needed when something has already gone wrong, and the pilot is small enough that the blast radius
is contained.

**Independent Test**: Publish version A, publish version B, roll back, and confirm users are served
A again and no data was altered by the round trip.

**Acceptance Scenarios**:

1. **Given** a previous version exists, **When** the operator rolls back, **Then** users are served
   that version without a rebuild.
2. **Given** a rollback, **When** it completes, **Then** no recorded transaction, asset or
   calibration record is altered — the app is a client, and rolling it back changes no data.
3. **Given** a rollback, **When** it completes, **Then** which version is live is recorded.
4. **Given** a release that must be stopped immediately rather than reverted, **When** the operator
   acts, **Then** they can prevent users opening it at all.

---

### User Story 4 - Promote a change from development to production (Priority: P4)

Schema, flows, roles and the app move from the development environment to production as one
reviewable unit, in a repeatable order, with nothing configured by hand at the far end.

**Why this priority**: Essential for the second release and every one after, but the first
production deployment can be done attentively by hand. Deferring it does not block go-live; being
unable to repeat it does block the release after that.

**Independent Test**: Deploy the entire system into a fresh, empty environment from the repository
alone. Anything requiring an undocumented manual step is a defect — this is Principle VI's own
stated test.

**Acceptance Scenarios**:

1. **Given** the repository, **When** the system is deployed to an empty environment, **Then** it
   comes up with no undocumented manual step.
2. **Given** a promotion, **When** it runs, **Then** schema precedes reference data, which precedes
   assets, which precede flows, and each step's success is confirmed before the next begins.
3. **Given** a promotion to production, **When** it is attempted before the required sign-offs
   exist, **Then** it is refused — the migration conflict report and model review are hard gates.
4. **Given** a promoted environment, **When** it is compared with development, **Then** differences
   are limited to environment-specific configuration, and those are enumerated.

---

### User Story 5 - Know the system is unhealthy before a user tells you (Priority: P5)

When the state-derivation automation fails, a submission is stuck unprocessed, or the app starts
erroring, the System Owner finds out from the system rather than from a technician who cannot
check out a logger.

**Why this priority**: Real operational value, but the pilot is one office and the feedback loop is
short — someone will say something within the hour. It becomes important as the fleet scales past
the pilot, which is exactly when it is too late to start.

**Independent Test**: Cause a derivation failure and an unprocessed line, and confirm both surface
to the operator without anyone reporting them.

**Acceptance Scenarios**:

1. **Given** the derivation automation fails terminally on a transaction, **When** it fails,
   **Then** the operator is alerted with the asset and the submitter, and the line remains
   identifiable for reprocessing.
2. **Given** lines that remain unprocessed beyond a threshold, **When** the operator looks, **Then**
   they can see how many and reprocess them.
3. **Given** the platform's own health metrics, **When** the operator reviews them, **Then** app
   usage and error rates are visible without instrumenting the app separately.
4. **Given** an alert, **When** it is raised, **Then** it reaches a person, not only a log — a
   channel nobody reads is a log file with extra steps.

### Edge Cases

- **A release published with the local mock backend.** The failure this whole feature exists to
  prevent. Must be impossible, not discouraged.
- **A developer runs the release build on a machine where the staged data was never generated.**
  Must still produce a correct bundle rather than failing for the wrong reason.
- **The environment feature that permits this class of app is switched off** after the app is
  published. Behaviour is unknown and should be established before relying on it.
- **A deep link shared by a technician** — an asset URL pasted into a message — opened cold by
  someone else. Must resolve under the hosted path.
- **Two operators publish concurrently.** The later publish must not silently discard the earlier
  one without the operator knowing.
- **A rollback to a version whose expected data shape no longer matches** the schema, after a
  schema change has been promoted. Rolling the app back does not roll the schema back.
- **Licence exhaustion.** A technician opens the app and has no licence. The failure must be
  legible to them and visible to the operator.
- **Conditional access blocks a technician on a site with no corporate network.** Field work
  happens off-network by definition; an IP restriction designed for the office can lock out the
  people the system is for.

## Requirements *(mandatory)*

### Functional Requirements

**Release safety — the non-negotiable set**

- **FR-001**: The release build MUST fail, producing no publishable output, unless the data backend
  is explicitly set to the real data platform — the backend both the development and the production
  environments use. An unset value and the local mock backend are both refused. *(Reworded
  2026-09-02: "production backend" wrongly implied a build for the development environment was
  refused too.)*
- **FR-002**: The release build MUST exclude all staged fleet data from its output, and MUST NOT
  rely on an operator remembering to remove it.
- **FR-003**: A release bundle MUST contain no asset record, secondary identifier, phone number or
  network address.
- **FR-004**: A release bundle MUST NOT contain development-only stand-ins for tenant capabilities.
- **FR-005**: The release build MUST report which backend it targeted and what it excluded.
- **FR-006**: The system MUST NOT require any credential, key or secret to be present in the app or
  its bundle.

**Publishing**

- **FR-007**: The operator MUST be able to publish a release with a documented, repeatable command
  sequence that matches the platform's current supported tooling.
- **FR-008**: The system MUST record which version is live, and when it was published.
- **FR-009**: The operator MUST be given the address at which the published app runs.
- **FR-010**: The published app MUST resolve deep links correctly when served from a hosted
  sub-path, including on a cold page load.
- **FR-011**: The published app MUST be usable at 390 px and MUST allow the platform's own header
  to be suppressed.
- **FR-012**: The published app MUST obtain identity from the platform, with no separate sign-in and
  no development role selection.

**Verification**

- **FR-013**: A documented verification list MUST exist that exercises identity, the read model, a
  write, and the acceptance questions against real data.
- **FR-014**: Verification MUST be performed against the development environment before any
  production publish.
- **FR-015**: A failed verification item MUST block promotion until it is resolved or the release is
  withdrawn.

**Rollback**

- **FR-016**: The operator MUST be able to return users to the previously published version without
  rebuilding.
- **FR-017**: A rollback MUST NOT alter any recorded transaction, asset, relationship or calibration
  record.
- **FR-018**: The operator MUST be able to prevent users from opening a release immediately, as
  distinct from reverting it.
- **FR-019**: Rollbacks MUST be recorded.

**Promotion and lifecycle**

- **FR-020**: The whole system MUST be deployable into an empty environment from the repository
  alone, with no undocumented manual step.
- **FR-021**: Promotion MUST follow a stated order, confirming each step before the next.
- **FR-022**: Promotion to production MUST be refused until the required sign-offs are recorded.
- **FR-023**: Environment-specific configuration MUST be enumerated and separated from the
  promotable artefacts.
- **FR-024**: Sequence state MUST be isolated per environment so that a development run cannot
  consume production identifiers.

**Access control**

- **FR-025**: Access restriction by location or network MUST be achievable, and MUST NOT be assumed
  to come from the hosting endpoint, which does not support it.
- **FR-026**: Any access restriction MUST be validated against field use before enforcement —
  technicians work off the corporate network by definition.
- **FR-027**: Sensitive attributes MUST remain protected by the data platform's own field-level
  controls, not by the app withholding them.

**Operational visibility**

- **FR-028**: A terminal automation failure MUST alert a person, naming the affected asset and the
  submitter.
- **FR-029**: Submissions that remain unprocessed beyond a threshold MUST be discoverable and
  reprocessable.
- **FR-030**: An alert MUST reach a monitored destination, and the destination MUST be named and
  owned.
- **FR-031**: Platform health and usage metrics MUST be available to the operator without
  instrumenting the app separately.

**Documentation for the successor**

- **FR-032**: Every operational procedure in this feature MUST be written down where the operator
  will look for it, in enough detail for someone who did not build the system.
- **FR-033**: Prerequisites outside the repository — environment settings, licences, accounts,
  groups — MUST be enumerated with the exact place each is configured.

### Key Entities *(include if feature involves data)*

This feature introduces no stored business entity. Its artefacts are operational:

- **Release**: a published version — what was built, from what source state, targeting what
  backend, when, by whom, and whether it is live.
- **Verification run**: the outcome of the checklist against a release, item by item.
- **Environment profile**: the configuration that differs between development and production, held
  separately from the promotable artefacts.
- **Alert destination**: the named, owned channel that operational failures reach.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero release bundles containing fleet data or secured attributes are ever produced —
  verified by an automated check that runs as part of every release build, not by inspection.
- **SC-002**: A deliberate attempt to build a release against the local mock backend fails 100% of
  the time, with a message naming the cause.
- **SC-003**: An operator who has never published this app before completes a full publish and
  verification from the written procedure alone, with no help, in under 60 minutes.
- **SC-004**: A rollback completes in under 15 minutes from the decision, and alters zero records.
- **SC-005**: The system deploys into a fresh empty environment from the repository alone, with zero
  undocumented manual steps — Principle VI's own test.
- **SC-006**: 100% of terminal automation failures during the pilot reach a person before a user
  reports the symptom.
- **SC-007**: Zero unprocessed submissions remain undiscovered for longer than the stated threshold.
- **SC-008**: Zero technicians are blocked from legitimate field use by an access restriction,
  measured across the pilot month.
- **SC-009**: Deep links resolve on cold load in 100% of a sampled 10 links, on phone and desktop.

## Assumptions

- The operator is a competent Power Platform administrator, not a developer. Procedures assume the
  admin centre and the CLI, not a debugger.
- The app is a client. Rolling it back, republishing it or breaking it changes no business data —
  which is what makes US3 cheap and is a direct consequence of Principle I.
- Publishing is one-way with respect to disclosure. There is no recall for assets already served
  from a public endpoint, which is why FR-001 to FR-004 are build-time refusals rather than review
  steps.
- The platform's supported tooling changes. The command sequence documented in
  `docs/10-integration.md` was verified 2026-08-19, and the previously documented commands had
  already been deprecated — so the procedure must name its verification date and be re-checked at
  each release.
- Field technicians work off the corporate network routinely. Any location-based restriction is
  therefore a field-usability question before it is a security question.
- Two prerequisites sit outside this repository and block everything: the environment feature that
  permits this class of app, and a premium licence for every end user who opens it — not only
  makers. Both are in `docs/06-delivery-plan.md` Step 0.
- [NEEDS CLARIFICATION: **Offline.** The platform documentation states nothing either way about
  offline support for this class of app. Feature 003 US5 queues submissions and replays them, and
  technicians work in basements, piers and mine access. Whether the app loads at all without
  connectivity, and whether a service worker is permitted, must be established on the first day of
  tenant access — before the pilot depends on it]
- [NEEDS CLARIFICATION: **Mobile player.** The documentation states this class of app is not
  supported in the Windows client; it says nothing about iOS or Android. The app is designed
  phone-first at 390 px, and camera scanning depends on the answer. Whether technicians use the
  mobile app or a mobile browser changes the pilot rollout]
- [NEEDS CLARIFICATION: **IP and location restriction.** The hosting endpoint cannot restrict by
  IP; conditional access by location is the available control. Whether Englobe requires such a
  restriction, and whether it can accommodate off-network field use, is a security-policy decision]
- Depends on every other feature for what it publishes, and on nothing for its own logic. Blocks
  nothing during development and blocks *everything* at go-live.
