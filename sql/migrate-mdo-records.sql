CREATE TABLE IF NOT EXISTS detection_mdo_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID NOT NULL UNIQUE REFERENCES detections(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  equipment TEXT NOT NULL,
  tag_no_proposed TEXT,
  equipment_type TEXT,
  size TEXT,
  from_value TEXT,
  to_value TEXT,
  of_value TEXT,
  at_value TEXT,
  tag_number TEXT,
  alternative_description_old TEXT,
  alternative_description_acn TEXT,
  description_proposed TEXT,
  description_len INTEGER,
  class TEXT,
  object_type TEXT,
  weight NUMERIC,
  uom TEXT,
  size_dimension TEXT,
  flow_direction TEXT NOT NULL DEFAULT 'UNKNOWN',
  bypass BOOLEAN NOT NULL DEFAULT FALSE,
  relation_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  relation_confidence NUMERIC,
  relation_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS detection_mdo_document_idx ON detection_mdo_records(document_id);
CREATE INDEX IF NOT EXISTS detection_mdo_relation_status_idx ON detection_mdo_records(relation_status);
