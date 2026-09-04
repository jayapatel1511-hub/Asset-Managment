-- 0001 — initial schema (the frozen baseline).
--
-- This file IS the former `server/src/db/schema.sql`, moved here unchanged from
-- `CREATE TABLE IF NOT EXISTS meta` onward. It is migration 0001 rather than a rewrite because
-- databases already carry exactly these objects: the local `ams` container, every developer's
-- PGlite directory under `server/data/`, and the staged-data load the 98 existing tests run
-- against. A baseline that differed from what those databases hold would have to be reconciled
-- by hand on first run; a baseline that is byte-identical does not.
--
-- Two consequences follow, and both are deliberate:
--
--   1. Every statement here stays idempotent (CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
--      DROP TRIGGER IF EXISTS). That is what lets 0001 be applied to an already-populated
--      database as a no-op and have the ledger simply record it. Migrations 0002 onward are
--      written the same way for the same reason, not because the runner re-applies them — it
--      does not; `schema_migration` records each version once and refuses a changed checksum.
--   2. This file is now IMMUTABLE. Editing it changes its checksum and the runner refuses to
--      start (`server/src/db/migrate.ts`). Schema change is a NEW numbered file, forward-only,
--      which is what CLAUDE.md's "database migrations are forward-safe" asks for.
--
-- The original header is preserved below, because its reasoning about the compatibility status
-- column is still the reasoning that governs. Read `db/migrations/0008_state_axes.sql` next: it
-- is where the approved four-axis model (docs/15 § 3) is derived from the columns below without
-- rewriting them, per assumption A-STATE in specs/_planning/BUILD-FREEZE.md.
--
-- ---------------------------------------------------------------------------------------------
-- Englobe AMS — local proof-of-concept schema. Runs on both drivers: networked PostgreSQL
-- (docker-compose.yml, the default) and in-process PGlite. Verified unchanged on PostgreSQL
-- 17.11 on 2026-09-03 — see server/README.md § Swapping in networked PostgreSQL.
--
-- Mirrors app/src/api/types.ts one for one so the existing React screens run unchanged: one
-- asset `status` (data/reference/state_machine.json), not the multi-axis model.
--
-- THIS IS A COMPATIBILITY SCHEMA, NOT AN UP-TO-DATE ONE. When this header was written the
-- axis split was still PROPOSED; it is not. R1 was approved on 2026-09-03 (docs/08-decisions.md):
-- canonical asset state is `lifecycle` + `disposition` + `serviceability` stored, plus calibration
-- currency DERIVED — four named axes, three columns. The same decision says the single `status`
-- column "remains only in the local mock/`server/` POC until HTTP cutover", which is why this file
-- still has one. Do not read this schema as the canonical model; the canonical model is
-- docs/15-postgres-data-model.md plus specs/010-web-application-platform/data-model.md, and the
-- consequences of the gap are analysed in docs/19-state-model-decision.md.
--
-- One trap that analysis names and this file cannot fix on its own: axes -> status is total, but
-- status -> axes is NOT recoverable per row. Every transaction line written here carries two state
-- columns; canonical lines carry six. Lines written during the compatibility window cannot be
-- backfilled (docs/19 § 8.3).
--
-- Dates are ISO-8601 text, exactly the strings the app already exchanges. The database does no
-- timezone arithmetic; display in America/Toronto stays a client concern (master CLAUDE.md rule).

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- ---------------------------------------------------------------- reference data (Principle IV)

CREATE TABLE IF NOT EXISTS location (
  id             text PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  locationtype   text NOT NULL,          -- Region / Office / Site / Vehicle / CalLab / Client / Storage
  parentlocation text,                   -- location NAME, matching data/reference/locations.csv
  isactive       boolean NOT NULL DEFAULT true,
  note           text
);

CREATE TABLE IF NOT EXISTS equipment_model (
  manufacturer             text NOT NULL,
  model                    text NOT NULL,
  equipmenttype            text NOT NULL,
  assetgroup               text NOT NULL,
  idprefix                 text NOT NULL,
  isserialised             boolean NOT NULL,
  identifiertype           text NOT NULL,  -- Serial / ICCID / IMEI / None
  defaultcalintervalmonths integer,        -- null = calibration not tracked for this model
  name                     text,
  PRIMARY KEY (manufacturer, model, equipmenttype)   -- docs/08: three-part catalogue key
);

CREATE TABLE IF NOT EXISTS project (
  id            text PRIMARY KEY,
  projectnumber text NOT NULL UNIQUE,
  name          text NOT NULL,
  status        text NOT NULL,           -- Active / Closed
  office        text,
  pm            text
);

-- ---------------------------------------------------------------- assets (Principle I, III)

CREATE TABLE IF NOT EXISTS asset (
  id               text PRIMARY KEY,     -- opaque key; the tag is not the key (Principle III)
  assetid          text NOT NULL UNIQUE, -- the human-readable, immutable tag
  migrationsource  text,
  manufacturer     text NOT NULL,
  model            text NOT NULL,
  equipmenttype    text NOT NULL,
  serialnumber     text,                 -- deliberately NOT unique: 132 shared serials
  homeoffice       text,
  lifecycle        text NOT NULL,        -- Active / Retired
  status           text NOT NULL,        -- derived; written only by the transaction service
  currentlocation  text,                 -- derived
  custodian        text,                 -- derived
  currentproject   text,                 -- derived
  parentasset      text,                 -- derived mirror of the open Kit/Component relationship
  lastcaldate      text,                 -- derived from calibration records
  nextcaldue       text,                 -- derived from calibration records
  retirementreason text,
  notes            text,
  carrier          text,
  identifiervalue  text,                 -- ICCID — sensitive, Office Admin and above
  phonenumber      text,                 -- sensitive
  staticip         text,                 -- sensitive
  row_version      integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS asset_status_idx    ON asset (status);
CREATE INDEX IF NOT EXISTS asset_custodian_idx ON asset (custodian);
CREATE INDEX IF NOT EXISTS asset_project_idx   ON asset (currentproject);
CREATE INDEX IF NOT EXISTS asset_serial_idx    ON asset (serialnumber);

-- ---------------------------------------------------------------- immutable history (Principle II)

CREATE SEQUENCE IF NOT EXISTS transaction_name_seq;

CREATE TABLE IF NOT EXISTS asset_transaction (
  id                   text PRIMARY KEY,
  name                 text NOT NULL UNIQUE,   -- TXN-000123
  transactiontype      text NOT NULL,
  transactiondate      text NOT NULL,          -- business-effective time (ISO)
  performedby          text NOT NULL,          -- UPN resolved from the authenticated session
  fromlocation         text,
  tolocation           text,
  fromuser             text,
  touser               text,
  fromproject          text,
  toproject            text,
  primaryasset         text,
  notes                text,
  expectedreturn       text,
  client_submission_id text,                   -- the command that produced this header (traceability)
  recorded_at          text NOT NULL           -- server acceptance time (ISO)
);

CREATE TABLE IF NOT EXISTS asset_transaction_line (
  id             text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES asset_transaction (id),
  asset          text NOT NULL,                -- assetid (the tag), as the app's HistoryEntry expects
  statusbefore   text NOT NULL,
  statusafter    text NOT NULL,
  kitrole        text,
  orientation    text,
  powersource    text,
  condition      text,
  processed      boolean NOT NULL DEFAULT true,
  notes          text,
  line_number    integer NOT NULL,
  UNIQUE (transaction_id, line_number)
);
CREATE INDEX IF NOT EXISTS line_asset_idx ON asset_transaction_line (asset);
CREATE INDEX IF NOT EXISTS line_txn_idx   ON asset_transaction_line (transaction_id);

-- Principle II at the database layer: history is append-only. TRUNCATE (used only by the seed
-- loader when a dataset is replaced wholesale) does not fire row triggers.
CREATE OR REPLACE FUNCTION refuse_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transaction history is append-only (constitution Principle II): % on %', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS line_immutable ON asset_transaction_line;
CREATE TRIGGER line_immutable BEFORE UPDATE OR DELETE ON asset_transaction_line
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

DROP TRIGGER IF EXISTS header_immutable ON asset_transaction;
CREATE TRIGGER header_immutable BEFORE UPDATE OR DELETE ON asset_transaction
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

-- ---------------------------------------------------------------- relationships, calibration

CREATE TABLE IF NOT EXISTS asset_relationship (
  id               text PRIMARY KEY,
  parentasset      text NOT NULL,
  childasset       text NOT NULL,
  relationshiptype text NOT NULL,        -- Component (permanent) / Kit (per checkout/deployment)
  start_at         text NOT NULL,
  end_at           text,                 -- null = open
  createdbyline    text,
  closedbyline     text
);
CREATE INDEX IF NOT EXISTS rel_child_idx  ON asset_relationship (childasset);
CREATE INDEX IF NOT EXISTS rel_parent_idx ON asset_relationship (parentasset);
-- one open parent per child, enforced as a partial unique index. transactionService.ts's
-- relationship "open" op closes a previous membership rather than colliding with this
-- (server/README.md § Two deliberate divergences from the mock).
CREATE UNIQUE INDEX IF NOT EXISTS rel_one_open_parent ON asset_relationship (childasset) WHERE end_at IS NULL;

CREATE TABLE IF NOT EXISTS calibration_record (
  id                text PRIMARY KEY,
  asset             text NOT NULL,
  calibrationdate   text,                -- null only for legacy due-date-only evidence (docs/13)
  nextduedate       text NOT NULL,
  lab               text,
  certificatenumber text,
  certificateurl    text,
  cost              text,
  result            text,                -- Pass / Fail / Adjusted
  corrected_by      text,
  corrected_at      text
);
CREATE INDEX IF NOT EXISTS cal_asset_idx ON calibration_record (asset);

CREATE TABLE IF NOT EXISTS id_sequence (
  prefix    text PRIMARY KEY,
  nextvalue integer NOT NULL
);

-- ---------------------------------------------------------------- installations (feature 005)

CREATE TABLE IF NOT EXISTS installation (
  id                  text PRIMARY KEY,
  site                text NOT NULL,     -- location NAME, locationtype Site
  project             text NOT NULL,     -- project number
  primaryasset        text NOT NULL,
  locationtype        text NOT NULL,
  sitename            text NOT NULL,
  position            text,
  latitude            double precision,
  longitude           double precision,
  coordinatesource    text,
  powersource         text NOT NULL,
  start_at            text NOT NULL,
  end_at              text,
  openedbytransaction text NOT NULL,
  closedbytransaction text,
  notes               text
);
CREATE INDEX IF NOT EXISTS inst_site_idx ON installation (site);

CREATE TABLE IF NOT EXISTS installation_component (
  id           text PRIMARY KEY,
  installation text NOT NULL REFERENCES installation (id),
  asset        text NOT NULL,
  kitrole      text NOT NULL,
  orientation  text,
  start_at     text NOT NULL,
  end_at       text,
  openedbyline text,
  closedbyline text
);
CREATE INDEX IF NOT EXISTS instcomp_inst_idx  ON installation_component (installation);
CREATE INDEX IF NOT EXISTS instcomp_asset_idx ON installation_component (asset);

-- ---------------------------------------------------------------- admin, idempotency

CREATE TABLE IF NOT EXISTS office_admin_assignment (
  office     text PRIMARY KEY,
  admin_upns jsonb NOT NULL
);

-- One store for command idempotency, rather than the drift-prone two-table variant an earlier
-- draft proposed (server/README.md § Idempotency). Rows are never expired: an accepted command
-- must return its original outcome for as long as a device might replay it (Principle VIII).
--
-- The PRIMARY KEY is the concurrency control, not just a uniqueness constraint. runCommand
-- INSERTs this row FIRST, before it touches an asset; a second copy of the same submission
-- blocks on the key until the first commits or rolls back. That is what makes a simultaneous
-- duplicate return the original answer instead of running the command twice.
CREATE TABLE IF NOT EXISTS command_idempotency (
  client_submission_id text PRIMARY KEY,
  request_hash         text NOT NULL,
  user_upn             text NOT NULL,
  command              text NOT NULL,
  response             jsonb,               -- NULL only between the claim and the outcome, and
                                            -- never visible to another session: the row is
                                            -- uncommitted for that whole window.
  created_at           text NOT NULL
);
-- The column was NOT NULL when the claim was written at the END of the transaction rather than
-- the start (finding WS-W4-F2). CREATE TABLE IF NOT EXISTS will not alter an existing table, and
-- this schema is applied on every start-up, so the change is expressed as an idempotent ALTER —
-- a no-op once the column is already nullable.
ALTER TABLE command_idempotency ALTER COLUMN response DROP NOT NULL;
