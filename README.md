# Englobe AMS — Azure Web Application

## Current direction

> **The production target is now a conventional Azure-hosted web application.**

The existing React/TypeScript/Vite application, migration pipeline, domain rules, tests, synthetic data and feature specifications remain the foundation. Power Apps Code App, Dataverse and Power Automate are no longer the planned primary runtime.

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
| Hosting | Azure Container Apps in an approved Canadian region |
| Reporting | Read-only web reports; Power BI optional |
| Delivery | GitHub Actions + infrastructure-as-code + immutable revisions |

Microsoft 365 remains available for integrations such as Teams, email, SharePoint exports and Power BI. Core asset operation does not depend on those integrations.

## Status

| Area | Maturity |
|---|---|
| Business specification | Substantial; open product decisions remain |
| Local React user journeys | Mock Implemented |
| Migration profiling and cleaning | Implemented and repeatable locally |
| Synthetic data | In progress / locally testable |
| Azure web architecture | Specified in draft and constitutionally recorded |
| PostgreSQL physical schema | Proposed; review required before migration creation |
| Production API | Not implemented |
| Entra integration | Not implemented or tenant-verified |
| PWA cold-start offline behavior | Not implemented or device-verified |
| Azure infrastructure | Not implemented |
| Ottawa pilot | Not approved |

The local prototype proves useful interface and domain behavior. It does not yet prove the production API, database, identity, offline, document, security or recovery boundaries.

## Read order

1. [`CLAUDE.md`](CLAUDE.md) — active stack, operating rules and implementation order
2. [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — governing principles, version 2.0.0
3. [`docs/00-brief.md`](docs/00-brief.md) — problem, scope and seven acceptance questions
4. [`docs/14-webapp-architecture.md`](docs/14-webapp-architecture.md) — selected web architecture
5. [`docs/15-postgres-data-model.md`](docs/15-postgres-data-model.md) — proposed canonical schema
6. [`docs/13-production-readiness-review.md`](docs/13-production-readiness-review.md) — risks and approval gates
7. [`specs/010-web-application-platform/spec.md`](specs/010-web-application-platform/spec.md) — executable web-platform requirements
8. [`specs/009-production-readiness/spec.md`](specs/009-production-readiness/spec.md) — cross-cutting production proof
9. [`docs/06-delivery-plan.md`](docs/06-delivery-plan.md) — implementation sequence
10. [`docs/09-build-report.md`](docs/09-build-report.md) — what the existing local implementation actually proved

## Repository map

```text
CLAUDE.md                              active project instructions
.specify/memory/constitution.md        governing principles and platform decision

docs/00-brief.md                       business problem and acceptance questions
docs/01-data-model.md                  legacy Dataverse-oriented logical reference
docs/02-app.md                         existing screen/workflow reference
docs/03-automation.md                  legacy Power Automate design reference
docs/04-migration.md                   source cleanup and migration rules
docs/05-security.md                    legacy Power Platform security reference
docs/06-delivery-plan.md               active web-application delivery sequence
docs/07-open-questions.md              product decisions requiring Jay
docs/08-decisions.md                   decision log
docs/09-build-report.md                local/mock implementation evidence
docs/10-integration.md                 legacy M365 integration research
docs/12-ui-spec.md                     detailed mobile UI specification
docs/13-production-readiness-review.md architecture and production review
docs/14-webapp-architecture.md          active Azure web architecture
docs/15-postgres-data-model.md          proposed physical PostgreSQL schema

specs/001-* ... 008-*                  business feature specifications
specs/009-production-readiness/        cross-cutting integrity and verification gates
specs/010-web-application-platform/    web platform, API, PWA, storage and operations

app/                                    existing React/Vite interface and mock backend
server/                                 planned TypeScript API and worker; add when implementation starts
packages/                               planned shared contracts/domain packages
db/                                     planned PostgreSQL migrations and views
infra/                                  planned Azure infrastructure-as-code
migration/                              repeatable source profiling, cleaning and target loading
data/source/                            frozen legacy exports
data/reference/                         curated mappings and domain inputs
solution/                               legacy Power Platform and Power BI artifacts; not the production path
```

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

## First implementation proof

Do not begin with additional screens.

> Implement one real five-asset checkout through a TypeScript API and PostgreSQL. The command must authenticate the user, enforce office scope, claim an idempotency key, lock all affected assets in deterministic order, validate every line, create immutable history, update all derived state and relationships, write outbox events, and commit all-or-nothing. Run a deliberate race and a deliberate mid-transaction failure.

That proof must pass before the remaining write workflows are moved from the mock backend.

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

- canonical PostgreSQL schema approved;
- product decisions affecting state and authorization closed;
- atomic transaction and idempotency proof passed;
- Entra and office-scope security tested through direct API calls;
- PWA cold start and queued replay passed on supported managed devices;
- private certificate upload/download and failure recovery passed;
- migration rehearsal and sign-offs completed;
- database and document restore exercised;
- alerts, owners and rollback procedures active.
