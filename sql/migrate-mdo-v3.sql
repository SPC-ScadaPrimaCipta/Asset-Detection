ALTER TABLE detection_mdo_records
  ADD COLUMN IF NOT EXISTS component_name TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE detection_mdo_records
SET approval_status = 'PENDING'
WHERE approval_status IS NULL;

ALTER TABLE detection_mdo_records
  DROP CONSTRAINT IF EXISTS detection_mdo_records_approval_status_check;

ALTER TABLE detection_mdo_records
  ADD CONSTRAINT detection_mdo_records_approval_status_check
  CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));

ALTER TABLE detection_mdo_records
  DROP COLUMN IF EXISTS equipment,
  DROP COLUMN IF EXISTS tag_number,
  DROP COLUMN IF EXISTS alternative_description_old,
  DROP COLUMN IF EXISTS alternative_description_acn,
  DROP COLUMN IF EXISTS description_proposed,
  DROP COLUMN IF EXISTS description_len,
  DROP COLUMN IF EXISTS class,
  DROP COLUMN IF EXISTS object_type,
  DROP COLUMN IF EXISTS weight,
  DROP COLUMN IF EXISTS uom,
  DROP COLUMN IF EXISTS size_dimension,
  DROP COLUMN IF EXISTS flow_direction,
  DROP COLUMN IF EXISTS bypass,
  DROP COLUMN IF EXISTS relation_status,
  DROP COLUMN IF EXISTS relation_confidence,
  DROP COLUMN IF EXISTS relation_evidence,
  DROP COLUMN IF EXISTS isolation_status,
  DROP COLUMN IF EXISTS flow_source,
  DROP COLUMN IF EXISTS confidence_breakdown;

CREATE INDEX IF NOT EXISTS detection_mdo_approval_idx
  ON detection_mdo_records(document_id, approval_status);
