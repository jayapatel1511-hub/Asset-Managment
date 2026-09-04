-- 0008 — the approved four-axis state model, DERIVED from the compatibility column.
--
-- docs/15-postgres-data-model.md § 3 (approved 2026-09-03, R1) splits the single asset status
-- into four named axes. specs/_planning/BUILD-FREEZE.md assumption A-STATE settles how that lands
-- here: `asset.status` STAYS as the operational value the screens and `state_machine.json`
-- already use, and the axes arrive as derived columns plus a view. Not a rewrite.
--
-- Why derive rather than replace, when docs/19 § 8.3 is emphatic that status -> axes is not
-- recoverable per row? Because the two claims are about different things, and conflating them is
-- the trap:
--
--   * For a TRANSACTION LINE, docs/19 is right and this migration does not pretend otherwise.
--     A line stores `statusbefore`/`statusafter` — two columns where the canonical model has six
--     — so a line written during the compatibility window genuinely cannot be split into
--     before/after axes afterwards. Nothing below touches `asset_transaction_line`.
--   * For an ASSET's CURRENT state, the mapping is total and information-preserving in the
--     direction that matters: `status` plus `lifecycle` plus the calibration columns determine a
--     coherent (lifecycle, disposition, serviceability, calibration currency) tuple for every one
--     of the seven statuses. It is the FUTURE writes that need the axes to be authoritative, and
--     those arrive with the canonical schema.
--
-- So this is rule 9 — "lifecycle, disposition, serviceability and calibration currency are
-- separate" — made true for reporting and for every consumer that should never have been reading
-- a fused pill, without invalidating a single existing row or test.
--
-- STORED generated columns for three axes, a view for the fourth. The split is forced, not
-- stylistic: a generated column's expression must be IMMUTABLE and may reference only its own
-- row. Lifecycle, disposition and serviceability satisfy both. Calibration currency does not —
-- it compares a due date against TODAY (not immutable) and needs the model's calibration
-- interval from `equipment_model` (another row). It therefore lives in the view, recomputed on
-- read, which is also the only correct place for a value that changes at midnight with no write.
--
-- The columns are `axis_*`-prefixed because `asset.lifecycle` is already taken by the stored
-- Active/Retired column, and shadowing it would be the single most confusing name in the schema.
-- The view exposes them under their canonical docs/15 names.
--
-- What is NOT reachable from the compatibility status, recorded so nobody mistakes the gap for
-- an oversight:
--   * disposition `InTransit` — no compatibility status carries it. A transfer between offices
--     is instantaneous in the current model. It becomes reachable when the canonical schema
--     stores disposition directly.
--   * a NeedsRepair asset's true location. The fused status spends its one slot on the fault, so
--     serviceability recovers perfectly and disposition falls back to AtOffice. This is exactly
--     docs/19's lossiness, visible instead of hidden.

ALTER TABLE asset
  ADD COLUMN IF NOT EXISTS axis_lifecycle text
    GENERATED ALWAYS AS (
      CASE WHEN status = 'Retired' OR lifecycle = 'Retired' THEN 'Retired'
           WHEN lifecycle = 'Active' THEN 'Active'
      END
    ) STORED;

ALTER TABLE asset
  ADD COLUMN IF NOT EXISTS axis_disposition text
    GENERATED ALWAYS AS (
      CASE status
        WHEN 'Available'     THEN 'AtOffice'
        WHEN 'CheckedOut'    THEN 'CheckedOut'
        WHEN 'Deployed'      THEN 'Deployed'
        WHEN 'InCalibration' THEN 'AtCalibrationLab'
        WHEN 'Missing'       THEN 'Missing'
        WHEN 'NeedsRepair'   THEN 'AtOffice'
        WHEN 'Retired'       THEN 'AtOffice'
      END
    ) STORED;

ALTER TABLE asset
  ADD COLUMN IF NOT EXISTS axis_serviceability text
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'NeedsRepair' THEN 'NeedsRepair'
        WHEN status = 'Retired' OR lifecycle = 'Retired' THEN 'OutOfService'
        WHEN status IN ('Available','CheckedOut','Deployed','InCalibration','Missing') THEN 'Serviceable'
      END
    ) STORED;

-- Each CASE deliberately has NO ELSE branch, so an unrecognised `status` or `lifecycle` yields
-- NULL — and NOT NULL then refuses the row. That is the point: the axes are not a best-effort
-- translation with a fallback bucket, they are a total mapping, and the day someone adds an
-- eighth status without deciding what it means on all three axes, the INSERT fails and says so.
-- Verified against every dataset before landing: staged (1,026 assets), synthetic demo (371),
-- standard (1,459) and large (6,626) contain only the seven statuses and two lifecycles.
ALTER TABLE asset ALTER COLUMN axis_lifecycle      SET NOT NULL;
ALTER TABLE asset ALTER COLUMN axis_disposition    SET NOT NULL;
ALTER TABLE asset ALTER COLUMN axis_serviceability SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_axis_vocabulary') THEN
    ALTER TABLE asset ADD CONSTRAINT asset_axis_vocabulary CHECK (
      axis_lifecycle      IN ('Active','Retired')
      AND axis_disposition IN ('AtOffice','CheckedOut','Deployed','InTransit','AtCalibrationLab','Missing')
      AND axis_serviceability IN ('Serviceable','NeedsRepair','OutOfService')
    );
  END IF;
END $$;

-- docs/15 § 5 asks for the state index to be on the axes rather than on the fused status.
-- `asset_status_idx` from 0001 stays — the screens still filter on `status` — and this is the
-- one the axis-shaped reports want.
CREATE INDEX IF NOT EXISTS asset_axes_idx ON asset (axis_lifecycle, axis_disposition, axis_serviceability);

-- ---------------------------------------------------------------- the fourth axis, and the pill
--
-- Calibration currency (docs/15 § 3.4) is derived, never stored, "from model/asset requirements,
-- calibration records, due dates, and current disposition". The order of tests below is the
-- order the app's own reporting already uses (`app/src/api/mock/reporting.ts`
-- getCalibrationCounts, and `listCalibrationDue`), so the view and the screens cannot disagree:
--
--   NotRequired   the model has no calibration interval AND the asset has no due date and no
--                 calibration history — calibration was never tracked for it. The app's
--                 `isCalibrated` test, inverted.
--   InCalibration physically at the lab. FR-013: an asset at the lab is not ALSO "overdue".
--   Failed        the most recent calibration record says Fail and it has not been superseded.
--   Unknown       tracked, but no due date. FR-017 — counted explicitly, never omitted.
--   Overdue       due date before today.
--   DueSoon       due within the 30-day horizon the compliance screen uses (HORIZON_DAYS).
--   Current       everything else.
--
-- `current_date` makes the view non-immutable and that is correct: currency is a function of the
-- calendar, and a stored copy would be silently wrong every morning.

CREATE OR REPLACE VIEW asset_state AS
SELECT
  a.id,
  a.assetid,
  a.homeoffice,
  a.status                                    AS compatibility_status,
  a.axis_lifecycle                            AS lifecycle,
  a.axis_disposition                          AS disposition,
  a.axis_serviceability                       AS serviceability,
  CASE
    WHEN m.defaultcalintervalmonths IS NULL
     AND a.nextcaldue IS NULL
     AND a.lastcaldate IS NULL                THEN 'NotRequired'
    WHEN a.status = 'InCalibration'           THEN 'InCalibration'
    WHEN latest_cal.result = 'Fail'           THEN 'Failed'
    WHEN a.nextcaldue IS NULL                 THEN 'Unknown'
    WHEN a.nextcaldue < to_char(current_date, 'YYYY-MM-DD')                   THEN 'Overdue'
    WHEN a.nextcaldue <= to_char(current_date + INTERVAL '30 days', 'YYYY-MM-DD') THEN 'DueSoon'
    ELSE 'Current'
  END                                         AS calibration_currency,
  -- docs/15 § 3.5's compatibility pill, spelled the way the UI spells it. Presentation logic,
  -- explicitly NOT the authoritative state model — it is here so a report that wants the
  -- familiar label does not re-derive it from the axes and drift.
  CASE
    WHEN a.axis_lifecycle = 'Retired'              THEN 'Retired'
    WHEN a.axis_disposition = 'Missing'            THEN 'Missing'
    WHEN a.axis_disposition = 'AtCalibrationLab'   THEN 'In calibration'
    WHEN a.axis_serviceability = 'NeedsRepair'     THEN 'Needs repair'
    WHEN a.axis_disposition = 'Deployed'           THEN 'Deployed'
    WHEN a.axis_disposition = 'CheckedOut'         THEN 'Checked out'
    WHEN a.axis_disposition = 'InTransit'          THEN 'In transit'
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
  'The approved four-axis state model (docs/15 § 3) derived from the compatibility asset.status. Read this, not asset.status, for anything that should not fuse location, custody, fault and calibration into one value (CLAUDE.md rule 9).';
