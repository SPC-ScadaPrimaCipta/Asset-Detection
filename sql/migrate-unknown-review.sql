-- UNKNOWN detections must never be auto-valid — they always require a human.
-- The DXF fast path used to insert without validation_status (DEFAULT 'VALID'),
-- so UNKNOWN rows reached the Asset Register without review.
UPDATE detections
SET validation_status = 'NEEDS_REVIEW'
WHERE asset_type = 'UNKNOWN'
  AND validation_status = 'VALID';
