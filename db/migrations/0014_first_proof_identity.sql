-- 0014 — first-proof tables that 0001/0002 omitted: asset_identifier and user_office_scope.
--
-- docs/15 §4 / §6 and specs/010 data-model.md first-proof list. Not empty scaffolding:
-- search, get-by-id, history and authorization read these rows.
--
-- Completing a temporary tag (rule 6): 0004 refuses any assetid rename because history is
-- keyed on the tag. This file keeps that refusal for ordinary writes and adds one named
-- exception — OLD.assetid is a TMP-* tag AND a current TemporaryTag alias already exists
-- for it. The complete-temporary-tag command inserts the alias first, then updates assetid.
-- History lines keep the old tag; lookups resolve through the alias table.

CREATE TABLE IF NOT EXISTS asset_identifier (
  id               text PRIMARY KEY,
  asset_uuid       text NOT NULL REFERENCES asset (id),
  identifier_type  text NOT NULL CHECK (identifier_type IN (
                     'CanonicalAssetId','TemporaryTag','LegacyTag','Serial','ICCID','IMEI','Other'
                   )),
  identifier_value text NOT NULL,
  normalized_value text NOT NULL,
  is_current       boolean NOT NULL DEFAULT true,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz,
  is_sensitive     boolean NOT NULL DEFAULT false,
  source           text
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_identifier_current_tag
  ON asset_identifier (normalized_value)
  WHERE is_current AND identifier_type IN ('CanonicalAssetId','TemporaryTag','LegacyTag');

CREATE INDEX IF NOT EXISTS asset_identifier_asset_idx ON asset_identifier (asset_uuid);
CREATE INDEX IF NOT EXISTS asset_identifier_value_idx ON asset_identifier (normalized_value);

COMMENT ON TABLE asset_identifier IS
  'Searchable aliases. Completing a TMP tag inserts CanonicalAssetId and keeps TemporaryTag forever (rule 6). Serial is deliberately non-unique.';

CREATE TABLE IF NOT EXISTS user_office_scope (
  id                 text PRIMARY KEY,
  user_upn           text NOT NULL REFERENCES app_user (upn) ON DELETE CASCADE,
  office             text NOT NULL,
  scope_type         text NOT NULL CHECK (scope_type IN ('Member','Administer','Report')),
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_to           timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS user_office_scope_open
  ON user_office_scope (user_upn, office, scope_type)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS user_office_scope_office_idx ON user_office_scope (office, scope_type);

COMMENT ON TABLE user_office_scope IS
  'Office scope for authorization (docs/15 §4). Backfilled from app_user_role.office; directory reads this table first.';

-- Backfill identifiers from the current fleet.
-- The unique index is on normalized_value for current Canonical/Temporary/Legacy tags, so a
-- TMP-* asset cannot hold both TemporaryTag and CanonicalAssetId at the same value. TMP assets
-- get TemporaryTag only; completing adds CanonicalAssetId under the new tag and changes assetid.
-- Non-TMP assets get CanonicalAssetId. Serials are extra and deliberately non-unique.

INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current, is_sensitive, source)
SELECT
  'id-canon-' || a.id,
  a.id,
  CASE WHEN btrim(a.assetid) ~ '^TMP-[^-]+$' THEN 'TemporaryTag' ELSE 'CanonicalAssetId' END,
  a.assetid,
  lower(btrim(a.assetid)),
  true,
  false,
  'migration-0014'
FROM asset a
WHERE NOT EXISTS (
  SELECT 1 FROM asset_identifier i
   WHERE i.asset_uuid = a.id AND i.is_current
     AND i.identifier_type IN ('CanonicalAssetId','TemporaryTag')
);

INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current, is_sensitive, source)
SELECT
  'id-serial-' || a.id,
  a.id,
  'Serial',
  a.serialnumber,
  lower(btrim(a.serialnumber)),
  true,
  false,
  'migration-0014'
FROM asset a
WHERE a.serialnumber IS NOT NULL AND btrim(a.serialnumber) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM asset_identifier i
     WHERE i.asset_uuid = a.id AND i.identifier_type = 'Serial' AND i.is_current
       AND i.normalized_value = lower(btrim(a.serialnumber))
  );

INSERT INTO asset_identifier (id, asset_uuid, identifier_type, identifier_value, normalized_value, is_current, is_sensitive, source)
SELECT
  'id-iccid-' || a.id,
  a.id,
  'ICCID',
  a.identifiervalue,
  lower(btrim(a.identifiervalue)),
  true,
  true,
  'migration-0014'
FROM asset a
WHERE a.identifiervalue IS NOT NULL AND btrim(a.identifiervalue) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM asset_identifier i
     WHERE i.asset_uuid = a.id AND i.identifier_type = 'ICCID' AND i.is_current
       AND i.normalized_value = lower(btrim(a.identifiervalue))
  );

-- Backfill office scope from the role rows A-R5 already stores.
INSERT INTO user_office_scope (id, user_upn, office, scope_type)
SELECT
  'scope-' || r.upn || '-' || r.role || '-' || r.office,
  r.upn,
  r.office,
  CASE r.role
    WHEN 'OfficeAdmin'  THEN 'Administer'
    WHEN 'ReportReader' THEN 'Report'
    ELSE 'Member'
  END
FROM app_user_role r
WHERE r.office IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_office_scope s
     WHERE s.user_upn = r.upn AND s.office = r.office AND s.valid_to IS NULL
       AND s.scope_type = CASE r.role
         WHEN 'OfficeAdmin' THEN 'Administer' WHEN 'ReportReader' THEN 'Report' ELSE 'Member' END
  );

-- Narrow exception to 0004: completing a TMP tag, after the alias row exists.
CREATE OR REPLACE FUNCTION refuse_identity_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.assetid IS DISTINCT FROM OLD.assetid THEN
    IF OLD.assetid ~ '^TMP-[^-]+$'
       AND NEW.assetid !~ '^TMP-'
       AND EXISTS (
         SELECT 1 FROM asset_identifier i
          WHERE i.asset_uuid = OLD.id
            AND i.is_current
            AND i.identifier_type = 'TemporaryTag'
            AND i.normalized_value = lower(btrim(OLD.assetid))
       )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'canonical Asset ID is immutable (CLAUDE.md rule 6): % -> % on asset %. History in asset_transaction_line.asset is keyed on the tag; a rename re-points it. Complete a TMP tag via the alias table, or merge with a redirect (rule 17).',
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
