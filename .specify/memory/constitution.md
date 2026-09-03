# Englobe AMS Constitution

Instrumentation Asset Management System — Englobe Ontario.

This constitution governs every specification, plan and task under `specs/`. It is not advice.
A plan that violates a principle either changes the plan or amends this document — it does not
proceed with a silent exception. Violations that are genuinely justified are recorded in the
Complexity Tracking table of the owning `plan.md`.

## Core Principles

### I. Current State Is Derived, Never Typed

The current lifecycle, physical disposition, serviceability, location, custodian, project and parent
of an asset are **outputs**, not direct form inputs. They are written only by the authoritative server
transaction service in response to an accepted, immutable business event. No user, browser screen,
import, reporting tool or ad-hoc edit may write them as a shortcut.

**Rationale**: The system being replaced failed for one reason above all others — it let people type
current state directly into rows designed to hold static facts. 644 of 1,053 rows say
"Deployed or NOT Available", which means nobody knows where those assets are. If state can be typed,
it will drift, and the history becomes fiction.

**Test**: Remove every direct user write path to a derived column and the system must still reach the
correct state through accepted business events. A role or endpoint that can arbitrarily update current
state is a constitutional violation regardless of what the interface displays.

### II. History Is Append-Only and Complete

Every change of custody, location, project, lifecycle, serviceability, calibration journey or
installation creates an immutable transaction line or an explicitly versioned compliance record.
Accepted transaction headers and lines are never updated or deleted through ordinary application
access. Corrections are made by recording a compensating event linked to the original. Exceptional
data repair uses a separate audited procedure with System Owner approval.

**Rationale**: "Where was asset X on date D, and what was attached to it?" is an acceptance question.
It is answerable only if the log is complete and immutable. A history that can be edited cannot settle
a damage claim or a client dispute.

**Test**: Reconstructing an asset's state at any past timestamp by replaying its lines in order must
produce the same answer the derived columns held at that time.

### III. Identity Is Stable — the Asset ID Is a Tag, Not a Database Key

The primary key is a generated UUID. The canonical Asset ID is a human-readable, unique, immutable
tag. It never encodes office, project, custodian, status or any other mutable fact. Serial number is an
attribute, is indexed, and is **not** unique. Temporary and legacy tags are retained as searchable
aliases; they do not require changing the canonical identity after it has been assigned.

**Rationale**: 132 serials in the current data are shared between an instrument and its sensor
(`UM16984` is both `DL-UM-16984` and `GEO-UM-16984`). Any design that treats serial as identity merges
two physical objects. Any ID that encodes location must be reprinted when the asset moves, so it will
be wrong the first time it moves.

**Test**: Transferring an asset between offices, projects and custodians changes no character of its
canonical Asset ID and requires no relabelling. Completing a temporary tag retains the temporary value
as an alias and does not erase its traceability.

### IV. Reference Data Is Picked, Not Typed

Manufacturer, model, equipment type, asset group, location, project and staff are references to curated
records. There are no free-text substitutes for these attributes in the schema, application, forms or
imports. Free text may supplement a structured value but may not replace it.

**Rationale**: The current registry holds `Geohpone`, `Air Quailty Monitroing`, and model names sitting
in the Manufacturer column (`Minimate Pro`, `Series IV`, `Settop M1`) across 22% of rows. Every one of
those is a free-text field doing a reference table's job. Free text cannot be reliably filtered,
grouped, validated or reported on.

**Test**: A new value for any of these attributes can only be created by a user holding an approved
administrative role, in the entity that owns it.

### V. Invalid Transitions Are Refused at Every Layer

The transition contract is defined as reviewed data and server rules. The application enforces it for
immediate and understandable feedback, and the API/database independently enforce it because the
browser is not a security boundary. Checkout of an unavailable asset is refused even when a request is
sent directly to the API.

**Rationale**: "Prevent conflicting assignments" is a stated design principle. Two technicians opening
the application at the same moment may both see an asset as available; only the server and database
can arbitrate. A browser-only check is a race condition with a friendly error message.

**Test**: Submitting a command that describes an illegal transition directly to the API must be
rejected, logged, and leave all asset state unchanged.

### VI. Maintainable by a Successor, Not by Its Author

The system must be operable and extendable by a competent application and Azure administrator who has
never met the people who built it. Application code, API contracts, database migrations,
infrastructure-as-code, workers, tests, runbooks and environment prerequisites live in or are linked
from the repository. Every migration script is idempotent and reports what it changed and what it
could not resolve. Shared business rules have one reviewed definition and independently verified
consumers.

**Rationale**: The predecessor system's real dependency was user knowledge, not software. Rebuilding
that dependency behind a nicer interface is not a fix.

**Test**: The system can be deployed into a fresh non-production Azure environment from repository
artifacts plus explicitly documented enterprise prerequisites, with no undocumented application step.
A successor can publish, verify, observe, restore and roll back the system from written procedures.

### VII. No Credentials, Minimum Sensitive Data

Logins and passwords are not stored in this system — not in a table, column, note field, attachment,
source file, browser bundle or offline cache. The `Login` and `Password` columns present in the legacy
registry are dropped at export and must never reappear. Operationally necessary sensitive attributes —
SIM ICCID, phone number, static IP and equivalent values — are permitted only where required, are
server-authorized, excluded from general reporting, and excluded from Field User offline storage.

Application and deployment access uses Microsoft Entra identity, managed identities, workload identity
federation and approved secret storage. Long-lived platform credentials are not committed to source or
shipped to browsers.

**Rationale**: An asset registry is a widely shared, low-trust surface. It is the wrong place for
secrets, and no business requirement puts them there.

**Test**: A schema diff, source export, browser bundle, Field User API response or Field User offline
store containing a credential-bearing field or unauthorized sensitive value fails review.

### VIII. One Business Event Is One Atomic Commit

A checkout, return, transfer, deployment, recovery, calibration shipment, component change, retirement
or other multi-asset action is accepted and applied as one server-authoritative command. The server
validates identity, role, office scope, every affected asset, transition, relationship, project and
required field before committing. All transaction lines, state changes, relationship spans,
installation spans, audit facts and outbox events commit together or none commit.

Every externally submitted write has an idempotency key. Retrying an accepted request returns its
original outcome rather than recording the event again. Commands that overlap the same assets are
arbitrated by the database using deterministic locking and constraints.

**Rationale**: Recording five lines and applying them one at a time can leave a partially completed
checkout. That is not a temporary display issue; it is a false business record. Offline replay and
network retries make exactly-once command handling a core requirement rather than an optimization.

**Test**: Under deliberate concurrency and injected failure after every material step, a five-asset
command always commits all five resulting states or commits none. Repeating an accepted command one
hundred times with the same idempotency key produces one transaction.

## Technology Constraints

### Production platform

The production target is a conventional internal web application, decided by the System Owner on
2026-09-03.

- **Client**: React + TypeScript + Vite, delivered as a mobile-first Progressive Web App.
- **Authoritative service**: Node.js + TypeScript API; the browser never connects directly to the
  database or object storage with broad credentials.
- **System of record**: Azure Database for PostgreSQL Flexible Server.
- **Documents**: private Azure Blob Storage with server-authorized access.
- **Identity**: Microsoft Entra ID using supported OpenID Connect/OAuth flows.
- **Hosting**: Azure Container Apps or an explicitly approved equivalent Azure service.
- **Background work**: a transactional outbox plus worker/scheduled jobs.
- **Delivery**: committed database migrations, infrastructure-as-code, immutable application
  revisions and GitHub Actions using workload identity federation where supported.
- **Operations**: structured telemetry, monitored alerts, point-in-time database recovery and tested
  document recovery.

Production business data and documents remain in an approved Canadian Azure region. Development, UAT
and production are isolated. Third-party SaaS that receives production data requires a separate
security and privacy decision.

### Microsoft 365 relationship

Microsoft 365 is an integration surface, not the application runtime boundary. Teams, email,
SharePoint and Power BI may be used where approved, but core search, checkout, return, calibration,
deployment and reporting must continue when those optional integrations are disabled or unavailable.

Power Apps Code App, Dataverse and Power Automate are no longer the primary production route. Their
existing documentation and mock-adapter work remain historical reference until removed or archived.

### Offline and localisation

Offline behaviour is part of the product and must be verified on every supported managed device and
browser. Service worker and IndexedDB behaviour, cache contents, identity isolation, update behaviour,
queue replay and conflict handling are specified and tested directly.

Bilingual French labels are out of scope for Phase 1 but must not be designed out: user-facing strings
live in string tables from the first screen.

## Development Workflow

Specifications are the source of truth. Code that disagrees with an approved specification is a
defect in the code until the specification is amended.

1. A feature begins as `specs/###-name/spec.md` — user stories, requirements and success criteria.
2. Unresolved product questions are marked `[NEEDS CLARIFICATION: ...]` and mirrored in the open-
   questions record. A plan must not silently choose a load-bearing answer.
3. `plan.md` adds the technical approach and passes the Constitution Check gate.
4. `tasks.md` decomposes the plan into ordered, independently testable work grouped by user story.
5. Database and infrastructure changes include migrations/definitions, rollback or forward-recovery
   consequences, and automated verification.
6. Every deviation discovered during implementation is recorded in `docs/08-decisions.md` with date,
   decision, reason and who agreed.
7. A feature does not move from Mock Implemented to Tenant Implemented, Security Verified, Device
   Verified, Pilot Accepted or Production Accepted without evidence for that stage.

User stories are prioritized (P1, P2, …) and each must be independently deliverable. Implementing P1
alone must leave a genuinely useful and internally consistent capability, not a half-built screen.

## Governance

This constitution supersedes all other practice documents, including `CLAUDE.md`, where they conflict.

Amendments require: a written statement of the principle or constraint being changed, the reason, the
migration consequence for data and code already built against it, and approval by the System Owner
(Jay Patel). Amendments are versioned semantically — MAJOR for removing or redefining a principle or
settled platform, MINOR for adding one or materially expanding guidance, PATCH for clarification that
changes no behaviour.

Compliance is checked before planning, again after technical design, and at implementation handoff.
Reviewers verify against these principles, not against personal preference.

## Amendment record

### Version 2.0.0 — 2026-09-03

**Changed:** Replaced the settled Power Apps/Dataverse/Power Automate production platform with an
Azure-hosted web application, PostgreSQL, private Blob Storage, Entra ID and a PWA offline model. Added
Principle VIII requiring one atomic commit and idempotent handling for each complete business event.
Updated Principles I, II, III, V, VI and VII to match the server/API/database trust boundary.

**Reason:** The production-readiness review identified unresolved multi-asset atomicity, server
authority, offline cold-start, authorization and operational-recovery requirements. The System Owner
directed the project to pivot to a web application.

**Migration consequence:** The React screens, domain logic, tests, migration cleaning, reference data,
synthetic data and business feature specifications remain reusable. Dataverse schema work, Power Apps
publishing, Power Automate F1–F5 and SharePoint-as-primary-certificate-store are superseded. The
production adapter becomes HTTP, the physical schema becomes PostgreSQL, authoritative state mutation
moves into the API transaction service, and offline behaviour becomes a directly implemented PWA
capability.

**Approved by:** Jay Patel, System Owner.

**Version**: 2.0.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-03
