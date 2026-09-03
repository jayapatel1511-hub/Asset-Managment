# Englobe AMS — Specification Index

Spec-driven development structure following `github/spec-kit`.

The governing document is [`.specify/memory/constitution.md`](../.specify/memory/constitution.md), version 2.0.0. The production platform is defined by:

- [`docs/14-webapp-architecture.md`](../docs/14-webapp-architecture.md)
- [`docs/15-postgres-data-model.md`](../docs/15-postgres-data-model.md)
- [feature 009 — Production Readiness](009-production-readiness/spec.md)
- [feature 010 — Web Application Platform](010-web-application-platform/spec.md)

> **Writing code here?** Read [`CLAUDE.md`](../CLAUDE.md), then this index, then [`REMAINING-WORK.md`](REMAINING-WORK.md), then the owning feature spec. Do not use older Power Apps/Dataverse instructions as the active implementation route.

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
| `docs/14-webapp-architecture.md` | Active Azure web architecture |
| `docs/15-postgres-data-model.md` | Proposed canonical physical schema |
| `docs/00-*` through `docs/13-*` | Business context, legacy design, evidence, decisions and production review |
| `docs/08-decisions.md` | Approved decisions and recorded deviations |
| `docs/09-build-report.md` | Evidence from the local/mock implementation |

Where an approved feature spec and an older narrative document disagree, the approved feature spec and constitution win. Built code does not silently become the source of truth; useful deviations are recorded and the governing requirement is updated.

The older Dataverse, Power Apps, Power Automate, SharePoint-as-primary-document-store and Power Platform licensing sections are historical references after the 2026-09-03 pivot.

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

The existing test suite and browser walkthroughs prove Mock Implemented behavior. They do not prove PostgreSQL atomicity, Entra authorization, office-scope enforcement, private document access, PWA cold start, Azure recovery or production migration.

---

## Features

| # | Feature | Delivers | Current status |
|---|---|---|---|
| [001](001-asset-registry/spec.md) | **Asset Registry** | Searchable catalogue, stable identity, unlimited admin-managed offices, reference data, registration, retirement and scan-to-open | **Mock Implemented.** Production identity changes to canonical Asset ID + aliases; registration and sequence allocation move to the server. Q6, Q10 and model sign-off remain. |
| [002](002-inventory-migration/spec.md) | **Inventory Migration** | Clean, deduplicated, traceable migration of the legacy inventory and calibration history | **Mock Implemented.** 1,026 staged assets and reports exist. PostgreSQL loader, Entra user resolution, delta/cutover, target reconciliation and production sign-offs remain. |
| [003](003-asset-transactions/spec.md) | **Asset Transactions** | Checkout, return, transfer, immutable history, derived state, conflict refusal and offline queue | **Mock Implemented.** Production writes must move to feature 010’s atomic TypeScript/PostgreSQL command. Q8, Q9, inactive-project behavior and Q18 remain. |
| [004](004-calibration-management/spec.md) | **Calibration Management** | Due lists, evidence records, lab movement and reminders | **Mock Implemented.** Private Blob documents, failed-result rules, recalculation, physical receipt, outbox reminders and Q18 remain. |
| [005](005-deployment-and-kits/spec.md) | **Deployment & Kits** | Deployment, recovery, site history, configuration changes and dated station composition | **Mock Implemented.** Installation tables are now part of the proposed PostgreSQL model; atomic API application and offline device proof remain. |
| [006](006-fleet-reporting/spec.md) | **Fleet Reporting** | Seven acceptance questions, calibration compliance, timeline and utilisation | **Mock Implemented.** Production target is read-only web reporting over approved PostgreSQL views. Power BI is optional. |
| [007](007-synthetic-data/spec.md) | **Synthetic Fleet History** | Fictional 20-year history, five-year operational detail, answer key, planted scenarios and scale profiles | **In progress.** Adapt output to PostgreSQL/API contracts. Q14–Q16 and Q18 remain relevant. Production loading stays structurally refused. |
| [008](008-release-and-operations/spec.md) | **Release & Operations** | Safe build, publish, verify, rollback, promotion and monitoring | **Partially Mock Implemented.** Bundle data guard exists. Azure container delivery, migrations, observability, restore and runbooks move under feature 010. |
| [009](009-production-readiness/spec.md) | **Production Readiness** | Atomic authority, safe identity allocation, state correctness, security, device proof, cutover and recovery | **Spec Draft.** Still applies. Dataverse-specific recommended implementation is superseded by the TypeScript/PostgreSQL architecture. [Checklist](009-production-readiness/checklists/requirements.md). |
| [010](010-web-application-platform/spec.md) | **Web Application Platform** | Entra-authenticated PWA, TypeScript API, PostgreSQL, private documents, offline queue, Azure operations and reporting | **Spec Draft.** This is the active platform feature and the implementation route for feature 009. [Checklist](010-web-application-platform/checklists/requirements.md). |

Detailed production findings remain in [`docs/13-production-readiness-review.md`](../docs/13-production-readiness-review.md). The active platform decision is in [`docs/14-webapp-architecture.md`](../docs/14-webapp-architecture.md). The execution order is in [`docs/06-delivery-plan.md`](../docs/06-delivery-plan.md).

---

## The seven programme acceptance questions

1. What do we own?
2. Where is asset X right now?
3. Who has asset X?
4. What is available at office Y?
5. What needs calibration in the next N days?
6. What is assigned to project Z?
7. Where was asset X on date D, and what was attached to it?

| Question | Functional source | Web-platform production proof |
|---|---|---|
| 1, 2, 3, 4 | 001 display + 003 event state + 006 reporting | 010 read API, role/office security and PostgreSQL reconciliation |
| 5 | 004 calibration + 006 reporting | 010 calibration rules, private documents, due view and recovery |
| 6 | 001 project filter + 003 assignment + 006 reporting | 010 atomic validation and read-only reporting |
| 7 | 003 immutable history + 005 dated composition + 006 timeline | 010 atomic event commit, relationship/installation spans and historical views |

Mock walkthroughs demonstrate the user journeys. Production Accepted requires answering all seven from production PostgreSQL data after Security Verified, Device Verified and Migration Rehearsed gates pass.

---

## Data-quality finding — 2026-09-02

The originally committed `data/source/calibration_history_2026-09-02.csv` is defective: its unlabelled serial column was omitted, and calibration/next-due dates were under-exported.

Use `data/source/calibration_history_2026-09-02.corrected.csv`: 253 serials, 253 model names, 213 calibration dates, 253 next-due dates and a `source_row` traceability field.

The registry export was checked separately and is faithful, with credential columns absent.

Ambiguous calibration evidence remains unmatched until a person confirms its target. The PostgreSQL migration must not attach an uncertain compliance record merely to reduce the unmatched count.

---

## Product clarifications and sign-offs

Resolved: Q1, Q2, Q3, Q5, Q7 and Q13. Q4 is completed data work awaiting review.

Still requiring confirmation or decision:

| Item | Effect in the web architecture |
|---|---|
| Q6 server/configuration treatment | Asset catalogue and migration |
| Q8 expected return | Checkout command and reminders |
| Q9 backdating | `recorded_at`, `effective_at`, ordering and correction rules |
| Q10 project master | Project API and synchronization |
| Q11 report audience | `ReportReader` scope and optional Power BI |
| Q12 French timing | Phase scope; strings already externalized |
| Q14 synthetic Dev load/removal | Synthetic Azure environment policy |
| Q15 fictional identity domain | Entra/notification collision risk |
| Q16 synthetic modem extension | Synthetic component pattern |
| Q17 Code App entitlement | No longer a core architecture blocker; retained as historical licensing research |
| Q18 permanent-component calibration | Transaction, relationship and calibration behavior |
| inactive-project rule | Server command validation |
| reminder cadence | Outbox notification state |
| site-coordinate capture | PWA device workflow |
| global vs office-scoped administrator | API authorization and `user_office_scope` |
| permanent home-office transfer | `RehomeAsset` event and reporting |
| failed calibration and physical receipt | Calibration summary and lab movement |
| RTO/RPO/HA | PostgreSQL and document recovery tier |
| internet vs private access | Azure networking and field usability |
| supported mobile browsers | PWA pilot scope |

Two sign-offs remain hard gates before production migration:

- `migration/reports/03_models_review.md`
- `migration/reports/02_conflicts.md`

---

## Platform dependency chain

```text
Constitution 2.0.0
        ↓
010 Web Application Platform spec
        ↓
015 PostgreSQL data model approval
        ↓
Identity + read API
        ↓
Atomic transaction/idempotency proof
        ↓
Business workflow HTTP migration
        ↓
PWA offline + private documents + workers
        ↓
Azure infrastructure + reporting
        ↓
Migration rehearsal + security/device/recovery proof
        ↓
Ottawa pilot
```

The five-asset checkout race test is the first production implementation proof. Do not prioritize extra screens before it passes.

---

## Working the Spec Kit flow

Select the active platform feature:

```bash
export SPECIFY_FEATURE=010-web-application-platform
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

For feature 010, planning begins with the API command contract, PostgreSQL constraints, Entra session boundary, IndexedDB model and Azure environment design. Implementation begins with identity/read health and the atomic five-asset checkout proof.
