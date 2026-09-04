-- 0007 — synthetic data is refused in production, by the database.
--
-- CLAUDE.md rule 12: "Synthetic data is refused in production. Environment and seed markers are
-- verified before any load." Before this migration that verification lived in exactly one place —
-- `seed.ts`'s check that a manifest does not say `verified: false` — and that check answers a
-- different question. It refuses a synthetic dataset whose OWN generator failed its checks. It
-- says nothing about loading a perfectly valid synthetic dataset into the production database,
-- which is the failure rule 12 actually describes and the one that ends with fabricated
-- seismograph history in front of a client.
--
-- A guard that only exists in the loader is also a guard that only covers the loader. `psql`,
-- a restored dump, a future import job and a well-meaning script all reach the same tables
-- without passing through `seed.ts`. So the marker check belongs where every writer must pass:
-- the `meta` table itself.
--
-- Two markers, both already written by the loader, plus one this migration introduces:
--
--   meta.environment   'development' (default) / 'test' / 'staging' / 'production'.
--                      Written by seed.ts from AMS_ENV, falling back to NODE_ENV.
--   meta.dataset_key   'synthetic:<seed>:<profile>:<generatedAt>' for generated data,
--                      'real:<path>' for the migrated fleet. seed.ts § datasetKeyFor.
--   meta.dataset_info  the DatasetInfo JSON, whose `synthetic` boolean is the same fact.
--
-- The trigger fires on either marker changing and evaluates the PAIR, so both orders of arrival
-- are covered: loading synthetic data into an already-production database, and stamping a
-- database that already holds synthetic data as production. Getting only one direction would
-- have left the easier mistake — promote a UAT database — wide open.
--
-- Deliberately NOT overridable. There is no GUC hatch as in 0003. "Load it anyway, just this
-- once" is the entire failure mode rule 12 exists to prevent, and a database that holds the two
-- markers side by side is one that a human has to fix on purpose.

CREATE OR REPLACE FUNCTION refuse_synthetic_in_production() RETURNS trigger AS $$
DECLARE
  env       text;
  synthetic boolean;
BEGIN
  -- The row being written wins; anything else comes from what is already stored. Inside one
  -- transaction the loader's earlier meta writes are visible here, which is what makes the
  -- seed's own dataset_key -> environment sequence evaluate as a pair rather than in isolation.
  SELECT coalesce(
           CASE WHEN NEW.key = 'environment' THEN NEW.value END,
           (SELECT value FROM meta WHERE key = 'environment')
         ) INTO env;

  SELECT coalesce(
           CASE WHEN NEW.key = 'dataset_key'  THEN NEW.value LIKE 'synthetic:%' END,
           CASE WHEN NEW.key = 'dataset_info' THEN coalesce((NEW.value::jsonb ->> 'synthetic')::boolean, false) END,
           (SELECT value LIKE 'synthetic:%' FROM meta WHERE key = 'dataset_key'),
           false
         ) INTO synthetic;

  IF synthetic AND lower(coalesce(env, '')) IN ('production', 'prod') THEN
    RAISE EXCEPTION
      'refusing synthetic data in a production environment (CLAUDE.md rule 12): meta.environment = %, dataset marked synthetic. Environment and seed markers are verified before any load.',
      env
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meta_refuses_synthetic_in_production ON meta;
CREATE TRIGGER meta_refuses_synthetic_in_production BEFORE INSERT OR UPDATE ON meta
  FOR EACH ROW
  WHEN (NEW.key IN ('environment', 'dataset_key', 'dataset_info'))
  EXECUTE FUNCTION refuse_synthetic_in_production();

COMMENT ON TABLE meta IS
  'Database-level markers. `environment` and `dataset_key`/`dataset_info` are read together by refuse_synthetic_in_production (CLAUDE.md rule 12) — they are not free-form notes.';
