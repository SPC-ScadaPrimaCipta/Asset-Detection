-- Migration 001: Add detection_audits table
CREATE TABLE IF NOT EXISTS detection_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_id UUID REFERENCES detections(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('CONFIRM','REJECT','EDIT','MANUAL_CREATE')),
    old_values JSONB,
    new_values JSONB,
    performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_audits_detection ON detection_audits(detection_id);
