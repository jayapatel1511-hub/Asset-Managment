# Englobe AMS — Specification Index

Spec-driven development structure following `github/spec-kit`.

The governing document is [`.specify/memory/constitution.md`](../.specify/memory/constitution.md), version 2.1.0. The production platform and cross-cutting capabilities are defined by:

- [`docs/14-webapp-architecture.md`](../docs/14-webapp-architecture.md)
- [`docs/15-postgres-data-model.md`](../docs/15-postgres-data-model.md)
- [`docs/16-data-management.md`](../docs/16-data-management.md)
- [`docs/23-canonical-product-ux-contract.md`](../docs/23-canonical-product-ux-contract.md)
- [`docs/25-need-to-know-access-ux.md`](../docs/25-need-to-know-access-ux.md)
- [feature 009 — Production Readiness](009-production-readiness/spec.md)
- [feature 010 — Web Application Platform](010-web-application-platform/spec.md)
- [feature 011 — Data Management & Stewardship](011-data-management/spec.md)

> **Writing code here?** Read [`CLAUDE.md`](../CLAUDE.md), then this index, then [`REMAINING-WORK.md`](REMAINING-WORK.md), then the owning feature spec.
>
> **Two tracks are parked (2026-09-03) and neither is an implementation route:** the Power Platform
> (Power Apps Code App, Dataverse, Power Automate — parked, files kept and banner-marked
> `LEGACY-POWER-PLATFORM`) and Zite (`zite/`, `specs/ZITE-BUILD-PROMPT.md` — parked; it has no
> transaction, so constitution Principle VIII / `CLAUDE.md` rule 2 is unsatisfiable on it). The
> Azure web application is the only live track.

---

## Source hierarchy

| Source | Role |
|---|---|
| `IM30 - Asset Managment via M365.docx` | Original objective, requested fields and operating principles |
| `Asset AMS - SharePoint.xlsx` | Authoritative legacy evidence: 1,053 asset rows, calibration history, ID conventions and form drafts |
| `.specify/memory/constitution.md` | Non-negotiable product and engineering principles |
| `specs/001-*` through `specs/008-*` | Business feature requirements |
| `specs/009-production-readiness/` | Cross-cutting integrity, security, device, cutover and recovery proof |
| `specs/010-web-application-platform/` | Web/API/PostgreSQL/PWA/document/operations platform requirements |
| `specs/011-data-management/` | Stewardship, reference/master data, corrections, bulk jobs, quality, duplicates, lineage, exports and retention |
| `docs/14-webapp-architecture.md` | Active Azure web architecture |
| `docs/15-postgres-data-model.md` | Proposed core physical schema |
| `docs/16-data-management.md` | Data-management operating model and proposed schema additions |
| `docs/23-canonical-product-ux-contract.md` | Canonical product purpose, personas, Field/Desk/Console allocation, route/offline matrix and UX acceptance gates. D6 approves that product direction; OT-01–OT-09 remain proposed until owner sign-off/owning-contract amendment, and the document is not implementation evidence |
| `docs/25-need-to-know-access-ux.md` | D18 Work/Reports/Administration separation, exact Field/desktop navigation, purpose-sized server projections, and calibration/inspection disclosure. Documentation authority, not implementation/security evidence |
| `docs/00-*` through `docs/13-*` | Business context, legacy design, evidence, decisions and production review |
| `docs/08-decisions.md` | Approved decisions and recorded deviations |
| `docs/09-build-report.md` | Evidence from the local/mock implementation |

Where an approved feature spec and an older narrative document disagree, the approved feature spec and constitution win. Built code does not silently become the source of truth; useful deviations are recorded and the governing requirement is updated.

The older Dataverse, Power Apps, Power Automate, SharePoint-as-primary-document-store and Power Platform licensing sections are **parked**, not merely historical: as of 2026-09-03 the Dataverse adapter is no longer imported by `app/src/api/index.ts`, the `@microsoft/power-apps` packages are removed from `app/package.json`, and `docs/01`, `02`, `03`, `05`, `10` and `solution/` carry `LEGACY-POWER-PLATFORM` banners. They remain worth reading for the business rules and logical model they carry.

---

## Maturity vocabulary

Do not use **Built** by itself.

1. **Spec Draft**
2. **Spec Approved**
3. **Mock Implemented**
4. **API Implemented**
5. **Azure Integrated**
6. **Security Verified**
7. **Device Verified**
8. **Migration Rehearsed**
9. **Pilot Accepted**
10. **Production Accepted**

The existing test suite and browser walkthroughs prove Mock Implemented behavior. They do not prove PostgreSQL atomicity, Entra authorization, office-scope enforcement, private document access, PWA cold start, governed data jobs, Azure recovery or production migration.

---

## Features

| # | Feature | Delivers | Current status |
|---|---|---|---|
| [001](001-asset-registry/spec.md) | **Asset Registry** | Searchable catalogue, stable identity, unlimited admin-managed offices, reference data, registration, retirement and scan-to-open | **Mock Implemented.** Production identity changes to canonical Asset ID + aliases; registration and sequence allocation move to the server. Q6, Q10 and model sign-off remain. |
| [002](002-inventory-migration/spec.md) | **Inventory Migration** | Clean, deduplicated, traceable migration of the legacy inventory and calibration history | **Mock Implemented.** 1,026 staged assets and reports exist. PostgreSQL loader, Entra user resolution, delta/cutover, target reconciliation and production sign-offs remain. |
| [003](003-asset-transactions/spec.md) | **Asset Transactions** | Checkout, return, transfer, immutable history, derived state, conflict refusal and offline queue | **Mock Implemented.** Production writes must move to feature 010’s atomic TypeScript/PostgreSQL command. Q8/Q9 are decided (optional editable/clearable +14-day expected return; admin-only 30-day backdating with same-asset conflict refusal), but owning text still needs reconciliation. Inactive-project behavior, Q18, and D6 OT gates remain. |
| [004](004-calibration-management/spec.md) | **Calibration Management** | Due lists, evidence records, lab movement and reminders | **Mock Implemented.** D18 narrows Work to recorded-blocker/next-action summaries and gates history/evidence separately. Private documents, readiness policy, failed-result rules, recalculation, physical receipt, outbox reminders and Q18 remain. |
| [005](005-deployment-and-kits/spec.md) | **Deployment & Kits** | Deployment, recovery, site history, configuration changes and dated station composition | **Mock Implemented.** Installation tables are part of the proposed PostgreSQL model; atomic API application and offline device proof remain. |
| [006](006-fleet-reporting/spec.md) | **Fleet Reporting** | Seven acceptance questions, calibration compliance, timeline and utilisation | **Mock Implemented.** Production target is the separate Desk Reports workspace over approved projections. D18 separates general reports from governed evidence; Power BI is optional. |
| [007](007-synthetic-data/spec.md) | **Synthetic Fleet History** | Fictional 20-year history, five-year operational detail, answer key, planted scenarios and scale profiles | **Mock Implemented** (synthetic-generator evidence dated 2026-09-02, WS-G). Three profiles were source-verified at 1,459 / 371 / 6,626 assets and byte-identical regeneration; US5 remains blocked on Q14. Remaining: adapt output to PostgreSQL/API contracts. Q15, Q16 and Q18 remain relevant. Production loading stays structurally refused. |
| [008](008-release-and-operations/spec.md) | **Release & Operations** | Safe build, publish, verify, rollback, promotion and monitoring | **Mock Implemented (partial: US1).** WS-H/T012/T016 source evidence dated 2026-09-03 (`f6a090f`) covers the release guard, bundle scan, mode-conditional `publicDir`, `build:release`, and removal of MOCK-ONLY stand-ins from that bundle. FR-001's guard requires `VITE_AMS_BACKEND=http`, not `dataverse`. Azure integration, migrations, observability, restore, runbooks, and broader feature acceptance remain unverified. |
| [009](009-production-readiness/spec.md) | **Production Readiness** | Atomic authority, safe identity allocation, state correctness, security, device proof, cutover and recovery | **Spec Draft.** Evidence gate (not a delivery platform). [plan](009-production-readiness/plan.md), [tasks](009-production-readiness/tasks.md) (T001–T055), [contracts/](009-production-readiness/contracts/) (race, registration, security matrix, device, cutover, recovery). Consumes 010 command shapes. [Checklist](009-production-readiness/checklists/requirements.md). |
| [010](010-web-application-platform/spec.md) | **Web Application Platform** | Entra-authenticated PWA, TypeScript API, PostgreSQL, private documents, offline queue, Azure operations and reporting | **Spec Draft.** Active production platform. [plan](010-web-application-platform/plan.md), [tasks](010-web-application-platform/tasks.md), [research](010-web-application-platform/research.md), [data-model](010-web-application-platform/data-model.md), [contracts/](010-web-application-platform/contracts/). R1 and R5 are decided; R2/R3 are frozen only for the first-proof subset; R4/Q8/Q9 are decided. D18 projection/readiness/evidence gates, full table/command review, and affected D6 OT gates remain. [Checklist](010-web-application-platform/checklists/requirements.md). |
| [011](011-data-management/spec.md) | **Data Management & Stewardship** | Governed reference/master data, controlled corrections, import/bulk jobs, quality issues, duplicate resolution, lineage, exports, external reconciliation, retention and legal hold | **Spec Draft.** [plan](011-data-management/plan.md), [tasks](011-data-management/tasks.md) (T001–T090), [research](011-data-management/research.md), [data-model](011-data-management/data-model.md), [contracts/](011-data-management/contracts/). Administration/Data-governance only under D18; read-only dictionary/quality first; writes blocked on 010 W3/W4. OD-2–OD-9/OD-11 are decided; named owners, external obligations, final capability mapping, and acceptance evidence remain. [Checklist](011-data-management/checklists/requirements.md): unreviewed. |

Detailed production findings remain in [`docs/13-production-readiness-review.md`](../docs/13-production-readiness-review.md). The active platform decision is in [`docs/14-webapp-architecture.md`](../docs/14-webapp-architecture.md). The data-management model is in [`docs/16-data-management.md`](../docs/16-data-management.md). The execution order is in [`docs/06-delivery-plan.md`](../docs/06-delivery-plan.md).

---

## The seven programme acceptance questions

1. What do we own?
2. Where is asset X right now?
3. Who has asset X?
4. What is available at office Y?
5. What needs calibration in the next N days?
6. What is assigned to project Z?
7. Where was asset X on date D, and what was attached to it?

| Question | Functional source | Web-platform production proof | Data-management support |
|---|---|---|---|
| 1, 2, 3, 4 | 001 display + 003 event state + 006 reporting | 010 purpose-sized read APIs, D18 workspace/capability/projection security and PostgreSQL reconciliation | 011 reference stewardship, completeness rules, corrections and duplicate resolution |
| 5 | 004 calibration + 006 reporting | 010 calibration rules, private documents, due view and recovery | 011 calibration/document quality rules, lineage and controlled evidence correction |
| 6 | 001 project filter + 003 assignment + 006 reporting | 010 atomic validation and read-only reporting | 011 project authority, synchronization and reconciliation |
| 7 | 003 immutable history + 005 dated composition + 006 timeline | 010 atomic event commit, relationship/installation spans and historical views | 011 no-history-rewrite merge/correction rules, lineage and quality verification |

Mock walkthroughs demonstrate the user journeys. Production Accepted requires answering all seven from production data after Security Verified, Device Verified, Migration Rehearsed and Data Management pilot gates pass.

---

## Data management finding — 2026-09-03

The repository already contained reference data, migration controls, auditing, backups, retention fragments and data-quality findings. It did not have one complete feature assigning ownership and providing controlled post-go-live management.

Feature 011 now explicitly covers:

- Data Owner and Data Steward responsibilities;
- a Data Management Centre;
- versioned field dictionary and data classification;
- reference/master-data maintenance;
- controlled static corrections without direct state/history edits;
- dry-run import and bulk update;
- data-quality rules and owned issue workflow;
- human-reviewed duplicate resolution and permanent redirects;
- authoritative-source synchronization/reconciliation;
- lineage and “Why does the system say this?” explanations;
- approved, redacted, private, expiring exports;
- retention register, legal holds and controlled purge;
- job-level idempotency, progress, audit and recovery.

The proposed physical additions are described in `docs/16-data-management.md` and must be integrated into the canonical schema before migrations are finalized.

---

## Data-quality finding — 2026-09-02

The originally committed `data/source/calibration_history_2026-09-02.csv` is defective: its unlabelled serial column was omitted, and calibration/next-due dates were under-exported.

Use `data/source/calibration_history_2026-09-02.corrected.csv`: 253 serials, 253 model names, 213 calibration dates, 253 next-due dates and a `source_row` traceability field.

The registry export was checked separately and is faithful, with credential columns absent.

Ambiguous calibration evidence remains unmatched until a person confirms its target. The production migration must not attach an uncertain compliance record merely to reduce the unmatched count.

---

## Product clarifications and sign-offs

Resolved: Q1, Q2, Q3, Q5, Q7, Q8, Q9 and Q13. Q4 is completed data work awaiting review.

Still requiring confirmation or decision:

| Item | Effect in the web/data-management architecture |
|---|---|
| Q6 server/configuration treatment | Asset catalogue and migration |
| Q10 project master | Project authority, API and reconciliation |
| Q11 report audience | `ReportReader` scope, exports and optional Power BI |
| Q12 French timing | Phase scope; strings already externalized |
| Q14 synthetic Dev load/removal | Synthetic environment and job policy |
| Q15 fictional identity domain | Identity/notification collision risk |
| Q16 synthetic modem extension | Synthetic component pattern |
| Q17 Code App entitlement | **Closed by the Power Platform parking.** No longer any kind of blocker; retained as licensing research only |
| Q18 permanent-component calibration | Transaction, relationship, calibration and quality behavior |
| inactive-project rule | Server validation and source reconciliation |
| reminder cadence | Outbox notification state |
| site-coordinate capture | PWA device workflow and quality rule |
| global vs office-scoped administrator | **Decided R5:** OfficeAdmin assigned-office scoped; SystemOwner global only where exact capability permits |
| Data Steward role | **Decided OD-2:** capability bundle within OfficeAdmin/SystemOwner scope; not a fifth application role |
| data owners/stewards | Accountability and issue routing |
| approval thresholds | **Decided OD-3:** field/risk-specific controls for corrections, bulk apply, merge, purge, and governed exports |
| corporate classification taxonomy | **Decided OD-4:** Internal / Confidential / Restricted, narrowed by D18 purpose/capability/projection |
| permanent home-office transfer | `RehomeAsset` event and reporting |
| failed calibration and physical receipt | Calibration summary and lab movement |
| retention periods and legal hold | **Decided OD-5/OD-6 defaults;** external legal obligations may supersede them |
| project/source authority | External reconciliation contract |
| RTO/RPO/HA | Database and document recovery tier (**R6**) |
| internet vs private access | Azure networking and field usability |
| supported mobile browsers | PWA pilot scope |

Two sign-offs remain hard gates before production migration:

- `migration/reports/03_models_review.md`
- `migration/reports/02_conflicts.md`

---

## Platform dependency chain

```text
Constitution 2.1.0
        ↓
010 Web Application Platform spec
        ↓
015 core PostgreSQL model + 016 data-management additions
        ↓
Identity + read API
        ↓
Atomic transaction/idempotency proof
        ↓
011 read-only quality/dictionary foundation
        ↓
Business workflow HTTP migration
        ↓
011 corrections, imports, duplicates, exports and reconciliation
        ↓
PWA offline + private documents + workers
        ↓
011 retention/legal hold + Azure infrastructure + reporting
        ↓
Migration rehearsal + security/device/recovery/data-management proof
        ↓
Ottawa pilot
```

The five-asset checkout race test remains the first production implementation proof. The read-only data dictionary and quality-rule foundation can be designed in parallel once the canonical schema is stable; high-impact write jobs wait for atomic command, authorization and audit infrastructure.

---

## Working the Spec Kit flow

Select the relevant feature:

```bash
export SPECIFY_FEATURE=010-web-application-platform
# or
export SPECIFY_FEATURE=011-data-management
```

Then follow:

```text
/speckit.constitution   → .specify/memory/constitution.md
/speckit.specify        → specs/###-*/spec.md
/speckit.clarify        → resolve blocking product questions
/speckit.plan           → plan.md + research.md + data-model.md + contracts/
/speckit.tasks          → tasks.md grouped by independently testable story
/speckit.checklist      → checklists/*.md
/speckit.analyze        → cross-artifact consistency review
/speckit.implement      → execute approved tasks
```

Feature 011 planning begins with ownership/roles, the field dictionary, job and issue contracts, correction/merge authority, export rules, retention policy inputs and physical schema additions. It must not create a generic database-editor endpoint.
