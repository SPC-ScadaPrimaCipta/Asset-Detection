-- Migration: G1/G2/G3 — main_equipment, field_confidence, field_provenance
-- Run after migrate-validation-status.sql

-- G1: main_equipment column (mainEquipment was in prompt but not in DB)
ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS main_equipment TEXT;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS main_equipment TEXT;

-- G2: field_confidence — per-field confidence scores
-- Structure: { "tag": 0.94, "type": 0.97, "service": 0.72, "mainEquipment": null, "description": null }
ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS field_confidence JSONB;

-- G2 (assets): field_confidence also needed on assets table (Fix #4 — confirm route copies it)
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS field_confidence JSONB;

-- G3: field_provenance — per-field source tracing
-- Structure: {
--   "tag":   { "value": "P-101", "source": "OCR+KNOWLEDGE", "normalized": true, "correctionReason": "..." },
--   "type":  { "value": "Pump",  "source": "LEGEND", "inferred": false },
--   "service": { "value": null,  "source": null, "inferred": false }
-- }
ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS field_provenance JSONB;

-- G3 (assets): field_provenance also needed on assets table (Fix #4 — confirm route copies it)
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS field_provenance JSONB;

-- Indexes for common filter queries
CREATE INDEX IF NOT EXISTS idx_detections_main_equipment ON detections(main_equipment);
