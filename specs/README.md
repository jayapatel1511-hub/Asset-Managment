# Englobe AMS — Specification Index

Spec-Driven Development structure, following [github/spec-kit](https://github.com/github/spec-kit).

Governing document: [`.specify/memory/constitution.md`](../.specify/memory/constitution.md). Read it first.
Every plan is gated against it.

> **Writing code here?** Read [`AGENT-BRIEF.md`](AGENT-BRIEF.md) before touching a file — most of
> this system is already built, and its §1 (environment) and §5 (shared-file ownership for parallel
> agents) are what stop a session being wasted. Then [`REMAINING-WORK.md`](REMAINING-WORK.md) for
> what is actually left, sliced into workstreams that can run concurrently.

## How this relates to `docs/`

`docs/00-brief.md` … `docs/08-decisions.md` is the original handover package: one continuous design
document covering the whole system. It remains the **reference** for stack rationale, the full
Dataverse column list, flow step detail, and the decision log.

`specs/` is the **executable** form of the same intent, sliced the way Spec Kit expects: numbered
features, each with prioritized and independently deliverable user stories, testable requirements,
and measurable success criteria. Where the two disagree, `specs/` wins and the discrepancy is logged
in `docs/08-decisions.md`.

| Source | Role |
|---|---|
| `IM30 - Asset Managment via M365.docx` | The original ask — objective, needed fields, design principles |
| `Asset AMS - SharePoint.xlsx` | The evidence — 1,053 live asset rows, current sheet design, ID conventions, form drafts. **Authoritative** over the CSV exports |
| `docs/` | Narrative design reference and decision log |
| `docs/10-integration.md` | **Which Microsoft service satisfies which requirement** — the integration surface map, and its open gaps. `specs/` is technology-agnostic by design, so this is where SharePoint, Teams, Entra and the Dataverse seam are pinned down |
| `.specify/memory/constitution.md` | Non-negotiable principles; gates every plan |
| `specs/###-*/` | Per-feature spec → plan → tasks |

## Features

Delivery order was top to bottom. `001`–`004` are built and tested and verified live at 390 px against the real migrated data;
`005` and `006` have since been built too. **281 tests passing across 12 files**, re-verified
2026-09-02. `docs/09-build-report.md` predates the 005/006 work — treat this table and the report
as needing a refresh against the current tree.

| # | Feature | Delivers | Build status |
|---|---|---|---|
| [001](001-asset-registry/spec.md) | **Asset Registry** | A trustworthy, searchable catalogue: stable identity, N admin-managed offices, curated reference data, add/retire, scan-to-open | **Built** (P1–P2, most P3–P4). Camera scan stubbed |
| [002](002-inventory-migration/spec.md) | **Inventory Migration** | The existing 1,053 rows loaded clean, deduplicated, with every judgement call visible and signed off | **Built.** 1,026 staged assets, 9 reports, idempotent. Needs Jay's sign-off before Prod |
| [003](003-asset-transactions/spec.md) | **Asset Transactions** | Checkout / Return / Transfer, derived current state, complete immutable history, conflict refusal, offline queueing | **Built** except US5 offline queue → WS-C |
| [004](004-calibration-management/spec.md) | **Calibration Management** | Due lists, calibration records with certificates, reminders, lab round-trip | **Built** except US4 admin assignment → WS-D |
| [005](005-deployment-and-kits/spec.md) | **Deployment & Kits** | Deploy an instrument kit to a site with orientation, power and site detail; undeploy; historical kit composition | **Not started.** [plan](005-deployment-and-kits/plan.md) · [contracts](005-deployment-and-kits/contracts/ams-backend-deployment.md) · [tasks](005-deployment-and-kits/tasks.md) → WS-A |
| [006](006-fleet-reporting/spec.md) | **Fleet Reporting** | The seven acceptance questions answered from a report, without an app licence | **Not started.** [plan](006-fleet-reporting/plan.md) · [tasks](006-fleet-reporting/tasks.md) → WS-B |

Build detail, every assumption and the exact remaining steps: `docs/09-build-report.md` — read it
fresh rather than trusting any summary, including this table.

## Data-quality finding, 2026-09-02

The committed `data/source/calibration_history_2026-09-02.csv` is **defective** and blocks feature 002's
calibration matching: its serial column is empty in all 253 rows, because that column carries no header
in the source spreadsheet and a header-driven export skipped it. The same export also lost 47
calibration dates and 47 next-due dates.

The serial is the only attribute linking a calibration record to an asset. A corrected export
regenerated from the spreadsheet sits alongside it as
`data/source/calibration_history_2026-09-02.corrected.csv` — 253 serials, 253 models, 213 calibration
dates, 253 next-due dates, plus a `source_row` column for traceability.

The registry export was checked column by column and is faithful, with `Login` / `Password` correctly
absent. Details in [002's spec](002-inventory-migration/spec.md) and
[its checklist](002-inventory-migration/checklists/requirements.md) (CHK005–CHK008).

## The seven acceptance questions

Every feature traces back to these. They are the definition of done for the programme, from
`docs/00-brief.md`:

1. What do we own?
2. Where is asset X right now?
3. Who has asset X?
4. What is available at office Y?
5. What needs calibration in the next N days?
6. What is assigned to project Z?
7. Where was asset X on date D, and what was attached to it?

| Question | Answered by |
|---|---|
| 1, 2, 3, 4 | 001 (display) + 003 (keeps it true) + 006 |
| 5 | 004 + 006 |
| 6 | 001 (filter) + 003 (assignment) + 006 |
| 7 | 003 (history) + 005 (kit composition) + 006 |

## Blocking clarifications

Spec Kit marks unresolved product questions inline as `[NEEDS CLARIFICATION: …]`. A `plan.md` is not
normally written while a **blocking** marker in its spec is open.

That rule was **explicitly waived once**, on 2026-09-02, by the System Owner: the build proceeded on
each open item's recorded recommendation, every one marked `// ASSUMPTION: Q<n>` in code and logged in
`docs/08-decisions.md`. Plans for 005 and 006 exist on the same basis. The waiver does not extend to a
production load — the sign-offs below are still hard gates.

**[`clarifications.md`](clarifications.md)** states each question with its evidence, what is at stake,
a recommendation, and what changes if the answer differs.

Five of the thirteen were resolved outright. **Q4 is no longer a blocker** — it was data work, and it
was done: 35 of 64 catalogue rows corrected, reviewable in full at
`migration/reports/03_models_review.md`. It is now a completed deliverable awaiting a read-through, not
a pending decision.

**Resolved 2026-09-02** (recorded in `docs/08-decisions.md`):

| Q | Decision |
|---|---|
| Q1, Q2 | **N offices, admin-managed.** The hierarchy takes any number of offices at any level, added and re-parented in-app; no fixed office list anywhere. Migration maps source offices one for one with no inference, and SWO / Mississauga / Thunder Bay are re-parented on a screen afterwards. This dissolved the blocker rather than answering it — no asset gets a guessed home office |
| Q3 | The 644 "Deployed or NOT Available" rows migrate as **CheckedOut with no custodian**, plus a one-week return sweep in the Ottawa pilot |
| Q5 | SLM pre-amp and element get **their own Asset IDs**, attached as permanent Components. Fleet is roughly 1,150 assets, and acoustic calibration becomes fully trackable |
| Q7 | A SIM is a **permanent Component** of its modem. It never appears in a checkout cart or on a deployment form |
| Q13 | Retired assets and their history are retained **indefinitely** |

**Still open** — these need Jay, not a guess:

| Q | Question | Blocks |
|---|---|---|
| **Q4** | **Done, awaiting review.** 35 of 64 catalogue rows corrected and calibration intervals set; read `migration/reports/03_models_review.md`. Not blocking any further build | 001, 002, 004 |
| Q6 | Are the 16 "Servers" trackable assets, or is `Azure` configuration that does not belong in an asset registry? | 001 |
| Q8 | Is expected return required on checkout? *(Recommendation: optional, 14-day default)* | 003 |
| Q9 | May admins backdate, and how far? *(Recommendation: admins only, 30 days, refuse if it lands before an existing transaction)* | 003 |
| Q10 | Is there a project master to sync from, or do we seed the 79 IDs and let admins add? | 001 |
| Q11 | Who needs report access, and are the licences held? | 006 |
| — | Refuse a transaction naming an inactive project outright, or warn and permit? | 003 |
| — | Calibration reminder cadence — daily until actioned, weekly, or once per threshold? | 004 |
| — | Site coordinates — captured from the device, entered by hand, or both? | 005 |
| Q12 | French labels — confirm Phase 1 ships English only | Phase 3 |

**Two sign-offs are hard gates before any production load**, neither of them a question:
`migration/reports/03_models_review.md` (35 corrected model rows) and
`migration/reports/02_conflicts.md` (16 cross-office duplicate resolutions) — the second is required
by feature 002's FR-026.

## Working the flow

Without git branches in this workspace, select a feature by environment variable rather than by
checkout:

```bash
export SPECIFY_FEATURE=003-asset-transactions
```

Then the usual Spec Kit progression per feature:

```text
/speckit.constitution   → .specify/memory/constitution.md   (done, v1.0.0)
/speckit.specify        → specs/###-*/spec.md
/speckit.clarify        → resolves [NEEDS CLARIFICATION] markers
/speckit.plan           → specs/###-*/plan.md + research.md + data-model.md + contracts/
/speckit.tasks          → specs/###-*/tasks.md
/speckit.checklist      → specs/###-*/checklists/*.md
/speckit.analyze        → cross-artifact consistency check
/speckit.implement      → executes tasks.md
```
