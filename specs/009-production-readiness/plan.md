# Implementation Plan: Production Readiness

**Branch**: `009-production-readiness` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-production-readiness/spec.md`,
`docs/13-production-readiness-review.md`, `specs/REMAINING-WORK.md` (WS-W4, WS-W12, pilot gate),
and platform contracts owned by feature 010.

## Summary

009 is the **evidence gate**, not a delivery platform. Feature 010 builds the Azure web application
(React PWA, Node/TypeScript API, PostgreSQL, private Blob, Entra OIDC). Feature 011 adds governed
data-management commands. This feature defines **how we prove** that those implementations satisfy
atomicity, identity, three-axis state, authorization, device/offline behavior, cutover and recovery
before any feature may claim API Implemented, Azure Integrated, Security Verified, Device Verified,
Migration Rehearsed, Pilot Accepted or Production Accepted.

This plan does **not** invent UI screens, redefine transaction command shapes, or create empty
`server/` / `db/` scaffolding. Proof harnesses **consume** contracts under
`specs/010-web-application-platform/contracts/` (Agent 010 writes them in parallel). If a named 010
contract file is not yet present, treat the path as the intended consume target and mark the harness
task blocked until that contract freezes.

## Spec wording amendments (reconciled)

These scrubs are now reflected in `spec.md` and the checklist:

| Location | Current | Replace with |
|---|---|---|
| Purpose / Dependencies | “tenant-implemented” | Use maturity vocabulary below — never “Tenant Implemented” |
| FR-031 | “without opening the Code App” | “without the Power Apps runtime — via in-app read-only reports and/or an approved reporting path” |
| FR-041 | “Tenant Implemented” in the status list | Align with `specs/README.md`: Spec Approved → Mock Implemented → **API Implemented** → **Azure Integrated** → Security Verified → Device Verified → **Migration Rehearsed** → Pilot Accepted → Production Accepted |
| CHK035 | “without opening the Code App” | Same FR-031 replacement |
| docs/13 maturity list | “Tenant Implemented” | Same README vocabulary (docs scrub is outside 009 ownership; note only) |

The D18 amendment additionally replaces role-only authorization language with the full
workspace/purpose/capability/row-scope/projection decision from
`docs/25-need-to-know-access-ux.md`.

## Role versus 010 and 011

| Concern | 010 owns | 011 owns | 009 owns |
|---|---|---|---|
| Command request/response shapes, error codes, idempotency envelope | Draft & freeze | — | Consume; assert outcomes |
| Auth/session caller context, health, documents, outbox envelope | Draft & freeze | — | Consume for security & recovery proofs |
| Field dictionary, quality issues, data jobs, merge, export, retention | — | Draft & freeze | Pilot/production gates may require 011 evidence later; not redefined here |
| Five-asset race, registration concurrency, security matrix, device evidence record, cutover checklist, recovery drill | Implement harness targets | — | Define acceptance contracts + evidence tasks |
| UI / PWA / API / migrations / IaC | Build | Build DM surfaces | Prove / record / refuse-to-claim |

## Current gates (the former `_planning/MULTI-AGENT-OWNERSHIP.md` table is historical context)

| ID | How 009 treats it |
|---|---|
| **R1** three-axis state | `R1 APPROVED 2026-09-03` — US3 proofs assert independent lifecycle / disposition / serviceability / calibration currency. Local atomic proofs may proceed against the first-proof schema subset once R1 is decided enough for WS-W2/W4; do not invent a fourth model. |
| **R2** atomic command contract | Harnesses blocked on 010 contract freeze before claiming WS-W4 pass. |
| **R3** full schema | First-proof subset is enough for five-asset and registration proofs; full schema approval remains a gate before Migration Rehearsed / Pilot. |
| **R4** Q8 / Q9 | Checkout proof fields carry `// ASSUMPTION` where command payloads include expected-return or backdate. |
| **R5** admin scope | **DECIDED 2026-09-04** — OfficeAdmin is assigned-office scoped; SystemOwner has a global row-scope ceiling. D18 still requires the active workspace, purpose, named capability and allowlisted projection for every request. |
| **R6** Azure enterprise | Does **not** block local PostgreSQL proof (US1/US2/parts of US3). **Does** gate Azure Integrated recovery drills, hosted device matrix on published apps, and Production Accepted restore evidence. |

**Gate rule encoded here**: **R1–R4 gate local atomic/identity proof.** **R6 gates Azure recovery drills** and hosted production-environment evidence. Do not refuse to run the five-asset race because Azure subscription work is open.

## Technical Context

**Language/Version**: TypeScript 5.x (test harnesses against 010 API); PostgreSQL for concurrency proofs.

**Primary Dependencies**: Feature 010 API + migrations; real PostgreSQL (container or Flexible Server Dev) — not PGlite alone for race/lock proofs (`REMAINING-WORK` WS-W4 note).

**Storage under test**: PostgreSQL as system of record; private Blob for document recovery drills (R6).

**Testing**: Integration/concurrency harnesses; direct API security calls (no UI-only evidence); dated device and recovery evidence records per contracts in this folder.

**Target Platform**: Azure web application (PWA + API + Postgres + Blob + Entra). Power Platform / Code App / Dataverse paths are parked — not proof targets.

**Project Type**: Evidence and acceptance artifacts under `specs/009-production-readiness/` only. Implementers build harnesses where 010 places integration tests (e.g. `server/` test suites) once those directories exist.

**Performance Goals**: SC-001–SC-004 concurrency batches (100 deliberate failures / races / retries / registrations); WS-W12 scale targets (5,000 assets, ≥100,000 lines) as pilot-gate evidence, not day-one local MVP.

**Constraints**: No claim of Security / Device / Migration / Pilot / Production Accepted without dated evidence (FR-043). Mock suite alone never advances past Mock Implemented. No credentials in evidence logs; redact SIM/network values.

**Scale/Scope**: Six user stories; six proof contracts; evidence tasks mapped to WS-W4 and WS-W12 (with device pieces from WS-W6 and cutover from WS-W11 as *evidence consumers*, not builders).

## Constitution Check

*GATE: Must pass before evidence tasks claim pass. Re-check when harnesses land.*

| Principle | How 009 complies | Risk |
|---|---|---|
| **I — state is derived** | Five-asset and race contracts assert browser-supplied before/after are ignored; server computes snapshots (SC-005). | Harness that posts client `statusAfter` and treats UI echo as pass. |
| **II — append-only history** | Correction scenarios require compensating events; accepted headers/lines must remain unchanged. | “Fix” scripts that UPDATE history rows to make a test green. |
| **III — Asset ID is a tag** | Registration concurrency proves unique canonical IDs; aliases for TMP/legacy; serial non-unique. | Client-side sequence preview treated as reserved ID. |
| **IV — reference data is picked** | Proofs use curated references from seed/API; no free-text manufacturer shortcuts in harness fixtures. | Synthetic fixtures that bypass reference FKs. |
| **V — refuse at both layers** | Security matrix requires **direct API** refusal; UI filtering is never evidence. | App-only negative tests counted as Security Verified. |
| **VI — maintainable by a successor** | Evidence records have owner, date, pass/fail, artifact link; recovery drills are named procedures. | Verbal “we tried it” without retained artifacts. |
| **VII — no credentials** | Device and security evidence must show Field User stores exclude secured SIM/network fields; logs redact secrets. | Dumping full API responses into evidence packs. |

**Result: PASS** for planning. No constitution exception required. Any remaining R1–R4 product
assumptions are explicit and do not weaken D18 authorization.

## Project Structure

### Documentation (this feature)

```text
specs/009-production-readiness/
├── spec.md
├── plan.md                          # this file
├── tasks.md
├── checklists/requirements.md
└── contracts/
    ├── five-asset-race.md           # US1 / SC-001–SC-005 / WS-W4 first proof
    ├── registration-concurrency.md  # US2 / SC-004 / WS-W4 registration proof
    ├── security-matrix.md           # US4 / SC-009–SC-010 / WS-W12 security
    ├── device-evidence.md           # US5 / SC-011 / WS-W6 + WS-W12 device
    ├── cutover-reconciliation.md    # US6 / SC-012 / WS-W11 + WS-W12 migration
    └── recovery-drill.md            # US6 / SC-013 / WS-W12 recovery (R6)
```

### Consumed 010 contracts (not owned; do not redefine shapes)

Intended paths under `specs/010-web-application-platform/contracts/` — **consumes 010 contracts**:

- `transaction-command.md` — multi-asset command request/response
- `idempotency.md` — submission ID + request hash behavior
- `auth-session.md` — caller context (never trust browser user id)
- `error-codes.md` — structured refusal codes
- `outbox-envelope.md` — outbox row committed with the business event
- `health.md` — readiness for harness preflight
- `document-upload.md` — private document metadata (recovery drill)

If Agent 010 uses different filenames, update the consume pointers in tasks — do not copy command schemas into 009.

### Evidence artifact locations (when implementers record results)

Prefer dated files under a future `docs/evidence/009/` or CI artifact store once the orchestrator creates that path. Until then, tasks require an evidence record matching the contract schema with owner + date + pass/fail; do not invent a parallel status system.

**Structure Decision**: Planning and acceptance contracts only under `specs/009-production-readiness/`. Harness code lives with 010’s server/integration test tree when created — 009 tasks say “prove/record,” not “scaffold empty apps.”

## User story → workstream evidence map

| User story | Primary WS | Evidence contract | Local (R1–R4) | Azure (R6) |
|---|---|---|---|---|
| **US1** Apply one complete event or none | **WS-W4** | `five-asset-race.md` | Required | Retest on Dev/UAT after Azure Integrated |
| **US2** Allocate stable identity safely | **WS-W4** | `registration-concurrency.md` | Required | Retest after Entra-backed registration |
| **US3** Preserve simultaneous asset facts | **WS-W4** (+ reporting WS-W9 for SC-006) | Covered by race + state assertions in five-asset / security / reporting evidence | Required once R1 frozen | Confirm in-app/approved reports |
| **US4** Prove authorization through every path | **WS-W12** (needs WS-W3) | `security-matrix.md` | Partial with test tokens if allowed | Full Entra + workspace/purpose/capability/row/projection matrix |
| **US5** Real mobile and offline behavior | **WS-W6** build; **WS-W12** evidence | `device-evidence.md` | Emulator ≠ pass | Hosted iOS/Android matrix required |
| **US6** Cut over and recover safely | **WS-W11** cutover; **WS-W12** recovery | `cutover-reconciliation.md`, `recovery-drill.md` | Migration dry-run against Postgres | Platform + DB + Blob restore drills |

Pilot gate (`REMAINING-WORK`): do not approve Ottawa until 009/010 atomicity outcomes, Entra/office direct API tests, supported device evidence, private documents, migration rehearsal + sign-offs, and recovery procedures pass — all with dated evidence (SC-014, FR-043).

## Phase 0 — research (settled for planning)

1. **Is 009 a second API?** No. Command shapes belong to 010; 009 defines outcome contracts.
2. **Can local Postgres prove atomicity without Azure?** Yes — WS-W4 first proof; R6 does not block it.
3. **Does mock offline count?** No — FR-033/FR-034; Device Verified requires hosted evidence or explicit unsupported carve-out from pilot claims.
4. **Maturity vocabulary?** `specs/README.md` is authoritative; “Tenant Implemented” is retired for status claims.

## Phase 1 — design (this folder)

- Six contracts below fix scenario IDs, pass/fail predicates and evidence record shapes.
- `tasks.md` sequences Setup → Foundational (consume 010 freeze) → US proofs → Polish/pilot checklist.
- No `data-model.md` in 009 — schema ownership is 010/docs/15.

**Post-design constitution re-check: PASS.** Evidence that updates history in place or trusts browser state fails Principle I/II regardless of green CI.

## Complexity Tracking

> No constitution violations requiring justification.

| Note | Why recorded |
|---|---|
| Three recovery procedures (app revision, platform/schema, business data + documents) | docs/13 and FR-040; names updated from Dataverse/SharePoint to Container Apps revision, PostgreSQL, and Blob + metadata reconciliation |
| Reporting without Power Apps runtime | FR-031 amendment; Power BI remains optional over approved views — not required for core operation |
