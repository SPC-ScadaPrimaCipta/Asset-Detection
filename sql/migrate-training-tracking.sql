-- Migration: Training dataset tracking
-- Track konfirmasi user untuk YOLO retraining

CREATE TABLE IF NOT EXISTS training_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    confirmed_count INT NOT NULL,
    unique_classes INT NOT NULL DEFAULT 0,
    zip_size_bytes BIGINT,
    exported_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Track konfirmasi per detection untuk incremental learning
-- Gunakan field 'included_in_export' untuk mark mana sudah dipakai
ALTER TABLE detections ADD COLUMN IF NOT EXISTS included_in_training BOOLEAN DEFAULT FALSE;
ALTER TABLE detections ADD COLUMN IF NOT EXISTS training_exported_at TIMESTAMPTZ;

-- Index untuk query training stats
CREATE INDEX IF NOT EXISTS idx_detections_training ON detections(detection_status, validation_status, included_in_training) 
WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID');

COMMENT ON TABLE training_exports IS 'Log setiap kali dataset YOLO diekspor untuk training/fine-tuning';
COMMENT ON COLUMN detections.included_in_training IS 'Flag marking deteksi ini sudah dimasukkan ke dataset training';
COMMENT ON COLUMN detections.training_exported_at IS 'Timestamp terakhir kali deteksi ini diexport ke training set';
