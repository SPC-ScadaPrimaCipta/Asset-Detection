-- Migration: Add Accenture 8-Column standard fields to detection_mdo_records
ALTER TABLE detection_mdo_records
  ADD COLUMN IF NOT EXISTS location_prefix TEXT,
  ADD COLUMN IF NOT EXISTS equipment_type_short TEXT,
  ADD COLUMN IF NOT EXISTS equipment_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS detection_mdo_tag_proposed_idx ON detection_mdo_records(tag_no_proposed);
CREATE INDEX IF NOT EXISTS detection_mdo_prefix_idx ON detection_mdo_records(location_prefix);
