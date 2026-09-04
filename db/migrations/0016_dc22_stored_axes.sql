-- 0016 — DC-22: three stored axes are the truth; compatibility `status` is generated.
--
-- Jay, 2026-09-03: "fix all" on docs/21 §1.1. A-STATE (axes generated from status) is reversed.
--
-- Forward-only. Application rollback: a previous release that WRITES asset.status will fail
-- (generated column). Reads of `status` / `statusbefore` / `statusafter` keep working — those
-- names survive as generated projections of the axes. That is the compatibility direction
-- (axes → pill is total).
--
-- Transaction lines are append-only (0003). Filling the four new axis columns is a structural
-- rewrite, so this file SET LOCAL ams.allow_history_write (the sanctioned hatch). No line is
-- deleted. Values that cannot be reconstructed are filled by the conservative 0008 mapping and
-- recorded in the NOTICE at the end — not invented as if they had been captured.

-- ---------------------------------------------------------------- functions (idempotent)

CREATE OR REPLACE FUNCTION ams_compat_status(p_lifecycle text, p_disposition text, p_serviceability text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lifecycle = 'Retired' THEN 'Retired'
    WHEN p_disposition = 'Missing' THEN 'Missing'
    WHEN p_disposition = 'AtCalibrationLab' THEN 'InCalibration'
    WHEN p_serviceability IN ('NeedsRepair', 'OutOfService') THEN 'NeedsRepair'
    WHEN p_disposition = 'Deployed' THEN 'Deployed'
    WHEN p_disposition = 'CheckedOut' THEN 'CheckedOut'
    ELSE 'Available'
  END
$$;

CREATE OR REPLACE FUNCTION ams_axes_from_status(p_status text, p_lifecycle text DEFAULT NULL)
RETURNS TABLE(lifecycle text, disposition text, serviceability text) LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE WHEN p_status = 'Retired' OR p_lifecycle = 'Retired' THEN 'Retired' ELSE 'Active' END,
    CASE p_status
      WHEN 'Available'     THEN 'AtOffice'
      WHEN 'CheckedOut'    THEN 'CheckedOut'
      WHEN 'Deployed'      THEN 'Deployed'
      WHEN 'InCalibration' THEN 'AtCalibrationLab'
      WHEN 'NeedsRepair'   THEN 'AtOffice'
      WHEN 'Missing'       THEN 'Missing'
      WHEN 'Retired'       THEN 'AtOffice'
      WHEN 'InTransit'     THEN 'InTransit'
      ELSE 'AtOffice'
    END,
    CASE
      WHEN p_status = 'NeedsRepair' THEN 'NeedsRepair'
      WHEN p_status = 'Retired' OR p_lifecycle = 'Retired' THEN 'OutOfService'
      ELSE 'Serviceable'
    END
$$;

CREATE OR REPLACE FUNCTION ams_apply_type_axes(p_type text, p_life text, p_disp text, p_serv text)
RETURNS TABLE(lifecycle text, disposition text, serviceability text) LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE WHEN p_type = 'Retire' THEN 'Retired' ELSE p_life END,
    CASE p_type
      WHEN 'Checkout'              THEN 'CheckedOut'
      WHEN 'Return'                THEN 'AtOffice'
      WHEN 'ReturnFromCalibration' THEN 'AtOffice'
      WHEN 'Deploy'                THEN 'Deployed'
      WHEN 'Undeploy'              THEN 'CheckedOut'
      WHEN 'SendToCalibration'     THEN 'AtCalibrationLab'
      WHEN 'MarkMissing'           THEN 'Missing'
      WHEN 'Found'                 THEN 'AtOffice'
      WHEN 'Retire'                THEN 'AtOffice'
      ELSE p_disp
    END,
    CASE p_type
      WHEN 'ReportFault'    THEN 'NeedsRepair'
      WHEN 'RepairComplete' THEN 'Serviceable'
      WHEN 'Found'          THEN 'Serviceable'
      WHEN 'Retire'         THEN 'OutOfService'
      ELSE p_serv
    END
$$;

-- ---------------------------------------------------------------- drop dependents so status can be rebuilt as generated

DROP VIEW IF EXISTS v_utilisation             CASCADE;
DROP VIEW IF EXISTS v_asset_state_spans       CASCADE;
DROP VIEW IF EXISTS v_installation_timeline   CASCADE;
DROP VIEW IF EXISTS v_current_installations   CASCADE;
DROP VIEW IF EXISTS v_asset_timeline          CASCADE;
DROP VIEW IF EXISTS v_assets_by_project       CASCADE;
DROP VIEW IF EXISTS v_calibration_due         CASCADE;
DROP VIEW IF EXISTS v_calibration_currency    CASCADE;
DROP VIEW IF EXISTS v_unknown_custodian_sweep CASCADE;
DROP VIEW IF EXISTS v_available_assets_by_office CASCADE;
DROP VIEW IF EXISTS v_asset_current_detail    CASCADE;
DROP VIEW IF EXISTS v_asset_effective_status  CASCADE;
DROP VIEW IF EXISTS asset_state               CASCADE;

-- ---------------------------------------------------------------- asset: stored axes, generated status

ALTER TABLE asset ADD COLUMN IF NOT EXISTS disposition text;
ALTER TABLE asset ADD COLUMN IF NOT EXISTS serviceability text;

UPDATE asset SET
  lifecycle      = COALESCE(axis_lifecycle, lifecycle),
  disposition    = COALESCE(disposition, axis_disposition),
  serviceability = COALESCE(serviceability, axis_serviceability)
WHERE disposition IS NULL OR serviceability IS NULL
   OR (axis_lifecycle IS NOT NULL AND lifecycle IS DISTINCT FROM axis_lifecycle);

UPDATE asset AS a SET
  lifecycle      = COALESCE(a.lifecycle,      s.lifecycle),
  disposition    = COALESCE(a.disposition,    s.disposition),
  serviceability = COALESCE(a.serviceability, s.serviceability)
FROM (
  SELECT a2.id, x.lifecycle, x.disposition, x.serviceability
    FROM asset a2
    CROSS JOIN LATERAL ams_axes_from_status(a2.status, a2.lifecycle) AS x
) s
WHERE a.id = s.id
  AND (a.disposition IS NULL OR a.serviceability IS NULL);

ALTER TABLE asset ALTER COLUMN disposition SET NOT NULL;
ALTER TABLE asset ALTER COLUMN serviceability SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'asset' AND column_name = 'axis_lifecycle'
  ) THEN
    ALTER TABLE asset DROP CONSTRAINT IF EXISTS asset_axis_vocabulary;
    DROP INDEX IF EXISTS asset_axes_idx;
    ALTER TABLE asset DROP COLUMN axis_lifecycle;
    ALTER TABLE asset DROP COLUMN axis_disposition;
    ALTER TABLE asset DROP COLUMN axis_serviceability;
  END IF;
END $$;

-- Convert stored status → generated. attgenerated = 's' means already done.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'asset' AND a.attname = 'status'
      AND a.attgenerated = ''
  ) THEN
    DROP INDEX IF EXISTS asset_status_idx;
    ALTER TABLE asset DROP COLUMN status;
    ALTER TABLE asset ADD COLUMN status text
      GENERATED ALWAYS AS (ams_compat_status(lifecycle, disposition, serviceability)) STORED;
    ALTER TABLE asset ALTER COLUMN status SET NOT NULL;
    CREATE INDEX asset_status_idx ON asset (status);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_axis_vocabulary') THEN
    ALTER TABLE asset ADD CONSTRAINT asset_axis_vocabulary CHECK (
      lifecycle IN ('Active','Retired')
      AND disposition IN ('AtOffice','CheckedOut','Deployed','InTransit','AtCalibrationLab','Missing')
      AND serviceability IN ('Serviceable','NeedsRepair','OutOfService')
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS asset_axes_idx ON asset (lifecycle, disposition, serviceability);

-- ---------------------------------------------------------------- lines: six stored axis columns; status* become generated

ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS lifecycle_before text;
ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS lifecycle_after text;
ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS disposition_before text;
ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS disposition_after text;
ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS serviceability_before text;
ALTER TABLE asset_transaction_line ADD COLUMN IF NOT EXISTS serviceability_after text;

DO $$
DECLARE
  rec record;
  prev_asset text;
  prev_life text;
  prev_disp text;
  prev_serv text;
  prev_status text;
  b_life text; b_disp text; b_serv text;
  a_life text; a_disp text; a_serv text;
  applied record;
  mech_before record;
  mech_after record;
  n_replay int := 0;
  n_mechanical int := 0;
  n_hole int := 0;
BEGIN
  -- Structural rewrite of append-only rows — 0003's sanctioned hatch.
  PERFORM set_config('ams.allow_history_write', 'on', true);

  FOR rec IN
    SELECT l.id, l.asset, l.statusbefore, l.statusafter, l.line_number,
           t.transactiontype, t.transactiondate
      FROM asset_transaction_line l
      JOIN asset_transaction t ON t.id = l.transaction_id
     WHERE l.lifecycle_before IS NULL
     ORDER BY l.asset, t.transactiondate, l.line_number
  LOOP
    IF prev_asset IS DISTINCT FROM rec.asset THEN
      prev_life := NULL; prev_disp := NULL; prev_serv := NULL; prev_status := NULL;
    END IF;

    SELECT * INTO mech_before FROM ams_axes_from_status(rec.statusbefore);
    SELECT * INTO mech_after  FROM ams_axes_from_status(rec.statusafter);

    IF prev_status IS NOT NULL AND prev_status = rec.statusbefore THEN
      b_life := prev_life; b_disp := prev_disp; b_serv := prev_serv;
    ELSE
      b_life := mech_before.lifecycle;
      b_disp := mech_before.disposition;
      b_serv := mech_before.serviceability;
    END IF;

    SELECT * INTO applied FROM ams_apply_type_axes(rec.transactiontype, b_life, b_disp, b_serv);

    IF ams_compat_status(applied.lifecycle, applied.disposition, applied.serviceability) = rec.statusafter THEN
      a_life := applied.lifecycle; a_disp := applied.disposition; a_serv := applied.serviceability;
      n_replay := n_replay + 1;
    ELSE
      a_life := mech_after.lifecycle; a_disp := mech_after.disposition; a_serv := mech_after.serviceability;
      n_mechanical := n_mechanical + 1;
      IF rec.statusafter IN ('NeedsRepair','InCalibration','Missing','Retired') THEN
        n_hole := n_hole + 1;
      END IF;
    END IF;

    UPDATE asset_transaction_line SET
      lifecycle_before = b_life, disposition_before = b_disp, serviceability_before = b_serv,
      lifecycle_after  = a_life, disposition_after  = a_disp, serviceability_after  = a_serv
     WHERE id = rec.id;

    prev_asset := rec.asset;
    prev_life := a_life; prev_disp := a_disp; prev_serv := a_serv; prev_status := rec.statusafter;
  END LOOP;

  UPDATE asset_transaction_line AS l
     SET lifecycle_before      = COALESCE(l.lifecycle_before,      s.lifecycle),
         disposition_before    = COALESCE(l.disposition_before,    s.disposition),
         serviceability_before = COALESCE(l.serviceability_before, s.serviceability)
    FROM (
      SELECT l2.id, x.lifecycle, x.disposition, x.serviceability
        FROM asset_transaction_line l2
        CROSS JOIN LATERAL ams_axes_from_status(l2.statusbefore) AS x
    ) s
   WHERE l.id = s.id AND l.lifecycle_before IS NULL;

  UPDATE asset_transaction_line AS l
     SET lifecycle_after      = COALESCE(l.lifecycle_after,      s.lifecycle),
         disposition_after    = COALESCE(l.disposition_after,    s.disposition),
         serviceability_after = COALESCE(l.serviceability_after, s.serviceability)
    FROM (
      SELECT l2.id, x.lifecycle, x.disposition, x.serviceability
        FROM asset_transaction_line l2
        CROSS JOIN LATERAL ams_axes_from_status(l2.statusafter) AS x
    ) s
   WHERE l.id = s.id AND l.lifecycle_after IS NULL;

  RAISE NOTICE '0016 line backfill: replay-consistent %; mechanical %; conservative-hole %',
    n_replay, n_mechanical, n_hole;
END $$;

-- Window pass: when recorded pills chain, copy the previous line's after-axes onto this before.
DO $$
BEGIN
  PERFORM set_config('ams.allow_history_write', 'on', true);
  UPDATE asset_transaction_line l SET
    lifecycle_before      = p.lifecycle_after,
    disposition_before    = p.disposition_after,
    serviceability_before = p.serviceability_after
  FROM (
    SELECT l2.id,
           lag(l2.lifecycle_after)      OVER (PARTITION BY l2.asset ORDER BY t.transactiondate, l2.line_number) AS lifecycle_after,
           lag(l2.disposition_after)    OVER (PARTITION BY l2.asset ORDER BY t.transactiondate, l2.line_number) AS disposition_after,
           lag(l2.serviceability_after) OVER (PARTITION BY l2.asset ORDER BY t.transactiondate, l2.line_number) AS serviceability_after,
           lag(l2.statusafter)          OVER (PARTITION BY l2.asset ORDER BY t.transactiondate, l2.line_number) AS statusafter
      FROM asset_transaction_line l2
      JOIN asset_transaction t ON t.id = l2.transaction_id
  ) p
  WHERE l.id = p.id
    AND p.statusafter IS NOT NULL
    AND p.statusafter = l.statusbefore;
END $$;

ALTER TABLE asset_transaction_line ALTER COLUMN lifecycle_before SET NOT NULL;
ALTER TABLE asset_transaction_line ALTER COLUMN lifecycle_after SET NOT NULL;
ALTER TABLE asset_transaction_line ALTER COLUMN disposition_before SET NOT NULL;
ALTER TABLE asset_transaction_line ALTER COLUMN disposition_after SET NOT NULL;
ALTER TABLE asset_transaction_line ALTER COLUMN serviceability_before SET NOT NULL;
ALTER TABLE asset_transaction_line ALTER COLUMN serviceability_after SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'asset_transaction_line' AND a.attname = 'statusbefore'
      AND a.attgenerated = ''
  ) THEN
    ALTER TABLE asset_transaction_line DROP COLUMN statusbefore;
    ALTER TABLE asset_transaction_line DROP COLUMN statusafter;
    ALTER TABLE asset_transaction_line ADD COLUMN statusbefore text
      GENERATED ALWAYS AS (ams_compat_status(lifecycle_before, disposition_before, serviceability_before)) STORED;
    ALTER TABLE asset_transaction_line ADD COLUMN statusafter text
      GENERATED ALWAYS AS (ams_compat_status(lifecycle_after, disposition_after, serviceability_after)) STORED;
    ALTER TABLE asset_transaction_line ALTER COLUMN statusbefore SET NOT NULL;
    ALTER TABLE asset_transaction_line ALTER COLUMN statusafter SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'line_axis_vocabulary') THEN
    ALTER TABLE asset_transaction_line ADD CONSTRAINT line_axis_vocabulary CHECK (
      lifecycle_before IN ('Active','Retired') AND lifecycle_after IN ('Active','Retired')
      AND disposition_before IN ('AtOffice','CheckedOut','Deployed','InTransit','AtCalibrationLab','Missing')
      AND disposition_after  IN ('AtOffice','CheckedOut','Deployed','InTransit','AtCalibrationLab','Missing')
      AND serviceability_before IN ('Serviceable','NeedsRepair','OutOfService')
      AND serviceability_after  IN ('Serviceable','NeedsRepair','OutOfService')
    );
  END IF;
END $$;

-- ---------------------------------------------------------------- recreate views (0008/0009/0012), now reading stored axes

CREATE OR REPLACE VIEW asset_state AS
SELECT
  a.id,
  a.assetid,
  a.homeoffice,
  a.status                                    AS compatibility_status,
  a.lifecycle,
  a.disposition,
  a.serviceability,
  CASE
    WHEN m.defaultcalintervalmonths IS NULL
     AND a.nextcaldue IS NULL
     AND a.lastcaldate IS NULL                THEN 'NotRequired'
    WHEN a.disposition = 'AtCalibrationLab'   THEN 'InCalibration'
    WHEN latest_cal.result = 'Fail'           THEN 'Failed'
    WHEN a.nextcaldue IS NULL                 THEN 'Unknown'
    WHEN a.nextcaldue < to_char(current_date, 'YYYY-MM-DD')                   THEN 'Overdue'
    WHEN a.nextcaldue <= to_char(current_date + INTERVAL '30 days', 'YYYY-MM-DD') THEN 'DueSoon'
    ELSE 'Current'
  END                                         AS calibration_currency,
  CASE
    WHEN a.lifecycle = 'Retired'                   THEN 'Retired'
    WHEN a.disposition = 'Missing'                 THEN 'Missing'
    WHEN a.disposition = 'AtCalibrationLab'        THEN 'In calibration'
    WHEN a.serviceability IN ('NeedsRepair','OutOfService') THEN 'Needs repair'
    WHEN a.disposition = 'Deployed'                THEN 'Deployed'
    WHEN a.disposition = 'CheckedOut'              THEN 'Checked out'
    WHEN a.disposition = 'InTransit'               THEN 'In transit'
    ELSE 'Available'
  END                                         AS display_status
FROM asset a
LEFT JOIN equipment_model m
       ON m.manufacturer = a.manufacturer AND m.model = a.model AND m.equipmenttype = a.equipmenttype
LEFT JOIN LATERAL (
  SELECT c.result
    FROM calibration_record c
   WHERE c.asset = a.assetid
   ORDER BY c.calibrationdate DESC NULLS LAST, c.nextduedate DESC, c.id
   LIMIT 1
) AS latest_cal ON true;

COMMENT ON VIEW asset_state IS
  'The approved four-axis state model (docs/15 § 3). lifecycle/disposition/serviceability are stored on asset (DC-22). status is generated. Calibration currency is derived here.';

CREATE OR REPLACE VIEW v_asset_effective_status AS
SELECT
  id, assetid, homeoffice, lifecycle, disposition, serviceability,
  calibration_currency, display_status, compatibility_status
FROM asset_state;

COMMENT ON VIEW v_asset_effective_status IS
  'docs/15 § 12 catalogue name. One derivation, defined as asset_state; this is that view under its reviewed name.';

-- Recreated 0012 reporting views (dropped so status could become generated).
CREATE OR REPLACE VIEW v_asset_current_detail AS
SELECT
  a.assetid,
  a.manufacturer,
  a.model,
  a.equipmenttype,
  COALESCE(m.assetgroup, '')                    AS assetgroup,
  m.defaultcalintervalmonths,
  a.serialnumber,
  a.homeoffice,
  COALESCE(NULLIF(a.currentlocation, ''), a.homeoffice) AS effectiveoffice,
  a.currentlocation,
  a.custodian,
  a.currentproject,
  a.parentasset,
  a.lifecycle,
  a.status,
  a.lastcaldate,
  a.nextcaldue,
  a.retirementreason,
  a.carrier,
  a.migrationsource,
  (btrim(a.assetid) ~ '^TMP-[^-]+$')            AS istemporarytag,
  (a.notes IS NOT NULL AND a.notes ~* '\yowned by\y') AS isthirdpartyowned,
  (m.defaultcalintervalmonths IS NOT NULL OR a.nextcaldue IS NOT NULL OR a.lastcaldate IS NOT NULL)
                                                AS iscalibrationtracked
FROM asset a
LEFT JOIN equipment_model m
  ON  m.manufacturer  = a.manufacturer
  AND m.model         = a.model
  AND m.equipmenttype = a.equipmenttype;

-- ---------------------------------------------------------------------------------------------
-- v_available_assets_by_office — acceptance question 4, "what is available at office Y".
--
-- FR-007: retired, deployed, in-calibration, needing-repair and missing are all excluded, which
-- under the compatibility single-status column is simply `status = 'Available'`. Aggregated in
-- the view rather than in the service so the number a manager reads in Power BI and the number
-- the API returns come from the same GROUP BY.
--
-- Both office notions are kept: `office` is where the thing physically is (the answer to the
-- question), `homeoffice` is which office owns it (what A-R5's office scope filters on).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_available_assets_by_office AS
SELECT
  COALESCE(d.effectiveoffice, '') AS office,
  COALESCE(d.homeoffice, '')      AS homeoffice,
  COALESCE(d.equipmenttype, '')   AS equipmenttype,
  COALESCE(d.assetgroup, '')      AS assetgroup,
  count(*)::int                   AS available
FROM v_asset_current_detail d
WHERE d.lifecycle <> 'Retired'
  AND d.status = 'Available'
GROUP BY 1, 2, 3, 4;

-- ---------------------------------------------------------------------------------------------
-- v_unknown_custodian_sweep — FR-010, and the half of acceptance question 3 that matters
-- operationally: an asset that is out but whose holder is unknown is a different problem from an
-- asset sitting in the office, and conflating them is what the migrated data already does.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_unknown_custodian_sweep AS
SELECT
  d.assetid,
  d.homeoffice,
  d.effectiveoffice,
  d.currentlocation,
  d.currentproject,
  d.status,
  d.lifecycle,
  d.manufacturer,
  d.model,
  d.equipmenttype,
  d.assetgroup
FROM v_asset_current_detail d
WHERE d.lifecycle <> 'Retired'
  AND d.status IN ('CheckedOut', 'Deployed')
  AND d.custodian IS NULL;

-- ---------------------------------------------------------------------------------------------
-- v_calibration_currency — acceptance question 5's population.
--
-- The view establishes WHO is in scope (FR-029 retired excluded; the tracked/not-tracked test
-- from `readModel.getCalibrationCounts`) and leaves the horizon-dependent bucketing to the
-- service, because "due in the next N days" is a question, not a stored fact, and a view with 30
-- baked into it would be wrong for every other N. FR-017's unknown bucket is why `nextcaldue` is
-- passed through NULL rather than defaulted.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_calibration_currency AS
SELECT
  d.assetid,
  d.homeoffice,
  d.effectiveoffice,
  d.currentlocation,
  d.custodian,
  d.currentproject,
  d.manufacturer,
  d.model,
  d.equipmenttype,
  d.assetgroup,
  d.lifecycle,
  d.status,
  d.lastcaldate,
  d.nextcaldue,
  d.iscalibrationtracked,
  CASE WHEN d.nextcaldue ~ '^\d{4}-\d{2}-\d{2}' THEN (left(d.nextcaldue, 10))::date END AS nextcalduedate
FROM v_asset_current_detail d
WHERE d.lifecycle <> 'Retired'
  AND d.iscalibrationtracked;

-- ---------------------------------------------------------------------------------------------
-- v_calibration_due — FR-015 (days overdue, custodian and location for each overdue asset) and
-- FR-016 (the certificate is reachable). `daysoverdue` is positive when overdue and negative when
-- still current, so one column answers "how late" and "how long left". NULL means unknown, which
-- FR-017 requires be visible rather than treated as zero.
--
-- The certificate join is LATERAL … LIMIT 1 rather than a GROUP BY so the row carries the newest
-- certificate's own number/lab/result together, not three independent maxima.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_calibration_due AS
SELECT
  c.assetid,
  c.homeoffice,
  c.effectiveoffice,
  c.currentlocation,
  c.custodian,
  c.currentproject,
  c.manufacturer,
  c.model,
  c.equipmenttype,
  c.assetgroup,
  c.status,
  c.lastcaldate,
  c.nextcaldue,
  c.nextcalduedate,
  CASE WHEN c.nextcalduedate IS NOT NULL THEN (CURRENT_DATE - c.nextcalduedate) END AS daysoverdue,
  cert.certificatenumber,
  cert.certificateurl,
  cert.lab,
  cert.result           AS certificateresult,
  cert.calibrationdate  AS certificatedate
FROM v_calibration_currency c
LEFT JOIN LATERAL (
  SELECT r.certificatenumber, r.certificateurl, r.lab, r.result, r.calibrationdate
  FROM calibration_record r
  WHERE r.asset = c.assetid
  ORDER BY r.calibrationdate DESC NULLS LAST
  LIMIT 1
) cert ON TRUE;

-- ---------------------------------------------------------------------------------------------
-- v_assets_by_project — acceptance question 6, "what is assigned to project Z", with the
-- custodian and location FR-008 requires and the calibration/certificate columns FR-014 and
-- FR-016 require.
--
-- The certificate LATERAL repeats `v_calibration_due`'s deliberately. A view catalogue whose
-- members only make sense when joined to one another is not a catalogue, it is a schema with
-- extra steps: the compliance pack is one read of ONE view, which is what lets the governed
-- export declare a fixed field allowlist against a single approved source. Unlike
-- `v_calibration_due` this view keeps assets that are retired or not calibration-tracked, because
-- a project's evidence pack must account for every asset that was on the project, including the
-- ones with nothing to prove.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_assets_by_project AS
SELECT
  d.currentproject AS projectnumber,
  p.name           AS projectname,
  p.status         AS projectstatus,
  p.office         AS projectoffice,
  p.pm             AS projectpm,
  d.assetid,
  d.manufacturer,
  d.model,
  d.equipmenttype,
  d.assetgroup,
  d.serialnumber,
  d.homeoffice,
  d.currentlocation,
  d.custodian,
  d.status,
  d.lifecycle,
  d.lastcaldate,
  d.nextcaldue,
  d.iscalibrationtracked,
  CASE
    WHEN d.nextcaldue ~ '^\d{4}-\d{2}-\d{2}'
    THEN (CURRENT_DATE - (left(d.nextcaldue, 10))::date)
  END AS daysoverdue,
  cert.certificatenumber,
  cert.certificateurl,
  cert.lab,
  cert.result          AS certificateresult,
  cert.calibrationdate AS certificatedate
FROM v_asset_current_detail d
LEFT JOIN project p ON p.projectnumber = d.currentproject
LEFT JOIN LATERAL (
  SELECT r.certificatenumber, r.certificateurl, r.lab, r.result, r.calibrationdate
  FROM calibration_record r
  WHERE r.asset = d.assetid
  ORDER BY r.calibrationdate DESC NULLS LAST
  LIMIT 1
) cert ON TRUE
WHERE d.currentproject IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- v_asset_timeline — acceptance question 7 for one asset. FR-018 (the chronological history),
-- FR-019 (attachment and detachment events naming the other asset and the role) and FR-022
-- (retired assets keep their timeline — nothing here filters on lifecycle).
--
-- The `attachments` column exists so Power BI can answer FR-019 without re-implementing
-- `app/src/domain/pointInTime.ts`. The API does NOT read it: `reportService` composes the same
-- answer through `buildTimeline`, the module the UI already uses, and `reports.test.ts` asserts
-- the two agree. That is deliberate — one of them has to be the authority, and it is the tested
-- domain module; this column is the reconciled projection of it.
--
-- `asset_relationship.createdbyline` / `closedbyline` hold a TRANSACTION id, not a line id (see
-- transactionService.ts and pointInTime.ts:206, which compares against `entry.transaction`), so
-- the join below is to `t.id`. The role of a DETACH event comes from the line that OPENED the
-- relationship, because a closing line never carries a kitrole.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_asset_timeline AS
SELECT
  l.asset            AS assetid,
  l.id               AS lineid,
  t.id               AS transactionid,
  t.name             AS transactionname,
  t.transactiontype,
  t.transactiondate,
  t.recorded_at      AS recordedat,
  t.performedby,
  l.statusbefore,
  l.statusafter,
  t.fromlocation,
  t.tolocation,
  t.fromuser,
  t.touser,
  t.fromproject,
  t.toproject,
  t.expectedreturn,
  l.kitrole,
  l.orientation,
  l.powersource,
  l.condition,
  l.processed,
  l.notes            AS linenotes,
  t.notes            AS transactionnotes,
  l.line_number      AS linenumber,
  att.attachments
FROM asset_transaction_line l
JOIN asset_transaction t ON t.id = l.transaction_id
LEFT JOIN LATERAL (
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('kind', e.kind, 'assetId', e.otherasset, 'role', e.role)
                     ORDER BY e.kind, e.otherasset),
           '[]'::jsonb
         ) AS attachments
  FROM (
    SELECT 'attach'::text AS kind,
           CASE WHEN r.parentasset = l.asset THEN r.childasset ELSE r.parentasset END AS otherasset,
           (SELECT ol.kitrole FROM asset_transaction_line ol
             WHERE ol.transaction_id = r.createdbyline AND ol.asset = l.asset LIMIT 1) AS role
    FROM asset_relationship r
    WHERE r.createdbyline = t.id
      AND (r.parentasset = l.asset OR r.childasset = l.asset)
    UNION ALL
    SELECT 'detach'::text,
           CASE WHEN r.parentasset = l.asset THEN r.childasset ELSE r.parentasset END,
           (SELECT ol.kitrole FROM asset_transaction_line ol
             WHERE ol.transaction_id = r.createdbyline AND ol.asset = l.asset LIMIT 1)
    FROM asset_relationship r
    WHERE r.closedbyline = t.id
      AND (r.parentasset = l.asset OR r.childasset = l.asset)
  ) e
) att ON TRUE;

-- ---------------------------------------------------------------------------------------------
-- v_current_installations — what is standing at a site right now (feature 005 US1). The office
-- an installation belongs to is its PRIMARY ASSET's home office: a site is a client's ground,
-- not an Englobe office, so it cannot answer A-R5's scope question by itself.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_current_installations AS
SELECT
  i.id            AS installationid,
  i.site,
  i.project,
  i.primaryasset,
  i.locationtype,
  i.sitename,
  i.position,
  i.latitude,
  i.longitude,
  i.coordinatesource,
  i.powersource,
  i.start_at      AS startedat,
  i.end_at        AS endedat,
  i.openedbytransaction,
  i.closedbytransaction,
  i.notes,
  a.homeoffice    AS homeoffice,
  (SELECT count(*)::int FROM installation_component c
    WHERE c.installation = i.id AND c.end_at IS NULL) AS opencomponents
FROM installation i
LEFT JOIN asset a ON a.assetid = i.primaryasset
WHERE i.end_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- v_installation_timeline — acceptance question 7 for a SITE: what was installed there on date D
-- and what was attached to it. Every component membership is a dated span, open or closed, so a
-- station that had a geophone swapped mid-deployment reads as two spans rather than as a
-- contradiction. Historical: closed installations are included (FR-029's historical half).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_installation_timeline AS
SELECT
  i.id         AS installationid,
  i.site,
  i.sitename,
  i.project,
  i.primaryasset,
  i.locationtype,
  i.powersource AS installationpowersource,
  i.start_at   AS installationstart,
  i.end_at     AS installationend,
  pa.homeoffice AS installationhomeoffice,
  c.id         AS componentid,
  c.asset      AS assetid,
  c.kitrole,
  c.orientation,
  c.start_at   AS componentstart,
  c.end_at     AS componentend,
  c.openedbyline,
  c.closedbyline,
  ca.manufacturer,
  ca.model,
  ca.equipmenttype,
  ca.homeoffice AS componenthomeoffice
FROM installation i
LEFT JOIN installation_component c ON c.installation = i.id
LEFT JOIN asset pa ON pa.assetid = i.primaryasset
LEFT JOIN asset ca ON ca.assetid = c.asset;

-- ---------------------------------------------------------------------------------------------
-- v_asset_state_spans — the raw span decomposition FR-023 rests on: from each transaction until
-- the next one, the asset was in `status`. `spanend IS NULL` means "and still is".
--
-- This view is a Power BI projection, NOT the API's authority. The API computes utilisation
-- through `app/src/domain/utilisation.ts`, which is the module carrying the FR-027/FR-028 guard
-- and its 24 tests; a second arithmetic in SQL that could drift from it would be exactly the
-- "separately maintained reporting copy" FR-030 forbids. `reports.test.ts` asserts the two agree.
--
-- Ordering tie-break is (transactiondate, line_number). The TypeScript sorts by date alone with a
-- stable sort, so the two can only differ for two lines on one asset bearing the identical
-- timestamp — a case the reconciliation test compares as a set rather than a sequence.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_asset_state_spans AS
SELECT
  l.asset           AS assetid,
  t.transactiondate AS spanstart,
  LEAD(t.transactiondate) OVER (PARTITION BY l.asset ORDER BY t.transactiondate, l.line_number) AS spanend,
  l.statusafter     AS status,
  t.transactiontype,
  row_number() OVER (PARTITION BY l.asset ORDER BY t.transactiondate, l.line_number)::int AS spanindex
FROM asset_transaction_line l
JOIN asset_transaction t ON t.id = l.transaction_id;

-- ---------------------------------------------------------------------------------------------
-- v_utilisation — the acquisition / go-live boundary facts that WS-W9's "acquisition/go-live
-- boundaries protect utilisation" depends on, one row per asset.
--
-- `acquisitionat` is the earliest AddToInventory line — the date the asset became ours.
-- `firsttransactionat` is the earliest line of ANY type; the minimum of that column across the
-- reported population is the date the FLEET's records began. FR-028 as clarified turns on the two
-- being different facts, and this view is where they stop being conflated: a logger bought last
-- month must report its five weeks of service, not refuse a 90-day question.
--
-- min()/max() over TEXT compare lexicographically, which for ISO-8601 is chronological and is
-- byte-for-byte what `earliestDate()` in utilisation.ts does with `<`.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_utilisation AS
SELECT
  d.assetid,
  d.homeoffice,
  d.effectiveoffice,
  d.equipmenttype,
  d.assetgroup,
  d.manufacturer,
  d.model,
  d.lifecycle,
  d.status,
  h.firsttransactionat,
  h.lasttransactionat,
  h.acquisitionat,
  COALESCE(h.transactioncount, 0) AS transactioncount
FROM v_asset_current_detail d
LEFT JOIN LATERAL (
  SELECT min(t.transactiondate) AS firsttransactionat,
         max(t.transactiondate) AS lasttransactionat,
         min(t.transactiondate) FILTER (WHERE t.transactiontype = 'AddToInventory') AS acquisitionat,
         count(*)::int          AS transactioncount
  FROM asset_transaction_line l
  JOIN asset_transaction t ON t.id = l.transaction_id
  WHERE l.asset = d.assetid
) h ON TRUE;
