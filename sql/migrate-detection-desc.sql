ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS component_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;
