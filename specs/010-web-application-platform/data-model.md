# Data Model: First-Proof Subset (Feature 010)


> **Path note, 2026-09-03 (after this document was written).** Every reference below to
> `server/src/db/schema.sql` describes content that is now in `db/migrations/` — nine numbered,
> forward-only files applied through a `schema_migration` ledger by `server/src/db/migrate.ts`.
> The single `schema.sql` was deleted, not moved, so that two files could not both claim to
> describe the schema. The *content* of every reference below is still accurate; only the
> location has changed. See `docs/08-decisions.md` § "Database lane calls" (D-MIG-1..4).

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: **Approved for migration** (R3, Jay 2026-09-03)  
**Authority**: `docs/15-postgres-data-model.md` (§3 state model **APPROVED** — R1 2026-09-03)  
**Transition and derivation authority**: `contracts/transition-table.md` — 27 rules over all 22 transaction
types, the calibration-currency derivation, the display-pill precedence order, and the compatibility-window
column rule (DC-22 below).  
**Scope**: Tables required for the five-asset checkout race and concurrent registration proof
(WS-W4). Full schema catalogue review remains for complete WS-W2.

## State axes (R1 APPROVED 2026-09-03)

**Three stored columns plus one derived value.** "Four axes" in the R1 row invites a fourth *column*; there
must not be one.

| Axis | Stored? | Values |
|---|---|---|
| `lifecycle` | **column** | `Active`, `Retired` |
| `disposition` | **column** | `AtOffice`, `CheckedOut`, `Deployed`, `InTransit`, `AtCalibrationLab`, `Missing` |
| `serviceability` | **column** | `Serviceable`, `NeedsRepair`, `OutOfService` |
| Calibration currency | **derived — no column** | `NotRequired`, `Unknown`, `Current`, `DueSoon`, `Overdue`, `Failed` (see DC-18) |

Display pills (Available, Deployed, …) are views only — never authoritative columns. A stored
`calibration_currency` column would be a second writable source of truth for a value computed from
`next_calibration_due_date`, the model's requirement and the calibration records; migrations must not create
one.

> **DEMO CALL 2026-09-03 (DC-18, recorded here)** — the derived calibration-currency list drops
> `InCalibration`; "at the lab" is read off `disposition = AtCalibrationLab`. Full reasoning at
> `contracts/transition-table.md` §6. **`docs/15` §3.4 and `docs/08-decisions.md:88` still list seven values
> and remain the authority of record until amended** — reported to the decision-log owner under `CLAUDE.md`
> rule 13.

## First-proof tables

### Identity (minimal for lock tests)

| Table | Why in first proof |
|---|---|
| `app_user` | `performed_by_user_id`, custodian FKs |
| `user_role` | Authorization stubs / Entra sync later |
| `user_office_scope` | Decided R5 row ceiling: OfficeAdmin assigned-office; SystemOwner global ceiling. D18 workspace/purpose/capability/projection checks remain separate. |
| `location` | Home office / AtOffice disposition |
| `project` | Checkout requires active project |
| `equipment_model` | Registration prefix / serialisation rules |

### Assets

| Table | Notes |
|---|---|
| `asset` | UUID PK; immutable `asset_id`; `lifecycle` / `disposition` / `serviceability`; `row_version`; location/custodian/project FKs — **R1 APPROVED 2026-09-03** |
| `asset_identifier` | Temp/legacy aliases for registration proof |
| `asset_id_sequence` | Prefix row locked inside registration |

### Commands and history

| Table | Notes |
|---|---|
| `asset_transaction` | Header; `client_submission_id`, `request_hash`, `recorded_at`, `effective_at` |
| `asset_transaction_line` | Immutable; **all six** before/after axis columns server-written from the first row — DC-22 |
| `command_idempotency` | PK `client_submission_id`; hash; state; stable response |
| `outbox_event` | Same commit as business event |
| `asset_relationship` | Kit open/close on checkout when roles present |

### Deferred to later WS-W2 slices (not required for checkout race)

Installations, calibration/document tables, reporting views, reservation, full reference stewardship
(feature 011), audit_event for non-transaction edits.

## Checkout field assumptions

| Field | Treatment |
|---|---|
| `expectedReturnDate` | Optional on command until Q8 closed — **`R4 APPROVED 2026-09-03`** |
| `effectiveAt` | Client may propose; server validates backdating policy — **`R4 APPROVED 2026-09-03`** (Q9). `recorded_at` always server now. |
| Before/after state on lines | **Server-owned**; browser values ignored or refused |

## Invariants the first-proof migrations + tests must enforce

1. One business command = one DB transaction (commit all or none).
2. Assets locked `ORDER BY asset.id` (UUID) before validation.
3. Same `client_submission_id` + same hash → original outcome; different hash → refuse.
4. Transaction lines: no UPDATE/DELETE for application roles.
5. Canonical `asset_id` unique and immutable; serial not unique.
6. `is_synthetic` / environment markers block production load paths.
7. Outbox row(s) present iff transaction accepted, same commit.
8. Every `asset_transaction_line` carries six state columns (`lifecycle_before/after`,
   `disposition_before/after`, `serviceability_before/after`) — **never two**. DC-22.
9. No table has a `status` column that anything writes. Any compatibility `status` is a generated column or a
   view over the three axes, by the precedence order in `contracts/transition-table.md` §7.1.
10. No `calibration_currency` column exists anywhere.

## Mapping to docs/15

Column-level definitions remain in `docs/15`. When R1/R3 are approved, migrations must match that
document or the document must be amended first (constitution: specifications win).

---

## The compatibility window — six state columns, not two

`docs/08-decisions.md:88` and `docs/15-postgres-data-model.md:62` permit the local mock and the `server/` POC to
keep a single `status` until HTTP cutover. `docs/19-state-model-decision.md` §8.3 identified the trap that
leaves open: **axes → pill is total and mechanical, but pill → axes is not recoverable per row** (`NeedsRepair`
does not say where the asset is; `InCalibration` does not say whether it is broken). Transaction lines are
append-only (`.specify/memory/constitution.md:30-35`, `server/src/db/schema.sql:127-139`), so **a line written
with two state columns can never be backfilled to six.** The values were never captured.

> **DEMO CALL 2026-09-03 (DC-22)** — **Option 1 of `docs/19` §8.3. The three axes are the stored truth from the
> first `server/` write against networked PostgreSQL; the single `status` survives only as a derived
> projection.**
>
> 1. `asset` carries `lifecycle`, `disposition`, `serviceability`. Any compatibility `status` is a **generated
>    column or a view**, computed by `contracts/transition-table.md` §7.1, and is **never written directly**.
> 2. `asset_transaction_line` carries **all six** axis columns (`docs/15:401-403`) from its first row.
> 3. `app/src/domain/deriveState.ts` is **extended, not forked** — `DerivedFields` returns three axes and the
>    mock projects down to a pill. `docs/19` §8.2: a legacy `deriveState` beside an axis-aware one creates two
>    definitions of one business rule and violates constitution Principle VI by construction.
> 4. `data/reference/state_machine.json` becomes a **generated projection** of `transition-table.md`, or is
>    deleted. Hand-maintaining it alongside the axis contract violates Principle VI the same way.
>
> **Why not Option 2** ("window lines are explicitly disposable POC data"): it is safe *only if stated*, and it
> cannot honestly be stated here, because `server/src/db/seed.ts` loads from `migration/staged/` — real
> migrated asset data. Declaring those lines disposable would be declaring real history disposable.
>
> **Cost, plainly.** Four columns on `asset_transaction_line` and one on `asset` land in WS-W2/W4 instead of at
> cutover — the same delta either way (`docs/19` §3.1), **pulled forward, not added**. The `deriveState` rewrite
> comes forward with it; it is the single highest-leverage seam (`docs/19` §3.4) and was going to happen
> regardless. The two committed line fixtures (`app/public/data/transactionlines.json`,
> `migration/staged/transactionlines.json`) need re-derivation — 3 of 7 statuses map mechanically per row, the
> other 4 by replay of the unbroken `statusbefore → statusafter` chain (`docs/19` §4.2); **lossy for none**. The
> ~26 source and 15 test files carrying a status literal come forward too.
>
> **What it buys:** no transaction line is ever written whose state cannot be recovered. That is the one cost in
> this whole decision that is genuinely irreversible, and it is the reason R1 was decided before the first
> production migration rather than after.
>
> **Reversal cost:** none meaningful — reverting to a stored single `status` once the axes exist is the
> mechanical direction.
>
> **Scope:** `server/**` is not this file's to edit. This is the contract the server must satisfy; the
> `schema.sql` / `transactionService.ts` / `seed.ts` changes belong to whoever owns `server/` this pass.
