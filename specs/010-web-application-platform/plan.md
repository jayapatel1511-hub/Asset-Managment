# Implementation Plan: Web Application Platform

**Branch**: `010-web-application-platform` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-web-application-platform/spec.md`  
**Status**: Draft plan — **not Spec Approved**. Checklist remains 5 of 112 reviewed.

**Governing docs**: constitution 2.0.0, `docs/14-webapp-architecture.md`, `docs/15-postgres-data-model.md` (§3 **APPROVED** — R1 2026-09-03), `specs/REMAINING-WORK.md` (WS-W1…W12, R1–R6).

## Summary

Replace the parked Power Platform / Dataverse production path with a conventional internal web
application: React PWA client, Node/TypeScript API, PostgreSQL system of record, private Azure Blob
for documents, Microsoft Entra OIDC, Azure Container Apps hosting.

The existing `app/` mock remains valid for UI development and deterministic unit tests. The
production path is `app/src/api/http/` talking to `server/` over one origin. Do **not** create empty
`server/`, `db/`, `packages/`, or `infra/` scaffolding in this planning feature — directories appear
when the first owned implementation file needs them.

**First implementation proof (WS-W4)**: a five-asset checkout race against real PostgreSQL —
atomicity, deterministic locking, idempotency, immutable lines, derived four-axis state, and
outbox rows in one commit. **R1–R4 closed 2026-09-03.** Needs a local Postgres container; does **not**
need Azure or Entra (R6 does not block local proof).

**Gates**:

| Gate | Status (2026-09-03) | Still blocks |
|---|---|---|
| **R1** four-axis state | **APPROVED** | — |
| **R2** atomic command | **FROZEN** for first proof | Silent rewrite of lock/idempotency rules |
| **R3** schema | First-proof subset **APPROVED**; full catalogue review open | Full WS-W2 parallel beyond subset |
| **R4** Q8 / Q9 | **APPROVED** | — |
| **R5** admin scope | Open | Production OfficeAdmin behaviour |
| **R6** Azure enterprise | Open | WS-W10 / Azure deploy |

## Technical Context

**Language/Version**: TypeScript 5.x (app + server), React 18, Node 22.x, PostgreSQL major aligned to
Azure Flexible Server (pin in compose).

**Primary Dependencies (target)**: Vite + Fluent UI (existing client); Fastify (or approved
equivalent); Zod/TypeBox shared schemas; Kysely or equivalent typed SQL; `pg` against networked
Postgres — **not** PGlite for concurrency proofs.

**Storage**: Azure Database for PostgreSQL Flexible Server (Prod/UAT/Dev); private Azure Blob;
local Docker/Colima Postgres for developer and integration tests.

**Testing**: vitest (existing app unit suite); API integration tests against container Postgres;
concurrency / fault-injection suite for WS-W4; contract tests between `packages/contracts/` and
`app/src/api/http/`; later device matrix for PWA (WS-W6 / WS-W12).

**Target Platform**: Mobile-first PWA at 390 px, Entra workforce sign-in, Canadian Azure region for
production data/documents. Power Platform and Zite are **parked** — no Dataverse or Zite work.

**Project Type**: Monorepo emerging under `app/`, `server/`, `packages/`, `db/`, `infra/` as
implementation lands.

**Performance Goals**: Five-asset race and 100 concurrent registrations prove correctness first;
load targets (5,000 assets / 100k+ lines) belong to WS-W12.

**Constraints**: Browser owns no business authority. One business event = one atomic DB commit.
No credentials in source, bundle, or Field User offline cache. No empty scaffolding directories.
Synthetic data refused in production mode.

**Scale/Scope**: ~1,050 source assets; five user stories (US1–US5); work mapped to WS-W1…W12.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature complies | Risk |
|---|---|---|
| **I — state is derived** | Only `POST /api/transactions` (and named registration/document commands) write lifecycle, disposition, serviceability, location, custodian, project, parent. HTTP adapter never PATCHes those columns. | Leaking a “quick edit asset” endpoint during WS-W5. Forbidden. |
| **II — append-only history** | `asset_transaction` / `asset_transaction_line` immutable; corrections are new events with `correction_of_transaction_id`. DB triggers refuse ordinary UPDATE/DELETE. | Repair scripts must be separate, audited, System Owner approved. |
| **III — Asset ID is a tag** | UUID PK; canonical `asset_id` unique/immutable; aliases for temp/legacy; serial non-unique; sequence allocated server-side inside registration. | Browser preview of next ID must not reserve. |
| **IV — reference data is picked** | Command payloads carry UUIDs/codes to curated rows; free text only where already decided (notes, site position). Admin stewardship of references is feature 011. | Do not reintroduce free-text manufacturer/model on write commands. |
| **V — refuse at every layer** | Client feedback + API validation + DB constraints. Race loser gets structured conflict, not a half write. | UI-only disable as “security evidence”. |
| **VI — maintainable by a successor** | Migrations, contracts, IaC, runbooks, CI in repo; Dev deploy from artifacts + documented enterprise prerequisites. | Undocumented Entra/portal clicks as required steps. |
| **VII — no credentials** | Entra OIDC; managed identity to Blob/Postgres; no AMS password store; Field User DTOs omit SIM/network/certificate bytes. | Putting storage account keys in client or long-lived CI secrets. |
| **VIII — one atomic commit** | Single Postgres transaction: idempotency claim, locks, validation, header/lines, derived state, relationships, outbox. Same submission ID + hash replays; different hash refused. | Per-line commits or “apply then notify” outside the outbox. |

**Result: PASS** for the planned approach, subject to freezing R1–R4 before WS-W4 implementation.
Open product fields are marked `ASSUMPTION` in contracts — not silently decided.

## Project Structure

### Documentation (this feature)

```text
specs/010-web-application-platform/
├── spec.md
├── plan.md                 # this file
├── research.md             # Phase 0 notes
├── data-model.md           # first-proof subset + R1 APPROVED 2026-09-03
├── tasks.md
├── checklists/requirements.md
└── contracts/
    ├── transaction-command.md   # R2 frozen draft
    ├── auth-caller-context.md
    ├── health-and-read.md
    ├── document-blob.md
    ├── outbox-envelope.md
    └── error-codes.md
```

### Source / infra (future implementation — describe only; do not create empty dirs)

```text
app/
  src/api/http/             # production AmsBackend → AMS API
  src/offline/              # IndexedDB cache, drafts, queue, replay (WS-W6)
server/
  src/auth/                 # Entra / session / caller context (WS-W3)
  src/modules/transactions/ # atomic command service (WS-W4)
  src/modules/assets/       # search/read, registration
  src/modules/calibration/
  src/modules/installations/
  src/modules/reports/
  src/db/                   # pool, migration apply helpers
  src/outbox/               # claim/lease workers (WS-W8)
  src/documents/            # Blob metadata + authorize (WS-W7)
  src/observability/
packages/
  contracts/                # shared Zod/TS request/response schemas (WS-W1)
  domain/                   # pure rules where safe to share (never security alone)
db/
  migrations/               # forward-safe SQL (WS-W2; first-proof subset first)
  seeds/
  views/
infra/                      # Bicep + env params (WS-W10; blocked on R6 for real Azure)
```

Existing local POC under `server/` uses PGlite and the legacy single `status` column. Production
work **replaces** that concurrency story with networked Postgres and three-axis state
(`R1 APPROVED 2026-09-03`). The POC is a reference for sequencing and refusal HTTP shape, not the schema.

**Structure Decision**: Monorepo with shared contracts. Client mock stays for UI. Production writes
only through the HTTP adapter and server transaction module. Feature 011 owns data-management
contracts; feature 009 owns proof harness outcomes that **consume** these 010 contracts.

## Phase map → WS-W1…W12

| Plan phase | Workstreams | Outcome |
|---|---|---|
| Phase 0 — research | — | Settled notes in `research.md` |
| Phase 1 — contracts + first-proof data model | R2 frozen draft, R3 subset | Contracts under `contracts/`; `data-model.md` |
| Phase 2 — foundation | **WS-W1** | Workspace commands, local Postgres (Docker/Colima), health, `packages/contracts` first files |
| Phase 3 — schema subset | **WS-W2** (subset) | Migrations for race tables only after R1 |
| Phase 4 — caller context | **WS-W3** (stub → Entra) | Test doubles until R5/R6; Entra when ready |
| Phase 5 — atomic command MVP | **WS-W4** | Five-asset checkout race + registration proof |
| Phase 6 — HTTP workflows | **WS-W5** | `app/src/api/http/` checkout→… migration order |
| Phase 7 — PWA offline | **WS-W6** / US3 | Service worker, IndexedDB, queue, Needs attention |
| Phase 8 — documents | **WS-W7** / US4 | Private Blob upload/download |
| Phase 9 — outbox workers | **WS-W8** | Best-effort notifications |
| Phase 10 — reporting | **WS-W9** | Read-only views/API |
| Phase 11 — Azure ops | **WS-W10** / US5 | IaC, Container Apps (needs R6) |
| Phase 12 — migration target | **WS-W11** | PostgreSQL loader (reuses `migration/` profiling) |
| Phase 13 — verification | **WS-W12** / 009 | Security, scale, recovery, pilot evidence |

## Phase 0 — research

See [research.md](research.md). Settled conclusions:

1. PGlite cannot prove the five-asset race — use Docker/Colima Postgres.
2. Three-axis state (`docs/15` §3) is the model to plan against (`R1 APPROVED 2026-09-03`).
3. Production adapter is HTTP; Dataverse/Zite parked.
4. R6 does not block local WS-W4 proof.
5. Existing `deriveState` / mock transaction semantics are behavioural references until the server
   re-implements them against PostgreSQL and three-axis columns.

## Phase 1 — design

- Freeze **draft** contracts in `contracts/` (R2 remains unfrozen until Jay approves).
- Document first-proof tables in `data-model.md`.
- Tasks gate: **R1 closed 2026-09-03 — proceed** before committing migrations; **STOP until command
  contract frozen** before WS-W4 implementation.

**Post-design constitution re-check: PASS** if implementation follows the contracts and never adds
a generic table PATCH.

## Complexity Tracking

| Violation / stretch | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dual adapters (mock + HTTP) during transition | UI and 318+ unit tests must keep running while API is built | Big-bang cutover would block all frontend work on Postgres readiness |
| Test-double auth before Entra (R5/R6) | Local race proof must not wait on enterprise Entra app registration | Blocking WS-W4 on R6 idles the critical path behind procurement |
| First-proof schema subset before full `docs/15` approval | Prove VIII early with `asset`, transactions, idempotency, sequence, outbox | Waiting for every 011 table before any proof delays the whole programme |
