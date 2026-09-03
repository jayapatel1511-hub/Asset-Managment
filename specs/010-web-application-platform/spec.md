# Feature Specification: Web Application Platform

**Feature Branch**: `010-web-application-platform`  
**Created**: 2026-09-03  
**Status**: Draft — platform pivot decided; implementation has not started.  
**Input**: `docs/14-webapp-architecture.md`, `docs/15-postgres-data-model.md`, `specs/009-production-readiness/spec.md`, feature specifications 001–008, and the System Owner direction to pivot to a web application.

---

## Purpose

This feature changes the programme’s delivery platform without changing its business objective.

The existing asset-management prototype runs locally as a React application with a mock backend. The previously planned production route depended on Power Apps Code Apps, Dataverse, and Power Automate. The production target is now a conventional internal web application: browser/PWA user experience, Microsoft Entra sign-in, a server-authoritative API, PostgreSQL, private document storage, and Azure hosting.

The feature is complete only when the application can be operated as a real web system and the existing asset workflows run through the new production boundary without relying on Power Apps or Dataverse.

---

## User Scenarios & Testing

### User Story 1 — Open one internal application from any supported device (Priority: P1)

A technician opens the AMS URL on a work phone or browser, signs in with their Englobe account, and reaches the same application regardless of whether they arrived from a bookmark, a home-screen icon, a QR code, or a deep link to an asset.

**Why this priority**: Every business feature depends on a reliable and supportable entry point. Identity, role, routing, and the application shell must work before write workflows can be moved.

**Independent Test**: Register one test user for each role, open the application on desktop and mobile, follow a direct asset link, sign out, and sign in as a different user. Confirm the correct role and office scope on every session.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they open the application, **Then** they sign in through Microsoft Entra ID without creating a separate AMS password.
2. **Given** an unauthorized user, **When** they reach the application, **Then** no asset data is returned and the refusal is understandable.
3. **Given** a deep link to an asset or installation, **When** an authorized user opens it cold, **Then** the correct screen loads after sign-in.
4. **Given** a Field User, Office Admin, System Owner, and Report Reader, **When** each signs in, **Then** the API returns only actions and data permitted to that role and office scope.
5. **Given** a sign-out followed by another user signing in on the same device, **When** the second session starts, **Then** no cached data or queued command from the first user is exposed or replayed.
6. **Given** an application release, **When** the user refreshes or returns later, **Then** the application updates safely without corrupting local drafts or queued commands.

---

### User Story 2 — Record a complete business event atomically (Priority: P1)

A technician checks out five assets. The server either accepts and applies the whole checkout or refuses it. It never records three lines and leaves two behind, and two technicians cannot both acquire the same asset.

**Why this priority**: This is the production integrity boundary. Every write feature relies on it, and it resolves the main architecture gap identified in the production-readiness review.

**Independent Test**: Submit a five-asset checkout while another user races for one asset. Repeat the accepted request after a simulated lost response. Verify one complete transaction, one winner, one stable replay result, and no partial state.

**Acceptance Scenarios**:

1. **Given** five valid assets, **When** checkout is accepted, **Then** one transaction, five immutable lines, all derived state changes, all relationships, and all outbox events commit together.
2. **Given** one invalid asset among five, **When** the command is submitted, **Then** nothing from that command is committed.
3. **Given** two simultaneous commands for the same available asset, **When** the server processes them, **Then** one succeeds and one receives a structured conflict.
4. **Given** a request whose response is lost, **When** the client retries with the same idempotency key and payload, **Then** it receives the original result without a duplicate transaction.
5. **Given** the same idempotency key with a different payload, **When** submitted, **Then** the request is refused as a client defect.
6. **Given** any browser request, **When** it names before/after state, a sequence value, or another server-owned field, **Then** the server ignores or rejects that authority and computes the value itself.
7. **Given** an accepted event, **When** any non-repair principal attempts to edit or delete its transaction line, **Then** the database refuses the change.
8. **Given** a fault report on a deployed asset, **When** it is accepted, **Then** repair condition changes without erasing deployment, project, location, or custody.
9. **Given** a repair completion, **When** it is accepted, **Then** serviceability changes without inventing a return to an office.
10. **Given** an asset ID allocation, **When** two registrations race, **Then** both receive distinct committed IDs and neither browser reserved the sequence directly.

---

### User Story 3 — Continue field work without connectivity (Priority: P2)

A technician opens the installed web application in a basement or remote site without service, searches the approved cached fleet, completes a workflow, and sees it queued. When authenticated connectivity returns, the app submits it exactly once or clearly explains the conflict.

**Why this priority**: Field use is part of the core operating context. The web platform is chosen partly so the programme controls and tests this behavior directly.

**Independent Test**: Install the PWA, open it online once, reboot the phone, start it in airplane mode, queue several commands, create a server-side conflict from another device, reconnect, and verify ordered replay and visible conflict handling.

**Acceptance Scenarios**:

1. **Given** a previously installed and synchronized application, **When** the device starts without connectivity, **Then** the application shell opens and permitted cached data is searchable.
2. **Given** no connectivity, **When** a supported workflow is submitted, **Then** it is persisted with a unique command ID and shown as pending.
3. **Given** queued commands and a device restart, **When** the application reopens, **Then** the commands remain.
4. **Given** connectivity returns, **When** replay begins, **Then** commands are sent in the order required to preserve their business meaning.
5. **Given** the server accepts a queued command but the response is lost, **When** it is retried, **Then** the idempotency result prevents duplication.
6. **Given** a queued command that conflicts with current server state, **When** replay occurs, **Then** it moves to Needs attention and is not silently discarded or force-applied.
7. **Given** a Field User, **When** offline data is inspected, **Then** administratively secured identifiers and certificate files are absent.
8. **Given** a user or environment change, **When** the local store is opened, **Then** data and commands are isolated by tenant, environment, and user identity.
9. **Given** a browser that does not support a required offline capability, **When** the application detects it, **Then** it states the limitation and prevents an unsafe assumption of offline readiness.

---

### User Story 4 — Store and retrieve calibration evidence privately (Priority: P2)

An office admin records a calibration, uploads its certificate, and retrieves it later from the asset. A failed upload does not lose the calibration fact, a failed calibration does not return the asset to service, and certificate access is authorized by the application.

**Why this priority**: Calibration evidence is the main document workflow and carries compliance consequences.

**Independent Test**: Record pass, adjusted, and failed calibrations; simulate upload failure and later attachment; replace a certificate; retire the asset; verify the correct due-date and document behavior throughout.

**Acceptance Scenarios**:

1. **Given** a permitted certificate, **When** it is uploaded, **Then** the file is stored privately and metadata is linked to the calibration record.
2. **Given** an upload failure after the calibration fact is accepted, **When** the screen returns, **Then** the calibration remains and is marked Certificate missing.
3. **Given** a later retry, **When** the certificate is attached, **Then** the original calibration record is preserved.
4. **Given** a failed calibration result, **When** saved, **Then** successful-calibration summaries and next-due date are not advanced and the asset is not automatically returned to service.
5. **Given** an older calibration entered after a newer one, **When** summaries recalculate, **Then** the latest qualifying calibration by calibration date remains authoritative.
6. **Given** a corrected or reissued certificate, **When** it replaces the current document, **Then** replacement history and attribution remain.
7. **Given** a retired asset, **When** its history is viewed, **Then** permitted users can still retrieve retained certificates.
8. **Given** a Field User without access to a secured document or attribute, **When** they attempt direct access, **Then** the API and storage authorization refuse it.

---

### User Story 5 — Operate, observe, release, and recover the system (Priority: P3)

A successor administrator deploys a version, verifies it, observes health, restores a test backup, and rolls the web application back without relying on the original author.

**Why this priority**: The platform is not production-ready until it can be operated and recovered by someone else.

**Independent Test**: Deploy the full system into an empty non-production environment from the repository, run migrations and smoke tests, cause a worker failure, restore the database to a test point, and roll back the application revision.

**Acceptance Scenarios**:

1. **Given** an empty approved Azure environment, **When** the documented deployment runs, **Then** infrastructure, database schema, application, worker, identity configuration inputs, and monitoring are created or identified with no undocumented step.
2. **Given** a pull request, **When** CI runs, **Then** type checks, tests, migration validation, contract tests, dependency/security checks, and bundle scans complete before merge.
3. **Given** a release, **When** it is deployed, **Then** the running revision, source commit, schema version, and deployment time are recorded.
4. **Given** a failed release verification, **When** the failure is found, **Then** traffic is not promoted or is returned to the previous compatible revision.
5. **Given** a database migration, **When** application rollback is attempted, **Then** compatibility is checked rather than assuming that rolling back code rolls back data.
6. **Given** an outbox or worker backlog, **When** it exceeds the threshold, **Then** a monitored person is alerted.
7. **Given** the backup policy, **When** a scheduled restore exercise occurs, **Then** the restored database and documents pass an integrity check and measured recovery time is recorded.
8. **Given** production secrets and service access, **When** the repository and deployment configuration are inspected, **Then** no long-lived secret is embedded in source code or a browser bundle.

---

## Edge Cases

- A PWA update occurs while unsent commands exist.
- The user’s Entra account is disabled while the device is offline.
- The user changes offices or roles before an offline command replays.
- The same queued command is open in two tabs.
- A request is accepted, the API crashes before responding, and the client retries.
- Two multi-asset commands overlap on some but not all assets.
- A transaction locks many assets in a different order than another transaction.
- A calibration certificate is large, incorrectly typed, malicious, duplicated, or replaced.
- The database is restored but Blob Storage is not restored to the same logical point.
- A new release understands a schema that the previous release does not.
- A manager exports a report containing fields they are not permitted to see.
- A temporary physical tag is replaced but must remain searchable.
- A component is sent to calibration while its parent remains in service.
- A deployed asset is reported broken but remains physically at the site.
- A synthetic-data marker reaches a production load attempt.

---

## Functional Requirements

### Platform and identity

- **FR-001**: System MUST run as a standards-based web application without requiring the Power Apps runtime or Dataverse for core operation.
- **FR-002**: System MUST authenticate workforce users with the organization’s Microsoft Entra tenant using a supported OIDC flow.
- **FR-003**: System MUST maintain no separate AMS password store.
- **FR-004**: System MUST enforce role and office scope at the API for every protected read and write.
- **FR-005**: System MUST treat the browser as untrusted and MUST NOT accept client-provided authority over current state, role, sequence, or historical snapshots.
- **FR-006**: System MUST support cold deep links after sign-in.
- **FR-007**: System MUST isolate local data by tenant, environment, and user.

### Atomic commands and history

- **FR-008**: System MUST accept each multi-asset business action through one server-authoritative command.
- **FR-009**: System MUST validate and apply all affected rows in one PostgreSQL transaction.
- **FR-010**: System MUST lock overlapping assets in deterministic order and MUST arbitrate concurrent commands server-side.
- **FR-011**: System MUST apply all lines or none.
- **FR-012**: System MUST require a unique client submission ID for every externally initiated write command.
- **FR-013**: System MUST return the original stable result for a retried ID with the same canonical request.
- **FR-014**: System MUST refuse the same ID with a different canonical request.
- **FR-015**: System MUST calculate before/after state and all relationship effects on the server.
- **FR-016**: System MUST create immutable transaction headers and lines for accepted state-changing commands.
- **FR-017**: System MUST represent corrections as further events linked to the original, not edits to history.
- **FR-018**: System MUST keep lifecycle, physical disposition, serviceability, and calibration currency logically separate.
- **FR-019**: System MUST allocate canonical Asset IDs on the server inside the asset-registration transaction.
- **FR-020**: System MUST retain temporary and legacy identifiers as aliases after canonical identification.

### Offline PWA

- **FR-021**: System MUST provide an installable PWA for supported field devices.
- **FR-022**: System MUST cache the application shell and approved data required for the declared offline workflows.
- **FR-023**: System MUST persist drafts and queued commands in IndexedDB or an equivalent durable browser store.
- **FR-024**: System MUST keep queued commands across application restarts and device restarts on supported devices.
- **FR-025**: System MUST replay queued commands exactly once in the required order when authenticated connectivity returns.
- **FR-026**: System MUST surface server conflicts for human resolution and MUST NOT silently discard or force-apply them.
- **FR-027**: System MUST display cache age, last successful sync, pending count, and conflict count.
- **FR-028**: System MUST exclude secured attributes and certificate bytes from field-user offline storage.
- **FR-029**: System MUST prevent a queued command from replaying under a different identity.
- **FR-030**: System MUST verify cold-start and replay behavior on every supported browser/device combination before pilot approval.

### Documents and calibration

- **FR-031**: System MUST store production documents in private object storage and MUST NOT expose an account key to the browser.
- **FR-032**: System MUST authorize document access through the application’s identity and role model.
- **FR-033**: System MUST retain a calibration fact when its certificate upload fails and MUST allow later attachment.
- **FR-034**: System MUST enforce approved file types, maximum size, collision-safe naming, integrity hash, and malware-scan disposition.
- **FR-035**: System MUST preserve replacement and attribution history for documents.
- **FR-036**: System MUST recalculate asset calibration summaries after create, correction, supersession, or voiding.
- **FR-037**: System MUST NOT advance successful calibration summaries or return an asset to service from a failed calibration.
- **FR-038**: System MUST treat physical return from a laboratory as an explicit state-changing event.

### Hosting, delivery, and operations

- **FR-039**: System MUST deploy application workloads to an approved Canadian Azure region.
- **FR-040**: System MUST define infrastructure and database migrations in the repository.
- **FR-041**: System MUST isolate development, UAT, and production data, identity, configuration, storage, and deployment approvals.
- **FR-042**: System MUST use managed identities or workload identity federation for Azure service and deployment access where supported.
- **FR-043**: System MUST keep production secrets out of source, browser bundles, and long-lived CI secrets.
- **FR-044**: System MUST emit background work through a transactional outbox committed with the business event.
- **FR-045**: System MUST make notification delivery best-effort and independent from business-transaction success.
- **FR-046**: System MUST expose structured logs, metrics, traces, correlation IDs, and health checks.
- **FR-047**: System MUST alert a monitored owner for terminal API/worker failures and stale outbox backlog.
- **FR-048**: System MUST support immutable application revisions and a documented traffic rollback.
- **FR-049**: System MUST define application, schema, database, and document recovery separately.
- **FR-050**: System MUST configure and regularly test database point-in-time recovery and the approved document-recovery process.

### Reporting and integration

- **FR-051**: System MUST provide read-only web reporting that answers the seven acceptance questions for authorized users.
- **FR-052**: System MUST exclude secured attributes from general manager/report-reader responses and exports.
- **FR-053**: System MAY integrate with Teams, email, SharePoint, and Power BI, but failure or absence of those integrations MUST NOT prevent core asset operations.
- **FR-054**: System MUST expose approved read models/views rather than granting reporting tools unrestricted operational-table access.

### Migration

- **FR-055**: System MUST reuse the approved source profiling, cleaning, mapping, conflict reporting, and sign-off gates.
- **FR-056**: System MUST load the canonical PostgreSQL schema idempotently and reconcile every source row.
- **FR-057**: System MUST support rehearsal, delta, freeze, final load, validation, and rollback activities for cutover.
- **FR-058**: System MUST refuse synthetic data in production mode.
- **FR-059**: System MUST leave ambiguous compliance records unmatched until a person confirms the target.

---

## Key Entities

- **Web/PWA Client**: The installable React user experience and its controlled offline cache. It proposes commands but owns no business authority.
- **AMS API**: The authoritative application boundary. It authenticates, authorizes, validates, locks, commits, and returns stable command outcomes.
- **PostgreSQL Database**: The business system of record. It stores reference data, assets, immutable transactions, relationships, calibrations, installations, authorization scope, idempotency, audit data, and outbox events.
- **Command Idempotency Record**: The stable association between a client submission ID, request hash, originating identity, and outcome.
- **Transactional Outbox Event**: A background side effect committed atomically with the business event and processed later without changing the event’s truth.
- **Offline Command**: A client-persisted proposed command awaiting server acceptance. Pending is not equivalent to accepted.
- **Document**: Private object storage bytes plus authoritative relational metadata, hash, scan state, retention class, and replacement chain.
- **Application Revision**: An immutable deployed web/API artifact tied to a source commit and compatible database schema range.

---

## Success Criteria

- **SC-001**: Authorized users sign in with Entra and reach a deep-linked screen on all supported desktop and mobile browsers.
- **SC-002**: A deliberate race between two users for the same asset produces exactly one accepted transaction and one explained conflict in 100% of test runs.
- **SC-003**: A five-asset command either commits five lines and all five resulting states or commits none, across automated fault injection at every step.
- **SC-004**: Replaying an accepted command 100 times with the same idempotency key creates one transaction.
- **SC-005**: Zero transaction headers or lines are edited or deleted through ordinary application access during pilot.
- **SC-006**: A supported phone cold-starts the installed PWA in airplane mode after reboot and opens the approved offline experience.
- **SC-007**: Thirty queued commands, including intermittent connectivity and five conflicts, are each accepted once or surfaced once for resolution; zero are lost.
- **SC-008**: A second user signing into the same device cannot read or replay the first user’s local data.
- **SC-009**: A Field User’s offline store, network responses, reports, and exports contain zero secured identifiers or certificate bytes.
- **SC-010**: An admin records a calibration fact during an induced upload failure and attaches the certificate later without re-entering or losing the fact.
- **SC-011**: A failed calibration changes neither last-successful-calibration nor next-due summaries and does not make the asset serviceable.
- **SC-012**: The application and API deploy from the repository into a fresh non-production Azure environment with no undocumented manual application step.
- **SC-013**: A database restore exercise completes within the approved RTO, meets the approved RPO, and passes transaction/document reconciliation.
- **SC-014**: Every production release identifies source commit, application revision, schema version, and verification result.
- **SC-015**: Report Readers answer all seven acceptance questions without a Power Apps runtime licence and without seeing secured attributes.
- **SC-016**: The production migration runs twice in rehearsal with an empty second-run business-data diff and every source row accounted for.
- **SC-017**: Core checkout, return, search, and calibration operation continues when Teams, Power BI, and SharePoint integrations are disabled.

---

## Assumptions

- The current React/Vite front end remains the starting point; the platform pivot is not a visual redesign.
- Azure is an approved enterprise hosting option, subject to subscription, security, networking, and cost approval.
- Microsoft Entra ID remains the workforce identity provider.
- Production data and document storage remain in an approved Canadian region.
- The application serves a fleet in the low thousands and transaction history in the low hundreds of thousands initially; the architecture must scale beyond those volumes without redesigning identity or transaction semantics.
- A PWA is the field client. A native mobile wrapper is a later option if device verification shows a browser limitation that blocks a mandatory requirement.
- Power BI is optional because the web application can provide the operational reports directly.
- Features 001–008 remain business requirements unless a specific conflict is recorded and approved.
- Feature 009 remains the cross-cutting production-readiness gate and is implemented through this platform.

---

## Open Decisions

1. Approved Azure subscription and owning platform team.
2. Production region, network exposure, and private-access requirements.
3. Approved RTO, RPO, HA tier, backup retention, and document-recovery strategy.
4. Entra app-role versus group mapping.
5. Global versus office-scoped administration.
6. Supported iOS/Android browsers and managed-device policy.
7. Expected-return and backdating product rules.
8. Project-master integration.
9. Permanent-component calibration dispatch.
10. Certificate malware-scanning implementation.
11. Whether a native wrapper is needed after PWA verification.
12. Whether Power BI is required after in-app reporting is demonstrated.
