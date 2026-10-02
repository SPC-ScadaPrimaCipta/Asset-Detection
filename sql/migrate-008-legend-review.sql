-- Migration 008: legend review decision reason (Stage 3.5).
-- Additive only. Stores the human reject reason selected in Review UI
-- (Note/annotation, Invalid symbol, Wrong OCR, Wrong crop, Other + text).
-- Idempotent: safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='review_reason'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN review_reason TEXT;
    RAISE NOTICE 'Added legend_symbols.review_reason';
  END IF;
END $$;
