# Requirements Checklist — Feature 010 Web Application Platform

**Feature:** `010-web-application-platform`  
**Review status:** Open — **5 of 112 reviewed** (CHK001–CHK005, *Platform decision*, 2026-09-03). The other 107 are unreviewed and are Jay's gate, not Claude's.  
**Rule:** A checked item means the requirement is explicit, internally consistent, testable, and assigned to a delivery stage. It does not mean the implementation exists.

---

## Platform decision

*Reviewed 2026-09-03, after the Power Platform and Zite tracks were parked. Each item below names the
evidence that closes it, so the review can be re-checked rather than trusted.*

- [x] CHK001 The repository states unambiguously that the production target is a conventional web application.
  <br>*Evidence:* `README.md` title and § Current direction; `CLAUDE.md` § Stack; `docs/14-webapp-architecture.md`; constitution § Hosting. No competing statement remains — both alternative tracks are marked parked.
- [x] CHK002 Power Apps Code App, Dataverse, and Power Automate are identified as superseded primary-runtime choices rather than silently left as parallel production paths.
  <br>*Evidence:* closed 2026-09-03, and **it was genuinely open until then** — the parallel path was not merely documented, it was wired in: `app/src/api/index.ts` imported the Dataverse adapter and `@microsoft/power-apps` was an installed dependency. Now the adapter is unimported, `VITE_AMS_BACKEND=dataverse` throws, both packages are removed from `app/package.json`, and `docs/01`, `02`, `03`, `05`, `10` plus `solution/` carry `LEGACY-POWER-PLATFORM` banners. `CLAUDE.md` § *Parked — Power Platform* lists the whole set. See `docs/08-decisions.md`, 2026-09-03.
- [x] CHK003 Microsoft Entra ID, Teams, SharePoint, and Power BI are described as independent integrations with explicit necessity/optionality.
  <br>*Evidence:* `CLAUDE.md` § Stack — Entra is **required** (identity layer); "Microsoft 365 is an integration surface, not the runtime boundary. Teams, email, SharePoint and Power BI may be used, but core asset and data-management operation cannot depend on them." Constitution § 168 states the same. Necessity and optionality are stated separately, which is what this item asks.
- [x] CHK004 The platform pivot preserves features 001–008 as business requirements unless a recorded conflict changes one.
  <br>*Evidence:* `CLAUDE.md` § Reuse lists "features 001–008 as business requirements". One conflict has arisen and is recorded rather than silent: feature 008 FR-001's release guard was rebound from `dataverse` to `http` (`docs/08-decisions.md`, 2026-09-03). FR-001's own wording — "the real data platform" — was already platform-neutral, so the requirement did not change.
- [x] CHK005 The constitution amendment records the architecture change, rationale, migration consequence, and System Owner approval.
  <br>*Evidence:* `.specify/memory/constitution.md` § Amendment record, Version 2.0.0 — 2026-09-03, carrying all four: **Changed**, **Reason**, **Migration consequence**, **Approved by:** Jay Patel, System Owner.

## Identity and authorization

- [ ] CHK006 Tenant-scoped Entra authentication is specified.
- [ ] CHK007 The application does not create or store separate user passwords.
- [ ] CHK008 Stable Entra object ID, not UPN/email text, is the internal identity key.
- [ ] CHK009 Field User, Office Admin, System Owner, and Report Reader roles are defined.
- [ ] CHK010 Global versus office-scoped administration is explicitly decided before production.
- [ ] CHK011 Every protected API read and write is subject to server-side role and office-scope checks.
- [ ] CHK012 Sign-out and same-device identity change behavior is specified for cached data and queued commands.
- [ ] CHK013 Direct API and document-access tests exist for unauthorized and cross-office attempts.

## Authoritative commands

- [ ] CHK014 One API command covers the complete multi-asset business event.
- [ ] CHK015 Browser-submitted before/after state and sequence values are non-authoritative.
- [ ] CHK016 The server re-reads and locks every affected asset before validation.
- [ ] CHK017 Asset rows are locked in a deterministic order.
- [ ] CHK018 All lines, state changes, relationship changes, installation changes, audit facts, and outbox events commit in one PostgreSQL transaction.
- [ ] CHK019 One invalid line refuses the complete command.
- [ ] CHK020 A unique idempotency key is mandatory on every external write command.
- [ ] CHK021 Same key plus same canonical request returns the original stable outcome.
- [ ] CHK022 Same key plus different request is refused.
- [ ] CHK023 A bounded retry rule exists for deadlock/serialization failures.
- [ ] CHK024 Conflict responses identify the affected asset and actionable reason without exposing unauthorized information.
- [ ] CHK025 Fault injection tests cover failure before and after every material write step.

## History and state

- [ ] CHK026 Transaction headers and lines are immutable after acceptance.
- [ ] CHK027 Corrections are compensating events linked to the original.
- [ ] CHK028 Lifecycle, disposition, serviceability, and calibration currency are separate in the canonical model.
- [ ] CHK029 Report Fault preserves physical state and assignment.
- [ ] CHK030 Repair Complete does not invent a return or location.
- [ ] CHK031 Found requires an explicit resulting physical state.
- [ ] CHK032 Rehome Asset records permanent home-office change in history.
- [ ] CHK033 Retirement resolves or refuses open custody, installation, and relationship obligations.
- [ ] CHK034 A compatibility display-status view does not become the authoritative state column.

## Identity and asset tags

- [ ] CHK035 Canonical Asset ID is unique, human-readable, and immutable.
- [ ] CHK036 Asset ID allocation occurs server-side inside the registration transaction.
- [ ] CHK037 Concurrent registrations cannot receive the same committed ID.
- [ ] CHK038 Temporary and legacy tags remain searchable aliases after canonical completion.
- [ ] CHK039 Serial number is explicitly non-unique and tested with shared-serial examples.
- [ ] CHK040 Sensitive identifiers are excluded from Field User responses and offline storage.

## Offline PWA

- [ ] CHK041 Installable PWA behavior is specified for supported devices.
- [ ] CHK042 Cold start after reboot in airplane mode is an acceptance test.
- [ ] CHK043 The service worker cache strategy and update strategy are specified.
- [ ] CHK044 IndexedDB schema, versioning, and migration are specified.
- [ ] CHK045 Cached records include source row-version and cache age.
- [ ] CHK046 Pending commands survive app and device restarts.
- [ ] CHK047 Queue replay order is defined.
- [ ] CHK048 Replay does not depend exclusively on optional browser background-sync support.
- [ ] CHK049 Accepted-but-unacknowledged commands are safe to retry.
- [ ] CHK050 Conflicted commands move to Needs attention and are never silently dropped.
- [ ] CHK051 Local stores are isolated by tenant, environment, and user.
- [ ] CHK052 No command replays under a different identity.
- [ ] CHK053 Unsupported browser capability is detected and communicated before field reliance.
- [ ] CHK054 Managed-device storage, eviction, and sign-out behavior are included in device verification.

## Calibration and documents

- [ ] CHK055 Calibration record and document upload are independent enough that upload failure does not lose the calibration fact.
- [ ] CHK056 Failed calibration does not advance successful summary dates or return an asset to service.
- [ ] CHK057 Latest qualifying calibration is selected by calibration date, not entry timestamp.
- [ ] CHK058 Calibration create, correction, supersession, and voiding all recalculate summaries.
- [ ] CHK059 Physical return from the lab is an explicit event.
- [ ] CHK060 Private Blob Storage is the target document store.
- [ ] CHK061 Storage access uses application identity/managed identity; no account key reaches the browser.
- [ ] CHK062 Allowed file types, size limit, integrity hash, naming, malware scan, quarantine, and retention are specified.
- [ ] CHK063 Document replacement and attribution history are retained.
- [ ] CHK064 Database and Blob recovery consistency is addressed.

## Data model

- [ ] CHK065 The canonical PostgreSQL schema lists all tables, keys, constraints, indexes, delete behavior, audit fields, and ownership.
- [ ] CHK066 User/office authorization scope is part of the physical data model.
- [ ] CHK067 Idempotency and transactional outbox tables are part of the physical data model.
- [ ] CHK068 Installation and installation-component spans are part of the physical data model.
- [ ] CHK069 Asset aliases are part of the physical data model.
- [ ] CHK070 Calibration interval overrides are represented physically.
- [ ] CHK071 Ownership type is structured rather than parsed from notes.
- [ ] CHK072 Synthetic provenance exists on every table the loader must select/delete by seed.
- [ ] CHK073 Relationship cycles, overlapping open relationships, and multiple open parents are database-tested.

## Hosting and infrastructure

- [ ] CHK074 Production application and data are in an approved Canadian Azure region.
- [ ] CHK075 Azure Container Apps hosting and environment boundaries are specified.
- [ ] CHK076 PostgreSQL private networking is specified for production.
- [ ] CHK077 Blob containers are private and anonymous access is disabled.
- [ ] CHK078 Managed identity and Key Vault responsibilities are explicit.
- [ ] CHK079 Infrastructure is represented in Bicep or the approved enterprise IaC tool.
- [ ] CHK080 GitHub Actions uses workload identity federation/OIDC rather than a long-lived Azure secret.
- [ ] CHK081 Dev, UAT, and Prod have separate data, storage, identities, and approvals.
- [ ] CHK082 Application revision and database schema compatibility are checked before traffic promotion.

## Operations and recovery

- [ ] CHK083 API, worker, database, storage, authentication, and outbox telemetry are specified.
- [ ] CHK084 Alert destinations have named owners.
- [ ] CHK085 Outbox backlog age and terminal worker failures alert a person.
- [ ] CHK086 RTO and RPO are approved before the production tier is selected.
- [ ] CHK087 Database backup retention and point-in-time restore are configured.
- [ ] CHK088 Document recovery is defined separately from database recovery.
- [ ] CHK089 Restore exercises are scheduled, measured, and reconciled.
- [ ] CHK090 Application rollback, schema compatibility, data restore, and document restore are separate runbooks.
- [ ] CHK091 Deployment records source commit, image/revision, schema version, environment, actor, and verification result.

## Reporting and integrations

- [ ] CHK092 Read-only web reporting answers the seven programme questions.
- [ ] CHK093 Report Reader access does not grant operational write access.
- [ ] CHK094 General reporting responses and exports exclude sensitive identifiers.
- [ ] CHK095 Optional Power BI reads approved views rather than unrestricted tables.
- [ ] CHK096 Teams, email, SharePoint, and Power BI outages do not block core asset operations.
- [ ] CHK097 Data currency is visible on every report view.

## Migration and cutover

- [ ] CHK098 Existing source profiling, cleaning, mapping, and conflict reports are retained.
- [ ] CHK099 PostgreSQL loader is idempotent and produces row-level reconciliation.
- [ ] CHK100 Ambiguous calibration evidence remains unmatched until human confirmation.
- [ ] CHK101 Rehearsal snapshot, delta extraction, freeze time, final load, validation, and rollback are specified.
- [ ] CHK102 Model-review and duplicate-conflict sign-offs remain production gates.
- [ ] CHK103 Synthetic loading is structurally refused in production.
- [ ] CHK104 A second identical rehearsal produces an empty business-data diff.

## Verification and pilot

- [ ] CHK105 Unit, integration, API contract, database invariant, browser, device, security, migration, load, and recovery test layers are defined.
- [ ] CHK106 The five-asset atomic race test passes against the real PostgreSQL/API boundary.
- [ ] CHK107 The thirty-command offline replay test passes on every supported device class.
- [ ] CHK108 Direct API cross-role and cross-office tests pass.
- [ ] CHK109 A certificate upload-failure and later-attach test passes.
- [ ] CHK110 A failed-calibration workflow test passes.
- [ ] CHK111 A clean environment can be deployed from repository artifacts and documented enterprise prerequisites.
- [ ] CHK112 Ottawa pilot entry and exit criteria reference Feature 010 and Feature 009.
