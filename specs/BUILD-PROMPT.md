# Build prompt — WS-W1 foundation + first-proof schema on real PostgreSQL

Paste the block below into a fresh Claude Code session opened at the repository root, with
multi-agent orchestration enabled. It is written to be self-contained: the session it lands in will
not have the conversation that produced it.

**What this starts.** WS-W1 (Postgres transport, CI) and the **first-proof** slice of WS-W2/W4:
migrations from `specs/010-web-application-platform/data-model.md`, atomic checkout command per
frozen `contracts/transaction-command.md`, and the five-asset race from
`specs/009-production-readiness/contracts/five-asset-race.md`. Prefer the `large` synthetic profile
for scale once the race is green on a smaller fixture.

**What changed 2026-09-03.** R1–R4 are **closed** (Jay). You **may** write the first-proof schema
and command contracts into code. Full `docs/15` beyond the first-proof subset still needs
table-by-table review before claiming complete WS-W2.

---

```text
You are starting the build for Englobe AMS. Read CLAUDE.md, specs/README.md and
specs/REMAINING-WORK.md before doing anything — REMAINING-WORK.md § "Readiness" is the
triage this prompt implements. Execute from specs/010-web-application-platform/tasks.md
(foundational → WS-W2 subset → WS-W4) and prove with specs/009-production-readiness/contracts/.

## Decisions already made — do not re-open

- **R1 APPROVED**: lifecycle / disposition / serviceability / derived calibration currency
  (`docs/15` §3, `docs/08-decisions.md`).
- **R2 FROZEN** for first proof: `specs/010-web-application-platform/contracts/transaction-command.md`
  (+ auth-caller-context, error-codes, outbox-envelope).
- **R3**: first-proof tables in `specs/010-web-application-platform/data-model.md` may be migrated.
- **R4**: Q8 optional expected return (+14d prefills); Q9 admin backdate ≤30d, refuse crossing history.
- Power Platform and Zite are PARKED — not implementation routes.

## Still open — do not invent

- **R5** global vs office-scoped admin (use a test-double / feature flag for the race).
- **R6** Azure enterprise set (does not block local proof).
- Q18 permanent-component calibration; full docs/15+16 table review; Data Steward role.

## Verified starting state — do not re-derive

- Branch master. app tests green; server POC (PGlite) green. `npm ci` works in app/ and server/.
- Docker/Colima available on the Mac path; start Colima if needed; no Postgres container may exist yet.
- server/ POC still uses single `status` — production path uses four-axis columns. Do not treat
  schema.sql as the target schema of record.
- Parked tracks: app/src/api/dataverse/, solution/, docs/01,02,03,05,10 (LEGACY-POWER-PLATFORM);
  zite/, specs/ZITE-BUILD-PROMPT.md.

## The claim to prove first

1. A real PostgreSQL container runs the AMS command path (not only PGlite).
2. Five-asset checkout: all commit / all refuse / rollback / race / idempotent retry /
   hash mismatch refuse / deterministic lock order / browser before-after ignored —
   per specs/009-production-readiness/contracts/five-asset-race.md.

## Agents (exclusive file ownership)

### Agent 1 — PostgreSQL transport (SERIAL, FIRST)

Owns: docker-compose.yml (repo root), server DB connection layer swap off PGlite,
server/.env.example, README concurrency notes.

### Agent 2 — CI skeleton (PARALLEL)

Owns: .github/workflows/* for app + server test on push. No cloud secrets.

### Agent 3 — First-proof migrations (AFTER Agent 1)

Owns: db/migrations/ for tables in 010/data-model.md only; migration runner wiring.
Four-axis columns on asset. No docs/16 tables yet unless required by the race.

### Agent 4 — Shared contracts package (PARALLEL with 3 after R2 freeze — already frozen)

Owns: packages/contracts/ TypeScript types generated/copied from
specs/010-web-application-platform/contracts/*.md.

### Agent 5 — Atomic checkout + race harness (AFTER 1, 3, 4)

Owns: server transaction module implementing Checkout for the race; tests under
server/tests or agreed path matching 009 five-asset-race + registration-concurrency contracts.
Do not build unrelated screens.

## Done when

- docker compose up postgres works from a clean checkout
- first-proof migrations apply twice with empty second diff
- five-asset race scenarios pass on networked Postgres
- CI runs the existing app tests (and new server integration tests) on push
- docs/08-decisions.md updated only if an implementation deviation is required
```
