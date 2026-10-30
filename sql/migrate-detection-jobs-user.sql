-- Migration: Add user_id and index for detection queue monitoring
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='detection_jobs' AND column_name='user_id'
  ) THEN
    ALTER TABLE detection_jobs ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_detection_jobs_status_created ON detection_jobs(status, created_at ASC);
