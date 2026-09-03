# 03 — Automation (Power Automate, solution-aware, runs as svc-ams)

Five flows. Each lives in `solution/flows/<name>/` with `definition.json` + `README.md`.
All flows: retry policy exponential ×4; on terminal failure, post to Teams channel `AMS-Alerts` and leave
`eng_processed = false` so `F5` can retry.

## F1 — Derive asset state (the important one)

**Trigger:** Dataverse — row added, table `eng_transactionline`, scope Organization.
**Concurrency:** 1 (sequential). Lines within one Transaction must be processed in order and two flows must
not race on the same asset.

Steps:
1. Get line → transaction → asset (current status).
2. Look up transition matrix (Compose from `domain/stateMachine.json`). If `(asset.status, txn.type)` is not
   allowed → set line.eng_processed = true, line.eng_notes += "REJECTED: illegal transition", post to `AMS-Alerts`
   with asset id + submitter, **stop**. (App should have prevented this; if it happens, it is a bug or a race.)
3. Update `eng_asset`:
   - status = line.statusafter
   - Checkout / Deploy: custodian = txn.touser, currentproject = txn.toproject, currentlocation = txn.tolocation ?? (Deploy: site)
   - Return: custodian = null, currentproject = null, currentlocation = txn.tolocation ?? asset.homeoffice
   - Undeploy: custodian = txn.touser (the recovering user), currentlocation = null — the component is in someone's
     custody, so its location is unknown until a later Return, exactly as for Checkout. *(Corrected 2026-09-02 per
     feature 005 FR-013 and `docs/08-decisions.md`; `domain/deriveState.ts` already does this and F1 must match it.)*
   - Transfer: any of the three that are non-null on the txn
   - SendToCalibration: currentlocation = txn.tolocation (CalLab), custodian = null
   - ReturnFromCalibration: currentlocation = asset.homeoffice
   - Retire: lifecycle = Retired, custodian/project/location cleared, retirementreason from txn.notes choice
4. Kit relationships:
   - If txn.primaryasset is set and line.asset ≠ primary and type ∈ {Checkout, Deploy}: create `eng_assetrelationship`
     (parent = primary, child = line.asset, type Kit, start = txn.date, createdbyline = line). Set child.parentasset = primary.
   - If type ∈ {Return, Undeploy, Retire, MarkMissing}: close all open relationships where child = line.asset
     (end = txn.date, closedbyline = line); if line.asset is a parent, close all open Kit rows where parent = line.asset
     and clear `parentasset` on each child.
5. Component children (type Component, open) of an asset follow their parent automatically: for each, update
   status/location/custodian identically. **Do not** create a line for them (they were not transacted); the parent's
   line is their history.
6. line.eng_processed = true.

## F2 — Calibration recorded

**Trigger:** row added, `eng_calibrationrecord`.
Update asset: lastcaldate, nextcaldue. If asset.status = InCalibration, create a ReturnFromCalibration
transaction + line (performedby = record creator) so F1 moves it to Available. Never set status directly.

## F3 — Calibration reminders

**Trigger:** recurrence, daily 06:00 America/Toronto.
Query Active assets where nextcaldue ≤ today+30 grouped by homeoffice. One Teams adaptive card + one email
per office admin. The office→administrator assignment is **derived from the location table at run time** (feature 004
FR-027/FR-027a; WS-D's `OfficeAdminAssignment` in the app, a table or multi-select column in Dataverse pending Jay —
`docs/08-decisions.md`), so a newly added office is covered without configuration and an office with no administrator
is reported as a gap, not skipped. `data/reference/office_admins.csv` is superseded — do not read it. Delivery is
best-effort (004 FR-032a): a Teams or email failure is logged and never fails the run.
Flag ≤ 0 days as OVERDUE. Suppress if nothing due.

## F4 — Overdue returns

**Trigger:** recurrence, daily 07:00.
Checkout transactions with expectedreturn < today whose lines' assets are still CheckedOut → Teams DM to custodian
with a deep link to the Return screen. Weekly summary to office admin. Snooze via reply not required in Phase 1.

## F5 — Reprocess unprocessed lines

**Trigger:** manual (button) + recurrence every 6 h.
Lines where processed = false and createdon < now-15 min, ordered by createdon → call F1 logic (child flow).
Report count to `AMS-Alerts`.

## Not a flow

Asset ID minting happens in the app (needs immediate feedback). The `eng_idsequence` increment uses an
optimistic-concurrency update (`If-Match` etag); on conflict, re-read and retry up to 3×.
