# F1 — Derive asset state

**Trigger**: Dataverse row added, table `eng_transactionline`, scope Organization, concurrency 1
(sequential — see docs/03-automation.md and docs/01-data-model.md's indexing note).

**Inputs**: the new `eng_transactionline` row, its parent `eng_transaction`, and the `eng_asset`
it names.

**Writes**: `eng_asset.eng_status`, `eng_currentlocation`, `eng_custodian`, `eng_currentproject`,
`eng_parentasset`, `eng_lifecycle`, `eng_retirementreason` (Retire only); `eng_assetrelationship`
open/close; `eng_transactionline.eng_processed`.

**Failure mode**: retries transient failures (exponential ×4). On terminal failure, posts to
Teams `AMS-Alerts` and leaves `eng_processed = false` so F5 (`solution/flows/F5`) retries it on
its 6-hour sweep or a manual button push. Never fails silently, never leaves an asset half-updated
(the whole Dataverse update for one line is a single transaction at the platform level).

## Why this file exists as a README, not just a definition.json

Constitution Principle V: the transition matrix is enforced in the app **and** independently in
the automation, so the app is not a security boundary. Principle VI: that matrix is defined once,
as data, and consumed twice. This file is the second half of proving that: it maps each of F1's
steps onto the exact function in `app/src/domain/deriveState.ts` that does the same job in the
mock backend (which plays F1's role for local development, since there is no flow runtime to call
in this build — see `docs/09-build-report.md`, "What needs the tenant"). Anyone reviewing whether
the flow and the app can drift apart should be able to read this table and see they can't, because
they're generated from and written against the same source.

| F1 step | What it does | `deriveState.ts` equivalent |
|---|---|---|
| 1. Get line → transaction → asset | Reads the asset's current `eng_status` before writing anything | The caller builds an `AssetSnapshot` before calling `deriveState()` — deriveState itself never reads a store |
| 2. Look up transition | `transitions[asset.status][txn.type]` against `data/reference/state_machine.json` | `STATE_MACHINE[asset.status][line.type]` — `STATE_MACHINE` **is** `state_machine.json`, generated verbatim by `app/scripts/generate-state-machine.mjs` |
| 2a. On miss: reject | Sets `eng_processed=true`, notes `REJECTED: illegal transition`, alerts `AMS-Alerts`, asset unchanged | `if (!statusAfter) return { ok: false, reason: ... }` — same rule, same refusal, checked independently per Principle V |
| 3. Update `eng_asset` | Sets `eng_status` = the looked-up value, then custodian/location/project per transaction type (see table below) | `deriveFields()` — the `switch (line.type)` block, one case per transaction type |
| 4. Kit relationships | Opens a Kit relationship on Checkout/Deploy when a primary asset is named; closes this asset's own membership and everything it parents on Return/Undeploy/Retire/MarkMissing | `deriveRelationshipOps()` — returns the same three operation kinds (`open`, `closeAsChild`, `closeAllAsParent`) |
| 5. Mirror Component children | Copies the parent's new state onto every open Component child, with no line of their own | **Not** in `deriveState.ts` by design — it's a fan-out over the relationship table, not a single-asset derivation. Lives in `api/mock/store.ts`'s `mirrorComponentChildren()` instead; F1 does the same thing against Dataverse rows |
| 6. Mark processed | `eng_processed = true` | `MockStore.applyTransaction` sets `processed: true` on the line it pushes |

### Step 3's per-transaction-type field mapping

This is `deriveFields()`'s switch statement, transcribed so a flow author can build the Dataverse
`Update Row` action's field mappings directly from it without re-deriving the logic:

| Transaction type | `eng_custodian` | `eng_currentlocation` | `eng_currentproject` | other |
|---|---|---|---|---|
| Checkout | `txn.touser` | **null** (unknown — see note) | `txn.toproject` | |
| Deploy | `txn.touser` | `txn.tolocation` (the site) | `txn.toproject` | |
| Return / Undeploy | null | `txn.tolocation` ?? `asset.homeoffice` | null | |
| Transfer | whichever of custodian/location/project the transaction names; others untouched | | | status unchanged (matrix already enforces this) |
| SendToCalibration | null | `txn.tolocation` (the lab) | unchanged | |
| ReturnFromCalibration | unchanged | `asset.homeoffice` | unchanged | |
| Retire | null | null | null | `eng_lifecycle = Retired`, `eng_retirementreason` from the transaction |
| ReportFault / MarkMissing / RepairComplete / Found | unchanged | unchanged | unchanged | status only |
| Audit / AddToInventory | unchanged | unchanged | unchanged | status only (Audit never changes it; AddToInventory establishes day-one state at migration) |

**Checkout's location note**: the field is set to null, not the office, because the asset has
left — claiming it is still "at the office" once it is checked out is exactly the dishonesty
Principle I exists to remove (the same reasoning `migration/02_clean.py` uses for the 644
`Deployed or NOT Available` rows). A technician's current holdings are found by custodian, not by
location.

## Testing this flow for real

`tests/flows/f1_matrix_test.py` (referenced by `tests/README.md` and `docs/06-delivery-plan.md`
Step 3) is written against a live Dataverse connection and does not exist yet — there is no
tenant to run it against in this build. Its equivalent, run and passing today, is
`app/tests/domain/stateMachine.test.ts` (100 cases: every status × every transaction type,
allowed and disallowed) plus `app/tests/api/mockBackend.test.ts`'s transaction tests, which
exercise `MockStore.applyTransaction` — the same code path this README maps onto F1. When a
tenant exists, `tests/flows/f1_matrix_test.py` should insert one `eng_transactionline` per cell
directly via the Dataverse Web API (bypassing the app, per SC-005) and assert the resulting
`eng_asset` state matches `app/src/domain/stateMachine.ts` exactly — a direct, automatable check
that the two definitions have not drifted.
