-- Migration: pgvector training embeddings for continuous learning
-- Run: psql -U postgres -d asset_detection -f sql/migrate-pgvector-training.sql

-- Enable pgvector extension if not exists
CREATE EXTENSION IF NOT EXISTS vector;

-- Approved detection training data dengan visual embeddings
CREATE TABLE IF NOT EXISTS asset_training_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
  asset_tag TEXT,
  asset_type TEXT NOT NULL,
  symbol_category TEXT, -- Tank, Pump, Valve, Instrument, Fitting
  dxf_layer TEXT,
  
  -- Bounding box dalam koordinat DXF asli
  bbox_dxf_x_min FLOAT,
  bbox_dxf_y_min FLOAT,
  bbox_dxf_x_max FLOAT,
  bbox_dxf_y_max FLOAT,
  
  -- Bounding box dalam koordinat pixel (untuk reference)
  bbox_px_x INTEGER,
  bbox_px_y INTEGER,
  bbox_px_w INTEGER,
  bbox_px_h INTEGER,
  
  -- Path ke cropped image di storage/approved/
  crop_path TEXT NOT NULL,
  
  -- Visual embedding (512-dim dari CLIP ViT-B/32 atau ResNet)
  embedding vector(512),
  
  -- Metadata
  is_approved BOOLEAN DEFAULT TRUE,
  confidence_original FLOAT,
  source_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk fast vector similarity search (IVFFlat untuk dataset < 1M)
CREATE INDEX IF NOT EXISTS asset_training_embeddings_embedding_idx 
  ON asset_training_embeddings 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Composite index untuk filter + similarity
CREATE INDEX IF NOT EXISTS asset_training_embeddings_project_type_idx 
  ON asset_training_embeddings (project_id, asset_type);

CREATE INDEX IF NOT EXISTS asset_training_embeddings_category_idx 
  ON asset_training_embeddings (symbol_category);

-- Tambah embedding column ke legend_symbols (jika belum ada)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'legend_symbols' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE legend_symbols ADD COLUMN embedding vector(512);
  END IF;
END $$;

-- Index untuk legend_symbols embedding search
CREATE INDEX IF NOT EXISTS legend_symbols_embedding_idx 
  ON legend_symbols 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

-- Function helper untuk cosine similarity query
CREATE OR REPLACE FUNCTION find_similar_symbols(
  query_embedding vector(512),
  similarity_threshold FLOAT DEFAULT 0.85,
  result_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  asset_type TEXT,
  confidence FLOAT,
  crop_path TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ate.id,
    ate.asset_type,
    (1 - (ate.embedding <=> query_embedding))::FLOAT AS confidence,
    ate.crop_path
  FROM asset_training_embeddings ate
  WHERE ate.is_approved = TRUE
    AND ate.embedding IS NOT NULL
    AND (1 - (ate.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ate.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE asset_training_embeddings IS 'Continuous learning storage: approved detection crops with visual embeddings for similarity matching';
COMMENT ON COLUMN asset_training_embeddings.embedding IS '512-dimensional visual embedding from CLIP ViT-B/32';
COMMENT ON INDEX asset_training_embeddings_embedding_idx IS 'IVFFlat index for fast cosine similarity search (approximate nearest neighbor)';
