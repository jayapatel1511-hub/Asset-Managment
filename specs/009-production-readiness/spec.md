# Feature Specification: Production Readiness

**Feature Branch**: `009-production-readiness`  
**Created**: 2026-09-02  
**Status**: Draft — no tenant or production implementation claim  
**Input**: features 001–008 and `docs/13-production-readiness-review.md`.

> **D18 access amendment (2026-09-04):** `docs/25-need-to-know-access-ux.md` is authoritative for
> workspace, purpose, capability, row-scope and field-projection behavior. A role is only a coarse
> assignment ceiling. It never grants every route or field associated with that role name.

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

Field users, office administrators, system owners and report readers may enter only their eligible
Work, Reports or Administration workspace. Every hosted-app, direct-API, export, document and report
path enforces the same intersection of tenant/environment, active workspace, route purpose, named
capability, row scope and explicit field projection. Interface filtering is never the security boundary.

**Acceptance scenarios**

1. A Field User receives the Work projection only: no calibration history, certificate links, maintenance
   history, cost, data-quality entities, audit detail, secured SIM/network attributes or Administration
   queue data exists in the response, cache, export or UI.
2. An OfficeAdmin cannot read or modify another office through any direct or indirect path.
3. A SystemOwner has a global row-scope ceiling, but is still denied when the workspace, purpose, named
   capability or field projection does not permit the request.
4. A ReportReader receives a separate read-only Reports workspace, never Field navigation, Scan,
   Administration or general-report secured fields.
5. A wrong-workspace or forbidden direct link is rejected before any protected resource or existence
   lookup; browser restoration cannot reveal previously cached privileged content.
6. Switching workspace, identity or capability set partitions or purges protected cache and queued data.
7. Relationship cycles, self-parenting, second open parents and historical edits are refused server-side.
8. Routine automation runs under least privilege rather than broad owner authority.

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
7. Field-user local storage contains only the approved Field Work projection and zero forbidden
   maintenance, evidence, cost, performer, audit, data-quality, secured-network, free-text,
   internal-identifier or unrelated-people fields.

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
  representable independently. **No axis value may duplicate a fact another axis already carries.**
  Concretely: `lifecycle` and `disposition` and `serviceability` are three separate stored columns, and
  calibration currency is derived from calibration requirement, calibration records, due date and the current
  date **only** — never from `disposition`. Amended 2026-09-03, see below.
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

- **FR-025**: Every protected request MUST be authorized server-side as the intersection of authenticated
  identity, tenant/environment, active workspace, route purpose, named capability, row scope and explicit
  field projection. Role membership alone MUST NOT authorize a request.
- **FR-026**: OfficeAdmin MUST be assigned-office scoped. SystemOwner MAY have a global row-scope ceiling,
  but MUST NOT inherit Work, Reports, evidence, financial, stewardship or document capabilities.
- **FR-027**: Relationship cycles, self-parenting, multiple open parents and direct historical edits
  MUST be refused server-side.
- **FR-028**: Routine automation MUST use least privilege.
- **FR-029**: Cache and queues MUST be partitioned by environment, tenant, signed-in identity, workspace
  and projection version; identity, workspace, row-scope or capability change MUST purge or make prior
  protected entries inaccessible.
- **FR-030**: Field Work responses, cache and exports MUST omit calibration records and certificate links,
  maintenance history, costs, performer identities, data-quality entities, audit detail, secured
  SIM/network attributes, unrestricted free text and internal identifiers. General Reports MUST use its
  own allowlisted read model and apply the same exclusions unless a separately approved evidential purpose
  explicitly requires a field.
- **FR-031**: Reporting MUST be a separate read-only Reports workspace in the same hosted web application,
  without requiring the Power Apps runtime. It MUST state its identity, purpose, capability, row-scope and
  projection model; ReportReader MUST NOT inherit Work or Administration navigation.
- **FR-032**: Reporting recipients, approved purposes, named capabilities, row scope, projection templates
  and required licences MUST be approved before sharing.
- **FR-032a**: Route eligibility MUST be decided before any protected data or existence lookup. Forbidden
  direct links MUST make zero protected-data requests and MUST NOT disclose whether the resource exists.
- **FR-032b**: APIs, reports, exports and document endpoints MUST construct purpose-specific server
  allowlist projections. A universal entity response followed by client-side hiding is prohibited.
- **FR-032c**: Calibration and other evidence documents MUST require an approved evidence purpose, named
  capability, row scope and document ACL. General Work and Reports projections MUST contain no document URL.

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

- **FR-041**: Status MUST distinguish Spec Approved, Mock Implemented, API Implemented, Azure
  Integrated, Security Verified, Device Verified, Migration Rehearsed, Pilot Accepted and
  Production Accepted.
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
- **SC-009**: Every forbidden combination of workspace, purpose, capability, row scope and projection fails
  through app, direct API, document, export and report paths, regardless of the actor's role label.
- **SC-010**: Zero fields outside the approved projection exist in Field Work responses/local storage or
  general Reports responses/exports.
- **SC-011**: Hosted iOS/Android evidence exists for every claimed offline and scanner behavior.
- **SC-012**: Final migration reconciliation accounts for every source row and post-rehearsal change.
- **SC-013**: App rollback, platform recovery and data restore each pass rehearsal.
- **SC-014**: Every gate has named ownership and retained evidence.
- **SC-015**: The seven acceptance questions are answered live from tenant data before production
  acceptance.
- **SC-016**: Every forbidden or wrong-workspace direct route produces zero protected-data requests and no
  resource-existence disclosure.
- **SC-017**: Workspace, identity, row-scope and capability changes leave zero recoverable privileged
  responses in browser history, cache or queued work.
- **SC-018**: A ReportReader-only account renders Reports navigation only and cannot fetch Work, Scan,
  Administration or evidence-document data.

## Dependencies

This feature depends on 001–008 and blocks API Implemented / Azure Integrated claims that lack
dated evidence, Security Verified, Device Verified,
Pilot Accepted and Production Accepted status for them.
---

## Amendments made 2026-09-03 (prototype-scoped, reversible)

> **DEMO CALL 2026-09-03 (DC-26)** — **FR-013 is amended to say what "independently" means**, and the
> calibration-currency value list loses `InCalibration` as a consequence.
>
> **The problem.** `docs/19-state-model-decision.md` §7.2 found that the approved currency list contains
> `InCalibration`, and the implemented derivation gives it **priority over the date buckets**
> (`app/src/api/mock/reporting.ts:128`, commented "FR-013: already at the lab — not also 'overdue'/'due
> soon'"). That makes currency a **partial function of `disposition`** — the two axes encode the same fact —
> and it silently drops assets at the lab out of the overdue count that feature 006 exists to report. FR-013 as
> written said the four MUST be independent while the approved value list quietly was not.
>
> **The decision.** Amend FR-013 to define independence as *no axis value duplicates another axis's fact*, and
> drop `InCalibration` from the derived currency list. "At the lab" is `disposition = AtCalibrationLab`, which
> already carries it. Currency becomes six values: `NotRequired | Unknown | Current | DueSoon | Overdue |
> Failed`. Full derivation and precedence:
> `specs/010-web-application-platform/contracts/transition-table.md` §6 (DC-18, DC-19, DC-20).
>
> **Why this direction and not the other.** Weakening FR-013 to permit the coupling would have kept a seventh
> value whose only job is to suppress two others. Dropping it makes the derivation a **pure function of
> calibration data and the date** — `deriveState` does not need to look at `disposition` at all to compute it,
> which is the simpler thing to implement and the simpler thing to test.
>
> **Reversal cost:** re-adding `InCalibration` is one value plus one precedence row. **No data migration ever**,
> because currency is derived and has no column.
>
> **Residual, stated honestly:** `docs/15-postgres-data-model.md` §3.4 and the R1 row at
> `docs/08-decisions.md:88` still list seven values. Neither file is this pass's to edit. Until they are
> reconciled they disagree with this spec and with 010's contracts; reported to the decision-log owner under
> `CLAUDE.md` rule 13 (*"a useful implementation deviation is recorded and the governing requirement is
> amended"*).

FR-014 and FR-015 are unchanged and are implemented literally by `transition-table.md` rules R-12/R-13
(fault and repair touch one axis and nothing else) and R-02/R-07 (checkout and deploy require all three axes).
