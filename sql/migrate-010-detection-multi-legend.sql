-- Migration 010: multi-legend detection jobs (1-3 legends per job).
--
-- Additive only, idempotent, no data deleted.
--
-- Rationale: different plants use different P&ID symbol conventions, and one
-- document can mix them. A detection job may therefore reference up to 3
-- legends, ordered by priority: legend_ids[1] is the primary legend and wins
-- every symbol conflict; legend_id is kept as that primary for backward
-- compatibility with jobs created before multi-legend existed.
--
-- Precedence of symbols (implemented in workers/detection-worker.ts):
--   1. legend_ids[1] (primary) — wins all conflicts
--   2. legend_ids[2]
--   3. legend_ids[3]
-- Detections store the SOURCE legend that produced the match (detections.legend_id),
-- not necessarily the primary.
--
-- NOTE: some deployments already carry legend_ids / legend_snapshot /
-- legend_version / legend_validated_count columns (added outside this repo,
-- all NULL, never written by the app). This migration only ensures legend_ids
-- exists with the right type and backfills it; the other three columns are left
-- untouched and remain reserved.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='detection_jobs' AND column_name='legend_ids'
  ) THEN
    ALTER TABLE detection_jobs
      ADD COLUMN legend_ids UUID[];
    RAISE NOTICE 'Added detection_jobs.legend_ids';
  END IF;

  -- Backfill: single-legend jobs become single-element arrays.
  UPDATE detection_jobs
     SET legend_ids = ARRAY[legend_id]
   WHERE legend_ids IS NULL AND legend_id IS NOT NULL;

  -- Length guard: 1-3 legends per job. Named explicitly so re-runs can check
  -- pg_constraint instead of failing on a duplicate constraint name.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='detection_jobs_legend_ids_len'
  ) THEN
    ALTER TABLE detection_jobs
      ADD CONSTRAINT detection_jobs_legend_ids_len
      CHECK (legend_ids IS NULL OR (
        array_length(legend_ids, 1) IS NOT NULL
        AND array_length(legend_ids, 1) BETWEEN 1 AND 3
      ));
    RAISE NOTICE 'Added detection_jobs_legend_ids_len check';
  END IF;
END $$;

COMMENT ON COLUMN detection_jobs.legend_ids IS
  'Ordered legend ids for multi-legend detection (max 3). [1] is the primary legend and wins symbol conflicts. detections.legend_id stores the source legend of each match.';
