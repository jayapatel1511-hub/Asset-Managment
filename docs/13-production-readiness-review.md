# 13 — Production architecture review and approval gates

**Date:** 2026-09-02  
**Status:** Proposed for approval  
**Scope:** Independent review of the governing constitution, features 001–008, data model, automation,
migration, security, integration, UI, release controls and build report.

## Executive decision

The repository is approved as a **functional specification and working mock prototype**. It is **not
approved as the production architecture** yet.

The local implementation proves the product journeys, migration rules, domain logic, responsive UI and
mock-backed reporting. It does not yet prove the properties that depend on the real tenant: atomic
multi-asset state changes, server-side arbitration, production identity and authorization, field-level
security through every access path, report security, hosted scanning, offline cold start, solution
promotion or recovery.

Until every gate in this document passes, project status must be reported as:

> **Functional specification and mock prototype complete; production architecture approval pending.**

## Maturity vocabulary

Do not use **Built** by itself. Use one of these states:

1. **Spec Draft** — requirements exist but are not approved.
2. **Spec Approved** — product behavior is agreed.
3. **Mock Implemented** — behavior works against local or synthetic data.
4. **Tenant Implemented** — the real data platform, identity and integrations are connected.
5. **Security Verified** — direct API, export and reporting tests confirm authorization.
6. **Device Verified** — hosted phone, scanner, interruption and offline tests pass.
7. **Pilot Accepted** — the Ottawa pilot meets its acceptance criteria.
8. **Production Accepted** — rollout, monitoring and recovery are approved.

Features 001–006 are presently **Mock Implemented**. Feature 007 is in progress. Feature 008 US1 is
Mock Implemented. The Dataverse backend, schema, deployed flows, published Power BI model and tenant
security remain outside that claim.

---

## P0 — Atomic transaction application

### Finding

The app creates one transaction header plus multiple transaction lines in a batch, but F1 is triggered
once per line and applies each asset's state separately. A five-asset checkout can therefore be fully
recorded while only some of its asset-state changes are applied if a later line is rejected or a flow
fails. That contradicts feature 003 FR-003 and SC-009.

### Required behavior

One authoritative synchronous command must own a business transaction from validation through commit.
For every checkout, return, transfer, deployment, recovery, calibration despatch, repair, missing/found
or retirement action, it must:

1. authenticate and authorize the caller;
2. reload every affected asset and relationship;
3. validate every requested transition and all required fields;
4. refuse the entire request if any asset is invalid or changed;
5. compute the authoritative before/after values on the server;
6. create the header and all immutable lines;
7. update every derived asset field and dated relationship;
8. commit all writes together or commit none; and
9. return one transaction number and one final result.

The current F1 logic should become **reconciliation and repair**, not the normal authority that turns an
already accepted transaction into current state.

### Recommended implementation in the chosen stack

A Dataverse Custom API backed by a synchronous plug-in transaction. The implementation plan may choose
another mechanism only if it demonstrates the same atomicity, authorization and conflict behavior.

### Proof required

- Two devices attempt to check out the same asset at the same time: exactly one succeeds.
- A five-asset request containing one invalid asset changes zero assets and records no partial event.
- A deliberate exception after the third line rolls back the header, every line, every derived field
  and every relationship.
- Retrying an acknowledged or ambiguous request records exactly one transaction.

---

## P0 — Server ownership of state and identity

### State snapshots

`statusbefore`, `statusafter`, previous/new location, custodian, project, parent and relationship effects
are authoritative facts. The client may preview them but must not supply values the server trusts.

The server must calculate and persist those values from the current records and the requested action.
A direct API caller must not be able to submit a fabricated `statusafter` or rewrite the source of a
history entry.

### Asset ID allocation

The browser must not update `eng_idsequence` through service-account impersonation. Sequence allocation
and asset creation belong in one server-side registration command. A preview may be shown as
non-binding; the committed ID is returned only after the sequence and asset are saved together.

### Required transaction fields

Add these to the canonical transaction design before schema creation:

| Field | Purpose |
|---|---|
| `eng_clientsubmissionid` | Alternate key for exactly-once retry behavior |
| `eng_recordedat` | When the system accepted the event |
| `eng_effectiveat` | When the business event occurred |
| `eng_submissionstatus` | Applied / Rejected / Reversed |
| `eng_appliedat` | When derived state was committed |
| `eng_rejectioncode` | Stable machine-readable refusal reason |
| `eng_rejectiondetail` | Human-readable explanation |
| `eng_correctstransaction` | Optional reference to the event being corrected |

`eng_processed` on an individual line is not sufficient as the status of the whole business event.

---

## P0 — State model correction

The current single `eng_assetstatus` choice combines physical disposition, serviceability, calibration
process and lifecycle. This produces incomplete journeys: an item can be checked out and broken at the
same time, but one status cannot express both; repair completion can incorrectly make an item Available
without resolving custody or location; and `InTransit` is listed without a complete transaction path.

Before the Dataverse schema is created, the approved model must represent these independently:

- **Lifecycle:** Active / Retired
- **Disposition:** AtOffice / CheckedOut / Deployed / InTransit / AtCalibrationLab / Missing
- **Serviceability:** Serviceable / NeedsRepair / OutOfService
- **Calibration currency:** derived from calibration records and dates, not typed as an exclusive state

The exact names may change, but the model must represent simultaneous custody, physical location,
service condition and calibration condition without discarding one fact to store another.

Every existing transition and report measure must be revalidated against the approved model before the
real schema is created.

---

## P0 — Temporary identifiers versus immutable Asset IDs

Feature 001 requires an immutable Asset ID, while feature 002 allows `TMP-*` to be replaced by a
permanent ID. Both statements cannot describe the same field.

Add an `eng_assetidentifier` entity or an equivalent alias model:

| Field | Purpose |
|---|---|
| asset | The physical asset |
| identifier | The searchable value |
| type | CanonicalAssetID / TemporaryTag / LegacyTag / Serial / ICCID / IMEI |
| valid from / valid to | Identifier history |
| is current | Current label indicator |
| created by transaction | Audit trail |

A temporary tag remains searchable forever as a legacy alias. Once the canonical Asset ID is assigned,
it is immutable.

---

## P0 — Calibration semantics

The production design must distinguish a calibration date from physical receipt of an asset and must
handle result, correction and historical entry consistently.

| Result | Update last successful calibration | Advance next due | Return to service |
|---|---:|---:|---:|
| Pass | Yes | Yes | Yes, after receipt is confirmed |
| Adjusted and accepted | Yes | Yes | Yes, after receipt is confirmed |
| Fail | No | No | No |

Recalculation must run when a calibration record is created, corrected, replaced or voided, and must
select the latest qualifying record by **calibration date**, not entry date.

The schema currently requires a calibration date while the migration includes legacy rows that have a
next-due date but no calibration date. Resolve this explicitly by either permitting a typed
`LegacyDueDateOnly` record or introducing a separate schedule/evidence record. Do not invent a date.

Recording a certificate must not by itself claim that equipment has physically returned from the lab
unless the approved operating process confirms both facts in one action.

---

## P0 — Permanent component calibration

Q18 is an architecture blocker, not a minor workflow preference. Pre-amps and elements have their own
certificates and due dates, while permanent components normally mirror the parent and carry no lines of
their own.

Recommended resolution:

- permit exactly `SendToCalibration` and `ReturnFromCalibration` on a permanent component;
- keep the component relationship open;
- suspend parent-to-component state propagation while the component is at the lab;
- leave the parent unaffected;
- show the exception from both the parent and component records; and
- continue to refuse all other standalone component transactions.

Also specify separately what happens when a permanent component is damaged, missing, retired, replaced
or becomes overdue while its parent is deployed.

---

## P1 — Security model

### Administrator scope

Choose one model and state it honestly:

- **Global AMS Administrator:** every administrator may administer every office; or
- **Office-scoped Administrator:** office assignment is enforced by the data platform or the
  authoritative server command on every write.

Organization-level table privileges plus interface filtering are not office-level security.

### Immutable headers

Transaction headers and lines become immutable after acceptance. Backdating is selected at creation,
validated server-side and bounded. A correction is a new compensating event that references the
original. Do not allow an administrator to edit an accepted transaction's effective date, locations,
users or projects in place.

### Relationships

Server-side validation must prevent cycles, self-parenting, two open parents, invalid parent/child model
combinations and direct editing of historical spans. Kit relationships are created only by an approved
transaction. Permanent component attach/detach is itself an attributable event.

### Service account

Replace broad System Owner access with a least-privilege automation role. It should read only what each
flow needs and write only approved derived fields, notification state and system-generated events.

### Offline cache

Secured SIM and network attributes must never enter a Field User's cache. Cache and queues must be
partitioned by user and environment, cleared on identity change, time-limited and never replayed under a
different account.

---

## P1 — Reporting and licensing

The in-app Reports surface is useful to already licensed app users. It does not satisfy feature 006's
requirement that managers read reports without opening the app.

The Power BI design must explicitly select one security model:

1. per-viewer identity reaching the data platform; or
2. a shared semantic-model identity with tested row/object security.

The manager semantic model should exclude ICCID, phone number and static IP entirely. Hiding a visual is
not authorization.

Power Apps and Power BI licensing decisions remain production gates. Budget on the documented Code App
requirement unless a current written licensing interpretation says otherwise.

---

## P1 — Hosted device and offline proof

[Unverified] The current browser queue proves persistence and replay logic after the app is loaded. It
does not prove that the hosted application can cold-start without connectivity or that identity,
scanner and cached data remain available in the intended phone client.

Before offline is included in the pilot promise, test the published app on managed iOS and Android:

1. load online, enter airplane mode, search and submit;
2. close and reopen while offline;
3. reboot and reopen while offline;
4. queue checkout, return and transfer;
5. create a conflict from a second device;
6. reconnect and verify ordered exactly-once replay;
7. repeat with an expired authentication token;
8. change signed-in user on the same device; and
9. confirm secured fields never enter local storage.

If cold start fails, remove offline from the pilot acceptance criteria or change the application
architecture before pilot approval. Do not describe offline as production-ready on the strength of the
mock queue alone.

---

## P1 — Migration cutover

The idempotent cleaning pipeline is strong, but a frozen 2026-09-02 snapshot is not a future cutover
plan. Add:

- rehearsal snapshot and final delta export;
- freeze date and exact read-only transition;
- reconciliation of records changed since rehearsal;
- ownership of each office's cutover;
- handling of transfers between a migrated and legacy office;
- pre/post-load counts and hashes;
- rollback criteria; and
- a physical stock-validation sample.

Ambiguous compliance records must remain unmatched until a person confirms the asset. Do not attach an
ambiguous calibration to the logger by default merely to reduce the unmatched count.

The model review and conflict report remain hard production-load gates.

---

## P1 — Release, rollback and recovery

Document three separate recovery paths:

1. **App rollback:** restore a previous front-end release.
2. **Solution rollback:** handle schema, flow, security-role and configuration compatibility.
3. **Data recovery:** restore Dataverse and SharePoint business records.

Define RPO, RTO, backup ownership, restore-test frequency, emergency app disablement and SharePoint
certificate recovery. A previous app bundle is not a rollback for an incompatible schema or corrupted
data.

---

## Additional canonical-schema requirements

Before Step 1 creates Dataverse objects, one versioned schema must include every table introduced or
implied by features 001–009:

- Asset and Asset Identifier/Alias
- Equipment Model
- Location and Office Administrator Assignment
- Project
- Transaction and Transaction Line
- Asset Relationship
- Calibration Record
- Installation and Installation Component
- ID Sequence
- Notification delivery/state history if threshold-crossing suppression is retained
- Synthetic dataset/run provenance where synthetic rows are tenant-loadable

For every field record: logical/display name, purpose, type, requiredness, default, keys, indexes,
relationships, delete behavior, auditing, field security, cache behavior, source feature, migration rule
and retention rule.

Add structured ownership (`Owned`, `Leased`, `Rented`, `ClientOwned`, `SubcontractorOwned`) rather than
parsing ownership from notes. Add an explicit permanent rehome workflow for changing an asset's home
office. Add a per-asset calibration-interval override field or narrow feature 004 to record-level
overrides.

---

## Approval gates

### Gate A — Product decisions

- Q6 server/configuration handling confirmed
- Q8 expected return confirmed
- Q9 backdating decided
- Q10 project source decided
- Q11 report audience/licensing decided
- Q18 component calibration decided
- global versus office-scoped administrators decided
- permanent rehome workflow decided
- calibration failure/receipt workflow decided
- ownership categories decided

### Gate B — Architecture

- state model approved
- authoritative synchronous transaction command designed
- server-side asset registration and ID allocation designed
- canonical schema approved
- immutable event and correction model approved
- reporting security model approved

### Gate C — Tenant proof

- real schema and backend implemented
- transaction atomicity/concurrency tests pass
- field and office authorization verified through direct API calls
- Power BI security verified as each role
- hosted scanning and deep links pass
- mobile/offline test passes or offline is removed from scope

### Gate D — Migration rehearsal

- corrected calibration export used
- ambiguous records resolved or left explicitly unmatched
- both production sign-offs recorded
- full load re-run produces no duplicates
- delta load and rollback rehearsal pass

### Gate E — Ottawa pilot

- zero direct user writes to derived state
- zero partial multi-asset actions
- all deliberate double-bookings refused
- alert destination is owned and monitored
- support and recovery procedures are active
- the seven acceptance questions are answered from tenant data

## Priority after this review

Do not invest next in additional screens or additional synthetic history. The highest-value next proof is:

1. one synchronous atomic five-asset checkout;
2. server-side Asset ID allocation;
3. direct-API security verification; and
4. hosted-phone offline/cold-start verification.

Those four results decide whether the chosen production architecture is sound.