-- Migration 012: Multi-Provider Vision AI (OpenAI & Anthropic Claude support)
-- Adds API keys and model configuration columns to settings table

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
  ADD COLUMN IF NOT EXISTS openai_model VARCHAR(100) DEFAULT 'gpt-4o',
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT,
  ADD COLUMN IF NOT EXISTS anthropic_model VARCHAR(100) DEFAULT 'claude-3-7-sonnet-20250219';

COMMENT ON COLUMN settings.openai_api_key IS 'API Key for OpenAI Vision & Chat completions';
COMMENT ON COLUMN settings.openai_model IS 'Selected model for OpenAI (e.g. gpt-4o, gpt-4o-mini, o1)';
COMMENT ON COLUMN settings.anthropic_api_key IS 'API Key for Anthropic Claude Vision completions';
COMMENT ON COLUMN settings.anthropic_model IS 'Selected model for Anthropic (e.g. claude-3-7-sonnet-20250219, claude-3-5-haiku-20241022)';
