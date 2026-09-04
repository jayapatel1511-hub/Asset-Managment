-- 0005 — the open containment graph is acyclic.
--
-- 0001 already refuses a SECOND open parent for one child (`rel_one_open_parent`, a partial
-- unique index). That makes the open graph a forest of chains — but a chain can still close on
-- itself. A -> B, B -> C, C -> A satisfies "one open parent each" perfectly, and produces a kit
-- that contains itself.
--
-- The damage is not theoretical. `transactionService.mirrorComponentChildren` walks parent to
-- child to copy status, location, custodian and project onto permanent components, and
-- `refreshParentAsset` walks the other way. Both terminate because the graph is a forest today.
-- Insert one cycle and the same code either loops or, worse, converges on a state that no
-- transaction produced — a Principle I violation written by the system itself.
--
-- Three shapes are refused, and they are the same shape at different lengths:
--   * self-parent      A -> A
--   * two-cycle        A -> B -> A
--   * longer cycle     A -> B -> C -> A
--
-- Only OPEN rows (end_at IS NULL) participate. A cycle in history is not a cycle: an asset that
-- was inside a kit last year and contains that kit today is an ordinary sequence of events, and
-- refusing it would refuse legitimate history. This also keeps the check cheap — the migrated
-- fleet has 6 open relationships and the largest synthetic profile 1,907, against 26,372 rows.
--
-- AFTER, not BEFORE. A BEFORE ROW trigger cannot see the other rows of its own INSERT statement,
-- and `seed.ts` loads relationships in 200-row multi-row INSERTs — a cycle spread across one
-- statement would slip past a BEFORE trigger entirely. AFTER sees them, and raising there still
-- aborts the transaction, which is the only outcome that matters.

CREATE OR REPLACE FUNCTION refuse_relationship_cycle() RETURNS trigger AS $$
DECLARE
  cycle_path text;
BEGIN
  IF NEW.parentasset = NEW.childasset THEN
    RAISE EXCEPTION
      'an asset cannot contain itself: % -> % (asset_relationship %)', NEW.parentasset, NEW.childasset, NEW.id
      USING ERRCODE = '23514';
  END IF;

  -- Walk UP from the new row's parent along open relationships. Reaching the new row's child
  -- means the edge just written closes a loop. The depth guard is a second line of defence: if a
  -- cycle somehow already exists in the table, the recursion must still terminate to report it.
  WITH RECURSIVE ancestors(assetid, depth, path) AS (
    SELECT NEW.parentasset, 1, NEW.childasset || ' -> ' || NEW.parentasset
    UNION ALL
    SELECT r.parentasset, a.depth + 1, a.path || ' -> ' || r.parentasset
      FROM ancestors a
      JOIN asset_relationship r ON r.childasset = a.assetid AND r.end_at IS NULL
     WHERE a.depth < 64
  )
  SELECT path INTO cycle_path FROM ancestors WHERE assetid = NEW.childasset LIMIT 1;

  IF cycle_path IS NOT NULL THEN
    RAISE EXCEPTION
      'relationship would create a containment cycle: %. The open parent graph must stay acyclic (asset_relationship %).',
      cycle_path, NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;   -- AFTER triggers ignore the return value.
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS relationship_acyclic ON asset_relationship;
CREATE TRIGGER relationship_acyclic AFTER INSERT OR UPDATE ON asset_relationship
  FOR EACH ROW
  WHEN (NEW.end_at IS NULL)
  EXECUTE FUNCTION refuse_relationship_cycle();

-- The recursive walk above joins on `childasset` for open rows; `rel_child_idx` in 0001 covers
-- the column but not the open-row predicate, and `rel_one_open_parent` is the partial index that
-- does. Named here so a later reader knows the walk is index-backed and not a table scan per row.
