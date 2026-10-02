-- Migration: Knowledge-First Detection Pipeline
-- pgvector, symbol_embeddings, symbol_cache, negative_learning,
-- detection_audit_trail, rule_engine_rules, company_knowledge hierarchy upgrade

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS symbol_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  tag_prefix TEXT,
  canonical_features TEXT NOT NULL,
  embedding vector(768),
  crop_hash TEXT,
  confirmed_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_se_project ON symbol_embeddings(project_id);
CREATE INDEX IF NOT EXISTS idx_se_asset_type ON symbol_embeddings(asset_type);
CREATE INDEX IF NOT EXISTS idx_se_crop_hash ON symbol_embeddings(crop_hash);
CREATE INDEX IF NOT EXISTS idx_se_embedding ON symbol_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

CREATE TABLE IF NOT EXISTS symbol_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_hash TEXT NOT NULL UNIQUE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  asset_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  tag_prefix TEXT,
  canonical_features TEXT,
  confidence REAL NOT NULL,
  confidence_breakdown JSONB,
  detection_source TEXT NOT NULL DEFAULT 'CACHE',
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  invalidated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_hash ON symbol_cache(image_hash);
CREATE INDEX IF NOT EXISTS idx_sc_project ON symbol_cache(project_id);
CREATE INDEX IF NOT EXISTS idx_sc_invalidated ON symbol_cache(invalidated);

CREATE TABLE IF NOT EXISTS negative_learning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  predicted_asset_type TEXT NOT NULL,
  correct_asset_type TEXT,
  canonical_features TEXT,
  crop_hash TEXT,
  prediction_confidence REAL,
  negative_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nl_project ON negative_learning(project_id);
CREATE INDEX IF NOT EXISTS idx_nl_predicted ON negative_learning(predicted_asset_type);
CREATE INDEX IF NOT EXISTS idx_nl_crop_hash ON negative_learning(crop_hash);

CREATE TABLE IF NOT EXISTS detection_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID REFERENCES detections(id) ON DELETE CASCADE,
  job_id UUID REFERENCES detection_jobs(id) ON DELETE CASCADE,
  decision_path JSONB NOT NULL DEFAULT '[]',
  confidence_history JSONB NOT NULL DEFAULT '[]',
  confidence_breakdown JSONB,
  evidence_sources JSONB NOT NULL DEFAULT '[]',
  processing_time_ms INT,
  final_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dat_detection ON detection_audit_trail(detection_id);
CREATE INDEX IF NOT EXISTS idx_dat_job ON detection_audit_trail(job_id);

CREATE TABLE IF NOT EXISTS rule_engine_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL UNIQUE,
  rules JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rer_asset_type ON rule_engine_rules(asset_type);

ALTER TABLE company_knowledge ADD COLUMN IF NOT EXISTS drawing_type TEXT;
ALTER TABLE company_knowledge ADD COLUMN IF NOT EXISTS geometry_hints JSONB;
