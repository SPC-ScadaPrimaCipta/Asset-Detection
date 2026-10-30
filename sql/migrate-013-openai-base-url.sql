-- Migration 013: Add openai_base_url column to settings for custom OpenAI-compatible providers (e.g. 9router, OpenRouter, LiteLLM)
ALTER TABLE settings 
ADD COLUMN IF NOT EXISTS openai_base_url TEXT DEFAULT NULL;
