-- Migration: DXF pipe relations — FROM/TO topology extracted from PID graph
-- Safe to run multiple times (idempotent).

-- Stores directed pipe connections between detected assets on the same DXF document.
-- Each row = one pipe segment connecting two equipment nodes.
CREATE TABLE IF NOT EXISTS dxf_pipe_relations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES detection_jobs(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  pid_page        INTEGER NOT NULL DEFAULT 1,

  -- Source asset (FROM end)
  from_tag        TEXT,               -- asset tag at the start of flow
  from_detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,

  -- Destination asset (TO end)
  to_tag          TEXT,               -- asset tag at the end of flow
  to_detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,

  -- Pipe line identity (from piping line label text)
  pipe_line_id    TEXT,               -- full line spec text e.g. "6\"-WS-B-007"
  pipe_size       TEXT,               -- nominal size e.g. "6\""
  pipe_service    TEXT,               -- service code e.g. "WS"
  pipe_spec       TEXT,               -- spec class e.g. "B-007"

  -- Flow direction keyword from label text (TO / FROM / AT / OF)
  direction_keyword TEXT,             -- 'TO' | 'FROM' | 'AT' | 'OF' | 'CONNECTED'

  -- Confidence of the relation (graph connectivity strength)
  confidence      REAL NOT NULL DEFAULT 0.7,

  -- Graph topology context
  graph_path_length INTEGER,          -- number of edges in shortest path
  evidence        JSONB NOT NULL DEFAULT '[]',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent exact duplicate relations per job
  UNIQUE (job_id, from_tag, to_tag, direction_keyword)
);

CREATE INDEX IF NOT EXISTS idx_dxf_pipe_relations_job      ON dxf_pipe_relations(job_id);
CREATE INDEX IF NOT EXISTS idx_dxf_pipe_relations_document ON dxf_pipe_relations(document_id);
CREATE INDEX IF NOT EXISTS idx_dxf_pipe_relations_from_tag ON dxf_pipe_relations(from_tag);
CREATE INDEX IF NOT EXISTS idx_dxf_pipe_relations_to_tag   ON dxf_pipe_relations(to_tag);
