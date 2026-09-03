# Feature Specification: Production Readiness

**Feature Branch**: `009-production-readiness`  
**Created**: 2026-09-02  
**Status**: Draft — no tenant or production implementation claim  
**Input**: features 001–008 and `docs/13-production-readiness-review.md`.

## Purpose

Features 001–008 define and locally demonstrate the product. This feature defines the evidence required
before those features may be called tenant-implemented, secure, device-verified, pilot-accepted or
production-accepted.

## User Story 1 — Apply one complete event or none (P1)

A technician submits a checkout, return, transfer, deployment or other action covering several assets.
The system validates, records and applies the complete event together. If one asset is invalid, another
user acted first, or processing fails halfway, no partial header, line, asset state or relationship is
left behind.

**Acceptance scenarios**

1. Five valid assets produce one event, five immutable lines and five consistent state changes.
2. One invalid asset among five refuses the whole request and writes nothing.
3. A deliberate failure after partial work rolls all work back.
4. Two concurrent incompatible requests for one asset produce exactly one success.
5. Retrying the same submission returns the original result without creating a duplicate.
6. The server calculates before/after state and ignores client attempts to supply authoritative values.
7. A correction is a new event that references the original; the original remains unchanged.

## User Story 2 — Allocate stable identity safely (P1)

Two administrators register assets concurrently. Each receives a unique permanent Asset ID only when
the asset is committed. A temporary legacy tag can later be completed without changing the canonical
ID field or losing the old tag.

**Acceptance scenarios**

1. Concurrent registrations under one prefix receive distinct committed sequence values.
2. The client cannot select or reserve a canonical sequence using elevated credentials.
3. A temporary tag becomes a searchable alias when a canonical Asset ID is assigned.
4. Canonical Asset IDs remain immutable for every role.
5. Serial number remains searchable and non-unique.

## User Story 3 — Preserve simultaneous asset facts (P1)

An asset may be checked out, located at a project site, in need of repair and overdue for calibration at
the same time. The system stores and reports all of those facts rather than replacing them with one
catch-all status.

**Acceptance scenarios**

1. Reporting a fault does not erase custody, project or location.
2. Repair completion does not invent a return to an office.
3. An overdue deployed asset is excluded from availability and included in calibration oversight.
4. Missing/found and in-transit states have complete, attributable entry and exit paths.

## User Story 4 — Prove authorization through every path (P2)

Field users, administrators, managers and owners access data through the hosted app, direct data API,
exports and reports. Each path enforces the same approved permissions. Interface filtering is never the
security boundary.

**Acceptance scenarios**

1. Secured SIM and network attributes are unavailable to field users through every path.
2. An office-scoped administrator cannot modify another office through a direct API call.
3. If administrators are global instead, the role is named and documented honestly.
4. The ordinary manager reporting model contains no secured SIM or network columns.
5. Relationship cycles, self-parenting, second open parents and historical edits are refused server-side.
6. Routine automation runs under least privilege rather than broad owner authority.

## User Story 5 — Establish real mobile and offline behavior (P2)

The published app is tested on managed iOS and Android under signal loss, cold reopen, restart,
authentication expiry, identity change, camera-permission changes and replay conflict. Only behavior
proved on the hosted client is included in the pilot promise.

**Acceptance scenarios**

1. Online-to-offline use matches the documented supported behavior.
2. Cold reopen while offline either works as specified or gives an explicit unsupported message.
3. Queued work persists across restart only when that behavior has passed testing.
4. A different signed-in user cannot see or replay the prior user's cache or queue.
5. Reauthentication occurs before an expired queue is replayed.
6. A rejected replay remains in Needs Attention and is never silently discarded.
7. Field-user local storage contains no secured attributes.

## User Story 6 — Cut over and recover safely (P3)

The migration is rehearsed before the final freeze. Every later legacy-system change is included in a
traceable delta or reported. App rollback, platform recovery and business-data restore are treated as
three separate procedures.

**Acceptance scenarios**

1. Every change between rehearsal and freeze is loaded or reported with a reason.
2. Missing model-review or conflict-report sign-off blocks production loading.
3. Ambiguous calibration evidence stays unmatched until a person confirms the asset.
4. App rollback changes no business data.
5. Platform recovery and data restore have separate, rehearsed procedures.
6. Calibration documents remain recoverable after retirement and restore.

## Functional Requirements

### Authoritative transactions

- **FR-001**: System MUST expose one authoritative server operation for each event that changes asset
  state or relationships.
- **FR-002**: A multi-asset event MUST commit all headers, lines, derived fields and relationship changes
  together or commit none.
- **FR-003**: The authoritative operation MUST reload and validate every affected asset and open
  relationship at submission time.
- **FR-004**: One invalid asset or rule MUST refuse the complete event.
- **FR-005**: Before/after snapshots and side effects MUST be calculated by the server.
- **FR-006**: Concurrent incompatible events for one asset MUST be arbitrated so only one succeeds.
- **FR-007**: Every request MUST carry a unique client submission identifier.
- **FR-008**: Repeating the same identifier and payload MUST return the original result; a different
  payload under the same identifier MUST be refused.
- **FR-009**: Recorded time and effective business time MUST be stored separately.
- **FR-010**: Accepted headers and lines MUST be immutable; corrections MUST be compensating events.
- **FR-011**: The complete event MUST carry Applied, Rejected or Reversed status and attributable reason.
- **FR-012**: Asynchronous automation MAY reconcile or alert but MUST NOT ordinarily apply an already
  accepted event one line at a time.

### State and identity

- **FR-013**: Lifecycle, physical disposition, serviceability and calibration currency MUST be
  representable independently.
- **FR-014**: Fault and repair events MUST NOT overwrite valid custody, project or location facts.
- **FR-015**: Availability MUST require active lifecycle, serviceable condition and physical presence at
  the selected office.
- **FR-016**: Canonical Asset ID allocation MUST occur inside the authoritative registration operation.
- **FR-017**: A browser MUST NOT update sequence state using an elevated service identity.
- **FR-018**: Temporary and legacy tags MUST be aliases; canonical Asset IDs MUST remain immutable.

### Calibration and components

- **FR-019**: Current calibration dates MUST derive from the latest qualifying record by calibration
  date, not entry date.
- **FR-020**: Failed calibration MUST NOT advance the due date or return an asset to service.
- **FR-021**: Create, correction, reassociation, replacement and voiding of calibration evidence MUST
  recalculate current dates and retain audit history.
- **FR-022**: Legacy due-only evidence MUST be represented without inventing a calibration date.
- **FR-023**: Physical lab return and calibration evidence MUST be separate facts unless one approved
  action explicitly confirms both.
- **FR-024**: Permanent-component calibration behavior MUST be decided before production. If standalone
  despatch is allowed, the relationship remains open and parent-state propagation is suspended during
  the lab interval.

### Security, cache and reporting

- **FR-025**: Every permission MUST be enforceable independently of the interface.
- **FR-026**: Administrators MUST be explicitly global or office-scoped at the data/server layer.
- **FR-027**: Relationship cycles, self-parenting, multiple open parents and direct historical edits
  MUST be refused server-side.
- **FR-028**: Routine automation MUST use least privilege.
- **FR-029**: Cache and queues MUST be partitioned by environment and signed-in user and cleared or made
  inaccessible on identity change.
- **FR-030**: Field-user cache, export and ordinary manager reports MUST contain no secured SIM/network
  attributes.
- **FR-031**: Manager reporting MUST work without opening the Code App and MUST state its identity and
  authorization model.
- **FR-032**: Reporting recipients and required licences MUST be approved before sharing.

### Device evidence, cutover and recovery

- **FR-033**: Offline and scanner support MUST be defined by hosted iOS/Android evidence, not local mock
  behavior alone.
- **FR-034**: Any unverified offline behavior MUST be removed from pilot acceptance or marked unsupported.
- **FR-035**: Queued work MUST replay exactly once, only under its original authorized identity.
- **FR-036**: Production migration MUST include rehearsal snapshot, final delta, freeze time and legacy
  read-only transition.
- **FR-037**: Every post-rehearsal source change MUST be loaded or reported.
- **FR-038**: Ambiguous calibration records MUST remain unmatched until confirmed.
- **FR-039**: Required model and conflict sign-offs MUST block production loading when absent.
- **FR-040**: App rollback, platform recovery and data recovery MUST be separate procedures with named
  owners and tested recovery objectives.

### Evidence and status

- **FR-041**: Status MUST distinguish Spec Approved, Mock Implemented, Tenant Implemented, Security
  Verified, Device Verified, Pilot Accepted and Production Accepted.
- **FR-042**: A feature MUST NOT be described as production-built while its real backend, tenant
  integration or required verification is stubbed.
- **FR-043**: Every production gate MUST have dated evidence, a named owner and a pass/fail result.
- **FR-044**: All seven programme acceptance questions MUST be answered from tenant data before
  Production Accepted status is assigned.

## Success Criteria

- **SC-001**: Zero partial events in 100 deliberate multi-asset failure tests.
- **SC-002**: Exactly one success in every one of 100 concurrent double-booking tests.
- **SC-003**: Zero duplicate events from 100 response-lost retries.
- **SC-004**: 100 concurrent registrations produce 100 unique canonical Asset IDs.
- **SC-005**: Client-supplied state values cannot alter the server result.
- **SC-006**: Simultaneous custody, location, service and calibration facts reconcile across app and
  reporting.
- **SC-007**: Temporary and canonical tags both resolve to one asset after completion.
- **SC-008**: Calibration create/correct/void/fail tests produce zero current-date mismatches.
- **SC-009**: Every forbidden role action fails through app, direct API, export and report.
- **SC-010**: Zero secured attributes exist in field-user local storage or ordinary manager reporting.
- **SC-011**: Hosted iOS/Android evidence exists for every claimed offline and scanner behavior.
- **SC-012**: Final migration reconciliation accounts for every source row and post-rehearsal change.
- **SC-013**: App rollback, platform recovery and data restore each pass rehearsal.
- **SC-014**: Every gate has named ownership and retained evidence.
- **SC-015**: The seven acceptance questions are answered live from tenant data before production
  acceptance.

## Dependencies

This feature depends on 001–008 and blocks Tenant Implemented, Security Verified, Device Verified,
Pilot Accepted and Production Accepted status for them.