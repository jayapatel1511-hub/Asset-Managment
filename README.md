# Englobe AMS — Azure Web Application

## Current direction

> **The production target is now a conventional Azure-hosted web application with an explicit Data Management & Stewardship capability.**

The existing React/TypeScript/Vite application, migration pipeline, domain rules, tests, synthetic data and business feature specifications remain the foundation.

Power Apps Code App, Dataverse and Power Automate are **parked** (2026-09-03) — kept on disk and
banner-marked `LEGACY-POWER-PLATFORM`, removed from the build. The Dataverse adapter is no longer
imported and the `@microsoft/power-apps` packages are gone from `app/package.json`. Those documents
are still worth reading for the business rules and logical model they carry; they are not build
instructions. See `CLAUDE.md`, *Parked — Power Platform*.

### Target platform

| Layer | Target |
|---|---|
| User experience | Mobile-first React/Vite Progressive Web App |
| Identity | Microsoft Entra ID workforce SSO |
| Authoritative API | Node.js + TypeScript |
| Business data | Azure Database for PostgreSQL Flexible Server |
| Documents | Private Azure Blob Storage |
| Offline | Service worker + IndexedDB queue/cache/conflict handling |
| Background work | Transactional outbox + worker/scheduled jobs |
| Data management | Governed reference/master data, corrections, imports, quality, duplicates, lineage, exports and retention |
| Hosting | Azure Container Apps in an approved Canadian region |
| Reporting | Read-only web reports; Power BI optional |
| Delivery | GitHub Actions + infrastructure-as-code + immutable revisions |

Microsoft 365 remains available for integrations such as Teams, email, SharePoint exports and Power BI. Core asset and data-management operation does not depend on those integrations.

Zite was evaluated in September 2026 as a hosting alternative and is **parked**: it cannot be the
authoritative store, because its client exposes no transaction and a failing multi-write does not
roll back — see [`docs/18-hosting-alternatives.md`](docs/18-hosting-alternatives.md) § 2b. The Azure
web application below is the single active direction.

## Status

| Area | Maturity |
|---|---|
| Business specification | Substantial; open product decisions remain |
| Local React user journeys | Mock Implemented |
| Migration profiling and cleaning | Implemented and repeatable locally |
| Synthetic data | In progress / locally testable |
| Azure web architecture | Specified in draft and constitutionally recorded |
| PostgreSQL physical schema | Proposed; review required before migration creation |
| Data Management & Stewardship | Spec Draft; no implementation yet |
| Production API | Not implemented |
| Entra integration | Not implemented or tenant-verified |
| PWA cold-start offline behavior | Not implemented or device-verified |
| Azure infrastructure | Not implemented |
| Ottawa pilot | Not approved |

The local prototype proves useful interface and domain behavior. It does not yet prove the production API, database, identity, offline, document, data-management, security or recovery boundaries.

## Read order

1. [`CLAUDE.md`](CLAUDE.md) — active stack, operating rules and implementation order
2. [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — governing principles, version 2.0.0
3. [`docs/00-brief.md`](docs/00-brief.md) — problem, scope and seven acceptance questions
4. [`docs/14-webapp-architecture.md`](docs/14-webapp-architecture.md) — selected web architecture
5. [`docs/15-postgres-data-model.md`](docs/15-postgres-data-model.md) — proposed core schema
6. [`docs/16-data-management.md`](docs/16-data-management.md) — data-management operating model and schema additions
7. [`docs/13-production-readiness-review.md`](docs/13-production-readiness-review.md) — risks and approval gates
8. [`specs/010-web-application-platform/spec.md`](specs/010-web-application-platform/spec.md) — executable web-platform requirements
9. [`specs/011-data-management/spec.md`](specs/011-data-management/spec.md) — executable data-management requirements
10. [`specs/009-production-readiness/spec.md`](specs/009-production-readiness/spec.md) — cross-cutting production proof
11. [`docs/06-delivery-plan.md`](docs/06-delivery-plan.md) — implementation sequence
12. [`docs/09-build-report.md`](docs/09-build-report.md) — what the existing local implementation actually proved

## Repository map

```text
CLAUDE.md                              active project instructions
.specify/memory/constitution.md        governing principles and platform decision

docs/00-brief.md                       business problem and acceptance questions
docs/01-data-model.md                  PARKED (legacy) — Dataverse tables; logical model still valid
docs/02-app.md                         PARKED (legacy) — Code App framing; screen/workflow reference
docs/03-automation.md                  PARKED (legacy) — Power Automate F1-F5; rules still required
docs/04-migration.md                   source cleanup and migration rules
docs/05-security.md                    PARKED (legacy) — Power Platform environments and roles
docs/06-delivery-plan.md               active web-application delivery sequence
docs/07-open-questions.md              product decisions requiring Jay
docs/08-decisions.md                   decision log
docs/09-build-report.md                local/mock implementation evidence
docs/10-integration.md                 PARKED (legacy) — M365 research; M365 stays an integration surface
docs/12-ui-spec.md                     detailed mobile UI specification
docs/13-production-readiness-review.md architecture and production review
docs/14-webapp-architecture.md          active Azure web architecture
docs/15-postgres-data-model.md          proposed core PostgreSQL schema
docs/16-data-management.md              stewardship, jobs, quality, lineage and retention model
docs/17-ux-audit.md                     UX audit: what is static and must not be; admin console gaps
docs/18-hosting-alternatives.md         PARKED — Zite assessed and ruled out as the store

specs/001-* ... 008-*                  business feature specifications
specs/009-production-readiness/        cross-cutting integrity and verification gates
specs/010-web-application-platform/    web platform, API, PWA, storage and operations
specs/011-data-management/             governed data administration and lifecycle
specs/ZITE-BUILD-PROMPT.md             PARKED — handoff prompt for the Zite test environment

app/                                    existing React/Vite interface and mock backend
server/                                 local TypeScript API over in-process PostgreSQL (PGlite); working POC, not production
packages/                               planned shared contracts/domain packages
db/                                     planned PostgreSQL migrations and views
infra/                                  planned Azure infrastructure-as-code
migration/                              repeatable source profiling, cleaning and target loading
data/source/                            frozen legacy exports
data/reference/                         curated mappings and domain inputs
solution/                               PARKED (legacy) — Power Platform solution, flows F1-F5, Power BI project
zite/                                   PARKED — Zite test environment (loader + Field slice); not the production path
```

## Data management scope

The earlier specifications had useful fragments—reference tables, migration reports, audit, backup and retention—but no complete post-go-live data-management feature.

Feature 011 now covers:

- named Data Owner and Data Steward responsibilities;
- a Data Management Centre with owned quality issues;
- field dictionary, source authority and classification;
- reference and master-data administration;
- controlled static corrections without direct state/history edits;
- dry-run imports, bulk updates and row-level outcomes;
- human-reviewed duplicate resolution without automatic serial-based merges;
- permanent redirects that preserve both histories;
- external source reconciliation;
- lineage and “Why does the system say this?” explanations;
- approved, redacted, private and expiring exports;
- retention register, legal holds and controlled purge;
- auditable, idempotent data jobs.

It is explicitly **not** a generic database editor.

## What is preserved

- The seven acceptance questions
- Feature specifications 001–008
- The existing mobile-first user experience
- Fluent UI and the design specification
- Asset search, cart and history interaction patterns
- State-machine and point-in-time logic as test/reference material
- Source profiling, deduplication, model mapping and conflict reports
- Synthetic history and planted scenarios
- Release data-leak scanning concept

## What changes

- `api/dataverse/` is replaced by a production HTTP adapter.
- PostgreSQL migrations replace Dataverse schema creation.
- One synchronous API/database transaction replaces line-by-line Power Automate state application.
- A server-side idempotency record handles offline and network retries.
- A service worker and IndexedDB provide directly testable offline behavior.
- Private Azure Blob Storage replaces SharePoint as the target certificate system of record.
- Entra sign-in and API authorization replace Dataverse roles as the runtime access boundary.
- Outbox workers replace F1–F5 as production automation.
- Managers use read-only web reporting; Power BI becomes optional.
- Data management becomes a governed product feature rather than a collection of admin scripts.

## First implementation proof

Do not begin with additional screens.

> Implement one real five-asset checkout through a TypeScript API and PostgreSQL. The command must authenticate the user, enforce office scope, claim an idempotency key, lock all affected assets in deterministic order, validate every line, create immutable history, update all derived state and relationships, write outbox events, and commit all-or-nothing. Run a deliberate race and a deliberate mid-transaction failure.

After the canonical schema and authorization model are stable, the first Data Management increment is a **read-only data dictionary plus quality dashboard and issue queue**. Bulk writes, merges, exports and purge controls wait for the atomic command, job, approval and audit infrastructure.

## Local prototype

```bash
cd app
npm ci
npm run dev
npm run test
npm run build
```

The mock remains useful for interface development. A release build must never bundle real staged fleet data.

## Production approval gates

Before an Ottawa pilot:

- canonical PostgreSQL schema, including data-management additions, approved;
- product, ownership, stewardship and retention decisions closed;
- 100% field-level data-dictionary coverage achieved;
- atomic transaction and idempotency proof passed;
- Entra and office-scope security tested through direct API calls;
- PWA cold start and queued replay passed on supported managed devices;
- private certificate upload/download and failure recovery passed;
- data-quality dashboard and critical issue ownership active;
- governed correction/import/export paths verified;
- migration rehearsal and sign-offs completed;
- database and document restore exercised;
- alerts, owners and rollback procedures active.
