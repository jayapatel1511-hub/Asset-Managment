-- 0012 — the approved reporting views (WS-W9).
--
-- FOLDED IN from `server/src/db/views.sql`, which `ReportService.ensureReportViews` applied from
-- an `onReady` hook in `routes/reports.ts` during the parallel build. Same reason as 0010 and
-- 0011: two lanes could not edit one schema file at once, and a view is schema.
--
-- These eleven views are the reporting contract. Power BI is permitted over these and nothing
-- else (CLAUDE.md § Reporting), which is why the restricted-identifier exclusion below is
-- structural rather than a convention: `v_asset_current_detail` is the only view that touches the
-- `asset` table, and it lists its columns explicitly, so `identifiervalue`, `phonenumber` and
-- `staticip` are excluded once rather than eleven times. `tests/reports.test.ts` proves it three
-- ways — an `information_schema` column check, a `pg_get_viewdef()` scan that would catch an
-- alias, and a negative control asserting the same query DOES find all three on `asset` itself.
--
-- NOTE for whoever edits the DROP list below: `v_asset_effective_status` is NOT in it and must not
-- be added. That view belongs to `0009_effective_status_view.sql`; dropping it here would remove
-- it and never recreate it.
--
-- The SQL below is `views.sql` verbatim.

-- Englobe AMS — approved reporting views (WS-W9).
--
-- WHY THIS FILE EXISTS AT ALL. `specs/REMAINING-WORK.md` § WS-W9 states four rules that only a
-- view layer can satisfy together: reports are read-only, every figure reconciles to operational
-- data, manager views exclude sensitive identifiers, and "Power BI optional and uses approved
-- views only". A report that assembles its own SQL per endpoint satisfies none of them durably —
-- the next endpoint writes a fifth predicate and the fourth figure quietly disagrees. So every
-- reporting figure in `services/reportService.ts` reads one of the views below and nothing else,
-- and Power BI is permitted over these and only these.
--
-- NAMES ARE NOT INVENTED HERE. `docs/15-postgres-data-model.md` § 12 lists the reviewed view
-- catalogue for the first schema release; the eleven views below are that catalogue's reporting
-- members, spelled exactly as § 12 spells them. Two names from § 12 are deliberately absent:
--
--   v_asset_effective_status  belongs to the R1 four-axis state model, which
--                             specs/_planning/BUILD-FREEZE.md § A-STATE assigns to db/migrations/
--                             (Agent 1). Defining it here would put two lanes on one view name.
--                             These views read the compatibility `asset.status` column instead —
--                             which is what A-STATE explicitly permits until HTTP cutover.
--   v_completion_queue        is feature 011 data-quality territory, not reporting.
--
-- CLAUDE.md RULE 10, ENFORCED STRUCTURALLY. `asset.identifiervalue` (SIM ICCID),
-- `asset.phonenumber` and `asset.staticip` appear nowhere below — not selected, not aliased, not
-- reachable through `SELECT *` (every view lists its columns explicitly, and `v_asset_current_detail`
-- is the only view that touches the `asset` table directly). `server/tests/reports.test.ts`
-- proves it by introspecting `information_schema.columns` for every `v_%` view AND by scanning
-- `pg_get_viewdef()` for the three identifiers, so an alias cannot smuggle one past the column
-- check. WS-W9's "manager DTOs/views exclude sensitive identifiers" is therefore a property of
-- the schema, not of a reviewer's attention.
--
-- HOW IT IS APPLIED. `services/reportService.ts` runs this file once per database handle with
-- DROP IF EXISTS + CREATE, which is idempotent and safe to repeat on every start-up. It is
-- deliberately NOT wired into `src/db/`'s loader: Agent 1 is converting `schema.sql` into
-- `db/migrations/**` in parallel, and a second loader in that directory would collide. Once the
-- migration runner lands, this file folds into the migration set unchanged — the SQL does not
-- care who executes it.
--
-- Dates are ISO-8601 TEXT here exactly as they are in `schema.sql`, and every comparison below is
-- a lexicographic text comparison. That is not laziness: `app/src/domain/utilisation.ts` and
-- `services/readModel.ts` compare the same strings the same way, so a SQL figure and a TypeScript
-- figure over the same rows agree by construction rather than by luck. The one place a real date
-- is needed — days overdue — casts explicitly and guards the cast with a pattern test.

-- Reverse dependency order, so a re-run never trips over a dependent view.
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

-- ---------------------------------------------------------------------------------------------
-- v_asset_current_detail — the reporting grain for acceptance questions 1, 2, 3 and 6.
--
-- One row per asset. The ONLY view that reads the `asset` table, which is what makes rule 10
-- checkable at a glance: the three restricted columns are excluded once, here, and nothing
-- downstream can reintroduce them because nothing downstream can see them.
--
-- Three derived columns carry predicates that TypeScript already owns, transcribed so a SQL
-- figure and the operational figure cannot disagree:
--
--   effectiveoffice      `readModel.filterAssets`'s office predicate is
--                        `currentlocation === office || (!currentlocation && homeoffice === office)`.
--                        JavaScript's `!currentlocation` is true for the empty string as well as
--                        null, so the SQL is COALESCE(NULLIF(currentlocation,''), homeoffice) —
--                        the NULLIF is not decoration, it is the half of the predicate a plain
--                        COALESCE would silently get wrong for a blank-but-present location.
--   istemporarytag       FR-011. `app/src/domain/assetId.ts` calls a tag temporary when the text
--                        before its LAST dash is "TMP" — so `TMP-0001` qualifies and `TMP-00-01`
--                        and the prefix-only `TMP-` do not. `^TMP-[^-]+$` is that rule.
--   isthirdpartyowned    FR-012. `readModel`'s /\bowned by\b/i over `notes`; `\y` is PostgreSQL's
--                        word boundary. Marked, never excluded — the total still reconciles.
--
-- `notes` itself is not exposed: the flag is the reportable fact, and free text is the classic
-- route by which something restricted reaches a manager view.
-- ---------------------------------------------------------------------------------------------
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
