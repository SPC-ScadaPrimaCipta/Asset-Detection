-- Migration 003: add bbox + pid_page to legend_symbols
-- Coordinates are in PDF pixel space at scale=1 (natural PDF units)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legend_symbols' AND column_name='bbox_x') THEN
    ALTER TABLE legend_symbols ADD COLUMN bbox_x REAL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legend_symbols' AND column_name='bbox_y') THEN
    ALTER TABLE legend_symbols ADD COLUMN bbox_y REAL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legend_symbols' AND column_name='bbox_w') THEN
    ALTER TABLE legend_symbols ADD COLUMN bbox_w REAL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legend_symbols' AND column_name='bbox_h') THEN
    ALTER TABLE legend_symbols ADD COLUMN bbox_h REAL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legend_symbols' AND column_name='pid_page') THEN
    ALTER TABLE legend_symbols ADD COLUMN pid_page INTEGER DEFAULT 1;
  END IF;
END $$;
