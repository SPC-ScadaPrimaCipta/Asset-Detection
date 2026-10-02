-- Migration: Company Knowledge + Detection Source
-- company_knowledge: stores user-confirmed corrections as learning data
-- detection_source: tracks which rule chain step resolved each detection

CREATE TABLE IF NOT EXISTS company_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  tag_prefix TEXT,
  asset_type TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  category TEXT,
  symbol_description TEXT,
  source_detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
  confirmed_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ck_project ON company_knowledge(project_id);
CREATE INDEX IF NOT EXISTS idx_ck_tag_prefix ON company_knowledge(tag_prefix);
CREATE INDEX IF NOT EXISTS idx_ck_asset_type ON company_knowledge(asset_type);

-- detection_source: which rule resolved this detection
-- LEGEND = matched user-selected legend
-- COMPANY_KB = matched company knowledge (learned from corrections)
-- ISA = matched builtin ISA 5.1
-- ISO = matched builtin ISO 10628-2
-- API_STD = matched API standard (future)
-- VISION = Gemini Vision fallback
-- UNKNOWN = confidence below threshold
ALTER TABLE detections ADD COLUMN IF NOT EXISTS detection_source TEXT DEFAULT 'VISION';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS detection_source TEXT DEFAULT 'VISION';
