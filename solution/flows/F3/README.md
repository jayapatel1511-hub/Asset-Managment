# F3 — Calibration reminders

**Trigger**: recurrence, daily 06:00 America/Toronto.

**Inputs**: `eng_location` (offices, queried fresh every run — FR-027), `eng_asset` (nextcaldue),
office-to-admin assignment (maintained in-app by the System Owner, not a file).

**Writes**: none to Dataverse — this flow only sends notifications (Teams + email).

**Failure mode**: retries transient failures; posts to `AMS-Alerts` on terminal failure. A failed
run means administrators simply don't get that day's summary — feature 004's due list (US1) is
still correct and queryable on demand in the app, so this flow's failure degrades gracefully
rather than hiding information (FR-032: "notification can be disabled without affecting US1").

## Not built in this session

This flow needs two things this session did not build, both flagged here rather than silently
assumed:

1. **Office → administrator assignment.** Feature 004's own assumption section calls for this to
   be "maintained by the System Owner in the app," but no admin screen for it exists yet in
   `app/src/features/`. Until it does, F3 cannot actually resolve step 2's "look up the office's
   administrator" — this is real, scoped-out work, not a flow-authoring detail. See
   `docs/09-build-report.md`.
2. **Reminder cadence.** `specs/clarifications.md` lists this as an open, unnumbered question
   ("daily until actioned, weekly, or once per threshold?"). `// ASSUMPTION: cadence` in
   `definition.json` assumes once per threshold crossing (due→overdue, or first time due within
   the horizon) until the calibration is recorded — the least noisy option, matching the brief's
   own worry ("the first thing that should be switched off if it becomes noisy"). Recorded in
   `docs/08-decisions.md`, pending Jay's confirmation.
