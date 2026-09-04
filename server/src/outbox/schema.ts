/**
 * Outbox and worker DDL, applied idempotently from this module rather than from
 * `server/src/db/schema.sql`.
 *
 * WHY IT LIVES HERE. `server/src/db/**` belongs to the database lane, which is converting
 * `schema.sql` into `db/migrations/**` with a runner while this lane is being written
 * (specs/_planning/BUILD-FREEZE.md § File ownership). Two lanes editing the same schema file at
 * the same time is exactly the collision that document exists to prevent. So the DDL is kept
 * here, written to the same rule the POC schema follows — every statement is
 * `CREATE … IF NOT EXISTS`, so applying it on every start-up changes nothing — and
 * `ensureOutboxSchema` is called from this lane's own composition point
 * (`routes/documents.ts`'s `onReady` hook) and from its tests.
 *
 * INTEGRATION NOTE: fold these statements into the migration set once the database lane lands
 * `db/migrations/**`, and delete the bootstrap call. Nothing else has to move — the tables and
 * their names are exactly `docs/15-postgres-data-model.md` § 11's.
 *
 * DEVIATIONS from the § 11 catalogue, recorded rather than silently taken (needs a line in
 * `docs/08-decisions.md`, which is the integrator's file):
 *
 *   1. `outbox_event.dead_lettered_at` / `dead_letter_reason` — § 11 has no dead-letter column;
 *      it has `attempt_count`, so "dead" would have to be DERIVED as
 *      `attempt_count >= <the constant the worker happens to be running with>`. That makes a
 *      permanent operational fact depend on a runtime setting: lower the bound and live rows
 *      silently die, raise it and dead rows silently resurrect. WS-W8's definition of done asks
 *      for "a dead-letter state", and a state that a config change can rewrite is not one.
 *   2. `outbox_event.locked_by` — § 11 has `locked_at` alone, which answers "is this leased" but
 *      not "by whom", and the latter is what an operator needs when a lease is stuck.
 *   3. `outbox_delivery` — the consumer-side idempotency store the contract's § Worker claim
 *      semantics item 2 requires ("process idempotently keyed by eventId"). At-least-once
 *      delivery without a consumer dedup record is an explicit non-goal of that contract.
 *   4. `notification_suppression` — WS-W8 § owns "notification suppression/cadence state".
 *   5. `operational_alert` — WS-W8's definition of done requires reaching "an owned alert
 *      destination"; a log line is not a destination anyone can be shown to have owned.
 *
 * TYPES. `timestamptz` here, not the ISO `text` the POC schema uses for business dates. That is
 * deliberate and matches § 11 exactly: these are machine timestamps, and `available_at <= now()`
 * plus lease expiry are real time arithmetic, not string comparison. Business-effective dates
 * stay text everywhere else in this schema, unchanged.
 */
import type { Tx } from "../db/database";

export const OUTBOX_SCHEMA_SQL = `
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
`;

/**
 * Applies the outbox DDL. Idempotent, so it is safe on every start-up and in every test's
 * `beforeAll`; concurrent first-run callers are tolerated because PostgreSQL's own
 * `IF NOT EXISTS` race surfaces as a duplicate-object error that means the table now exists.
 */
export async function ensureOutboxSchema(db: Tx): Promise<void> {
  try {
    // `exec`, not `query`: this is a multi-statement script, and the PGlite driver's `query`
    // uses the extended protocol, which accepts exactly one statement. `exec` is the seam both
    // drivers expose for scripts — it is how db/postgres.ts applies schema.sql.
    await db.exec(OUTBOX_SCHEMA_SQL);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

/** SQLSTATE 42P07 (duplicate table) / 42710 (duplicate object) — two callers applied the same
 * `IF NOT EXISTS` DDL at once and both won. */
function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P07" || e?.code === "42710" || /already exists/i.test(e?.message ?? "");
}
