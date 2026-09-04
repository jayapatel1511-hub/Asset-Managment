# Implementation Plan: Data Management & Stewardship

**Branch**: `011-data-management` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-data-management/spec.md`; architecture from `docs/16-data-management.md`, `docs/15-postgres-data-model.md`, `docs/14-webapp-architecture.md`; sequencing from `CLAUDE.md` and `specs/REMAINING-WORK.md`.

**Agent ownership**: Agent 011 owns exclusively `specs/011-data-management/plan.md`, `tasks.md`, `contracts/**`, optional `research.md` / `data-model.md`. Does not edit 009/010 files or application code.

---

## Summary

Feature 011 turns distributed data-care fragments (reference seeds, migration reports, audit, retention notes) into one **governable Data Management Centre** inside the Azure web application. Authorized stewards manage reference/master data, correct static facts, run dry-run bulk jobs, own quality issues, review duplicate candidates, reconcile external sources, produce governed exports, and apply retention/legal-hold rules — all through **named, validated commands**, never a generic table editor.

**Critical delivery order** (CLAUDE.md sequence steps 6, 10–13; docs/16 §17):

1. **Read-only first**: field dictionary + quality rules + issue queue + overview dashboard — after schema/authorization stabilize.
2. Then reference maintenance (create / edit / deactivate — never hard-delete).
3. Then named static corrections (no derived-state writes).
4. Then import dry-run → approved apply with row-level outcomes.
5. Then duplicate review / redirect merge.
6. Then external reconciliation.
7. Then governed exports.
8. Then retention register, legal hold, purge preview.

High-impact write paths are **Blocked on 010 WS-W3/W4 foundations** (caller identity, authorization, atomic command, idempotency, audit, outbox). Read-only dictionary and quality surfaces may begin after the schema gate (WS-W2) and approved dictionary format, using read APIs and views.

Power Platform and Zite remain **parked**. No Dataverse adapter, no Zite store, no `PATCH /table/{id}`, no arbitrary SQL/data-editor endpoint.

---

## Technical Context

**Language/Version**: TypeScript 5.x (API + client), PostgreSQL (Flexible Server target; local container for proof)

**Primary Dependencies**: Existing React/Vite/Fluent UI app; Node.js TypeScript API (Fastify or approved equivalent); shared contracts under `packages/contracts/` when 010 creates them; private Azure Blob for job/export artifacts

**Storage**: PostgreSQL for dictionary, quality, jobs, redirects, retention; private Blob for import sources and export artifacts; reuse `audit_event`, `document`, aliases, outbox — do not duplicate

**Testing**: Domain/unit tests; database constraint tests; API integration against PostgreSQL; direct
API role × workspace × purpose × capability × row scope × projection/forbidden-key tests;
dry-run/apply/idempotency; duplicate/redirect/history preservation; export auth/expiry;
retention/hold/purge-preview

**Target Platform**: Azure Container Apps (Canadian region); Entra OIDC; Console surface for admin/data-management UI

**Project Type**: Monorepo — `server/src/modules/data-management/`, `app/` Console routes, `db/migrations/` additions, `packages/contracts/` schemas

**Performance Goals**: Overview and issue search usable at 5,000 assets / 100,000+ transaction lines without full-fleet client download; 5,000-row dry run within approved budget; jobs must not hold locks that disrupt checkout beyond approved budget

**Constraints**: No invented retention periods; no auto-merge on serial; no generic PATCH; OD-2 Data
Steward bundle and OD-4 classification are decided; exact D18 capability mapping and named owners
remain; high-impact writes wait for 010 foundations

**Scale/Scope**: US1–US8; ~9 physical entity groups (docs/16 §14); eight HTTP contract families; Console Data Management area (capability owned here; shell owned by WS-W5)

---

## Constitution Check

*GATE: Must pass before research/design. Re-check after design.*

| Principle / rule | How this feature complies | Risk |
|---|---|---|
| **I — Current state is derived** | Corrections, imports and merges refuse SystemDerived fields (lifecycle, disposition, serviceability, location, custodian, project, parent). Rehome / attach / detach route through named business events. | Import templates that include “status” columns — must refuse, not translate. |
| **II — History append-only** | Post-go-live merge creates `record_redirect`; never rewrites transaction lines. Corrections are compensating/linked events or audited static change requests. Purge is a controlled job, not row delete UI. | “Clean up” merge that rewrites lines — prohibited (FR-048). |
| **III — Stable identity** | UUID preserved for both survivor and merged-away; canonical Asset ID immutable; former IDs remain aliases; serial non-unique and never auto-merge key. | Treating serial as identity in duplicate rules. |
| **IV — Reference data picked** | Reference commands create/edit/deactivate curated rows; imports resolve aliases to canonical records; free-text references refused. | Silent invent-on-import of manufacturer/model text. |
| **V — Refuse at every layer** | API/database refuse invalid reference keys, cyclic locations, derived-state corrections, apply-after-drift; UI only for faster feedback. | UI-only validation on dry-run/apply. |
| **VI — Maintainable by a successor** | Named modules, versioned dictionary/rules/templates, job audit, runbooks for retention/hold. | Steward knowledge living only in chat/Slack. |
| **VII — No credentials / min sensitive** | Restricted fields redacted from logs, validation messages, unauthorized exports and Field User offline; export templates exclude restricted identifiers by default. | Export “for reconciliation” that ships ICCID broadly. |
| **VIII — One event, one atomic commit** | Data jobs use the same idempotency and transactional batch rules; logical groups remain atomic; outbox inside the commit. | Partial import apply without item outcomes. |
| **CLAUDE 14** — Not a generic DB editor | Named commands only; FR-008 / CHK001. | Admin “edit row” shortcut. |
| **CLAUDE 15** — Bulk dry-run + row outcomes | Every write job: dry-run, apply gates, item-level results. | Silent skip of failed rows. |
| **CLAUDE 16** — No auto-merge on serial | Candidates only; human review mandatory. | Confidence-threshold auto-merge. |
| **CLAUDE 17** — Merge preserves history | Redirect + both UUIDs/histories. | In-place UUID collapse. |
| **CLAUDE 18** — Dictionary coverage | Machine-readable dictionary; CI check fails missing production fields. | Shipping fields without entries. |
| **CLAUDE 19** — Governed exports | Approved templates, server scope, private short-lived artifacts, audit. | Client-side CSV of API pages. |
| **CLAUDE 20** — Retention / legal hold | Versioned policy; hold; preview; no general delete. | Ad-hoc DELETE for “cleanup”. |

**Current gates** (the former `_planning/MULTI-AGENT-OWNERSHIP.md` table is historical context):

| ID | Treatment in 011 |
|---|---|
| **R1** three-axis state | Plan against it; mark `R1 APPROVED 2026-09-03`. Quality replay rules and merge state checks use lifecycle / disposition / serviceability / calibration currency. |
| **R2** atomic command | High-impact writes blocked until 010 freezes command/idempotency/error contracts. |
| **R3** full schema | Dictionary + quality tables may use first-proof-compatible subset after schema gate; full 011 entities need docs/15 approval including docs/16 §14 additions. |
| **R5** admin scope | **DECIDED 2026-09-04** — OfficeAdmin is assigned-office scoped; SystemOwner has a global row-scope ceiling. Data-steward access still requires the Administration workspace, an approved purpose, exact capability and purpose-sized projection under D18. |
| **R6** Azure enterprise | Does not block local Postgres read/quality proof. |

**Result: PASS** with explicit remaining STOP gates (not silent product choices); R5 is no longer open.

---

## User-story map

| Story | Priority | WS map | First capability |
|---|---|---|---|
| **US1** Quality dashboard + issue queue | P1 | WS-W2 views + 011 quality module; read-first | Dictionary + rules + issues + overview |
| **US2** Reference / master data commands | P1 | After WS-W3 auth; blocked on W3/W4 for writes | Create / edit / deactivate / re-parent / merge with impact preview |
| **US3** Static corrections | P1 | **Blocked on 010 WS-W3/W4** | Named correction commands; no derived-state writes |
| **US4** Bulk import dry-run / apply | P2 | **Blocked on 010 WS-W3/W4** + job worker (W8) | Versioned templates, dry-run, apply gates, item outcomes |
| **US5** Duplicates / redirect | P2 | **Blocked on 010 WS-W3/W4** | Candidates, review outcomes, permanent redirect |
| **US6** External reconciliation | P3 | After authority decisions; job framework | Checkpoint dry-run, authority-aware apply |
| **US7** Governed exports | P3 | Blob (W7) + auth | Approved templates, private expiry, audit |
| **US8** Retention / legal hold | P4 | After retention policy decisions | Register, hold, preview, purge (no general delete) |

---

## Surfaces / Console ownership

From `specs/REMAINING-WORK.md` and `docs/17-ux-audit.md` § E:

| Concern | Owner |
|---|---|
| **Data administration capability** (dictionary, quality, reference, corrections, jobs, duplicates, exports, retention) | **Feature 011** |
| **Console shell** (three surfaces: field / desk / console; admin home workspace; navigation chrome) | **WS-W5** (HTTP client + surfaces) |
| Field / Desk must not become the only place admins work | WS-W5 routes Console; 011 fills Console content |

011 plans API modules and Console feature pages under Data Management; it does **not** re-own the whole admin IA. Tasks that need routes assume WS-W5 Console shell exists or land behind a temporary Console route owned by W5 coordination.

---

## Project Structure

### Documentation (this feature)

```text
specs/011-data-management/
├── spec.md
├── plan.md                 # this file
├── research.md             # Phase 0 notes
├── data-model.md           # 011 physical additions
├── checklists/requirements.md
├── contracts/
│   ├── field-dictionary.md
│   ├── quality-issue.md
│   ├── reference-command.md
│   ├── static-correction.md
│   ├── data-job.md
│   ├── duplicate-redirect.md
│   ├── governed-export.md
│   └── retention-legal-hold.md
└── tasks.md
```

### Target source (when implementation begins — do not scaffold empty now)

```text
server/src/modules/data-management/
  overview/  reference-data/  corrections/  jobs/
  imports/  exports/  quality/  duplicates/
  lineage/  retention/  reconciliation/

db/migrations/          # 011 tables after docs/15 approval
packages/contracts/     # shared request/response (010 creates package)
app/src/features/data-management/   # Console pages
```

**Structure Decision**: Feature modules under `server/src/modules/data-management/` per docs/16 §15. Shared auth, idempotency, audit and outbox from 010 — never a parallel trust boundary.

---

## Phase 0 — Research

See [research.md](research.md). Settled for planning:

1. Read-only dictionary + quality before writes (CLAUDE sequence).
2. Physical entities listed in docs/16 §14 are required additions to docs/15 (not yet present in the postgres doc body — **ASSUMPTION: R3** until schema approval includes them).
3. Categories are curated hierarchical reference rows (REMAINING-WORK G0.1 resolved) — feeds US2.
4. No staff table; people are Entra + AMS role/scope — feeds authority and reconciliation.
5. Duplicate detection never auto-merges on serial (constitution + FR-044).

---

## Phase 1 — Design

- [data-model.md](data-model.md) maps docs/16 §14 entities onto PostgreSQL conventions from docs/15.
- Contracts freeze request/response shapes for dictionary, quality, reference, correction, jobs, duplicates, exports, retention.
- Open decisions remain STOP gates. R1–R5 are recorded decisions; D18 implementation/evidence and
  genuinely open product/enterprise choices are not converted into assumptions or invented.

**Post-design constitution re-check: PASS.** The standing prohibition is any endpoint that accepts arbitrary column patches or SQL.

---

## Current open decisions (STOP gates — do not invent)

| Decision | Blocks |
|---|---|
| Named Data Owner / steward per domain and office | Issue ownership and alerts |
| Legal/statutory obligations that supersede OD-5 defaults | Any broader retention/purge activation |
| Project-master authority and sync contract | US6 |
| Quality service levels by severity/office | US1 production alerts |
| Dictionary-change approval breadth | Dictionary maintenance writes |
| Final Entra/group-to-capability mapping inside R5/D18 | All production authorization evidence |

OD-2 through OD-9 and OD-11 are decided in `docs/08-decisions.md`; implementation and evidence are
still separate. The table above must not reopen them under the plan's older numbering.

Plus **Blocked on 010 WS-W3/W4 foundations** for all write stories (US2 write path after auth decision; US3–US8 writes).

---

## Complexity Tracking

| Violation / expansion | Why needed | Simpler alternative rejected because |
|---|---|---|
| New tables beyond docs/15 body (`data_job`, quality, redirect, retention, …) | docs/16 §14 and FR-032+ require governable jobs/issues/holds | Reusing only `audit_event` cannot support dry-run snapshots, item outcomes, or legal hold |
| Async job workers for bulk apply | 5,000-row imports cannot hold HTTP and row locks | Synchronous apply would violate FR-081 lock budget |
| Console surface dependency on WS-W5 | Admins need a workspace, not Field screens | Putting data admin on Field/Desk recreates docs/17 § E1 gap |

---

## Dependencies on 010 / 009

| Dependency | Needed for |
|---|---|
| WS-W2 schema + docs/15 approval including 011 entities | Dictionary storage, quality, jobs |
| WS-W3 identity / role / office scope (**R5**) | All authorized reads/writes |
| WS-W4 atomic command + idempotency + audit + outbox | US3–US8 writes; US2 high-impact apply |
| WS-W7 private Blob | Import sources, export artifacts |
| WS-W8 workers | Async job apply, quality schedule, export generation, purge |
| WS-W5 Console shell | Navigation/home for Data Management UI |
| 009 migration sign-offs / quality evidence | Pilot gate SC-019; not required to start read-only US1 in Dev |

010 owns transaction command, idempotency, auth session, health, document metadata, outbox envelope, error codes. 011 **consumes** those; it does not redefine them.
