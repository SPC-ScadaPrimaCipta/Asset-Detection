CREATE TABLE IF NOT EXISTS detection_mdo_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID NOT NULL UNIQUE REFERENCES detections(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_no_proposed TEXT,
  equipment_type TEXT,
  component_name TEXT,
  size TEXT,
  from_value TEXT,
  to_value TEXT,
  of_value TEXT,
  at_value TEXT,
  approval_status TEXT NOT NULL DEFAULT 'PENDING',
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS detection_mdo_document_idx ON detection_mdo_records(document_id);
CREATE INDEX IF NOT EXISTS detection_mdo_relation_status_idx ON detection_mdo_records(relation_status);
