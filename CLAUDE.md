# Englobe AMS — Asset Management System

Instrumentation asset tracking for Englobe Ontario. The source inventory contains approximately 1,050 rows covering seismograph loggers, geophones, microphones and sound-level meters, SIMs and communications equipment, total stations, cameras, and geotechnical sensors.

Owner and System Owner: Jay Patel.  
Read in this order:

1. `.specify/memory/constitution.md`
2. `docs/00-brief.md`
3. `docs/14-webapp-architecture.md`
4. `docs/15-postgres-data-model.md`
5. `specs/009-production-readiness/spec.md`
6. `specs/010-web-application-platform/spec.md`
7. The feature specification being changed

`docs/01-data-model.md` through `docs/10-integration.md` remain useful historical and logical references, but their Dataverse, Power Apps, Power Automate, SharePoint-as-primary-document-store, and Power Platform licensing instructions are superseded by the web-application pivot.

## Stack — decided 2026-09-03

| Layer | Target |
|---|---|
| Client | Existing React + TypeScript + Vite app, converted to a mobile-first PWA |
| API | Node.js + TypeScript server; Fastify or an approved equivalent preserving the architecture contract |
| Data | Azure Database for PostgreSQL Flexible Server; committed migrations |
| Files | Private Azure Blob Storage; metadata in PostgreSQL |
| Identity | Microsoft Entra ID, tenant-scoped OIDC; server-side authorization |
| Offline | Service worker + IndexedDB cache, drafts, command queue and conflict handling |
| Background work | Transactional outbox + worker / scheduled jobs |
| Hosting | Azure Container Apps in an approved Canadian region |
| Secrets | Managed identities, workload identity federation and Azure Key Vault where needed |
| Reporting | In-app read-only reports; Power BI optional over approved views |
| Delivery | GitHub Actions, container registry, infrastructure-as-code, immutable revisions |

Microsoft 365 is an integration surface, not the runtime boundary. Teams, email, SharePoint and Power BI may be used, but core asset operation cannot depend on them.

## Non-negotiable rules

1. **The browser owns no business authority.** It does not decide role, current state, previous state, next state, sequence values or historical facts.
2. **One business event is one atomic database commit.** A five-asset checkout commits all five transaction lines, state changes, relationship changes and outbox events, or commits none.
3. **Every external write is idempotent.** The client sends a unique submission ID. Same ID + same request returns the original result; same ID + different request is refused.
4. **Current state is derived through accepted events.** No ordinary asset-edit endpoint writes lifecycle, disposition, serviceability, current location, custodian, project or parent.
5. **Transaction history is append-only.** Corrections create compensating events linked to the original. Exceptional repair is separate, audited and approved.
6. **Asset identity is stable.** UUID is the database key. Canonical Asset ID is unique and immutable. Temporary and legacy tags remain aliases. Serial is non-unique.
7. **Reference data is selected, not typed.** Manufacturer, model, equipment type, asset group, location, project and user are references to curated records.
8. **Invalid transitions are refused by the API/database.** Client-side checks exist only for faster feedback.
9. **Lifecycle, disposition, serviceability and calibration currency are separate.** Reporting a fault does not erase custody or deployment.
10. **No credentials in source, data, browser bundle or offline cache.** Field users never receive or cache restricted SIM/network fields.
11. **Production documents are private.** No storage account key or broad storage credential reaches the browser.
12. **Synthetic data is refused in production.** Environment and seed markers are verified before any load.
13. **Specifications win over code.** A useful implementation deviation is recorded and the governing spec is amended; code does not silently become the source of truth.

## Repository direction

```text
app/                         existing React/Vite UI; becomes the PWA
  src/api/http/              planned production AmsBackend implementation
  src/offline/               planned IndexedDB/cache/queue/replay

server/                      planned TypeScript API and worker
  src/auth/
  src/modules/
  src/db/
  src/outbox/
  src/documents/
  src/observability/

packages/
  contracts/                 planned shared request/response schemas
  domain/                    planned shared pure rules where safe

db/
  migrations/
  seeds/
  views/

infra/                       planned Bicep and environment parameters
migration/                   source profiling, cleaning and target loader
specs/                       executable requirements
docs/                        architecture, decisions and runbooks
data/source/                 read-only legacy exports
data/reference/              curated seed data
```

Do not create the entire planned structure as empty scaffolding. Add directories when the first owned implementation needs them.

## Reuse and retirement

### Reuse

- Existing screens and Fluent UI components
- i18n strings and 390 px design
- pure state/asset ID/reporting logic as references or shared modules
- migration profiling, cleaning, mapping and reports
- synthetic data generator and scenarios
- release bundle scanning concept
- features 001–008 as business requirements

### Retire from the production path

- Power Apps Code App publishing
- Dataverse as the system of record
- `api/dataverse/` as the production adapter
- Power Automate F1–F5 as the state authority
- SharePoint as the primary certificate store
- `svc-ams` as a high-privilege flow account

Keep legacy files until the replacement is implemented and their useful logic has been migrated. Mark them `LEGACY-POWER-PLATFORM` rather than deleting them prematurely.

## Development sequence

Do not begin by adding more screens.

1. Approve `docs/15-postgres-data-model.md` and close its blocking decisions.
2. Create shared contracts and database migrations.
3. Implement identity, health and read-only API paths.
4. Implement the atomic transaction command and concurrency/idempotency tests.
5. Replace the production frontend adapter with HTTP.
6. Add PWA shell caching, IndexedDB data, drafts, queue and conflict resolution.
7. Add private certificate upload/download.
8. Add outbox worker and scheduled jobs.
9. Bind reports to approved SQL views.
10. Adapt and rehearse the migration loader.
11. Complete tenant, security, device, recovery and load verification before pilot.

## Commands

### Existing frontend and mock

```bash
cd app
npm ci
npm run dev
npm run test
npm run build
```

The local mock remains valid for UI development and deterministic tests. A production build must not bundle real staged fleet data.

### Target monorepo commands

These scripts are requirements for the platform work and should be added as the implementation appears:

```bash
npm ci
npm run dev                 # web + API + worker in local development
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run db:migrate
npm run db:check
npm run infra:validate
```

Do not document a command as working until it exists and has been run successfully.

### Migration

The profiling and cleaning stages remain Python and idempotent. The final load target changes to PostgreSQL.

```bash
cd migration
python 01_profile.py
python 02_clean.py
python 03_models.py
# Target loader is rewritten for PostgreSQL before Dev/UAT rehearsal.
```

## API implementation rules

- Prefer explicit feature modules over one large route file.
- Validate requests at the boundary with shared schemas.
- Canonicalize and hash write requests before idempotency lookup.
- Lock asset rows in stable UUID order.
- Keep the complete event in one database transaction.
- Add outbox rows inside that transaction.
- Return structured error codes, not UI copy alone.
- Never trust a browser-provided user ID; resolve the caller from the authenticated session.
- Never accept browser-provided `statusBefore`, `statusAfter`, row owner, role or sequence value as authoritative.
- Keep sensitive fields out of general DTOs instead of relying only on the UI to hide them.
- Database migrations are forward-safe and include compatibility consequences for application rollback.

## Offline implementation rules

- Cache only approved projections, never unrestricted API rows.
- Partition IndexedDB by tenant + environment + user object ID.
- Persist command ID, request hash, originating identity, asset row versions and timestamps.
- Pending means proposed, not accepted.
- Replay while the application is active; optional background-sync support is an enhancement, not the sole mechanism.
- Never replay under a different identity.
- Preserve queued commands across service-worker updates.
- Surface every conflict in Needs attention.
- Verify cold start after device reboot in airplane mode on each supported device/browser.

## Testing gates

A platform change is not complete from unit tests alone.

Required layers:

- pure domain tests;
- database constraint tests;
- API integration tests against PostgreSQL;
- concurrency and fault-injection tests;
- contract tests between app and API;
- browser workflow tests;
- role and office-scope security tests using direct API calls;
- PWA cold-start and replay tests on real supported devices;
- migration reconciliation and idempotency tests;
- backup/restore and document-recovery exercises;
- load tests at 5,000 assets and at least 100,000 transaction lines.

The first production proof is the five-asset race test from feature 009/010. It must pass before additional write workflows are considered production-ready.

## Ask before doing

- Deleting or rewriting source data.
- Loading, deleting or bulk-changing data in any shared Azure environment.
- Creating production Azure resources or incurring material cloud cost.
- Changing the canonical state model, transaction semantics, identity model or retention policy.
- Adding a production data service outside the approved Azure architecture.
- Changing any unresolved decision in `docs/07-open-questions.md`, `docs/13-production-readiness-review.md`, `docs/14-webapp-architecture.md` or `docs/15-postgres-data-model.md` without recording Jay’s decision.
- Treating optional Microsoft 365 integration as required for core operation.
