-- Migration: Add Knowledge-First columns to detections table
-- Adds: canonical_features, crop_hash, embedding, detection_source, confidence_breakdown

ALTER TABLE detections ADD COLUMN IF NOT EXISTS canonical_features TEXT;
ALTER TABLE detections ADD COLUMN IF NOT EXISTS crop_hash TEXT;
ALTER TABLE detections ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE detections ADD COLUMN IF NOT EXISTS detection_source TEXT DEFAULT 'VISION';
ALTER TABLE detections ADD COLUMN IF NOT EXISTS confidence_breakdown JSONB;

-- Index crop_hash for fast cache lookups during detection
CREATE INDEX IF NOT EXISTS idx_detections_crop_hash ON detections(crop_hash);
CREATE INDEX IF NOT EXISTS idx_detections_detection_source ON detections(detection_source);
