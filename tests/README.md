# tests

## What actually runs today

`app/tests/` — vitest, run via `cd app && npm test`. 163 tests, all passing as of this build:

- `domain/stateMachine.test.ts` — every cell of the transition matrix in
  `data/reference/state_machine.json`, allowed and disallowed (100 cases: 7 statuses × 14
  transaction types), generated from the matrix itself so it can't go stale.
- `domain/assetId.test.ts` — mint/parse round trips, the shared-serial case, the no-serial
  (sequence) case, the embedded-manufacturer-code stripping bug and its regression test.
- `domain/deriveState.test.ts` — field-by-field derivation per transaction type, kit relationship
  open/close, the Retired-is-terminal rule.
- `api/mockBackend.test.ts` — checkout/return/transfer/calibration/registration/retirement against
  `MockAmsBackend`, including atomicity, idempotency, field security (FR-030), permanent
  Components (FR-026/FR-032), and the inactive-project refusal (FR-027).

Run: `cd app && npm test`. Type-check: `cd app && npx tsc -b`. Production build (also
type-checks): `cd app && npm run build`.

## What does not exist yet, and why

`tests/flows/f1_matrix_test.py`, mentioned in `docs/06-delivery-plan.md` Step 3, needs a live
Dataverse connection to insert `eng_transactionline` rows directly via the Web API and assert the
resulting `eng_asset` state — there is no tenant in this build to run it against (see
`docs/09-build-report.md`, "What needs the tenant"). Its job is done today by
`app/tests/domain/stateMachine.test.ts` plus `app/tests/api/mockBackend.test.ts`'s transaction
suite, which exercise the identical logic (`app/src/domain/deriveState.ts`) that
`solution/flows/F1` is specified against — see `solution/flows/F1/README.md`'s step-by-step
mapping for exactly how the two agree. When a tenant exists, write the real Python test against
that same matrix and both should agree by construction, not by re-deriving the rule.

Test Engine plans (one per screen, Power Apps' own UI test format) also don't exist — they need a
published Code App to record against, which needs `pac code push`, which needs the tenant.
`app/src/features/**` was instead verified by driving the running dev server directly (search,
asset detail, checkout, return, calibration recording, registration, retirement — all exercised
against real migrated data; see `docs/09-build-report.md` for the transcript).
