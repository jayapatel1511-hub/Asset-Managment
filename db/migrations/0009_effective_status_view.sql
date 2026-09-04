-- 0009 — the reviewed catalogue name for the four-axis view.
--
-- `docs/15-postgres-data-model.md` § 12 lists thirteen reviewed reporting views for the first
-- schema release, and `v_asset_effective_status` is the first of them. 0008 built that derivation
-- as `asset_state`; this migration publishes it under the name the catalogue reviewed, so a
-- report — or Power BI over approved views only — can ask for the documented object and get it.
--
-- WHY TWO NAMES AND NOT A RENAME. 0008 is applied; migrations are immutable, and the runner
-- refuses a database whose applied files have changed. Renaming inside 0008 would have been the
-- first edit to history in a file whose entire purpose is to make that impossible. So the name
-- arrives forward, the way every other schema change will.
--
-- WHY AN ALIAS AND NOT A SECOND DEFINITION. There is exactly one derivation of the axes, in 0008,
-- and this view selects from it. Copying the CASE expressions would create two places where the
-- approved state model lives and one place where it silently stops matching — the same drift the
-- migration ledger exists to catch, reintroduced by hand.
--
-- `server/src/db/views.sql` (the reports lane) builds the other eleven catalogue members and says
-- in its own header that this name belongs to the migration set. It must not appear in that
-- file's DROP ... CASCADE list: dropping it there would remove this object and never recreate it.

CREATE OR REPLACE VIEW v_asset_effective_status AS
SELECT
  id,
  assetid,
  homeoffice,
  lifecycle,
  disposition,
  serviceability,
  calibration_currency,
  display_status,
  compatibility_status
FROM asset_state;

COMMENT ON VIEW v_asset_effective_status IS
  'docs/15 § 12 catalogue name for the approved four-axis state (docs/15 § 3). One derivation, defined in db/migrations/0008_state_axes.sql as asset_state; this is that view under its reviewed name. Carries no restricted SIM or network field (CLAUDE.md rule 10).';
