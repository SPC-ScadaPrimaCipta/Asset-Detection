-- Migration 002: Add status + updated_at to legend_symbols, updated_at to legends
-- Safe: uses IF NOT EXISTS / DO $$ blocks — idempotent

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='status'
  ) THEN
    ALTER TABLE legend_symbols
      ADD COLUMN status TEXT DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','DRAFT','REJECTED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legend_symbols' AND column_name='updated_at'
  ) THEN
    ALTER TABLE legend_symbols
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legends' AND column_name='updated_at'
  ) THEN
    ALTER TABLE legends
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='legends' AND column_name='status'
  ) THEN
    ALTER TABLE legends
      ADD COLUMN status TEXT DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','DRAFT'));
  END IF;
END $$;
