-- Migration 008: DXF document support
-- Adds file_type to documents and dxf_entities to document_pages.
-- Safe to run multiple times (idempotent).

-- file_type: 'pdf' (default, existing docs) or 'dxf'
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'pdf'
    CHECK (file_type IN ('pdf', 'dxf'));

-- dxf_entities: parsed DXF entity data stored per-page (DXF = single "page")
-- Stores extracted INSERT blocks, TEXT/MTEXT, LINE/LWPOLYLINE in JSONB.
ALTER TABLE document_pages
  ADD COLUMN IF NOT EXISTS dxf_entities JSONB;

-- dxf_layer_map: layer→category mapping extracted at parse time
ALTER TABLE document_pages
  ADD COLUMN IF NOT EXISTS dxf_layer_map JSONB;

-- Index for fast lookup by file_type
CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
