-- 0013 — reference stewardship (Rule 7 second clause, FR-018–FR-021).
--
-- Administrators create, edit and deactivate curated reference records in the app.
-- `data/reference/*.csv` remain seeds for the initial load, not the ongoing source.
--
-- Two new tables hold values that were previously free text on `equipment_model`:
--   manufacturer          — selected when creating a catalogue row
--   equipment_category    — hierarchical: roots are the former asset groups, children the
--                           former equipment types (docs/08 Q21 / specs/011 EquipmentCategory)
--
-- `equipment_model` keeps its text columns so existing reads, seeds and the three-part
-- catalogue key do not change. The new tables are the selection source; commands refuse a
-- manufacturer or category that is missing or inactive. A later migration can add FKs once
-- that cutover is scheduled — this file does not touch `asset` or `asset_transaction_line`.
--
-- `equipment_model.isactive` is the deactivate flag the table was missing. Project
-- deactivate maps to the existing `status = Closed` column. Location already has `isactive`.
--
-- Hard DELETE is refused by trigger on every reference table. TRUNCATE (the seed reload
-- hatch) does not fire row DELETE triggers, so a dataset replace still works.

CREATE TABLE IF NOT EXISTS manufacturer (
  id       text PRIMARY KEY,
  name     text NOT NULL UNIQUE,
  isactive boolean NOT NULL DEFAULT true,
  note     text
);

CREATE TABLE IF NOT EXISTS equipment_category (
  id        text PRIMARY KEY,
  name      text NOT NULL,
  parent_id text REFERENCES equipment_category (id),
  sortorder integer NOT NULL DEFAULT 0,
  isactive  boolean NOT NULL DEFAULT true,
  note      text
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_category_root_name
  ON equipment_category (lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_category_child_name
  ON equipment_category (parent_id, lower(name)) WHERE parent_id IS NOT NULL;

ALTER TABLE equipment_model ADD COLUMN IF NOT EXISTS isactive boolean NOT NULL DEFAULT true;

-- Backfill from a catalogue that already exists (no-op on an empty database; seed.ts
-- repeats the same inserts after TRUNCATE so a reload rebuilds the lists).
INSERT INTO manufacturer (id, name)
SELECT DISTINCT manufacturer, manufacturer FROM equipment_model
ON CONFLICT (id) DO NOTHING;

INSERT INTO equipment_category (id, name, parent_id)
SELECT DISTINCT 'grp:' || assetgroup, assetgroup, NULL
FROM equipment_model
ON CONFLICT (id) DO NOTHING;

INSERT INTO equipment_category (id, name, parent_id)
SELECT DISTINCT 'typ:' || assetgroup || '|' || equipmenttype, equipmenttype, 'grp:' || assetgroup
FROM equipment_model
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION refuse_reference_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reference.deleteForbidden: % records are deactivated, not deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS manufacturer_no_delete ON manufacturer;
CREATE TRIGGER manufacturer_no_delete BEFORE DELETE ON manufacturer
  FOR EACH ROW EXECUTE FUNCTION refuse_reference_delete();

DROP TRIGGER IF EXISTS equipment_category_no_delete ON equipment_category;
CREATE TRIGGER equipment_category_no_delete BEFORE DELETE ON equipment_category
  FOR EACH ROW EXECUTE FUNCTION refuse_reference_delete();

DROP TRIGGER IF EXISTS location_no_delete ON location;
CREATE TRIGGER location_no_delete BEFORE DELETE ON location
  FOR EACH ROW EXECUTE FUNCTION refuse_reference_delete();

DROP TRIGGER IF EXISTS equipment_model_no_delete ON equipment_model;
CREATE TRIGGER equipment_model_no_delete BEFORE DELETE ON equipment_model
  FOR EACH ROW EXECUTE FUNCTION refuse_reference_delete();

DROP TRIGGER IF EXISTS project_no_delete ON project;
CREATE TRIGGER project_no_delete BEFORE DELETE ON project
  FOR EACH ROW EXECUTE FUNCTION refuse_reference_delete();
