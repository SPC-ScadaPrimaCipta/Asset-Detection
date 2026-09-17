CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  ai_provider VARCHAR(50) NOT NULL DEFAULT 'gemini',
  gemini_api_key TEXT,
  deepseek_api_key TEXT,
  gemini_model VARCHAR(100) DEFAULT 'gemini-2.0-flash',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure only one settings record
ALTER TABLE settings ADD CONSTRAINT settings_single_row CHECK (id = 1);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
