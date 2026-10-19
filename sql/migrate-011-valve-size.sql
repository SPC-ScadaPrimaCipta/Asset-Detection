-- Migration 011: Add size column to detections and assets tables if not present
-- Supports valve size inference from piping line numbers (e.g. 2", 4", DN100)

ALTER TABLE detections ADD COLUMN IF NOT EXISTS size VARCHAR(255);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS size VARCHAR(255);
