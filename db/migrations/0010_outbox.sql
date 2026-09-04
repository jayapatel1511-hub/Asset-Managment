-- 0010 — outbox, worker leases, notification cadence and operational alerts.
--
-- FOLDED IN from `server/src/outbox/schema.ts`, which applied this DDL from an `onReady` hook in
-- `server/src/routes/documents.ts` while the database lane was rewriting `server/src/db/**`. That
-- was the right call at the time — two lanes editing one schema file is the collision
-- `specs/_planning/BUILD-FREEZE.md` exists to prevent — and it left one hazard behind:
-- `services/transactionService.ts` now writes an `outbox_event` row inside every accepted
-- command (CLAUDE.md rule 2), so the table had become a hard dependency of the atomic command
-- while still being created by a *route module's start-up hook*. Any path that opened the
-- database without building the Fastify app — a standalone worker, a job runner, the migration
-- CLI — would have had a command fail on a missing table.
--
-- The SQL below is `OUTBOX_SCHEMA_SQL` verbatim. Every statement was already written
-- `IF NOT EXISTS`, so this applies cleanly to a database the hook had already bootstrapped.
--
-- Deviations from `docs/15-postgres-data-model.md` § 11 are recorded in `docs/08-decisions.md`
-- (§ Outbox and documents lane calls): `dead_lettered_at` / `dead_letter_reason` / `locked_by` on
-- `outbox_event`, and the `outbox_delivery`, `notification_suppression` and `operational_alert`
-- tables.


CREATE TABLE IF NOT EXISTS outbox_event (
  id                bigserial PRIMARY KEY,
  event_id          text NOT NULL UNIQUE,
  event_type        text NOT NULL,
  aggregate_type    text NOT NULL,
  aggregate_id      text NOT NULL,
  payload           jsonb NOT NULL,
  available_at      timestamptz NOT NULL DEFAULT now(),
  attempt_count     integer NOT NULL DEFAULT 0,
  locked_at         timestamptz,
  locked_by         text,
  processed_at      timestamptz,
  dead_lettered_at  timestamptz,
  dead_letter_reason text,
  last_error        text,
  correlation_id    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The claim predicate, indexed. Partial on purpose: a processed or dead-lettered row is never
-- claimed again, so the index stays the size of the BACKLOG rather than of the history.
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox_event (available_at, id)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_aggregate_idx ON outbox_event (aggregate_type, aggregate_id);

-- Consumer-side idempotency. One row per (event, consumer): claimed BEFORE the side effect and
-- removed if the side effect fails, so a retry re-attempts but a second worker never re-sends.
-- See worker.ts § delivery claim.
CREATE TABLE IF NOT EXISTS outbox_delivery (
  event_id     text NOT NULL,
  consumer     text NOT NULL,
  outcome      text NOT NULL,           -- InProgress / Delivered
  detail       text,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (event_id, consumer)
);

-- Cadence state, so an overdue asset is reminded about on the approved interval rather than
-- once per worker tick (WS-W8 § notification suppression/cadence state).
CREATE TABLE IF NOT EXISTS notification_suppression (
  subject_key       text NOT NULL,
  notification_kind text NOT NULL,
  last_sent_at      timestamptz NOT NULL,
  next_eligible_at  timestamptz NOT NULL,
  send_count        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (subject_key, notification_kind)
);

-- The owned alert destination. Durable, because "we logged it" is not evidence that anyone was
-- told; "owner" is the named role or address from the R6 operations decision.
CREATE TABLE IF NOT EXISTS operational_alert (
  id              text PRIMARY KEY,
  alert_kind      text NOT NULL,
  severity        text NOT NULL,        -- Warning / Critical
  owner           text NOT NULL,
  summary         text NOT NULL,
  detail          jsonb,
  raised_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);
CREATE INDEX IF NOT EXISTS alert_open_idx ON operational_alert (alert_kind, raised_at)
  WHERE acknowledged_at IS NULL;
