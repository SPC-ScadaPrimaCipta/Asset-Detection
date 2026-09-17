-- Initial Schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE legends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DRAFT')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE legend_symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legend_id UUID REFERENCES legends(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    symbol_name TEXT,
    tag_pattern TEXT,
    description TEXT,
    aliases TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DRAFT','REJECTED')),
    bbox_x INTEGER,
    bbox_y INTEGER,
    bbox_w INTEGER,
    bbox_h INTEGER,
    pid_page INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE legend_symbol_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol_id UUID REFERENCES legend_symbols(id) ON DELETE CASCADE,
    legend_id UUID REFERENCES legends(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','APPROVE','REJECT')),
    old_values JSONB,
    new_values JSONB,
    performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    page_count INTEGER,
    mime_type TEXT DEFAULT 'application/pdf',
    file_size INTEGER,
    status TEXT DEFAULT 'UPLOADED',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    image_path TEXT,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, page_number)
);

CREATE TABLE detection_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    legend_id UUID REFERENCES legends(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'PENDING',
    progress_pct INTEGER DEFAULT 0,
    error_detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES detection_jobs(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt_version TEXT DEFAULT 'v1',
    status TEXT DEFAULT 'PENDING',
    input_metadata JSONB,
    output_metadata JSONB,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES detection_jobs(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    document_page_id UUID REFERENCES document_pages(id) ON DELETE SET NULL,
    asset_tag TEXT,
    asset_type TEXT,
    equipment_class TEXT,
    description TEXT,
    service TEXT,
    location TEXT,
    unit TEXT,
    area TEXT,
    pid_number TEXT,
    pid_page INTEGER,
    legend_id UUID REFERENCES legends(id) ON DELETE SET NULL,
    legend_symbol_id UUID REFERENCES legend_symbols(id) ON DELETE SET NULL,
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    bbox_x INTEGER,
    bbox_y INTEGER,
    bbox_w INTEGER,
    bbox_h INTEGER,
    evidence JSONB,
    detection_status TEXT DEFAULT 'DETECTED',
    review_status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detection_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_id UUID REFERENCES detections(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('CONFIRM','REJECT','EDIT','MANUAL_CREATE')),
    old_values JSONB,
    new_values JSONB,
    performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    document_page_id UUID REFERENCES document_pages(id) ON DELETE SET NULL,
    detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
    asset_tag TEXT,
    asset_type TEXT NOT NULL,
    equipment_class TEXT,
    description TEXT,
    service TEXT,
    location TEXT,
    unit TEXT,
    area TEXT,
    pid_number TEXT,
    pid_page INTEGER,
    legend_id UUID REFERENCES legends(id) ON DELETE SET NULL,
    legend_symbol_id UUID REFERENCES legend_symbols(id) ON DELETE SET NULL,
    confidence REAL,
    detection_status TEXT DEFAULT 'DETECTED',
    review_status TEXT DEFAULT 'PENDING',
    bbox_x INTEGER,
    bbox_y INTEGER,
    bbox_w INTEGER,
    bbox_h INTEGER,
    evidence JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_detections_job ON detections(job_id);
CREATE INDEX idx_detections_document ON detections(document_id);
CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_assets_document ON assets(document_id);

-- Legend symbol bounding box (normalized 0-1000) + page location
-- Extracted by AI during legend PDF parse; used in legend review viewer.
-- CREATE TABLE above already includes these columns for fresh installs;
-- the ALTERs below keep existing DBs in sync (idempotent).
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS bbox_x INTEGER;
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS bbox_y INTEGER;
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS bbox_w INTEGER;
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS bbox_h INTEGER;
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS pid_page INTEGER;
