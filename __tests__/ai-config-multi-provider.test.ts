import { getAiConfig, clearAiConfigCache } from '@/lib/ai-config';
import { pool } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

describe('Multi-Provider AI Config Integration', () => {
  beforeEach(() => {
    clearAiConfigCache();
    jest.clearAllMocks();
  });

  it('reads openai provider and credentials from database row', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          ai_provider: 'openai',
          openai_api_key: 'sk-test-openai-12345',
          openai_model: 'gpt-4o-mini',
          gemini_api_key: 'gemini-key',
          gemini_model: 'gemini-2.5-flash',
        },
      ],
    });

    const cfg = await getAiConfig({ force: true });
    expect(cfg.provider).toBe('openai');
    expect(cfg.openaiKey).toBe('sk-test-openai-12345');
    expect(cfg.openaiModel).toBe('gpt-4o-mini');
  });

  it('reads anthropic provider and credentials from database row', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          ai_provider: 'anthropic',
          anthropic_api_key: 'sk-ant-test-99999',
          anthropic_model: 'claude-3-7-sonnet-20250219',
        },
      ],
    });

    const cfg = await getAiConfig({ force: true });
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.anthropicKey).toBe('sk-ant-test-99999');
    expect(cfg.anthropicModel).toBe('claude-3-7-sonnet-20250219');
  });

  it('falls back to gemini when provider in database is unrecognized', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          ai_provider: 'some-unknown-provider',
          gemini_api_key: 'gem-key',
        },
      ],
    });

    const cfg = await getAiConfig({ force: true });
    expect(cfg.provider).toBe('gemini');
  });
});
