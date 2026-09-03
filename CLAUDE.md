# Englobe AMS — Asset Management System

Instrumentation asset tracking for Englobe Ontario. The source inventory contains approximately 1,050 rows covering seismograph loggers, geophones, microphones and sound-level meters, SIMs and communications equipment, total stations, cameras, and geotechnical sensors.

Owner and System Owner: Jay Patel.

Read in this order:

1. `.specify/memory/constitution.md`
2. `docs/00-brief.md`
3. `docs/14-webapp-architecture.md`
4. `docs/15-postgres-data-model.md`
5. `docs/16-data-management.md`
6. `specs/009-production-readiness/spec.md`
7. `specs/010-web-application-platform/spec.md`
8. `specs/011-data-management/spec.md` when work touches reference data, corrections, imports, quality, duplicates, lineage, exports, retention or synchronization
9. The owning business feature specification

`docs/01-data-model.md` through `docs/10-integration.md` remain useful historical and logical references, but their Dataverse, Power Apps, Power Automate, SharePoint-as-primary-document-store, and Power Platform licensing instructions are **parked** — see *Parked — Power Platform* below for exactly what that means and what was kept.

**Parked — Zite.** Do not resume without Jay reopening it. The Zite evaluation and the test environment
built from it (`zite/`, `specs/ZITE-BUILD-PROMPT.md`, `docs/18-hosting-alternatives.md`) are closed,
not abandoned. The question they were asked has an answer: `zitejs/db` exposes no transaction and a
failing multi-write does not roll back, so **rule 2 below is unsatisfiable on that interface**
(`docs/18` § 2b, tested against the live runtime). Zite is therefore not a candidate for the
authoritative store. The files stay as evidence. **The active direction is the Azure web application
in the stack table below** — do not start work in `zite/`.

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
| Data management | Governed reference/master data, corrections, jobs, quality, duplicates, lineage, exports, retention and reconciliation |
| Hosting | Azure Container Apps in an approved Canadian region |
| Secrets | Managed identities, workload identity federation and Azure Key Vault where needed |
| Reporting | In-app read-only reports; Power BI optional over approved views |
| Delivery | GitHub Actions, container registry, infrastructure-as-code, immutable revisions |

Microsoft 365 is an integration surface, not the runtime boundary. Teams, email, SharePoint and Power BI may be used, but core asset and data-management operation cannot depend on them.

## Non-negotiable rules

1. **The browser owns no business authority.** It does not decide role, current state, previous state, next state, sequence values or historical facts.
2. **One business event is one atomic database commit.** A five-asset checkout commits all transaction lines, state changes, relationship changes and outbox events, or commits none.
3. **Every external write is idempotent.** Same submission ID + same request returns the original result; same ID + different request is refused.
4. **Current state is derived through accepted events.** No ordinary asset-edit or data-management endpoint writes lifecycle, disposition, serviceability, current location, custodian, project or parent.
5. **Transaction history is append-only.** Corrections create compensating events linked to the original. Exceptional repair is separate, audited and approved.
6. **Asset identity is stable.** UUID is the database key. Canonical Asset ID is unique and immutable. Temporary and legacy tags remain aliases. Serial is non-unique.
7. **Reference data is selected, not typed — and maintained in the app, not in a CSV.** Manufacturer, model, equipment type, asset group, location, project and user are references to curated records. An administrator creates, edits and **deactivates** (never deletes) those records through the app; `data/reference/*.csv` are seeds for the initial load, not the ongoing source. *(Second clause added 2026-09-03 — Jay: "everything should not be static". See `docs/17-ux-audit.md`, `docs/16-data-management.md` § reference stewardship, and `docs/08-decisions.md`.)*
8. **Invalid transitions are refused by the API/database.** Client-side checks exist only for faster feedback.
9. **Lifecycle, disposition, serviceability and calibration currency are separate.** Reporting a fault does not erase custody or deployment.
10. **No credentials in source, data, browser bundle or offline cache.** Field users never receive or cache restricted SIM/network fields.
11. **Production documents and job artifacts are private.** No broad storage credential reaches the browser.
12. **Synthetic data is refused in production.** Environment and seed markers are verified before any load.
13. **Specifications win over code.** A useful implementation deviation is recorded and the governing requirement is amended.
14. **Data management is not a generic database editor.** Use named, validated commands for reference changes, corrections, imports, merges, exports, retention and reconciliation.
15. **Bulk changes require dry run and row-level outcomes.** No row silently disappears and logical atomic groups remain atomic.
16. **Duplicate detection never auto-merges on serial or similar text.** Human review and approved survivor/redirect rules are mandatory.
17. **Post-go-live merge does not rewrite immutable transaction lines.** Preserve both original identities and histories; redirect the old identity to the survivor.
18. **Every production field belongs in the data dictionary.** Definition, authority, classification, roles, offline rule, retention, lineage and quality ownership are mandatory before production acceptance.
19. **Exports are governed products.** Approved template, server-side row/field scope, private short-lived artifact and audit are required.
20. **Retention and purge follow approved policy and legal hold.** No general-purpose delete path exists for production business history.

## Repository direction

```text
app/                         existing React/Vite UI; becomes the PWA
  src/api/http/              planned production AmsBackend implementation
  src/offline/               planned IndexedDB/cache/queue/replay

server/                      planned TypeScript API and workers
  src/auth/
  src/modules/
    assets/
    transactions/
    calibration/
    installations/
    reports/
    data-management/
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

- existing screens and Fluent UI components;
- i18n strings and 390 px design;
- pure state/asset ID/reporting logic as references or shared modules;
- migration profiling, cleaning, mapping and reports;
- synthetic data generator and scenarios;
- release bundle scanning concept;
- features 001–008 as business requirements.

### Parked — Power Platform *(done 2026-09-03)*

The Power Platform is **not** the delivery path and is no longer a second live track. Parked, not
deleted — every file below is kept and banner-marked `LEGACY-POWER-PLATFORM`:

- Power Apps Code App publishing — `app/power.config.json`, the `pac code` workflow;
- Dataverse as system of record;
- `app/src/api/dataverse/` as production adapter — **no longer imported**; `VITE_AMS_BACKEND=dataverse` now throws instead of silently falling back to mock;
- `@microsoft/power-apps` and `@microsoft/power-apps-cli` — **removed from `app/package.json`**; nothing imported them;
- Power Automate F1–F5 as state authority — `solution/flows/`;
- SharePoint as primary certificate store;
- `svc-ams` as a high-privilege flow account;
- `docs/01`, `docs/02`, `docs/03`, `docs/05`, `docs/10` and `solution/` as platform instructions.

Those documents remain useful for the **business rules and logical model** they carry — that is why
they were kept. They are not instructions for how to build anything. Do not start work in
`solution/` or `app/src/api/dataverse/`, and do not add a Power Platform dependency back.

M365 stays available as an *integration* surface (Teams, email, SharePoint export, Power BI).
Core asset and data-management operation must not depend on it.

## Development sequence

Do not begin by adding more operational screens.

1. Approve `docs/15-postgres-data-model.md`, including the additions required by `docs/16-data-management.md`.
2. Close blocking product, data ownership, classification, approval and retention decisions.
3. Create shared contracts and database migrations.
4. Implement identity, health and read-only API paths.
5. Implement the atomic transaction command and concurrency/idempotency tests.
6. Build the read-only data dictionary, data-quality rule engine, dashboard and issue queue.
7. Replace the production frontend adapter with HTTP.
8. Add PWA shell caching, IndexedDB data, drafts, queue and conflict resolution.
9. Add private certificate upload/download.
10. Add controlled corrections and reference-data management.
11. Add import dry run, bulk apply and row-level job results.
12. Add duplicate review/redirect merge and external reconciliation.
13. Add governed exports, retention register, legal holds and purge preview.
14. Add outbox workers and scheduled jobs.
15. Bind reports to approved SQL views.
16. Adapt and rehearse the migration loader.
17. Complete tenant, security, data-management, device, recovery and load verification before pilot.

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

Add these as implementation appears; do not claim they work before they exist and pass:

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run db:migrate
npm run db:check
npm run data:dictionary:check
npm run data:quality:test
npm run infra:validate
```

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
- Never add a generic `PATCH /table/{id}` or arbitrary SQL/data-editor endpoint.

## Data-management implementation rules

- Begin with read-only dictionary, quality rules and issue workflow after schema/authorization stabilize.
- Every reference/static correction is a named command with field-specific validation.
- Every bulk write has a dry-run snapshot, source hash, schema version, approval state, request identity and row-level result.
- Apply refuses source change, expired approval, lost permission, target drift or new critical validation.
- Every job declares Reversible, Compensatable or Irreversible.
- High-impact operations enforce separation of duties.
- Duplicate candidates are never auto-merged; shared serial is valid evidence of nothing by itself.
- A merge creates a permanent redirect and preserves both original histories/UUIDs.
- Quality issue closure requires re-evaluation or approved manual verification.
- Exports use approved templates, server-side scope and private expiring artifacts.
- Retention uses versioned policy, legal-hold checks, preview, approval and database/document reconciliation.
- Source synchronization declares authority per field and cannot overwrite derived state/history.
- Sensitive values are redacted from logs, validation messages and unauthorized job artifacts.

## Offline implementation rules

- Cache only approved projections, never unrestricted API rows.
- Partition IndexedDB by tenant + environment + user object ID.
- Persist command ID, request hash, originating identity, asset row versions and timestamps.
- Pending means proposed, not accepted.
- Replay while the application is active; optional background sync is an enhancement, not the sole mechanism.
- Never replay under a different identity.
- Preserve queued commands across service-worker updates.
- Surface every conflict in Needs attention.
- Verify cold start after device reboot in airplane mode on every supported device/browser.

## Testing gates

Required layers:

- pure domain tests;
- database constraint tests;
- API integration tests against PostgreSQL;
- concurrency and fault-injection tests;
- contract tests between app and API;
- browser workflow tests;
- role and office-scope security tests using direct API calls;
- data-dictionary coverage checks;
- data-quality rule and issue-lifecycle tests;
- import dry-run/apply/idempotency tests;
- duplicate/redirect/history-preservation tests;
- export authorization/expiry tests;
- retention/legal-hold/purge-preview tests;
- PWA cold-start and replay tests on real supported devices;
- migration reconciliation and idempotency tests;
- backup/restore and document-recovery exercises;
- load tests at 5,000 assets and at least 100,000 transaction lines.

The first production proof remains the five-asset race test from features 009/010. The first Data Management proof is a read-only field dictionary plus rule-driven issue queue. High-impact writes follow only after the common authorization, job, audit and atomic command foundations pass.

## Ask before doing

- Deleting or rewriting source data.
- Loading, deleting or bulk-changing data in any shared Azure environment.
- Creating production Azure resources or incurring material cloud cost.
- Changing the canonical state model, transaction semantics, identity model, merge semantics or retention policy.
- Adding a production data service outside the approved Azure architecture.
- Adding or broadening a data-management role, export template, bulk operation or purge authority.
- Approving or self-approving a high-impact data operation on behalf of Jay or a Data Owner.
- Changing unresolved decisions in `docs/07-open-questions.md`, `docs/13-production-readiness-review.md`, `docs/14-webapp-architecture.md`, `docs/15-postgres-data-model.md` or `docs/16-data-management.md` without recording the decision.
- Treating optional Microsoft 365 integration as required for core operation.
