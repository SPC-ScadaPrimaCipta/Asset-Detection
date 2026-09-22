-- Migration: add validation_status to detections table
-- Values: VALID | NEEDS_REVIEW | CONFLICT
-- VALID = all evidence consistent, no conflict
-- NEEDS_REVIEW = low-evidence field (service/mainEquipment from Vision only) or field missing
-- CONFLICT = Vision type contradicts OCR tag prefix, or evidence sources disagree

ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS validation_status TEXT
    CHECK (validation_status IN ('VALID', 'NEEDS_REVIEW', 'CONFLICT'))
    DEFAULT 'VALID';

-- Backfill: existing detections with detection_source='UNKNOWN' → NEEDS_REVIEW
UPDATE detections
SET validation_status = 'NEEDS_REVIEW'
WHERE detection_source = 'UNKNOWN'
  AND validation_status = 'VALID';

-- Backfill: detections with evidence containing CONFLICT keyword → CONFLICT
UPDATE detections
SET validation_status = 'CONFLICT'
WHERE evidence::text ILIKE '%CONFLICT:%'
  AND validation_status = 'VALID';

-- Index for filtering in review UI
CREATE INDEX IF NOT EXISTS idx_detections_validation_status ON detections(validation_status);
