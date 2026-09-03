-- Englobe AMS — local proof-of-concept schema (PGlite: real PostgreSQL, in-process).
--
-- Mirrors app/src/api/types.ts one for one so the existing React screens run unchanged: one
-- asset `status` (data/reference/state_machine.json), not the three-axis model proposed in
-- server/README.md § What this POC does not do — that split is a product decision still PROPOSED in
-- docs/08-decisions.md and is deliberately out of scope for the POC.
--
-- Dates are ISO-8601 text, exactly the strings the app already exchanges. The database does no
-- timezone arithmetic; display in America/Toronto stays a client concern (master CLAUDE.md rule).
--
-- Idempotent: every statement is CREATE ... IF NOT EXISTS / CREATE OR REPLACE, so it runs on
-- every start-up.

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
-- must return its original
-- outcome for as long as a device might replay it (Principle VIII).
CREATE TABLE IF NOT EXISTS command_idempotency (
  client_submission_id text PRIMARY KEY,
  request_hash         text NOT NULL,
  user_upn             text NOT NULL,
  command              text NOT NULL,
  response             jsonb NOT NULL,
  created_at           text NOT NULL
);
