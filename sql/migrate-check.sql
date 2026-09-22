-- Migration Safety Check
-- Run this BEFORE starting the application to verify all required columns exist.
-- If any DO assertion fails, run the corresponding migration SQL file first.
--
-- Usage:
--   psql $DATABASE_URL -f sql/migrate-check.sql
--
-- All checks use DO $$ ... $$ blocks so psql exits non-zero on first failure.

-- ── detections table ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='validation_status'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.validation_status — run sql/migrate-validation-status.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='main_equipment'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.main_equipment — run sql/migrate-field-metadata.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='field_confidence'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.field_confidence — run sql/migrate-field-metadata.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='field_provenance'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.field_provenance — run sql/migrate-field-metadata.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='canonical_features'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.canonical_features — run sql/migrate-detection-columns.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detections' AND column_name='embedding'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: detections.embedding — run sql/migrate-detection-columns.sql';
  END IF;
END $$;

-- ── assets table ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='assets' AND column_name='main_equipment'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: assets.main_equipment — run sql/migrate-field-metadata.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='assets' AND column_name='field_confidence'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: assets.field_confidence — run: ALTER TABLE assets ADD COLUMN IF NOT EXISTS field_confidence JSONB';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='assets' AND column_name='field_provenance'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: assets.field_provenance — run: ALTER TABLE assets ADD COLUMN IF NOT EXISTS field_provenance JSONB';
  END IF;
END $$;

-- ── required tables ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='symbol_cache') THEN
    RAISE EXCEPTION 'MISSING TABLE: symbol_cache — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='symbol_embeddings') THEN
    RAISE EXCEPTION 'MISSING TABLE: symbol_embeddings — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='company_knowledge') THEN
    RAISE EXCEPTION 'MISSING TABLE: company_knowledge — run sql/migrate-company-knowledge.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='negative_learning') THEN
    RAISE EXCEPTION 'MISSING TABLE: negative_learning — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='detection_audit_trail') THEN
    RAISE EXCEPTION 'MISSING TABLE: detection_audit_trail — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rule_engine_rules') THEN
    RAISE EXCEPTION 'MISSING TABLE: rule_engine_rules — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

-- ── pgvector extension ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') THEN
    RAISE EXCEPTION 'MISSING EXTENSION: vector (pgvector) — run: CREATE EXTENSION IF NOT EXISTS vector';
  END IF;
END $$;

-- ── company_knowledge columns ─────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='company_knowledge' AND column_name='drawing_type'
  ) THEN
    RAISE EXCEPTION 'MISSING COLUMN: company_knowledge.drawing_type — run sql/migrate-knowledge-first.sql';
  END IF;
END $$;

-- ── All checks passed ─────────────────────────────────────────────────────────
SELECT 'migrate-check: ALL REQUIRED COLUMNS AND TABLES PRESENT — safe to start application' AS status;
