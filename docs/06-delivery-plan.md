# 06 — Web Application Delivery Plan

## Current programme status

The business specification, source-data analysis, migration cleaning pipeline, mobile React user experience, domain tests and mock-backed workflows are substantial.

The production platform has changed. The active target is the Azure web architecture in `docs/14-webapp-architecture.md`, governed by constitution version 2.0.0 and features 009–010.

Current maturity:

```text
Business specification          substantial
Local user experience           Mock Implemented
Azure web architecture          specified
Canonical PostgreSQL schema     proposed, not approved
Production API                  not implemented
Entra integration               not implemented
PWA offline behavior            not implemented or device-verified
Azure infrastructure            not implemented
Production migration            not rehearsed
Ottawa pilot                    not approved
```

Do not add more mock-only screens until the atomic transaction proof is complete.

---

## Stage 0 — Decisions, ownership and enterprise prerequisites

### System Owner decisions

- [ ] Q6 server/configuration treatment confirmed
- [ ] Q8 expected-return rule confirmed
- [ ] Q9 backdating window and conflict rule decided
- [ ] Q10 project-master source decided
- [ ] Q11 reporting audience confirmed
- [ ] Q18 permanent-component calibration dispatch decided
- [ ] administrator scope decided: global or data-layer-enforced by office
- [ ] permanent asset rehome workflow approved
- [ ] calibration failure and physical-lab-return workflow approved
- [ ] ownership categories approved
- [ ] supported offline workflows approved
- [ ] supported device/browser matrix approved

### Enterprise platform decisions

- [ ] Azure subscription and resource owner named
- [ ] approved Canadian production region selected
- [ ] internet-reachable behind Entra versus private-network-only access decided
- [ ] application/data classification completed
- [ ] Dev, UAT and Prod environment ownership agreed
- [ ] Entra app-registration ownership agreed
- [ ] GitHub-to-Azure workload identity approved
- [ ] DNS and TLS ownership agreed
- [ ] RTO, RPO, backup retention and production HA budget approved
- [ ] alert destinations and on-call/support owners named
- [ ] certificate malware-scanning approach approved
- [ ] Azure cost centre and budget alert owner named

### Existing migration sign-offs

- [ ] `migration/reports/03_models_review.md` reviewed and signed
- [ ] `migration/reports/02_conflicts.md` reviewed and signed before production load

**Definition of done:** Every decision has an owner and evidence. Architecture blockers are recorded in `docs/08-decisions.md`. No production resource or material cloud cost is created without enterprise approval.

---

## Stage 1 — Canonical architecture and schema approval

### 1A. Approve the web platform

Review and approve:

- [ ] `docs/14-webapp-architecture.md`
- [ ] `specs/010-web-application-platform/spec.md`
- [ ] `specs/010-web-application-platform/checklists/requirements.md`
- [ ] continued applicability of `specs/009-production-readiness/spec.md`

### 1B. Approve the state model

- [ ] lifecycle separated from physical disposition
- [ ] serviceability separated from disposition
- [ ] calibration currency derived independently
- [ ] Report Fault preserves custody/location/project/deployment
- [ ] Repair Complete does not invent a return
- [ ] Found requires an explicit resulting physical state
- [ ] Retire resolves open custody, relationships and installations
- [ ] compatibility display status remains presentation only

### 1C. Approve the PostgreSQL model

Review `docs/15-postgres-data-model.md` and close its open schema decisions.

Required entities:

- application user, role and office scope
- equipment model
- location hierarchy
- project
- asset and asset identifier/alias
- transaction and immutable transaction line
- command idempotency
- asset relationship
- calibration record
- document and calibration-document association
- installation and installation component
- asset-ID sequence
- transactional outbox
- audit event
- approved reporting views

For every table record:

- column purpose and type;
- requiredness and defaults;
- keys and indexes;
- constraints;
- relationship and delete behavior;
- audit and retention behavior;
- sensitive/offline behavior;
- migration source;
- ownership and write authority.

**Definition of done:** Constitution check passes; no unresolved load-bearing schema conflict remains; the canonical schema is signed off before migrations are authored.

---

## Stage 2 — Repository and local engineering foundation

### 2A. Preserve the existing frontend

- [ ] retain `app/` as the PWA client
- [ ] keep current screens and tests passing
- [ ] mark Power Platform-specific adapters and release instructions as `LEGACY-POWER-PLATFORM`
- [ ] do not delete legacy logic until replacement coverage exists

### 2B. Add implementation structure when first needed

Target structure:

```text
server/                 TypeScript API and worker
packages/contracts/     shared validated API schemas
packages/domain/        shared pure rules where safe
db/migrations/          PostgreSQL schema migrations
db/views/               reviewed reporting views
infra/                   Bicep and environment parameters
```

- [ ] one root package/workspace command runs client, API and worker locally
- [ ] formatting, lint, typecheck and tests are consistent across packages
- [ ] local PostgreSQL is reproducible through an approved container/dev setup
- [ ] test database is isolated and resettable
- [ ] shared contracts generate or publish OpenAPI
- [ ] secrets remain outside source

### 2C. Baseline continuous integration

PR CI must run:

- [ ] install with lockfile enforcement
- [ ] formatting/lint
- [ ] TypeScript typecheck
- [ ] existing frontend tests
- [ ] API/unit tests
- [ ] database migration validation
- [ ] API contract tests
- [ ] dependency and secret scanning
- [ ] release bundle data scan
- [ ] production container build

**Definition of done:** A clean checkout can run the existing client plus a minimal API/database locally. CI is green and does not require a developer’s personal cloud credentials.

---

## Stage 3 — Identity, sessions and read-only API

### 3A. Entra sign-in

- [ ] tenant-scoped application registration
- [ ] supported OIDC Authorization Code flow with PKCE
- [ ] server-side session or approved Backend-for-Frontend design
- [ ] secure, HttpOnly, same-site cookie policy
- [ ] CSRF protection
- [ ] state, nonce, redirect and logout validation
- [ ] stable identity keyed by tenant ID + Entra object ID
- [ ] UPN changes do not create duplicate users

### 3B. Roles and office scope

- [ ] Field User
- [ ] Office Admin
- [ ] System Owner
- [ ] Report Reader
- [ ] Entra role/group claims mapped deliberately
- [ ] office scope stored and enforced by API
- [ ] disabled/inactive user handling
- [ ] direct API tests for cross-role and cross-office access

### 3C. Read paths

Implement approved HTTP endpoints for:

- [ ] current user/session
- [ ] asset search
- [ ] asset detail
- [ ] asset history
- [ ] calibration due
- [ ] locations/offices
- [ ] equipment models
- [ ] active projects
- [ ] current installations
- [ ] basic report views

Responses are role-specific projections. Sensitive identifiers do not appear in general DTOs.

**Definition of done:** Authorized users can sign in and read permitted data from PostgreSQL on desktop and mobile. Unauthorized, cross-office and direct-endpoint attempts are refused and tested.

---

## Stage 4 — Atomic transaction service: first production proof

This stage blocks migration of all write screens.

### 4A. Command contract

Implement:

```http
POST /api/transactions
Idempotency-Key: <UUID>
```

The browser submits intent and line membership. It does not submit authoritative before/after state, role, sequence value or previous ownership.

### 4B. Database transaction behavior

Within one PostgreSQL transaction:

- [ ] authenticate and authorize caller
- [ ] canonicalize request and calculate request hash
- [ ] claim unique idempotency key
- [ ] load affected assets in deterministic UUID order using row locks
- [ ] validate every asset, project, relationship, component and required field
- [ ] refuse complete command if any line fails
- [ ] create one immutable transaction header
- [ ] create one immutable line per affected asset
- [ ] compute and update all derived state
- [ ] open/close relationship and installation spans
- [ ] write audit/outbox records
- [ ] commit once
- [ ] return transaction ID and all resulting states

### 4C. Required first test

Run a five-asset checkout test with:

- [ ] two users racing for one overlapping asset
- [ ] request retry after an accepted response is deliberately lost
- [ ] same idempotency key with changed payload
- [ ] injected exception after each material write step
- [ ] reversed input order to test deterministic locking
- [ ] invalid fifth asset to test complete rollback

Expected result:

- one winner;
- one structured conflict;
- one transaction for repeated accepted request;
- zero partial commands;
- zero browser-authored state;
- immutable history.

### 4D. Registration and Asset ID

- [ ] sequence allocation occurs inside server registration transaction
- [ ] temporary tags remain aliases
- [ ] canonical ID is immutable
- [ ] 100 concurrent same-prefix registrations produce 100 unique IDs

**Definition of done:** Feature 009 and 010 atomicity/idempotency criteria pass against the real TypeScript/PostgreSQL boundary. No additional write workflow is called production-capable before this proof passes.

---

## Stage 5 — Move business workflows to HTTP

Implement the production `AmsBackend` HTTP adapter and migrate workflows in this order:

1. [ ] Checkout
2. [ ] Return
3. [ ] Transfer
4. [ ] New asset / temporary-tag completion
5. [ ] Report fault / repair complete
6. [ ] Mark missing / found
7. [ ] Send to calibration / physical return
8. [ ] Record/correct calibration
9. [ ] Retire
10. [ ] Rehome asset
11. [ ] Attach/detach permanent component
12. [ ] Deploy
13. [ ] Recover partially or fully
14. [ ] Swap component / change live installation configuration
15. [ ] Audit/stocktake

For every workflow:

- [ ] browser validates for fast feedback
- [ ] API independently validates
- [ ] role/office scope enforced
- [ ] accepted event is atomic and idempotent
- [ ] error codes map to understandable UI copy
- [ ] history and current state reconcile
- [ ] integration tests include race and invalid-state paths

**Definition of done:** Features 001–005 are API Implemented in Dev. Mock and production adapters pass a shared contract suite where their behavior should match.

---

## Stage 6 — Progressive Web App and offline operation

### 6A. PWA shell

- [ ] web manifest
- [ ] installability
- [ ] service worker registration and update flow
- [ ] offline application shell
- [ ] safe update while drafts/commands exist
- [ ] version compatibility between cached client and API

### 6B. IndexedDB model

Partition by:

```text
tenant ID + environment ID + user object ID
```

Store only approved projections:

- [ ] active asset cache
- [ ] reference data
- [ ] limited history where approved
- [ ] drafts
- [ ] pending commands
- [ ] conflict/Needs-attention records
- [ ] schema version
- [ ] cache age and last sync
- [ ] originating identity
- [ ] asset row versions
- [ ] command hash and replay attempts

Never store Field User restricted SIM/network values or certificate bytes.

### 6C. Replay

- [ ] replay when active application regains connectivity
- [ ] manual retry
- [ ] ordered dependency handling
- [ ] exactly-once server result through idempotency
- [ ] structured 409 conflict handling
- [ ] no silent discard or force-apply
- [ ] no replay under different identity
- [ ] sign-out behavior for pending work

Optional browser background-sync APIs may improve replay but cannot be the only mechanism.

### 6D. Device verification

For every approved iOS/Android browser/device class:

- [ ] install and initial online sync
- [ ] close app
- [ ] reboot device
- [ ] airplane-mode cold start
- [ ] offline search
- [ ] offline draft and queued command
- [ ] conflict created from another device
- [ ] reconnect and replay
- [ ] expired session/token
- [ ] same-device user switch
- [ ] storage eviction behavior
- [ ] service-worker update with queued commands
- [ ] camera permission allowed/denied/interrupted
- [ ] restricted fields absent from local store

**Definition of done:** The supported offline scope is evidenced, not assumed. Unsupported behavior is removed from pilot acceptance or triggers a separate native-wrapper decision.

---

## Stage 7 — Documents and calibration correctness

### 7A. Private Blob Storage

- [ ] private container
- [ ] anonymous access disabled
- [ ] server/managed-identity access
- [ ] no storage account key in browser or repository
- [ ] collision-safe path and file naming
- [ ] allowed content types
- [ ] maximum size
- [ ] SHA-256 integrity hash
- [ ] malware-scan/quarantine state
- [ ] replacement history
- [ ] retention beyond retirement

### 7B. Calibration transaction rules

- [ ] Pass advances qualifying summaries
- [ ] accepted Adjusted result advances qualifying summaries
- [ ] Fail does not advance successful summaries
- [ ] Fail does not return asset to service
- [ ] older historical entry does not replace a newer qualifying record
- [ ] correction/supersession/void recalculates summaries
- [ ] upload failure preserves calibration fact
- [ ] later attach does not require recreating calibration
- [ ] physical return from lab is an explicit event
- [ ] component calibration rule follows approved Q18 decision

### 7C. Recovery consistency

- [ ] database restore procedure
- [ ] Blob document recovery procedure
- [ ] reconciliation between calibration metadata and object existence/hash
- [ ] orphan document and missing object reports

**Definition of done:** Certificate and calibration workflows pass success, failure, correction, replacement, retirement and recovery tests.

---

## Stage 8 — Outbox, workers, notifications and reconciliation

### Transactional outbox

- [ ] outbox event committed with business event
- [ ] worker lease/claim behavior
- [ ] bounded retries
- [ ] dead-letter or failed-state handling
- [ ] idempotent consumers
- [ ] backlog-age metric and alert

### Scheduled/background capabilities

- [ ] calibration reminders
- [ ] overdue-return reminders
- [ ] unprocessed/consistency reconciliation
- [ ] certificate scan/status follow-up
- [ ] optional Teams/email delivery
- [ ] office-to-admin resolution from live data
- [ ] bounded notification size
- [ ] approved reminder cadence

Notification failure is logged and alerted according to policy but never rolls back or changes accepted asset state.

**Definition of done:** Workers can fail and recover without duplicate business effects. A terminal failure reaches a named monitored owner.

---

## Stage 9 — Reporting

### In-app read-only reporting

Implement:

- [ ] Fleet
- [ ] Where / Who
- [ ] Availability by office
- [ ] Calibration due / overdue / unknown
- [ ] By project
- [ ] Asset timeline
- [ ] Site/installation timeline
- [ ] Utilisation with acquisition/go-live boundary protection

### Access and export

- [ ] Report Reader role
- [ ] no operational write privileges
- [ ] secured fields absent from manager responses and exports
- [ ] data currency stated on every view
- [ ] export authorization tested
- [ ] queries reconciled to operational records

### Optional Power BI

Power BI is added only if needed after the web reports are accepted.

- [ ] approved read-only SQL views only
- [ ] identity/RLS model documented
- [ ] no unrestricted table connection
- [ ] secured fields excluded from general semantic model
- [ ] reader licensing/capacity decision recorded

**Definition of done:** An authorized manager can answer all seven programme questions from the web application without a Power Apps runtime licence and without seeing restricted fields.

---

## Stage 10 — Azure infrastructure and deployment

### Infrastructure-as-code

- [ ] Container Apps environment
- [ ] web/API container app
- [ ] worker or scheduled job
- [ ] Azure Container Registry
- [ ] PostgreSQL Flexible Server
- [ ] private networking / private access as approved
- [ ] Blob Storage
- [ ] Key Vault where needed
- [ ] Log Analytics / Application Insights
- [ ] DNS and managed/approved certificates
- [ ] managed identities and least-privilege RBAC
- [ ] environment parameters for Dev/UAT/Prod
- [ ] budget alerts

### Delivery

- [ ] GitHub Actions OIDC/workload identity
- [ ] image build and vulnerability scan
- [ ] migration compatibility check
- [ ] deploy immutable revision
- [ ] health and smoke verification
- [ ] controlled traffic promotion
- [ ] recorded source commit, image digest, schema version and actor
- [ ] application rollback procedure
- [ ] schema forward-recovery/compatibility procedure

**Definition of done:** A fresh non-production environment is deployable from repository artifacts plus documented enterprise prerequisites. No long-lived Azure deployment secret is stored in GitHub.

---

## Stage 11 — Migration rehearsal and cutover

### Preserve existing migration strengths

- [ ] frozen source profile
- [ ] corrected calibration export
- [ ] curated equipment model mapping
- [ ] one-to-one source office mapping
- [ ] duplicate/conflict reports
- [ ] temporary-tag completion queue
- [ ] unknown-custodian sweep
- [ ] row-level source traceability
- [ ] idempotent outputs

### PostgreSQL loader

- [ ] reference data
- [ ] users needed for attribution
- [ ] assets and aliases
- [ ] inventory events
- [ ] calibration evidence
- [ ] supported component relationships
- [ ] derived summary recalculation
- [ ] outbox disabled or controlled during bulk load
- [ ] reconciliation reports

### Cutover rehearsal

- [ ] initial UAT snapshot
- [ ] source change/delta after rehearsal
- [ ] freeze date and time
- [ ] final delta extraction
- [ ] final load
- [ ] source/staged/target reconciliation
- [ ] second-run empty business diff
- [ ] performance timing
- [ ] rollback criteria and procedure
- [ ] physical Ottawa sample verification

Ambiguous calibration evidence remains unmatched until a person confirms the target.

**Definition of done:** Every source record is loaded or explained. Both hard sign-offs exist. The cutover fits the approved window and can be reversed according to the approved criteria.

---

## Stage 12 — Security, load and recovery verification

### Security

- [ ] authentication and session tests
- [ ] direct API role matrix
- [ ] direct API office-scope matrix
- [ ] insecure direct object reference tests
- [ ] CSRF and redirect tests
- [ ] document authorization tests
- [ ] export tests
- [ ] sensitive-field network/cache tests
- [ ] dependency/container/IaC scans
- [ ] audit and incident evidence

### Load

At minimum:

- [ ] 5,000 active assets
- [ ] 100,000+ transaction lines
- [ ] concurrent search/read load
- [ ] simultaneous overlapping transactions
- [ ] long asset timeline
- [ ] report queries
- [ ] migration throughput
- [ ] outbox backlog recovery

### Recovery

- [ ] PostgreSQL point-in-time restore to isolated environment
- [ ] Blob recovery or version/backup restore according to approved design
- [ ] metadata/object/hash reconciliation
- [ ] measured RTO and RPO
- [ ] previous compatible application revision restored
- [ ] alert and escalation rehearsal

**Definition of done:** Feature 009 and 010 security, device, scale and recovery criteria have dated evidence.

---

## Stage 13 — Ottawa pilot

### Entry criteria

- atomic transaction proof passed;
- production workflows use HTTP/API rather than mock/Dataverse;
- Entra and office scope verified;
- supported offline matrix passed;
- document/calibration failure behavior passed;
- migration rehearsal and sign-offs complete;
- restore exercise complete;
- alerts and support ownership active.

### Pilot work

- [ ] freeze and load Ottawa final delta
- [ ] conduct unknown-custodian return sweep
- [ ] perform at least 20 real checkout/return cycles
- [ ] deliberately exercise double-booking refusal
- [ ] exercise supported offline queue/conflict path
- [ ] record calibration and certificate
- [ ] physically verify available stock sample
- [ ] answer all seven acceptance questions
- [ ] track support incidents, conflicts, latency, worker failures and corrections

### Exit criteria

- zero partial multi-asset commands;
- zero duplicate accepted retries;
- zero direct user writes to derived state;
- every deliberate double booking refused;
- zero silently lost queued commands in the supported scope;
- zero unauthorized sensitive-field exposure;
- report results reconcile;
- support and recovery procedures are usable by a successor.

---

## Stage 14 — Production rollout by office

- [ ] review pilot findings and amend specs/decisions
- [ ] repeat rehearsal/freeze/delta/reconciliation per rollout wave
- [ ] establish office scope and administrators
- [ ] load remaining offices
- [ ] retain rollback window
- [ ] retire legacy write paths only after reconciliation
- [ ] repeat post-release alert and recovery checks

---

## Whole-programme definition of done

- All seven acceptance questions are answered live from production data.
- Every complete business event is atomic, server-authoritative and idempotent.
- Current state is derived from immutable accepted history.
- Canonical Asset IDs are immutable and legacy/temporary tags remain searchable aliases.
- Role and office authorization hold through direct API and document access.
- Supported offline behavior is verified on real managed devices.
- Calibration and certificate failure paths preserve truthful compliance records.
- Core operation continues without optional Teams, SharePoint or Power BI integrations.
- Migration and final deltas account for every source record.
- The system deploys into a fresh environment from repository artifacts and documented prerequisites.
- Application rollback, schema compatibility, database restore and document recovery are separate, tested procedures.
- A successor can deploy, verify, observe, restore and support the system without undocumented author knowledge.
