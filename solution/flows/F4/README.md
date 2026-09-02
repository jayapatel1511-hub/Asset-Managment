# F4 — Overdue returns

**Trigger**: recurrence, daily 07:00 America/Toronto.

**Inputs**: `eng_transaction` (Checkout rows with an `eng_expectedreturn`), joined to
`eng_transactionline` / `eng_asset` to find ones still `CheckedOut`.

**Writes**: none to Dataverse — notifications only.

**Failure mode**: retries transient failures; posts to `AMS-Alerts` on terminal failure. A failed
run means a day's nudges don't go out; nothing about asset state depends on this flow running.

## Depends on Q8 (open)

`specs/clarifications.md` Q8 asks whether expected return should be required on checkout.
`app/src/features/checkout/CheckoutPage.tsx` implements the recommended answer — **optional**,
with a 14-day default *offered* rather than forced (matching the recommendation's own reasoning:
"a required field on the highest-frequency screen will be filled with whatever dismisses the
keyboard fastest"). The practical consequence for this flow, spelled out in `definition.json`'s
`// ASSUMPTION: Q8` note: it can only ever nudge about checkouts that recorded a date. If Jay
answers Q8 the other way (required), this flow's coverage becomes complete and the note can be
removed. Recorded in `docs/08-decisions.md`.
