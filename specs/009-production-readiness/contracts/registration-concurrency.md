# Contract: Registration concurrency (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: `specs/010-web-application-platform/contracts/transaction-command.md` (registration command),
`idempotency.md`, `auth-session.md`, `error-codes.md` (consumes 010 contracts)  
**Workstream**: WS-W4 registration proof  
**Spec mapping**: US2; FR-016–FR-018; SC-004, SC-007

## Purpose

Prove canonical Asset ID allocation is server-side, atomic with asset commit, safe under concurrency, and
that temporary/legacy tags remain aliases. Not an API schema — shapes come from 010.

## Preconditions

- Real PostgreSQL
- Registration command frozen in 010
- Single ID prefix under test
- No browser path to `id_sequence` (or equivalent) with elevated credentials

## Scenarios

### R1 — 100 concurrent registrations (SC-004)

1. Start **100** concurrent registration commands under one prefix, each with a unique submission ID.
2. **Pass**: 100 successful commits; **100 unique** canonical Asset IDs; no gaps required beyond policy, but **no duplicates**; each ID returned only after commit.
3. **Fail**: duplicate canonical IDs, client-visible “reserved” ID that another caller also received, or sequence advanced without asset row.

### R2 — Client cannot select or reserve sequence

1. Attempt registration with a client-chosen canonical ID or direct sequence update using any credential available to the browser/app client.
2. **Pass**: refused or ignored; only server allocation inside the registration command succeeds.
3. **Fail**: client-supplied canonical ID persisted, or sequence table writable from client-facing credentials.

### R3 — Temporary tag becomes searchable alias (SC-007)

1. Register or complete a `TMP-*` (or equivalent) to a canonical Asset ID.
2. **Pass**: canonical ID immutable; temporary value retained as searchable alias; both resolve to the same asset UUID.
3. **Fail**: temporary value overwritten/destroyed with no alias, or canonical ID changed.

### R4 — Canonical Asset ID immutable for every role

1. As Field User, Admin, Manager and Owner test identities, attempt to PATCH/change canonical Asset ID.
2. **Pass**: all refused server-side.
3. **Fail**: any role mutates the canonical tag.

### R5 — Serial searchable and non-unique

1. Register two assets sharing one serial (instrument + sensor pattern).
2. **Pass**: both commit; search by serial returns both; no uniqueness violation on serial.
3. **Fail**: second registration refused solely for shared serial, or silent merge.

## Evidence record (required)

| Field | Content |
|---|---|
| `contract` | `registration-concurrency` |
| `environment` | local-postgres / Dev / UAT |
| `prefix` | ID prefix under test |
| `concurrent_count` | 100 (or recorded actual) |
| `unique_ids_committed` | count |
| `owner` / `ran_at` / `artifacts` / `result` | as in five-asset-race evidence |
| `assumptions` | any open product decisions |

## Non-claims

- Preview/next-ID UI display is not a reservation.
- Mock local ID minting does not satisfy SC-004.
