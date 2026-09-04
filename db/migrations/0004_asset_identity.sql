-- 0004 — asset identity is stable, in the database rather than by convention.
--
-- CLAUDE.md rule 6 has three clauses and 0001 satisfies one and a half of them:
--
--   "UUID is the database key"          -> asset.id, PRIMARY KEY. Held.
--   "Canonical Asset ID is unique"      -> asset.assetid, UNIQUE. Held.
--   "...and immutable"                  -> NOT held. Nothing stopped `UPDATE asset SET assetid`.
--   "Serial is non-unique"              -> held by omission (no unique index), asserted by test.
--
-- The immutability half is the one that mattered and the one that was missing. Every printed
-- label, every migration cross-reference in `migration/staged/04_loaded_ids.csv`, and every
-- `asset_transaction_line.asset` value in 0001 is the TAG, not the UUID — the compatibility
-- schema stores history against `assetid`. Renaming a tag therefore silently re-points that
-- asset's entire history onto a different physical object. No application code does this today
-- (`transactionService.ts` and `commandService.ts` write status, location, custodian, project,
-- parent and calibration dates, never the identifiers), which is exactly why the constraint is
-- cheap to add now and expensive to add after the first caller that wants to "fix a typo".
--
-- There is deliberately NO escape hatch here, unlike 0003's history GUC. Rule 17 already settles
-- what happens when two records turn out to be one asset: a merge preserves both identities and
-- creates a permanent redirect. It never rewrites an identifier. A migration that genuinely must
-- re-key an asset drops this trigger by name in its own file, which is a reviewable act.
--
-- `asset.id` is covered too. It is the UUID the whole model claims is the key; a key that can be
-- reassigned by UPDATE is not a key.
--
-- The trigger carries a WHEN clause so the function body only runs on a statement that actually
-- changes an identifier. Every ordinary state write — and `mirrorComponentChildren` fans one of
-- those out across a kit's children — skips the call entirely.

CREATE OR REPLACE FUNCTION refuse_identity_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.assetid IS DISTINCT FROM OLD.assetid THEN
    RAISE EXCEPTION
      'canonical Asset ID is immutable (CLAUDE.md rule 6): % -> % on asset %. History in asset_transaction_line.asset is keyed on the tag; a rename re-points it. Use a merge with a redirect (rule 17).',
      OLD.assetid, NEW.assetid, OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION
      'asset UUID is the database key and is immutable (CLAUDE.md rule 6): % -> % on asset %.',
      OLD.id, NEW.id, OLD.assetid
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asset_identity_immutable ON asset;
CREATE TRIGGER asset_identity_immutable BEFORE UPDATE ON asset
  FOR EACH ROW
  WHEN (NEW.assetid IS DISTINCT FROM OLD.assetid OR NEW.id IS DISTINCT FROM OLD.id)
  EXECUTE FUNCTION refuse_identity_mutation();

-- Rule 6's last clause is an ABSENCE, and an absence cannot be written as a constraint: serials
-- are shared by 132 assets in the migrated fleet (0001's own comment on the column), so any
-- future unique index on `asset.serialnumber` would refuse a load that is legitimately correct.
-- `asset_serial_idx` in 0001 is non-unique on purpose. `server/tests/schema.test.ts` asserts both
-- halves — a duplicate serial inserts, and no unique index over the column exists — so the day
-- someone "tidies up" that index the test says why they must not.
COMMENT ON COLUMN asset.serialnumber IS
  'Deliberately NOT unique (CLAUDE.md rule 6). 132 assets in the migrated fleet share a serial with another asset. Do not add a unique index.';
COMMENT ON COLUMN asset.assetid IS
  'Canonical Asset ID: unique and immutable (CLAUDE.md rule 6), enforced by asset_identity_immutable.';
