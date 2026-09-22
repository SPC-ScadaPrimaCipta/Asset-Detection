-- Initial Schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

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
    standard_code TEXT,       -- 'ISA_5_1', 'ISO_10628_2', null for user legends
    is_builtin BOOLEAN DEFAULT FALSE,
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
    standard_code TEXT,
    isa_function_code TEXT,
    iso_category TEXT,
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
    -- Knowledge-First fields
    detection_source TEXT DEFAULT 'VISION',
    canonical_features TEXT,
    crop_hash TEXT,
    embedding vector(768),
    confidence_breakdown JSONB,
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

-- Company Knowledge (hierarchical: project+drawing_type → project → global)
CREATE TABLE company_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    drawing_type TEXT,               -- 'P&ID', 'PFD', 'ISOMETRIC', null = any
    tag_prefix TEXT,
    asset_type TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    category TEXT,
    symbol_description TEXT,
    geometry_hints JSONB,
    source_detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
    confirmed_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Symbol Embeddings (pgvector — confirmed symbols)
CREATE TABLE symbol_embeddings (
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

-- Symbol Cache (SHA256 exact match — fastest pipeline stage)
CREATE TABLE symbol_cache (
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

-- Negative Learning (rejection history — never deleted, increments counter)
CREATE TABLE negative_learning (
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

-- Detection Audit Trail (full decision path per detection)
CREATE TABLE detection_audit_trail (
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

-- Configurable Rule Engine (JSON rules per asset type)
CREATE TABLE rule_engine_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_type TEXT NOT NULL UNIQUE,
    rules JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_detections_job ON detections(job_id);
CREATE INDEX idx_detections_document ON detections(document_id);
CREATE INDEX idx_detections_crop_hash ON detections(crop_hash);
CREATE INDEX idx_detections_detection_source ON detections(detection_source);
CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_assets_document ON assets(document_id);
CREATE INDEX idx_ck_project ON company_knowledge(project_id);
CREATE INDEX idx_ck_tag_prefix ON company_knowledge(tag_prefix);
CREATE INDEX idx_se_project ON symbol_embeddings(project_id);
CREATE INDEX idx_se_asset_type ON symbol_embeddings(asset_type);
CREATE INDEX idx_se_crop_hash ON symbol_embeddings(crop_hash);
CREATE INDEX idx_se_embedding ON symbol_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX idx_sc_hash ON symbol_cache(image_hash);
CREATE INDEX idx_sc_project ON symbol_cache(project_id);
CREATE INDEX idx_sc_invalidated ON symbol_cache(invalidated);
CREATE INDEX idx_nl_project ON negative_learning(project_id);
CREATE INDEX idx_nl_predicted ON negative_learning(predicted_asset_type);
CREATE INDEX idx_nl_crop_hash ON negative_learning(crop_hash);
CREATE INDEX idx_dat_detection ON detection_audit_trail(detection_id);
CREATE INDEX idx_dat_job ON detection_audit_trail(job_id);
CREATE INDEX idx_rer_asset_type ON rule_engine_rules(asset_type);
