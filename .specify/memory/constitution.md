# Englobe AMS Constitution

Instrumentation Asset Management System — Englobe Ontario.

This constitution governs every specification, plan and task under `specs/`. It is not advice.
A plan that violates a principle either changes the plan or amends this document — it does not
proceed with a silent exception. Violations that are genuinely justified are recorded in the
Complexity Tracking table of the owning `plan.md`.

## Core Principles

### I. Current State Is Derived, Never Typed

The current status, location, custodian, project and parent of an asset are **outputs**, not inputs.
They are written exclusively by the state-derivation automation in response to a new, immutable
transaction line. No user, screen, form, import or ad-hoc edit may write them.

**Rationale**: The system being replaced failed for one reason above all others — it let people type
current state directly into rows designed to hold static facts. 644 of 1,053 rows say
"Deployed or NOT Available", which means nobody knows where those assets are. If state can be typed,
it will drift, and the history becomes fiction.

**Test**: Remove every write path to a derived column and the system must still reach correct state.
A Field User role that can update `eng_asset.eng_status` is a constitutional violation regardless of
what the UI allows.

### II. History Is Append-Only and Complete

Every change of custody, location, project or condition creates a transaction line. Transaction lines
are never updated and never deleted by any role except the System Owner, and then only to repair a
defect. Corrections are made by recording a compensating transaction, not by editing the past.

**Rationale**: "Where was asset X on date D, and what was attached to it?" is an acceptance question.
It is answerable only if the log is complete and immutable. A history that can be edited cannot settle
a damage claim or a client dispute.

**Test**: Reconstructing an asset's state at any past timestamp by replaying its lines in order must
produce the same answer the derived columns held at that time.

### III. Identity Is Stable — the Asset ID Is a Tag, Not a Key

The primary key is the platform-generated GUID. `eng_assetid` is a human-readable, unique, immutable
tag. It never encodes office, project, custodian, status or any other mutable fact. Serial number is
an attribute, is indexed, and is **not** unique.

**Rationale**: 132 serials in the current data are shared between an instrument and its sensor
(`UM16984` is both `DL-UM-16984` and `GEO-UM-16984`). Any design that treats serial as identity merges
two physical objects. Any ID that encodes location must be reprinted when the asset moves, so it will
be wrong the first time it moves.

**Test**: Transferring an asset between offices, projects and custodians changes no character of its
Asset ID and requires no relabelling.

### IV. Reference Data Is Picked, Not Typed

Manufacturer, model, equipment type, asset group, location, project and staff are lookups to curated
tables. There are no free-text columns for these anywhere in the schema, app, form or import.

**Rationale**: The current registry holds `Geohpone`, `Air Quailty Monitroing`, and model names sitting
in the Manufacturer column (`Minimate Pro`, `Series IV`, `Settop M1`) across 22% of rows. Every one of
those is a free-text field doing a lookup's job. Free text cannot be reliably filtered, grouped, or
reported on.

**Test**: A new value for any of these attributes can only be created by a user holding an
administrative role, in the table that owns it.

### V. Invalid Transitions Are Refused at Every Layer

The status transition matrix is defined once, as data. It is enforced in the app — to give the user an
immediate, explained refusal — **and** independently in the automation, because the app is not a
security boundary. Checkout of an asset that is not Available is refused in both places.

**Rationale**: "Prevent conflicting assignments" is a stated design principle. Two technicians opening
the app at the same moment will both see an asset as Available; only the server can arbitrate. An
app-only check is a race condition with a friendly error message.

**Test**: Inserting a transaction line directly through the platform API that describes an illegal
transition must be rejected and logged, and must not alter asset state.

### VI. Maintainable by a Successor, Not by Its Author

The system must be operable and extendable by a competent Power Platform administrator who has never
met the people who built it. Everything ships in one solution. Every flow has a README stating its
trigger, inputs, writes and failure mode. Every migration script is idempotent and reports what it
changed and what it could not resolve. Logic duplicated between app and flow is defined once, as data,
and consumed twice.

**Rationale**: The predecessor system's real dependency was user knowledge, not software. Rebuilding
that dependency behind a nicer UI is not a fix.

**Test**: The solution imports cleanly into a fresh environment from the repository alone, with no
undocumented manual step.

### VII. No Credentials, Minimum Sensitive Data

Logins and passwords are not stored in this system — not in any table, column, note field or
attachment. The `Login` and `Password` columns present in the legacy registry are dropped at export and
must never reappear. Operationally necessary sensitive attributes — SIM ICCID, phone number, static IP
— are permitted, field-level secured, and readable only by Office Admin and above.

**Rationale**: An asset registry is a widely-shared, low-trust surface. It is the wrong place for
secrets, and no requirement puts them there.

**Test**: A schema diff or data export containing a credential-bearing column fails review.

## Technology Constraints

Microsoft 365 tenant only. No external hosting, no custom database, no third-party SaaS.
Data residency: Canada. The stack decided in `CLAUDE.md` — Dataverse, Power Apps Code App,
Power Automate, SharePoint document library, Power BI — is settled and is not re-litigated inside a
feature spec. A feature that believes it needs different technology raises it as a decision in
`docs/08-decisions.md`, not as an implementation detail.

Premium licensing is a live risk. The entity design must remain re-targetable to SharePoint Lists.
Any app-layer code depending on a Dataverse-only capability carries a `// DATAVERSE-ONLY` comment so
the blast radius of a licensing refusal is greppable.

Bilingual (French) labels are out of scope for Phase 1 but must not be designed out: user-facing
strings live in string tables from the first screen.

## Development Workflow

Specifications are the source of truth. Code that disagrees with an approved spec is a defect in the
code until the spec is amended.

1. A feature begins as `specs/###-name/spec.md` — user stories, requirements, success criteria. No
   technology, no schema, no screens.
2. Unresolved product questions are marked `[NEEDS CLARIFICATION: ...]` in the spec and mirrored in
   `docs/07-open-questions.md`. A `plan.md` must not be written for a spec whose blocking markers are
   unresolved.
3. `plan.md` adds the technical approach and passes the Constitution Check gate.
4. `tasks.md` decomposes the plan into ordered, independently testable work grouped by user story.
5. Every deviation discovered during implementation is recorded in `docs/08-decisions.md` with date,
   decision, reason and who agreed.

User stories are prioritized (P1, P2, …) and each must be independently deliverable — implementing P1
alone must leave a system genuinely useful to a technician, not a half-built screen.

## Governance

This constitution supersedes all other practice documents, including `CLAUDE.md`, where they conflict.

Amendments require: a written statement of the principle being changed, the reason, the migration
consequence for data and code already built against it, and the approval of the System Owner
(Jay Patel). Amendments are versioned semantically — MAJOR for removing or redefining a principle,
MINOR for adding one or materially expanding guidance, PATCH for clarification that changes no
behaviour.

Compliance is checked at two gates: before Phase 0 research in every `plan.md`, and again after that
plan's Phase 1 design. Reviewers verify against these principles, not against personal preference.
`CLAUDE.md` carries the operational rules and commands that implement this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02
