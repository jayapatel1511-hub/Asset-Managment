# F5 — Reprocess unprocessed lines

**Trigger**: recurrence every 6 hours, plus a manual button for an admin.

**Inputs**: `eng_transactionline` where `eng_processed = false` and older than 15 minutes.

**Writes**: whatever F1 would have written for each line it reprocesses (see `solution/flows/F1`).

**Failure mode**: retries transient failures; posts a count to `AMS-Alerts` either way, so a
silently-growing backlog is visible even when every individual line eventually succeeds.

This flow exists because F1 is the only write path to derived state (constitution Principle I) —
if a line's derivation never runs, that asset's state is permanently one transaction behind, and
nothing else in the system will notice on its own (FR-045, FR-046). F5 is the guarantee that
"eventually" is bounded at 6 hours, not indefinite.

## Not built in this session

There is no mock-backend equivalent, and there doesn't need to be: `api/mock/store.ts`'s
`applyTransaction()` derives and writes synchronously in one call, so there is no "unprocessed"
state to sweep in this build (see `docs/09-build-report.md`). This flow only becomes meaningful
once F1 is a real, asynchronous Dataverse trigger.
