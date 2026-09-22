-- Migration: Built-in Standard Legends
-- Adds is_builtin and standard_code columns to legends table.
-- is_builtin = true  → cannot be edited or deleted by users
-- standard_code      → identifier: 'ISA_5_1' | 'ISO_10628_2' | 'COMBINED'

ALTER TABLE legends ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE legends ADD COLUMN IF NOT EXISTS standard_code TEXT;

-- Index for fast lookup of builtin legends
CREATE INDEX IF NOT EXISTS idx_legends_is_builtin ON legends(is_builtin);
CREATE INDEX IF NOT EXISTS idx_legends_standard_code ON legends(standard_code);

-- Also add standard_code to legend_symbols so AI prompt knows which standard each symbol belongs to
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS standard_code TEXT;
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS isa_function_code TEXT;   -- e.g. 'F', 'P', 'T', 'L'
ALTER TABLE legend_symbols ADD COLUMN IF NOT EXISTS iso_category TEXT;        -- e.g. 'vessels', 'rotating', 'heat_transfer'
