# Contract: Five-asset race (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: `specs/010-web-application-platform/contracts/transaction-command.md`,
`idempotency.md`, `error-codes.md`, `outbox-envelope.md` (consumes 010 contracts — do not redefine shapes here)  
**Workstream**: WS-W4 first proof; retest under WS-W12 after Azure Integrated  
**Spec mapping**: US1; FR-001–FR-012; SC-001, SC-002, SC-003, SC-005

## Purpose

Acceptance outcomes for the authoritative multi-asset command. This is **not** an API design document.
Request/response fields are owned by 010; this file states what a passing proof must observe.

## Preconditions

- Real PostgreSQL (not PGlite-only for lock/race claims)
- R1–R4 decided enough for checkout command; R2 contract frozen
- Caller context from 010 auth-session (test identity allowed for local proof)
- Health preflight green

## Scenarios

### S1 — Five valid assets commit completely (SC-001 happy path)

1. Submit one checkout (or equivalent) covering five available assets with one client submission ID.
2. **Pass**: exactly one transaction header; five immutable lines; five assets show server-derived disposition/custody consistent with the command; outbox row(s) committed in the same database transaction; Applied status.
3. **Fail**: any missing line, any asset unchanged while others changed, outbox without business commit, or commit without outbox when contract requires it.

### S2 — One invalid among five refuses all

1. Four valid + one illegal transition or missing required field.
2. **Pass**: structured refusal; **zero** headers, lines, derived-state writes, relationship writes, outbox rows for that submission.
3. **Fail**: any partial persist.

### S3 — Deliberate failure after partial work rolls back

1. Fault-inject after a material step (e.g. after Nth line write or before commit) per harness hooks.
2. **Pass**: database shows no header, lines, state, relationships or outbox from the attempt.
3. **Fail**: leftover rows or half-applied derived columns.

### S4 — Concurrent incompatible race (SC-002)

1. Two callers submit overlapping incompatible commands for at least one shared asset at the same time.
2. Repeat toward **100** runs.
3. **Pass**: exactly one success per race; loser receives structured conflict; winner’s five (or N) assets consistent; zero double-booking.
4. **Fail**: two Applied results for the same asset disposition claim, or silent overwrite.

### S5 — Lost-response retry (SC-003)

1. Accept a command; discard/omit response to client; retry **same** submission ID and **same** canonical request hash.
2. Repeat toward **100** runs.
3. **Pass**: original result returned; still exactly one business event.
4. **Fail**: second header/lines or changed side effects.

### S6 — Same ID, different payload (hash mismatch)

1. Reuse submission ID with altered body.
2. **Pass**: refused with stable idempotency/hash mismatch code from 010 `error-codes.md`; original event unchanged.
3. **Fail**: second interpretation applied or silent replace.

### S7 — Lock order / overlapping sets

1. Submit concurrent multi-asset commands with reversed asset UUID order and partial overlap.
2. **Pass**: no unsafe deadlock hang beyond harness timeout policy; arbitration deterministic; at most one Applied per contested asset fact.
3. **Fail**: permanent deadlock, or both commits on conflicting facts.

### S8 — Browser before/after ignored (SC-005)

1. Submit legal command including fabricated `statusBefore`, `statusAfter`, custodian, location or project “authoritative” fields if the transport allows extras.
2. **Pass**: server-computed snapshots persisted; client-supplied authoritative values do not alter result (ignored or rejected per 010 contract — either is fine if server truth wins).
3. **Fail**: fabricated after-state stored as truth.

### S9 — Correction is compensating

1. Apply a command; submit a correction referencing the original.
2. **Pass**: original header/lines immutable; new compensating event linked; derived state matches compensation rules.
3. **Fail**: in-place edit of accepted lines or deleted history.

## Batch targets

| Criterion | Target |
|---|---|
| SC-001 partial-event failures | 100 deliberate multi-asset failure tests, **zero** partials |
| SC-002 double-booking | 100 concurrent races, **exactly one** success each |
| SC-003 retries | 100 lost-response retries, **zero** duplicates |

## Evidence record (required)

| Field | Content |
|---|---|
| `contract` | `five-asset-race` |
| `environment` | local-postgres / Dev / UAT |
| `git_commit` / image / schema | immutable revision ids |
| `owner` | named person |
| `ran_at` | ISO date |
| `scenarios` | S1–S9 pass/fail + counts for batches |
| `artifacts` | CI log URLs or retained report paths |
| `result` | pass \| fail |
| `assumptions` | R1–R4 markers as applicable |

## Non-claims

- Passing against mock/`localStorage` does **not** satisfy this contract.
- UI cart validation alone does **not** satisfy this contract.
