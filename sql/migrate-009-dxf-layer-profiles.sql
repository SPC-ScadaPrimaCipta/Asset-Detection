-- Migration 009: DXF layer profile tables for configurable layer mapping
-- Safe to run multiple times (idempotent).

-- Per-project layer mapping: layer name → category
-- category: 'tag' | 'description' | 'pipe' | 'equipment' | 'title' | 'ignore' | 'unknown'
CREATE TABLE IF NOT EXISTS dxf_layer_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  layer_name    TEXT NOT NULL,           -- raw DXF layer name (may include XREF prefix)
  short_name    TEXT NOT NULL,           -- stripped (after $0$)
  category      TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (category IN ('tag','description','pipe','equipment','title','ignore','unknown')),
  tag_priority  INTEGER NOT NULL DEFAULT 99, -- lower = higher priority for tag extraction
  ai_classified BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence REAL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, layer_name)
);

CREATE INDEX IF NOT EXISTS idx_dxf_layer_profiles_project ON dxf_layer_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_dxf_layer_profiles_category ON dxf_layer_profiles(project_id, category);

-- AI pre-pass results per document (layer classification run once per upload)
CREATE TABLE IF NOT EXISTS dxf_layer_analysis (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  layer_name     TEXT NOT NULL,
  short_name     TEXT NOT NULL,
  sample_texts   JSONB,               -- up to 10 sample text values from this layer
  ai_category    TEXT,                -- AI suggested category
  ai_confidence  REAL,
  ai_reasoning   TEXT,
  final_category TEXT,                -- human override or accepted AI suggestion
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, layer_name)
);

CREATE INDEX IF NOT EXISTS idx_dxf_layer_analysis_document ON dxf_layer_analysis(document_id);
