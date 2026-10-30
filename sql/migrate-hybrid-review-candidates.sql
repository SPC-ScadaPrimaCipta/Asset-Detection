ALTER TABLE detections
  ADD COLUMN IF NOT EXISTS candidate_status TEXT NOT NULL DEFAULT 'FINAL',
  ADD COLUMN IF NOT EXISTS candidate_source TEXT,
  ADD COLUMN IF NOT EXISTS candidate_reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS detections_candidate_status_idx ON detections(candidate_status);
