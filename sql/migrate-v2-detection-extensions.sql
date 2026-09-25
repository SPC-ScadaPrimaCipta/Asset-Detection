-- Migration V2 Phase 2: deterministic geometry + AI-verification columns on detections.
--
-- PRINCIPLES (see docs/DETECTION_V2_ARCHITECTURE.md):
--  * ADDITIVE ONLY — legacy bbox_x/y/w/h untouched, still written by the worker.
--  * symbol_bbox_* is CANONICAL for V2 (natural page pixels + page_width/height).
--  * tag_bbox_* is a SEPARATE box — never merged into the symbol box.
--  * All new columns nullable → safely deployable on existing data, no backfill
--    rewrites history (dual-write fills new rows going forward).
--  * Idempotent (IF NOT EXISTS) — safe to re-run via scripts/migrate.cjs.
--
-- ROLLBACK (manual, only if V2 dual-write must be removed):
--   ALTER TABLE detections
--     DROP COLUMN IF EXISTS detection_method, DROP COLUMN IF EXISTS deterministic_score,
--     DROP COLUMN IF EXISTS ai_verified, DROP COLUMN IF EXISTS ai_decision,
--     DROP COLUMN IF EXISTS ai_confidence, DROP COLUMN IF EXISTS ai_status,
--     DROP COLUMN IF EXISTS ai_failure_reason,
--     DROP COLUMN IF EXISTS symbol_bbox_x, DROP COLUMN IF EXISTS symbol_bbox_y,
--     DROP COLUMN IF EXISTS symbol_bbox_w, DROP COLUMN IF EXISTS symbol_bbox_h,
--     DROP COLUMN IF EXISTS tag_bbox_x, DROP COLUMN IF EXISTS tag_bbox_y,
--     DROP COLUMN IF EXISTS tag_bbox_w, DROP COLUMN IF EXISTS tag_bbox_h,
--     DROP COLUMN IF EXISTS legend_reference_id,
--     DROP COLUMN IF EXISTS ocr_text, DROP COLUMN IF EXISTS ocr_confidence,
--     DROP COLUMN IF EXISTS ocr_rotation,
--     DROP COLUMN IF EXISTS spatial_score, DROP COLUMN IF EXISTS geometry_score,
--     DROP COLUMN IF EXISTS visual_score, DROP COLUMN IF EXISTS legend_score,
--     DROP COLUMN IF EXISTS tag_score, DROP COLUMN IF EXISTS pipeline_version,
--     DROP COLUMN IF EXISTS page_width, DROP COLUMN IF EXISTS page_height;

ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS detection_method TEXT
    CHECK (detection_method IN ('DETERMINISTIC', 'AI_VERIFIED', 'AI_CORRECTED', 'MANUAL')),
  ADD COLUMN IF NOT EXISTS deterministic_score REAL
    CHECK (deterministic_score >= 0 AND deterministic_score <= 1),
  ADD COLUMN IF NOT EXISTS ai_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_decision TEXT
    CHECK (ai_decision IN ('confirm', 'correct', 'reject', 'uncertain')),
  ADD COLUMN IF NOT EXISTS ai_confidence REAL
    CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ADD COLUMN IF NOT EXISTS ai_status TEXT
    CHECK (ai_status IN ('success', 'partial', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS ai_failure_reason TEXT,
  -- Canonical V2 geometry: natural page pixels (see coordinate-transform.ts).
  -- NULL on legacy rows; dual-write fills them for new detections.
  ADD COLUMN IF NOT EXISTS symbol_bbox_x INTEGER,
  ADD COLUMN IF NOT EXISTS symbol_bbox_y INTEGER,
  ADD COLUMN IF NOT EXISTS symbol_bbox_w INTEGER,
  ADD COLUMN IF NOT EXISTS symbol_bbox_h INTEGER,
  ADD COLUMN IF NOT EXISTS tag_bbox_x INTEGER,
  ADD COLUMN IF NOT EXISTS tag_bbox_y INTEGER,
  ADD COLUMN IF NOT EXISTS tag_bbox_w INTEGER,
  ADD COLUMN IF NOT EXISTS tag_bbox_h INTEGER,
  ADD COLUMN IF NOT EXISTS legend_reference_id UUID REFERENCES legend_symbols(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS ocr_confidence REAL
    CHECK (ocr_confidence >= 0 AND ocr_confidence <= 1),
  ADD COLUMN IF NOT EXISTS ocr_rotation INTEGER,
  -- Deterministic evidence signals for the Phase 6 confidence engine.
  ADD COLUMN IF NOT EXISTS spatial_score REAL
    CHECK (spatial_score >= 0 AND spatial_score <= 1),
  ADD COLUMN IF NOT EXISTS geometry_score REAL
    CHECK (geometry_score >= 0 AND geometry_score <= 1),
  ADD COLUMN IF NOT EXISTS visual_score REAL
    CHECK (visual_score >= 0 AND visual_score <= 1),
  ADD COLUMN IF NOT EXISTS legend_score REAL
    CHECK (legend_score >= 0 AND legend_score <= 1),
  ADD COLUMN IF NOT EXISTS tag_score REAL
    CHECK (tag_score >= 0 AND tag_score <= 1),
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS page_width INTEGER,
  ADD COLUMN IF NOT EXISTS page_height INTEGER;

-- Backfill (safe, non-destructive): mirror legacy bbox into canonical symbol bbox
-- only where V2 columns are still NULL — legacy rows become V2-readable.
UPDATE detections
SET symbol_bbox_x = bbox_x,
    symbol_bbox_y = bbox_y,
    symbol_bbox_w = bbox_w,
    symbol_bbox_h = bbox_h
WHERE symbol_bbox_x IS NULL AND bbox_x IS NOT NULL;

-- Justified indexes:
--  * detection_method: review UI filters (deterministic vs AI-verified).
--  * pipeline_version: cache invalidation + benchmark grouping per pipeline.
CREATE INDEX IF NOT EXISTS idx_detections_method ON detections(detection_method);
CREATE INDEX IF NOT EXISTS idx_detections_pipeline_version ON detections(pipeline_version);
