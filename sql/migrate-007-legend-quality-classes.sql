-- Migration 007: legend quality lifecycle + semantic classes (Stage 3).
-- Additive only. No column is dropped, no data deleted, no FK broken.
-- Idempotent: safe to run multiple times.
--
-- legend_symbols additions:
--   computed_features JSONB  — diagnostics metrics (ink/border/text/whitespace/geometry)
--   quality_status TEXT      — validated | review | rejected (NULL = not yet assessed)
--   quality_reasons JSONB    — evidence strings, never silently set
--   pipeline_version TEXT    — e.g. legend-diag-v1
--   superseded_by UUID       — versioned re-crop chain (raw crop never overwritten)
--   class_id UUID            — FK to legend_classes (semantic Asset Type grouping)
--
-- New table legend_classes: one row per normalized Legend Description per legend.
-- Eligibility rule (enforced by readers, not by CHECK): a reference is
-- matcher-eligible iff quality_status='validated' AND its crop file is readable.
-- review/rejected/missing are NEVER auto-eligible.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='computed_features'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN computed_features JSONB;
    RAISE NOTICE 'Added legend_symbols.computed_features';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='quality_status'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN quality_status TEXT
      CHECK (quality_status IN ('validated','review','rejected'));
    RAISE NOTICE 'Added legend_symbols.quality_status';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='quality_reasons'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN quality_reasons JSONB;
    RAISE NOTICE 'Added legend_symbols.quality_reasons';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='pipeline_version'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN pipeline_version TEXT;
    RAISE NOTICE 'Added legend_symbols.pipeline_version';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='superseded_by'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN superseded_by UUID
      REFERENCES legend_symbols(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added legend_symbols.superseded_by';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS legend_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legend_id UUID REFERENCES legends(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(legend_id, normalized_label)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='class_id'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN class_id UUID
      REFERENCES legend_classes(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added legend_symbols.class_id';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_legend_symbols_quality ON legend_symbols(legend_id, quality_status);
CREATE INDEX IF NOT EXISTS idx_legend_symbols_class ON legend_symbols(class_id);
CREATE INDEX IF NOT EXISTS idx_legend_classes_legend ON legend_classes(legend_id);
