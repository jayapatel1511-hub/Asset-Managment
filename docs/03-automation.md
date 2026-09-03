# 03 — Automation (Power Automate, solution-aware, runs as svc-ams)

Seven flows. Each lives in `solution/flows/<name>/` with `definition.json` + `README.md`.
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
2b. **Reservation guard** *(added 2026-09-03)*. If `txn.type = Checkout` and a `eng_reservation` exists for
   this asset with `status = Confirmed`, `requestedby ≠ txn.touser`, and `[starttime, endtime)` overlapping now →
   reject exactly as step 2 does ("REJECTED: reserved by {name} until {endtime}"), **stop**. This is the server
   half of CLAUDE.md rule 5 for bookings; the app refuses it first, and F1 is what makes the refusal true.
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

## F6 — Reservation conflict guard *(added 2026-09-03)*

**Trigger:** Dataverse — row added or `eng_status` changed, table `eng_reservation`, scope Organization.
**Concurrency:** 1 (sequential) — this flow is the arbiter and cannot be allowed to race with itself.

Dataverse has no exclusion constraint, so uniqueness of a time window is *this flow's* job, not the schema's:

1. Only act when `status = Confirmed`. Requested / Cancelled / Fulfilled / Expired → stop.
2. Query other `eng_reservation` rows: same `eng_asset`, `status = Confirmed`, different row id, and
   `starttime < this.endtime AND endtime > this.starttime`.
3. If any exist, the **earliest `createdon` wins**. Set this row `status = Cancelled`,
   `cancelreason = "Conflicts with {RSV-nnnnnn}"`, and notify `requestedby` with the winning booking's holder.
4. Validate `endtime > starttime` and `eng_asset`'s model `eng_isreservable = Yes`; cancel with a reason if not.

**Failure mode:** if F6 is down, two overlapping Confirmed rows can coexist until it runs. That is why the app
re-checks on submit *and* why the checkout guard (F1 step 2b) is written against the reservation rows rather
than against a "reserved" flag — two conflicting bookings still cannot both produce a checkout.

## F7 — Reservation fulfilment and expiry *(added 2026-09-03)*

**Trigger:** two — (a) row added, `eng_transaction`, and (b) recurrence, daily 06:15 America/Toronto.

- **(a) Fulfilment.** Checkout transaction → for each line's asset, find a Confirmed reservation held by
  `txn.touser` overlapping now → set `status = Fulfilled`, `eng_fulfilledby = txn`. Kept out of F1 so the
  state-derivation flow stays single-purpose.
- **(b) Expiry.** Confirmed reservations whose `endtime` has passed with no `eng_fulfilledby` → `status = Expired`,
  and report the count to `AMS-Alerts`. A pattern of expiries is a no-show problem worth seeing.
- **(b) Reminder.** Confirmed reservations starting in the next 24 h → Teams DM to `requestedby`.

Open: whether an expired no-show should notify anyone beyond the office admin, and who may override a
booking — `docs/07-open-questions.md` Q20.

## Not a flow

Asset ID minting happens in the app (needs immediate feedback). The `eng_idsequence` increment uses an
optimistic-concurrency update (`If-Match` etag); on conflict, re-read and retry up to 3×.
