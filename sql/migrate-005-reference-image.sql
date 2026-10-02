-- Migration 005: legend_symbols reference image for few-shot detection
-- Adds reference_image_url + reference_crop_hash to support visual few-shot
-- examples in symbol-detector prompt (Phase 1 of accuracy plan).
-- Idempotent: safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='reference_image_url'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN reference_image_url TEXT;
    RAISE NOTICE 'Added legend_symbols.reference_image_url';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='reference_crop_hash'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN reference_crop_hash TEXT;
    RAISE NOTICE 'Added legend_symbols.reference_crop_hash';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_legend_symbols_ref_hash ON legend_symbols(reference_crop_hash);
CREATE INDEX IF NOT EXISTS idx_legend_symbols_legend_status ON legend_symbols(legend_id, status);
