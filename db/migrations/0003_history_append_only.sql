-- 0003 — append-only history, hardened, with one named escape hatch.
--
-- CLAUDE.md rule 5 and constitution Principle II: transaction history is append-only. 0001
-- already refuses UPDATE and DELETE on both history tables with row triggers. Two holes remain,
-- and this migration closes them.
--
-- HOLE 1 — TRUNCATE. A row trigger never fires for TRUNCATE; that is a documented PostgreSQL
-- property, and 0001's own comment relies on it ("TRUNCATE ... does not fire row triggers") so
-- that the seed loader can replace a dataset wholesale. That makes `TRUNCATE asset_transaction`
-- the one statement any caller could use to erase every business event, with no error and no
-- audit trail. A protection with a hole that size is not a protection.
--
-- HOLE 2 — the escape hatch was implicit. The seed loader needed one, so the rule was weakened
-- for everybody rather than opened for the loader. That is backwards.
--
-- The fix is a session-local GUC, `ams.allow_history_write`. Setting it is an explicit,
-- greppable act; it is `SET LOCAL`, so it is scoped to one transaction and cannot leak to the
-- next statement on a pooled connection; and only two callers may set it:
--
--   * `server/src/db/seed.ts`, which replaces a whole dataset (development / rehearsal only);
--   * a migration that must rewrite history rows structurally.
--
-- NOT an application command. Rule 5's correction path is a compensating event, not an UPDATE
-- (CLAUDE.md rule 5, rule 17). An API route that reaches for this GUC is a bug, and the fact
-- that it must name it in SQL is what makes the bug visible in review.
--
-- SQLSTATE 23514 (check_violation) is raised rather than the plpgsql default P0001, so callers
-- can classify the refusal as an integrity refusal without matching on message text.

CREATE OR REPLACE FUNCTION ams_history_write_allowed() RETURNS boolean AS $$
  -- current_setting's second argument is missing_ok: an unset GUC returns NULL rather than
  -- raising, which is what makes "the hatch is closed unless someone opened it" the default.
  SELECT lower(coalesce(current_setting('ams.allow_history_write', true), 'off'))
         IN ('on', 'true', '1', 'yes');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION refuse_history_mutation() RETURNS trigger AS $$
BEGIN
  IF ams_history_write_allowed() THEN
    -- STATEMENT level is the TRUNCATE trigger; it has neither NEW nor OLD.
    IF TG_LEVEL = 'STATEMENT' THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'transaction history is append-only (CLAUDE.md rule 5 / constitution Principle II): % on %. Corrections are compensating events, not edits; only the seed loader and migrations may SET LOCAL ams.allow_history_write.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

-- Re-created rather than left alone: 0001's versions point at the same function name, but naming
-- them here keeps this migration self-describing and makes a re-run harmless.
DROP TRIGGER IF EXISTS line_immutable ON asset_transaction_line;
CREATE TRIGGER line_immutable BEFORE UPDATE OR DELETE ON asset_transaction_line
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

DROP TRIGGER IF EXISTS header_immutable ON asset_transaction;
CREATE TRIGGER header_immutable BEFORE UPDATE OR DELETE ON asset_transaction
  FOR EACH ROW EXECUTE FUNCTION refuse_history_mutation();

DROP TRIGGER IF EXISTS line_truncate_immutable ON asset_transaction_line;
CREATE TRIGGER line_truncate_immutable BEFORE TRUNCATE ON asset_transaction_line
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_history_mutation();

DROP TRIGGER IF EXISTS header_truncate_immutable ON asset_transaction;
CREATE TRIGGER header_truncate_immutable BEFORE TRUNCATE ON asset_transaction
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_history_mutation();
