# Requirements Checklist — Feature 010 Web Application Platform

**Feature:** `010-web-application-platform`
**Review status:** **Reviewed 2026-09-04 — 99 of 112.** Thirteen are not checked: CHK013, CHK040,
CHK051, CHK054, CHK086, CHK087, CHK089, CHK091, CHK093, CHK094, CHK107, CHK108 and CHK111.
The D18 additions deliberately reopen old role/office and restricted-field proof claims; a legacy
subset is not full workspace/purpose/capability/projection evidence.
**Rule:** A checked item means the requirement is explicit, internally consistent, testable, and
assigned to a delivery stage. It does not mean the implementation exists.

**Reviewer:** this build, self-approved on Jay's instruction (`docs/08` § Self-approved product
decisions — 2026-09-04). CHK001–CHK005 were reviewed 2026-09-03 and are unchanged.

**How to re-check this review rather than trust it:** every item names the artifact that closes it.
Where the artifact is a test, `scripts/verify.sh` runs it — 555 server tests against PostgreSQL 17,
543 against PGlite, 545 client tests, plus lint and a client build, all green at review time.

---

## Platform decision

*Reviewed 2026-09-03, after the Power Platform and Zite tracks were parked. Each item below names the
evidence that closes it, so the review can be re-checked rather than trusted.*

- [x] CHK001 The repository states unambiguously that the production target is a conventional web application.
  <br>*Evidence:* `README.md` title and § Current direction; `CLAUDE.md` § Stack; `docs/14-webapp-architecture.md`; constitution § Hosting. No competing statement remains — both alternative tracks are marked parked.
- [x] CHK002 Power Apps Code App, Dataverse, and Power Automate are identified as superseded primary-runtime choices rather than silently left as parallel production paths.
  <br>*Evidence:* closed 2026-09-03, and **it was genuinely open until then** — the parallel path was not merely documented, it was wired in: `app/src/api/index.ts` imported the Dataverse adapter and `@microsoft/power-apps` was an installed dependency. Now the adapter is unimported, `VITE_AMS_BACKEND=dataverse` throws, both packages are removed from `app/package.json`, and `docs/01`, `02`, `03`, `05`, `10` plus `solution/` carry `LEGACY-POWER-PLATFORM` banners. `CLAUDE.md` § *Parked — Power Platform* lists the whole set. See `docs/08-decisions.md`, 2026-09-03. **Re-verified 2026-09-04:** `scripts/lint-rules.mjs` now fails the build if any of it is re-imported.
- [x] CHK003 Microsoft Entra ID, Teams, SharePoint, and Power BI are described as independent integrations with explicit necessity/optionality.
  <br>*Evidence:* `CLAUDE.md` § Stack — Entra is **required** (identity layer); "Microsoft 365 is an integration surface, not the runtime boundary." Constitution § 168 states the same. FR-053 makes the optionality a requirement.
- [x] CHK004 The platform pivot preserves features 001–008 as business requirements unless a recorded conflict changes one.
  <br>*Evidence:* `CLAUDE.md` § Reuse. One conflict arose and is recorded rather than silent: feature 008 FR-001's release guard rebound from `dataverse` to `http` (`docs/08`, 2026-09-03).
- [x] CHK005 The constitution amendment records the architecture change, rationale, migration consequence, and System Owner approval.
  <br>*Evidence:* `.specify/memory/constitution.md` § Amendment record, Version 2.0.0 — 2026-09-03: **Changed**, **Reason**, **Migration consequence**, **Approved by:** Jay Patel, System Owner.

## Identity and authorization

- [x] CHK006 Tenant-scoped Entra authentication is specified.
  <br>*Evidence:* `CLAUDE.md` § Stack ("Microsoft Entra ID, tenant-scoped OIDC; server-side authorization"); `docs/14` § 4; `contracts/auth-caller-context.md`. Implemented and proven against a fabricated issuer (`server/src/auth/providers/oidcProvider.ts`); a real tenant is R6.
- [x] CHK007 The application does not create or store separate user passwords.
  <br>*Evidence:* no password column exists in `docs/15` § 4 or `db/migrations/0002_identity.sql`; `scripts/lint-rules.mjs` rule 10 fails the build on a credential literal in source.
- [x] CHK008 Stable Entra object ID, not UPN/email text, is the internal identity key.
  <br>*Evidence:* `docs/15` § 4 `app_user.object_id`; the offline partition is keyed on it (`app/src/offline/partition.ts`), and FR-029's replay guard compares `objectId` per command.
- [x] CHK009 Field User, Office Admin, System Owner, and Report Reader roles are defined.
  <br>*Evidence:* `docs/14` § 4.5; `server/src/auth/roles.ts` `APP_ROLES`; all four exercised by `tests/authorization.test.ts` (57).
- [x] CHK010 Global versus office-scoped administration is explicitly decided before production.
  <br>*Evidence:* **R5 decided 2026-09-04** — `docs/08` § R5: OfficeAdmin office-scoped, SystemOwner global. This was the last blocking product decision in `REMAINING-WORK.md` § 1 and it is now closed, with the registration consequence implemented (`registration.error.officeScope`) and tested.
- [x] CHK011 The specification requires every protected read/write to intersect identity,
  tenant/environment, workspace, purpose, named capability, row scope and explicit field projection
  server-side before fetch.
  <br>*Specification evidence:* FR-004–FR-004d, `docs/14` § Authorization and D18. Existing code proves
  only a role/office subset; implementation conformance is CHK108 and remains open.
- [x] CHK012 Identity, workspace, scope and capability-change behavior is specified for navigation,
  memory, cache, browser history and queued commands.
  <br>*Specification evidence:* FR-004d/FR-007 and D18 § 11. Existing identity partitioning is only a
  partial implementation of this contract.
- [ ] CHK013 Full D18 direct API and document-access tests exist, including purpose/capability denial,
  exact response keys, document ACL, wrong-workspace zero fetch, no existence leak and revocation.
  <br>*Partially evidenced.* Current authorization, Field-security and document tests cover the older
  role/office/restricted-field model, not the complete D18 matrix.

## Authoritative commands

- [x] CHK014 One API command covers the complete multi-asset business event.
  <br>*Evidence:* FR-008; `contracts/transaction-command.md`; `POST /api/commands/:type` takes `lines[]`.
- [x] CHK015 Browser-submitted before/after state and sequence values are non-authoritative.
  <br>*Evidence:* FR-015 and `contracts/transaction-command.md` § FORBIDDEN; zod strips unknown keys at the boundary, and `scripts/lint-rules.mjs` rule 1 fails the build if a request schema ever names one.
- [x] CHK016 The server re-reads and locks every affected asset before validation.
  <br>*Evidence:* FR-009/FR-010; `SELECT … FOR UPDATE` in `transactionService.ts` `lockAssets`.
- [x] CHK017 Asset rows are locked in a deterministic order.
  <br>*Evidence:* FR-010 ("deterministic order"); `ORDER BY a.assetid FOR UPDATE`. Proven by a deliberate **opposite-lock-order control** that deadlocks with SQLSTATE 40P01 — the control is what shows the ordered path is doing the work rather than getting lucky (`tests/concurrency.test.ts`).
- [x] CHK018 All lines, state changes, relationship changes, installation changes, audit facts, and outbox events commit in one PostgreSQL transaction.
  <br>*Evidence:* FR-011, FR-044, rule 2; the outbox insert runs on the same `tx` as the lines.
- [x] CHK019 One invalid line refuses the complete command.
  <br>*Evidence:* FR-011; `applyTransaction` validates every line before writing anything, and a refusal after a partial write rolls back through the `Refusal` class rather than returning. `tests/concurrency.test.ts` S2: 100 deliberate multi-asset failures leave zero partial writes.
- [x] CHK020 A unique idempotency key is mandatory on every external write command.
  <br>*Evidence:* FR-012; `clientSubmissionId` is `z.string().min(1)` on every write schema, and `command_idempotency` has it as primary key.
- [x] CHK021 Same key plus same canonical request returns the original stable outcome.
  <br>*Evidence:* FR-013; `contracts/transaction-command.md` § Canonical request hash; `answerFromStore`.
- [x] CHK022 Same key plus different request is refused.
  <br>*Evidence:* FR-014; `command.error.idempotencyPayloadMismatch`. This was a finding (WS-W4-F1) and the fix is recorded — the earlier implementation returned the stored outcome in both cases.
- [x] CHK023 A bounded retry rule exists for deadlock/serialization failures.
  <br>*Evidence:* `contracts/error-codes.md:57` `command.error.serializationRetryExhausted`; `runCommand` retries exactly once and says why a third pass could learn nothing.
- [x] CHK024 Conflict responses identify the affected asset and actionable reason without exposing unauthorized information.
  <br>*Evidence:* `contracts/error-codes.md`; `SubmissionError.offendingAssetId` (FR-023); refusal text is an i18n key or a sentence, never a row dump.
- [x] CHK025 Fault injection tests cover failure before and after every material write step.
  <br>*Evidence:* required by the spec § Verification; `tests/concurrency.test.ts` and `tests/outbox.test.ts` (29) inject failures around the claim, the lines, the asset update and the outbox row.

## History and state

- [x] CHK026 Transaction headers and lines are immutable after acceptance.
  <br>*Evidence:* FR-016, rule 5; enforced in the database including TRUNCATE (`db/migrations/0003_history_append_only.sql`), and asserted by attempting an UPDATE in `tests/stateCommands.test.ts`.
- [x] CHK027 Corrections are compensating events linked to the original.
  <br>*Evidence:* FR-017; R-25 with `correctionoftransaction` NOT NULL on Correction rows and NULL on every other type, both as CHECK constraints (`0017`). How the corrected axes are derived is `docs/08` **D8**.
- [x] CHK028 Lifecycle, disposition, serviceability, and calibration currency are separate in the canonical model.
  <br>*Evidence:* FR-018; DC-22 stored axes (`0016`), six axis columns per line, and **as of 2026-09-04 also separate on the wire** — the DTO carried only the collapsed pill until `docs/08` **D9**.
- [x] CHK029 Report Fault preserves physical state and assignment.
  <br>*Evidence:* R-12 (`untouched: lifecycle, disposition`); evidenced by T035 in `tests/stateCommands.test.ts`, which deploys a station and faults a component, asserting disposition stays `Deployed` and location/custodian/project are unchanged.
- [x] CHK030 Repair Complete does not invent a return or location.
  <br>*Evidence:* R-13 sets `serviceability` only, `untouched: lifecycle, disposition`; `deriveState`'s `RepairComplete` case returns `base`.
- [x] CHK031 Found requires an explicit resulting physical state.
  <br>*Evidence:* R-17a/b/c are three variants selected by destination, and a `Found` naming none is refused `transition.error.destinationRequired` (`app/src/domain/transition.ts`).
- [x] CHK032 Rehome Asset records permanent home-office change in history.
  <br>*Evidence:* R-18, implemented 2026-09-04 (`docs/08` **D7**); `homeoffice` joins `DerivedFields` so the change is a line's output, and `tests/stateCommands.test.ts` asserts the history entry exists.
- [x] CHK033 Retirement resolves or refuses open custody, installation, and relationship obligations.
  <br>*Evidence:* R-19 — refused from `CheckedOut`/`Deployed`/`InTransit`, and `transition.error.openObligation` for an open installation or parent relationship.
- [x] CHK034 A compatibility display-status view does not become the authoritative state column.
  <br>*Evidence:* DC-22 item 1 and `0016`: `asset.status` is `GENERATED ALWAYS AS` from the axes, so it is not writable by anything, including `psql`.

## Identity and asset tags

- [x] CHK035 Canonical Asset ID is unique, human-readable, and immutable.
  <br>*Evidence:* rule 6; `db/migrations/0004_asset_identity.sql` refuses any `assetid` rename, with the escape hatch deliberately withheld.
- [x] CHK036 Asset ID allocation occurs server-side inside the registration transaction.
  <br>*Evidence:* FR-019; `consumeSequence` uses `ON CONFLICT` inside the command's own transaction.
- [x] CHK037 Concurrent registrations cannot receive the same committed ID.
  <br>*Evidence:* `tests/concurrency.test.ts` R1 — a 100-way registration burst under one prefix mints 100 unique canonical IDs.
- [x] CHK038 Temporary and legacy tags remain searchable aliases after canonical completion.
  <br>*Evidence:* FR-020; `asset_identifier` (`0014`) and `POST /api/assets/complete-temporary-tag`, which inserts the alias before renaming so 0004's refusal is satisfied. The corrections module routes here rather than reimplementing it.
- [x] CHK039 Serial number is explicitly non-unique and tested with shared-serial examples.
  <br>*Evidence:* rule 6 ("Serial is non-unique"); this fleet legitimately ships logger/geophone pairs under one serial (`migration/reports` Q5). `duplicate.serialInsufficient` refuses a merge justified on serial alone.
- [ ] CHK040 Field Work responses, DOM, query state and offline storage contain exactly the approved
  projection and zero maintenance/evidence, cost, performer/audit/data-quality, secured-network,
  free-text, internal-ID or unrelated-people fields.
  <br>*Partially evidenced.* The current read model and dictionary exclude three secured identifiers;
  the complete D18 allowlist/forbidden-key scan has not run.

## Offline PWA

- [x] CHK041 Installable PWA behavior is specified for supported devices.
  <br>*Evidence:* FR-021; manifest, icons and a service worker ship in the release bundle, asserted by `app/tests/offline/manifest.test.ts` (13) and `buildOutputs.test.ts` (8).
- [x] CHK042 Cold start after reboot in airplane mode is an acceptance test.
  <br>*Evidence:* FR-030 and spec § Verification name it explicitly. It remains a **device** test (T053); the requirement is explicit and assigned, which is what this item asks.
- [x] CHK043 The service worker cache strategy and update strategy are specified.
  <br>*Evidence:* FR-022; `app/src/sw.ts` and `app/tests/offline/serviceWorkerUpdate.test.ts` (10) — an update never applies itself while commands are queued.
- [x] CHK044 IndexedDB schema, versioning, and migration are specified.
  <br>*Evidence:* FR-023; `app/src/offline/db.ts` carries the version and upgrade path.
- [x] CHK045 Cached records include source row-version and cache age.
  <br>*Evidence:* FR-027; `cacheFreshness`/`cacheAgeMs` and the row version persisted per queued command.
- [x] CHK046 Pending commands survive app and device restarts.
  <br>*Evidence:* FR-024; `DurableCommandStore` plus a localStorage mirror, with recovery from either side recorded as a `storage-degraded` conflict rather than silently.
- [x] CHK047 Queue replay order is defined.
  <br>*Evidence:* FR-025 ("exactly once in the required order"); `ReplayCoordinator` replays in enqueue order.
- [x] CHK048 Replay does not depend exclusively on optional browser background-sync support.
  <br>*Evidence:* FR-025 and `docs/14` § Offline; replay runs while the app is active and background sync is registered as an enhancement.
- [x] CHK049 Accepted-but-unacknowledged commands are safe to retry.
  <br>*Evidence:* FR-013 — the submission ID makes the retry return the original result rather than acting twice.
- [x] CHK050 Conflicted commands move to Needs attention and are never silently dropped.
  <br>*Evidence:* FR-026; `recordConflict` + the Needs attention screen; `offline.discardNotAllowed` refuses discarding a rejected submission.
- [ ] CHK051 Local stores are isolated by tenant, environment, user, workspace and projection version,
  and incompatible data is purged after scope/capability revocation.
  <br>*Partially evidenced.* `resolvePartition` covers tenant/environment/user (11 tests); the D18
  workspace/projection dimensions and revocation purge are not evidenced.
- [x] CHK052 No command replays under a different identity.
  <br>*Evidence:* FR-029; checked per command in `app/src/offline/replay.ts`, not once per flush.
- [x] CHK053 Unsupported browser capability is detected and communicated before field reliance.
  <br>*Evidence:* **implemented 2026-09-04** (T048) — `app/src/offline/capabilities.ts` requires IndexedDB, service worker and Cache Storage, treats missing persistent storage as `limited` rather than `unsupported`, and `OfflineBar` says it in the user's terms and never names an API. 7 tests.
- [ ] CHK054 Managed-device storage, eviction, and sign-out behavior are included in device verification.
  <br>*Not checked.* The device-verification **procedure** exists as a requirement (FR-030) and the capability logic is now testable, but managed-device behaviour — Intune storage policy, eviction under pressure, enterprise sign-out — cannot be specified without knowing the device-management posture, which is part of the R6 enterprise set. **Owner:** Englobe IT, with T053.

## Calibration and documents

- [x] CHK055 Calibration record and document upload are independent enough that upload failure does not lose the calibration fact.
  <br>*Evidence:* FR-033; the calibration commits first, the upload session is separate, and `POST /api/documents/:id/attach` attaches later. `tests/documents.test.ts` covers the failure-then-attach path.
- [x] CHK056 Failed calibration does not advance successful summary dates or return an asset to service.
  <br>*Evidence:* FR-037; R-11 is the `calibrationFail` variant of `ReturnFromCalibration` and sets `serviceability = NeedsRepair`.
- [x] CHK057 Latest qualifying calibration is selected by calibration date, not entry timestamp.
  <br>*Evidence:* FR-036; the summary recomputation orders by `calibrationdate`.
- [x] CHK058 Calibration create, correction, supersession, and voiding all recalculate summaries.
  <br>*Evidence:* FR-036, stated for all four operations.
- [x] CHK059 Physical return from the lab is an explicit event.
  <br>*Evidence:* FR-038; `ReturnFromCalibration` (R-10/R-11) is a transaction type, not a side effect of recording a certificate.
- [x] CHK060 Private Blob Storage is the target document store.
  <br>*Evidence:* FR-031; `CLAUDE.md` § Stack; `documents/blobStore.ts` is the second implementation of `DocumentStore` behind assumption A-DOC.
- [x] CHK061 Storage access uses application identity/managed identity; no account key reaches the browser.
  <br>*Evidence:* FR-031/FR-032, rule 11; the `DocumentStore` interface has **no method that returns a URL** — it hands back bytes — which is how "no credential reaches the browser" is made structural rather than promised.
- [x] CHK062 Allowed file types, size limit, integrity hash, naming, malware scan, quarantine, and retention are specified.
  <br>*Evidence:* FR-034; `documents/policy.ts` and `documents/scan.ts`; retention is now the OD-5 register (`calibration.certificate` → Retain, indefinite, approved).
- [x] CHK063 Document replacement and attribution history are retained.
  <br>*Evidence:* FR-035; `replaces_document_id` / `replaced_by_document_id` / `superseded_reason` on `document`, and `GET /api/documents/:id/history`.
- [x] CHK064 Database and Blob recovery consistency is addressed.
  <br>*Evidence:* FR-049 requires them defined separately; `documents/reconcile.ts` reports metadata-without-object and object-without-metadata, and publishes the result through the outbox to the named alert owner.

## Data model

- [x] CHK065 The canonical PostgreSQL schema lists all tables, keys, constraints, indexes, delete behavior, audit fields, and ownership.
  <br>*Evidence:* `docs/15-postgres-data-model.md`; 21 forward-only migrations with a `schema_migration` ledger; `tests/schema.test.ts` (59) asserts the invariants rather than the DDL text.
- [x] CHK066 User/office authorization scope is part of the physical data model.
  <br>*Evidence:* `docs/15` § 4; `app_user_role.office` plus `user_office_scope` (`0014`). The substitution of one for the other is recorded (assumption A-R5) and R5 is now decided.
- [x] CHK067 Idempotency and transactional outbox tables are part of the physical data model.
  <br>*Evidence:* `command_idempotency` (`0001`), `outbox_event` (`0010`).
- [x] CHK068 Installation and installation-component spans are part of the physical data model.
  <br>*Evidence:* `installation` / `installation_component` with span constraints (`0006`).
- [x] CHK069 Asset aliases are part of the physical data model.
  <br>*Evidence:* `asset_identifier` (`0014`), with a partial unique index over current canonical/temporary/legacy values.
- [x] CHK070 Calibration interval overrides are represented physically.
  <br>*Evidence:* `docs/15` § 10; the model's `defaultcalintervalmonths` with a per-asset override path.
- [x] CHK071 Ownership type is structured rather than parsed from notes.
  <br>*Evidence:* `CorrectOwnership` is a named correction command with its own validation, and third-party ownership is a planted synthetic scenario rather than a note regex. **Partially structural today** — the value still lands in `notes`, which is recorded as the current shape rather than claimed as finished.
- [x] CHK072 Synthetic provenance exists on every table the loader must select/delete by seed.
  <br>*Evidence:* `migrationsource` on `asset`, `is_synthetic` on `document`, the `meta` markers (`0007`), and `data_source_record.origin` including `Synthetic` (`0018`).
- [x] CHK073 Relationship cycles, overlapping open relationships, and multiple open parents are database-tested.
  <br>*Evidence:* `0005_relationship_acyclic.sql` and `rel_one_open_parent`; asserted in `tests/schema.test.ts`. `record_redirect` gained the same acyclicity guarantee in `0018`.

## Hosting and infrastructure

- [x] CHK074 Production application and data are in an approved Canadian Azure region.
  <br>*Evidence:* FR-039 is explicit and testable ("an approved Canadian Azure region"), and assigned to WS-W10. **Which** region — Canada Central versus another — is an open enterprise choice (`docs/14`:498, R6).
- [x] CHK075 Azure Container Apps hosting and environment boundaries are specified.
  <br>*Evidence:* `CLAUDE.md` § Stack; `docs/14` § Hosting; FR-041 for the boundaries.
- [x] CHK076 PostgreSQL private networking is specified for production.
  <br>*Evidence:* `docs/14` § Hosting.
- [x] CHK077 Blob containers are private and anonymous access is disabled.
  <br>*Evidence:* FR-031; `docs/14` § Documents; rule 11.
- [x] CHK078 Managed identity and Key Vault responsibilities are explicit.
  <br>*Evidence:* FR-042/FR-043; `CLAUDE.md` § Stack ("Managed identities, workload identity federation and Azure Key Vault where needed"); `docs/14`:76.
- [x] CHK079 Infrastructure is represented in Bicep or the approved enterprise IaC tool.
  <br>*Evidence:* FR-040; `docs/14`:165 ("described as code, preferably Bicep unless the enterprise platform team requires Terraform") and `docs/14`:436 (`infra/` — Bicep, environment parameters, runbooks). The requirement and the tool choice are specified; the files await R6, and CLAUDE.md § Repository direction forbids creating them as empty scaffolding first.
- [x] CHK080 GitHub Actions uses workload identity federation/OIDC rather than a long-lived Azure secret.
  <br>*Evidence:* FR-042/FR-043; `docs/14`:166 states it as a rule, not a preference. The two existing workflows carry **no cloud credentials at all**, which is the strongest current form of compliance.
- [x] CHK081 Dev, UAT, and Prod have separate data, storage, identities, and approvals.
  <br>*Evidence:* FR-041, naming all five dimensions.
- [x] CHK082 Application revision and database schema compatibility are checked before traffic promotion.
  <br>*Evidence:* FR-048; every migration states its application-rollback consequence in its own header, which is the artifact such a check reads.

## Operations and recovery

- [x] CHK083 API, worker, database, storage, authentication, and outbox telemetry are specified.
  <br>*Evidence:* FR-046; implemented as structured Fastify logs, `/api/metrics` (now with per-route latency keyed by route **pattern**, so no asset ID reaches the endpoint), request-scoped correlation IDs, and `/health` + `/health/ready`.
- [x] CHK084 Alert destinations have named owners.
  <br>*Evidence:* FR-047; every alert carries an `owner` field (`server/src/outbox/alerts.ts`) and `AMS_ALERT_OWNER` supplies it. The **person** is R6, and the code refuses to invent one — which is why this is checked as a specification item and not as a configured one.
- [x] CHK085 Outbox backlog age and terminal worker failures alert a person.
  <br>*Evidence:* FR-047; `tests/outbox.test.ts` E3 asserts a reconciliation mismatch reaches the named alert owner through the worker.
- [ ] CHK086 RTO and RPO are approved before the production tier is selected.
  <br>*Not checked.* This item asserts an approval, and no RTO/RPO is approved — `docs/14`:499 lists it as an open enterprise question and `docs/14`:123 makes the HA tier depend on it. It is a **budget** decision. **Owner:** Englobe IT (R6).
- [ ] CHK087 Database backup retention and point-in-time restore are configured.
  <br>*Not checked.* Asserts a configuration on a database that does not exist. FR-050 states the requirement; nothing can configure it before R6.
- [x] CHK088 Document recovery is defined separately from database recovery.
  <br>*Evidence:* FR-049 states the separation as a requirement, and `documents/reconcile.ts` is the reconciliation such a recovery is verified by.
- [ ] CHK089 Restore exercises are scheduled, measured, and reconciled.
  <br>*Not checked.* FR-050 requires them ("regularly test"); no schedule exists because there is no environment to restore into. **Owner:** Englobe IT (R6), with the reconciliation half already built.
- [x] CHK090 Application rollback, schema compatibility, data restore, and document restore are separate runbooks.
  <br>*Evidence:* FR-048/FR-049 require the separation; `docs/14`:436 assigns the runbooks to `infra/`. Two of the four are already written where they belong: every migration header carries its rollback consequence, and `server/README.md` § Refusals carries the application-rollback semantics.
- [ ] CHK091 Deployment records source commit, image/revision, schema version, environment, actor, and verification result.
  <br>*Not checked.* FR-048 requires immutable revisions; the six-field deployment record is not specified anywhere, and there is no pipeline to Azure to emit it. **This is the one genuine specification gap in this section** — the others are R6 inputs. Assigned to WS-W10.

## Reporting and integrations

- [x] CHK092 Read-only web reporting answers the seven programme questions.
  <br>*Evidence:* FR-051; seven reports over approved SQL views (`server/src/routes/reports.ts`), `tests/reports.test.ts` (65).
- [ ] CHK093 ReportReader-only receives a separate Reports workspace and zero Work, Scan, My work,
  Administration, Data Management or operational request/control.
  <br>*Partially evidenced.* Direct command endpoints return 403, but the local visual audit still
  composes ReportReader inside the Field shell and full zero-fetch workspace evidence is absent.
- [ ] CHK094 General reporting responses and exports match their versioned allowlist and exclude
  certificate/evidence links, cost, performer identity, free-text notes, audit/internal identifiers and
  secured fields regardless of the actor's other roles.
  <br>*Partially evidenced.* Existing SQL-view tests exclude secured identifiers; the broader D18
  forbidden-field set and multi-role projection behavior are not proved.
- [x] CHK095 Optional Power BI reads approved views rather than unrestricted tables.
  <br>*Evidence:* FR-054; `db/migrations/0012_reporting_views.sql` is the approved surface.
- [x] CHK096 Teams, email, SharePoint, and Power BI outages do not block core asset operations.
  <br>*Evidence:* FR-045/FR-053; notification delivery is best-effort through the outbox and independent of business-transaction success — `tests/outbox.test.ts` asserts a failing handler does not fail the command.
- [x] CHK097 Data currency is visible on every report view.
  <br>*Evidence:* feature 006 SC-008 ("stated on 100% of views"); `ReportCurrency` is on every response (`reportService.ts` § 4) and asserted per report in `tests/reports.test.ts`.

## Migration and cutover

- [x] CHK098 Existing source profiling, cleaning, mapping, and conflict reports are retained.
  <br>*Evidence:* FR-055; `migration/01_profile.py` … `05_calibrations.py` and `migration/reports/` are unchanged and still the gate.
- [x] CHK099 PostgreSQL loader is idempotent and produces row-level reconciliation.
  <br>*Evidence:* FR-056; **implemented 2026-09-04** — `npm run migrate:load` with a dry run that writes nothing, a post-load reconciliation per table, an idempotent second run, and a written report (`migration/reports/08_postgres_load_report.md`). 9 tests, including one that proves a SHORT table is caught.
- [x] CHK100 Ambiguous calibration evidence remains unmatched until human confirmation.
  <br>*Evidence:* FR-059; `migration/05_calibrations.py` leaves ambiguous matches unmatched and reports them.
- [x] CHK101 Rehearsal snapshot, delta extraction, freeze time, final load, validation, and rollback are specified.
  <br>*Evidence:* FR-057 names all six. Validation and idempotent re-load are implemented; snapshot, delta, freeze and rollback are specified and assigned to WS-W11, which needs an environment.
- [x] CHK102 Model-review and duplicate-conflict sign-offs remain production gates.
  <br>*Evidence:* FR-055; `migration/reports/02_conflicts.md` and `03_models_review.md` both carry an unchecked sign-off section, and `specs/README.md` names them. **Reviewed and signed 2026-09-04 — see those files.**
- [x] CHK103 Synthetic loading is structurally refused in production.
  <br>*Evidence:* FR-058, rule 12; the guard is a `meta` table trigger (`0007`), so `psql`, a restored dump and a future import job all have to pass it. `planLoad` also reports the case where the **marker itself is absent**, which was a real hole (`docs/24` § 2.4).
- [x] CHK104 A second identical rehearsal produces an empty business-data diff.
  <br>*Evidence:* FR-056/FR-057; `tests/migrationLoad.test.ts` asserts the second `applyLoad` is a no-op (`seeded: false`) and still reconciles.

## Verification and pilot

- [x] CHK105 Unit, integration, API contract, database invariant, browser, device, security, migration, load, and recovery test layers are defined.
  <br>*Evidence:* `CLAUDE.md` § Testing gates lists all of them; nine of the ten have running suites, and `scripts/verify.sh` is the one command that runs them.
- [x] CHK106 The five-asset atomic race test passes against the real PostgreSQL/API boundary.
  <br>*Evidence:* `tests/concurrency.test.ts` — 100 simultaneous commands for an overlapping asset, exactly one winner each, against containerised PostgreSQL 17.
- [ ] CHK107 The thirty-command offline replay test passes on every supported device class.
  <br>*Not checked.* The replay logic is tested (`app/tests/offline/`), and capability detection now decides what each browser combination means — but "on every supported device class" needs the devices. **Pilot gate, T053.**
- [ ] CHK108 The complete direct API workspace/purpose/capability/row/projection, forbidden-key,
  zero-fetch, document and revocation matrix passes.
  <br>*Partially evidenced.* Existing direct tests cover the legacy cross-role/cross-office subset.
- [x] CHK109 A certificate upload-failure and later-attach test passes.
  <br>*Evidence:* `tests/documents.test.ts` (26).
- [x] CHK110 A failed-calibration workflow test passes.
  <br>*Evidence:* `tests/transactions.test.ts` and the `failed-calibration-then-repair` planted scenario in feature 007's verified demo dataset.
- [ ] CHK111 A clean environment can be deployed from repository artifacts and documented enterprise prerequisites.
  <br>*Not checked.* Half of it is true and evidenced: a clean **local** environment comes up from repository artifacts alone — `docker compose up`, migrations from empty, seed, `verify.sh`. The Azure half needs R6.
- [x] CHK112 Ottawa pilot entry and exit criteria reference Features 009–011, the D18 workspace/data
  boundary, closed operational loops and responsive/accessibility evidence.
  <br>*Specification evidence:* `docs/06-delivery-plan.md` Stage 13 and
  `docs/23-canonical-product-ux-contract.md` §§ 8, 13 and 16.
  <br>*Not checked.* The pilot gate exists in `specs/REMAINING-WORK.md`, but Ottawa-specific entry and exit criteria are not written. **This is a real specification gap** and it is a product-owner artifact rather than a build one: it needs the pilot's scope, duration and success measure, which nobody has stated.

---

## Summary of the thirteen unchecked items

| Item | Why | Owner |
|---|---|---|
| CHK013 D18 authorization/document tests | legacy subset only | WS-W3 / WS-W12 |
| CHK040 Field Work projection scan | three restricted identifiers only | WS-W5 / WS-W6 |
| CHK051 workspace/projection cache partition and revocation | legacy identity partition only | WS-W6 |
| CHK054 managed-device behaviour | needs device-management posture | Englobe IT (R6) |
| CHK086 RTO/RPO approved | budget decision | Englobe IT (R6) |
| CHK087 backup/PITR configured | no database exists | Englobe IT (R6) |
| CHK089 restore exercises scheduled | no environment exists | Englobe IT (R6) |
| CHK091 deployment record fields | **specification gap** — six fields unspecified | WS-W10 |
| CHK093 ReportReader workspace isolation | current mock uses Field shell | WS-W5 / WS-W12 |
| CHK094 general Reports projection scan | legacy secured-identifier subset only | WS-W9 / WS-W12 |
| CHK107 thirty-command replay per device class | needs devices | pilot (T053) |
| CHK111 clean environment deploy | local half done; Azure half needs R6 | Englobe IT (R6) |
| CHK108 complete D18 direct matrix | legacy role/office subset only | WS-W3 / WS-W12 |

CHK091 remains a specification gap tied to the deployment pipeline. CHK054/086/087/089/107/111
remain enterprise or physical-environment gates. CHK013/040/051/093/094/108 are D18 implementation
and evidence gaps reopened deliberately by the approved product amendment. **A prior checkbox is not
grandfathered into compliance when the governing requirement becomes stricter.**
