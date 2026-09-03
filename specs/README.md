# Englobe AMS — Specification Index

Spec-driven development structure following `github/spec-kit`.

The governing document is [`.specify/memory/constitution.md`](../.specify/memory/constitution.md).
Every plan is gated against it. The production path is additionally gated by
[`docs/13-production-readiness-review.md`](../docs/13-production-readiness-review.md) and
[feature 009](009-production-readiness/spec.md).

> **Writing code here?** Read [`AGENT-BRIEF.md`](AGENT-BRIEF.md), then
> [`REMAINING-WORK.md`](REMAINING-WORK.md), then feature 009 before touching the real backend,
> schema, security, flows or hosted release.

## Source hierarchy

| Source | Role |
|---|---|
| `IM30 - Asset Managment via M365.docx` | Original objective, fields and design principles |
| `Asset AMS - SharePoint.xlsx` | Authoritative legacy evidence: 1,053 asset rows, calibration history, ID conventions and form drafts |
| `.specify/memory/constitution.md` | Non-negotiable product and engineering principles |
| `specs/001-*` through `specs/009-*` | Executable user stories, requirements and measurable outcomes |
| `docs/00-brief.md` through `docs/13-production-readiness-review.md` | Narrative reference, design detail, integration, decisions, evidence and production gates |
| `docs/08-decisions.md` | Approved decisions and recorded deviations |
| `docs/09-build-report.md` | Evidence from the local/mock implementation |

Where an approved feature spec and an older narrative document disagree, the approved feature spec
wins and the discrepancy is recorded in `docs/08-decisions.md`. Built code does not silently become the
source of truth; a useful implementation deviation must first be recorded and the governing spec
updated.

## Maturity vocabulary

Do not use **Built** by itself. Use:

1. **Spec Draft**
2. **Spec Approved**
3. **Mock Implemented**
4. **Tenant Implemented**
5. **Security Verified**
6. **Device Verified**
7. **Pilot Accepted**
8. **Production Accepted**

The existing test suite and browser walkthroughs prove Mock Implemented behavior. They do not, on their
own, prove tenant atomicity, direct-API authorization, report security, hosted scanning, offline cold
start or recovery.

## Features

| # | Feature | Delivers | Current status |
|---|---|---|---|
| [001](001-asset-registry/spec.md) | **Asset Registry** | Searchable catalogue, stable identity, N admin-managed offices, reference data, registration, retirement and scan-to-open | **Mock Implemented.** Camera integration, real identity, canonical temporary-tag handling and server-side ID allocation remain tenant/009 work. Q6 and Q10 remain open; model review awaits sign-off. |
| [002](002-inventory-migration/spec.md) | **Inventory Migration** | Clean, deduplicated, traceable migration of the legacy inventory and calibration history | **Mock Implemented.** 1,026 assets staged with idempotent reports. Real directory resolution, Dataverse load, final delta/cutover and two production sign-offs remain. |
| [003](003-asset-transactions/spec.md) | **Asset Transactions** | Checkout, return, transfer, immutable history, derived current state, conflict refusal and offline queue logic | **Mock Implemented.** The local backend works, but the production-authoritative atomic multi-asset command required by feature 009 is not implemented. Q8, Q9, inactive-project behavior and Q18 remain to confirm. |
| [004](004-calibration-management/spec.md) | **Calibration Management** | Due lists, evidence records, lab movement and reminder behavior | **Mock Implemented.** Tenant flows, document upload, correction/recalculation semantics, failed-result handling and Q18 remain production work. |
| [005](005-deployment-and-kits/spec.md) | **Deployment & Kits** | Deployment, recovery, site history, configuration changes and dated station composition | **Mock Implemented.** Proposed Installation tables, real schema, atomic server application and hosted offline behavior remain unapproved/unverified. |
| [006](006-fleet-reporting/spec.md) | **Fleet Reporting** | The seven acceptance questions, calibration compliance, timeline and utilisation | **Mock Implemented** in the app with a PBIP source project. The manager report is not published, its security model is not tenant-verified, and the in-app report does not satisfy manager access without opening the Code App. |
| [007](007-synthetic-data/spec.md) | **Synthetic Fleet History** | Fictional 20-year history, five-year operational detail, answer key, planted scenarios and scale profiles | **In progress.** No production dependency. Q14–Q16 and Q18 affect its tenant-load and component behavior. A dedicated synthetic environment is preferred for large loads. |
| [008](008-release-and-operations/spec.md) | **Release & Operations** | Safe bundle creation, publish, verify, roll back, promote and monitor | **US1 Mock Implemented.** Release-data guard exists. Hosted publish, verification, solution recovery, data recovery and operating procedures remain tenant work. |
| [009](009-production-readiness/spec.md) | **Production Readiness** | Atomic server-authoritative transactions, safe identity allocation, corrected state semantics, tenant security, hosted device proof, cutover and recovery | **Spec Draft.** This feature blocks Tenant Implemented, Security Verified, Device Verified, Pilot Accepted and Production Accepted status for 001–008. [Checklist](009-production-readiness/checklists/requirements.md). |

The detailed architecture findings and approval order are in
[`docs/13-production-readiness-review.md`](../docs/13-production-readiness-review.md). The revised
execution sequence is in [`docs/06-delivery-plan.md`](../docs/06-delivery-plan.md).

## Data-quality finding — 2026-09-02

The originally committed `data/source/calibration_history_2026-09-02.csv` is defective: its unlabelled
serial column was omitted, and calibration/next-due dates were under-exported. The serial is the only
attribute capable of linking those rows to assets.

Use `data/source/calibration_history_2026-09-02.corrected.csv`: 253 serials, 253 model names, 213
calibration dates, 253 next-due dates and a `source_row` traceability field. The registry export was
checked separately and is faithful, with credential columns absent.

Ambiguous calibration evidence must remain unmatched until a person confirms the target asset; a
production migration must not default an uncertain compliance record merely to reduce the unmatched
count.

## The seven programme acceptance questions

1. What do we own?
2. Where is asset X right now?
3. Who has asset X?
4. What is available at office Y?
5. What needs calibration in the next N days?
6. What is assigned to project Z?
7. Where was asset X on date D, and what was attached to it?

| Question | Functional source | Production proof |
|---|---|---|
| 1, 2, 3, 4 | 001 display + 003 state + 006 reporting | 009 atomicity/security + tenant report reconciliation |
| 5 | 004 calibration + 006 reporting | 009 calibration semantics, document/recovery and report security |
| 6 | 001 project filter + 003 assignment + 006 reporting | 009 server validation and tenant reporting |
| 7 | 003 immutable history + 005 dated composition + 006 timeline | 009 whole-event atomicity, correction model and recovery proof |

Mock walkthroughs demonstrate that the user journeys can answer these questions. Production Accepted
requires answering all seven from tenant data after Security Verified and Device Verified gates pass.

## Product clarifications and sign-offs

Resolved: Q1, Q2, Q3, Q5, Q7 and Q13. Q4 is completed data work awaiting review.

Still requiring confirmation or decision:

| Item | Effect |
|---|---|
| Q6 server/configuration treatment | Asset catalogue and migration |
| Q8 expected return | Checkout and overdue reminders |
| Q9 backdating | Immutable history and correction model |
| Q10 project master | Project status and assignment authority |
| Q11 report audience/licensing | Distribution and security model |
| Q12 French timing | Phase scope only; strings already externalized |
| Q14 synthetic Dev load/removal | Feature 007 US5 |
| Q15 fictional identity domain | Synthetic notification/collision risk |
| Q16 synthetic modem extension | Synthetic component pattern |
| Q17 Code App entitlement | Dominant programme cost |
| Q18 permanent-component calibration | Features 003, 004, 005, 007 and production state model |
| inactive-project rule | Checkout, transfer and deployment validation |
| reminder cadence | Notification state/history |
| site-coordinate capture | Hosted-device workflow |
| global vs office-scoped administrator | Data-layer security architecture |
| permanent home-office transfer | Fleet allocation and reporting history |
| failed calibration and physical receipt | Calibration state and lab workflow |

Two sign-offs remain hard gates before any production load:

- `migration/reports/03_models_review.md`
- `migration/reports/02_conflicts.md`

## Working the Spec Kit flow

Select a feature explicitly:

```bash
export SPECIFY_FEATURE=009-production-readiness
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

For feature 009, the first implementation proof is one authoritative five-asset checkout against a
development tenant: server revalidation, concurrency arbitration, idempotency, immutable history,
derived-state changes and full rollback on a deliberate mid-operation exception. Do not add more
screens before that proof passes.
