# 06 — Delivery plan

## Current programme status

The product specification, migration pipeline, responsive application and mock-backed journeys are
substantially implemented. That is **Mock Implemented**, not production-built.

Work in the order below. `docs/13-production-readiness-review.md` and feature 009 govern the path from
mock to tenant. Do not create the production schema from `docs/01-data-model.md` until Steps 0 and 1
are complete.

---

## Step 0 — Product, licensing and environment prerequisites — blocks everything after local work

### Jay decisions and sign-offs

- [ ] Q6 server/configuration treatment confirmed
- [ ] Q8 expected return confirmed
- [ ] Q9 backdating rule decided
- [ ] Q10 project master/source decided
- [ ] Q11 report audience and distribution decided
- [ ] Q18 permanent-component calibration decided
- [ ] administrators approved as global or data-layer-enforced by office
- [ ] permanent asset rehome workflow decided
- [ ] calibration failure and physical-receipt workflow decided
- [ ] `migration/reports/03_models_review.md` signed off
- [ ] `migration/reports/02_conflicts.md` signed off before any production load

### IT and licensing

- [ ] Power Apps entitlement confirmed in writing for every pilot app user
- [ ] Flow licensing selected for the automation identity or processes
- [ ] Power BI reader model and licensing confirmed
- [ ] Development and production environments created in Canada
- [ ] Code Apps enabled in each environment
- [ ] Dedicated least-privilege automation identity and Entra groups created
- [ ] Build machine authenticated with the supported Power Platform CLI
- [ ] Alert destination created with a named owner and monitored membership

**DoD:** decisions and sign-offs are recorded in `docs/08-decisions.md`; external prerequisites have
named owners and evidence.

---

## Step 1 — Production architecture proof — blocks schema creation

### 1A. State and identity model

- [ ] Replace the catch-all status design with an approved model that independently represents
      lifecycle, physical disposition, serviceability and calibration currency
- [ ] Define complete paths for transit, missing/found, fault/repair and lab movement
- [ ] Add a canonical Asset Identifier/Alias model so temporary and legacy tags do not require the
      canonical Asset ID to change
- [ ] Define permanent-component exceptions, including calibration, damage, missing, replacement and
      retirement

### 1B. Authoritative transaction command

Design and prove one synchronous authoritative server operation for every state-changing event. Begin
with checkout and demonstrate:

- [ ] server reload and validation of every affected asset and relationship
- [ ] server-computed before/after snapshots and side effects
- [ ] one transaction header plus immutable lines
- [ ] derived asset and relationship changes in the same commit
- [ ] complete rollback on a deliberate mid-operation exception
- [ ] concurrency arbitration from two devices
- [ ] exactly-once retry using a client submission identifier
- [ ] recorded time distinct from effective business time
- [ ] compensating-event correction rather than header/line edits

The recommended implementation for the selected stack is a synchronous Dataverse Custom API backed by
transactional server logic. Any alternative must prove the same behavior.

### 1C. Server-side registration

- [ ] sequence allocation and asset creation occur in one server operation
- [ ] the browser holds no service-account credential or impersonation authority
- [ ] 100 concurrent registrations under one prefix produce 100 unique IDs

**DoD:** feature 009 SC-001 to SC-005 pass against a development data platform. The existing F1 flow is
reclassified as reconciliation/repair, not the ordinary mechanism that partially applies accepted
transactions.

---

## Step 2 — Canonical schema, roles and solution

Create one versioned schema covering all features rather than creating the original nine tables and
adding untracked exceptions later.

Required entities include:

- Asset and Asset Identifier/Alias
- Equipment Model
- Location and Office Administrator Assignment
- Project
- Transaction and Transaction Line, including whole-event result and idempotency fields
- Asset Relationship
- Calibration Record
- Installation and Installation Component
- ID Sequence
- notification state/history where repeat suppression requires it
- synthetic run/provenance where tenant loading is permitted

For every column record purpose, type, requiredness, defaults, keys, indexes, relationships, delete
behavior, auditing, field security, cache behavior, migration rule and retention.

Also add structured ownership and an explicit permanent home-office transfer/rehome mechanism.

- [ ] solution and publisher created
- [ ] schema, choices, keys, indexes and relationships created
- [ ] Field User, Administrator, Owner and least-privilege automation roles created
- [ ] secured SIM/network field profile created
- [ ] relationship constraints and authoritative command deployed
- [ ] application user and connection references configured without embedded secrets

**DoD:** solution export succeeds; a fresh-environment import succeeds; forbidden direct API writes fail
for every role in the security matrix.

---

## Step 3 — Migration rehearsal in Development

Use the existing cleaning and reporting pipeline, but add the real-target writer and cutover controls.

- [ ] use the corrected calibration export
- [ ] load reference data, assets, inventory events and calibration evidence through supported APIs
- [ ] keep ambiguous calibration evidence unmatched until a person confirms it
- [ ] replace the temporary custodian allowlist with real directory resolution
- [ ] write source/staged/target reconciliation counts and identifiers
- [ ] run the full load twice and verify no duplicate business records
- [ ] rehearse a changed-source delta after the first load
- [ ] prove sequence state is isolated by environment

**DoD:** feature 002 acceptance criteria pass against real Development rows; every source record is
loaded or reported; the second run produces no duplicates; the delta rehearsal accounts for every
change.

---

## Step 4 — Real backend and hosted Code App

- [ ] implement the real backend behind `AmsBackend`
- [ ] route every write through the authoritative server operation
- [ ] remove development role switching and mock-only controls from release builds
- [ ] publish with the release-data guard and real backend selected
- [ ] confirm hosted identity, deep links and 390 px layout
- [ ] connect the production barcode/QR scanning capability
- [ ] display whole-event pending/applied/rejected status rather than relying only on line processing

**DoD:** features 001–005 are Tenant Implemented in Development; no screen writes derived fields
directly; a five-asset transaction is atomic and exactly-once.

---

## Step 5 — Automation and document integration

Build scheduled and asynchronous work only after the authoritative write path is complete.

- [ ] reconciliation/reprocess flow for genuinely incomplete system work
- [ ] calibration recalculation on create, correction, reassociation, replacement and void
- [ ] calibration reminders with approved cadence and bounded message size
- [ ] overdue-return reminders
- [ ] Teams/email delivery as best-effort with logged failures
- [ ] SharePoint certificate upload with attach-later behavior, unique naming, approved type/size limit,
      attribution and retention beyond retirement
- [ ] each flow has a README covering trigger, reads, writes, identity, retries and terminal failure

**DoD:** automation failure produces an owned alert; failed notification does not corrupt business
state; certificate and record failure modes are independently recoverable.

---

## Step 6 — Power BI reporting

The in-app Reports section remains useful for licensed app users but does not satisfy feature 006's
manager-access requirement.

- [ ] choose and document per-viewer or shared-model authorization
- [ ] remove ICCID, phone number and static IP from the ordinary manager semantic model
- [ ] implement Fleet, Where/Who, Availability, Calibration, By Project, Timeline and Utilisation pages
- [ ] state data currency on every page
- [ ] reconcile every figure to operational queries
- [ ] test the report as every recipient role
- [ ] confirm reader licensing and distribution

**DoD:** managers can answer the seven acceptance questions without opening the Code App; no recipient
sees a prohibited record or field.

---

## Step 7 — Security, device and recovery verification

Complete `specs/009-production-readiness/checklists/requirements.md`.

### Security

- [ ] direct API, export and report role matrix passes
- [ ] office scope is enforced or the administrator role is explicitly global
- [ ] relationship invariants cannot be bypassed
- [ ] automation identity is least privilege

### Hosted mobile and offline

Test published iOS and Android behavior for:

- [ ] online-to-offline use
- [ ] cold close/reopen while offline
- [ ] device restart
- [ ] queued checkout/return/transfer
- [ ] conflict created from another device
- [ ] expired authentication token
- [ ] signed-in user change on the same device
- [ ] scanner permission denied/granted/interrupted
- [ ] secured data absent from Field User local storage

Any failed capability is removed from pilot acceptance or explicitly marked unsupported.

### Recovery

- [ ] previous app release restored
- [ ] platform/solution recovery rehearsed separately
- [ ] business-data restore rehearsed separately
- [ ] certificate documents and links recovered
- [ ] RPO, RTO, backup owner and restore-test frequency approved

**DoD:** features can be marked Security Verified and Device Verified with dated evidence.

---

## Step 8 — Ottawa pilot

- [ ] freeze Ottawa's legacy source and load the final delta
- [ ] keep other offices on the legacy source read-only within their own rollout boundary
- [ ] complete the unknown-custodian return sweep
- [ ] perform at least 20 real checkout/return cycles
- [ ] track rejected conflicts, partial-event count, support incidents and unprocessed work
- [ ] physically verify a sample of available stock and calibration status
- [ ] answer all seven acceptance questions from tenant data

Pilot acceptance requires:

- zero partial multi-asset actions;
- zero direct user writes to derived state;
- every deliberate double-booking refused;
- zero silently lost queued submissions within the supported offline scope;
- no unauthorized secured-field exposure; and
- owned monitoring and recovery procedures.

---

## Step 9 — Production rollout by office

- [ ] review pilot findings and amend specs/decisions
- [ ] repeat rehearsal, freeze, delta and reconciliation per office
- [ ] re-parent locations and assign administrators through approved workflows
- [ ] load remaining offices in controlled waves
- [ ] retire the legacy write paths after reconciliation
- [ ] conduct post-rollout restore and alert tests

---

## Definition of done — whole programme

- All seven acceptance questions are answered live from production tenant data.
- Features are marked Production Accepted only after Spec Approved, Tenant Implemented, Security
  Verified, Device Verified and Pilot Accepted evidence exists.
- Multi-asset events are atomic, server-authoritative and exactly-once.
- Current state is derived without a direct user write path.
- The solution imports cleanly into a fresh environment with no undocumented manual step.
- Migration and final deltas account for every source record.
- Report and cache paths expose no secured fields to unauthorized users.
- App rollback, platform recovery and data restore are separate, rehearsed procedures.
- `docs/` and `specs/` match the approved production behavior; every deviation is recorded in
  `docs/08-decisions.md`.
