# Research: Web Application Platform (Phase 0)

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft notes for [plan.md](plan.md)

## R1 — Can local development prove concurrency without Azure?

**Decision**: Yes. Docker 29.x + Colima on the current macOS environment provides networked
PostgreSQL. Use a version-pinned container matching the Azure Flexible Server major.

**Rejected**: PGlite for WS-W4 proofs. The existing `server/` POC is single-connection; 
`db.transaction()` serialises for free, so `FOR UPDATE` ordering and sequence races are
documented intent, not exercised behaviour (`specs/REMAINING-WORK.md` Environment change).

## R2 — What is the authoritative write boundary?

**Decision**: `POST /api/transactions` with client submission ID + canonical request hash, as in
`docs/14` §5. One Postgres transaction applies header, lines, derived state, relationships, and
outbox. Browser-supplied `statusBefore` / `statusAfter` / sequence values are non-authoritative
(ignored or refused — see `contracts/transaction-command.md`).

**Rejected**: Power Automate F1 post-write derivation; Dataverse plugins; Zite multi-write without
transactions (parked — rule VIII unsatisfiable on that interface).

## R3 — State model for planning

**Decision**: Plan against `docs/15` §3 three-axis model + derived calibration currency.
Mark every encoding **`R1 APPROVED 2026-09-03`** until Jay approves and `docs/08-decisions.md` records it.

**Rejected**: Inventing a fourth model or continuing the POC’s single `status` column as the
production schema.

## R4 — Identity for first proof vs production

**Decision**: Production = Entra OIDC, BFF session cookies, roles
`FieldUser` | `OfficeAdmin` | `SystemOwner` | `ReportReader`, office scope in DB
(R5 decided 2026-09-04: OfficeAdmin assigned-office; SystemOwner global row ceiling;
ReportReader assigned-office/read-only). D18 requires workspace, purpose, named capabilities and
versioned projection IDs in addition to that ceiling. Local race tests may inject a
capability-bearing `CallerContext` test double so WS-W4 is not blocked on R6.

**Rejected**: AMS password store; trusting browser-provided role strings.

## R5 — Documents

**Decision**: Private Blob; metadata in PostgreSQL; short-lived authorized download URLs or
streaming through API; no account key to browser (`contracts/document-blob.md`).

**Rejected**: SharePoint as certificate system of record (parked / optional export only).

## R6 — Offline

**Decision**: PWA service worker + IndexedDB partitioned by
`environment + tenant + entra_object_id + workspace + projection_version`. Identity, workspace,
row-scope or capability change invalidates incompatible data. Pending ≠ accepted. Replay under the
originating identity and currently authorized purpose only. Background Sync optional enhancement.

**Open**: Exact supported device/browser matrix (pilot gate, WS-W12) — do not claim Device Verified
until dated evidence exists.

## R7 — Gates R1–R6 restated for implementers

| ID | Local five-asset proof | Azure pilot |
|---|---|---|
| R1 state model | **Required** | Required |
| R2 command contract freeze | **Required** before impl | Required |
| R3 full schema | Subset enough | Full approval |
| R4 Q8/Q9 | Checkout fields carry ASSUMPTION until decided | Required |
| R5 admin scope | **Decided**; test exact ceiling plus D18 intersection | Required with Entra claims |
| R6 enterprise Azure | **Not required** | Required |

## Sources

- `.specify/memory/constitution.md` v2.1.0
- `docs/14-webapp-architecture.md`
- `docs/15-postgres-data-model.md` (§3 APPROVED)
- `specs/010-web-application-platform/spec.md`
- `specs/REMAINING-WORK.md`
- `specs/_planning/MULTI-AGENT-OWNERSHIP.md`
