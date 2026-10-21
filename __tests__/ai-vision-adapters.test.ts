import {
  OpenAIVisionAdapter,
  ClaudeVisionAdapter,
  GeminiVisionAdapter,
  makeVisionProvider,
} from '@/lib/ai-providers';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({ symbols: [{ asset_type: 'Pump', asset_tag: 'P-101' }] }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
        }),
      },
    },
    models: {
      list: jest.fn().mockResolvedValue([
        { id: 'gpt-4o' },
        { id: 'gpt-4o-mini' },
        { id: 'gpt-3.5-turbo' },
        { id: 'text-embedding-3-small' },
      ]),
    },
  }));
});

// Mock Anthropic
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ symbols: [{ asset_type: 'Gate Valve', asset_tag: 'GTV-001' }] }),
          },
        ],
        usage: { input_tokens: 150, output_tokens: 50 },
      }),
    },
    models: {
      list: jest.fn().mockResolvedValue([
        { id: 'claude-3-7-sonnet-20250219' },
        { id: 'claude-3-5-haiku-20241022' },
      ]),
    },
  }));
});

// Mock GoogleGenerativeAI
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({ symbols: [{ asset_type: 'Vessel', asset_tag: 'V-101' }] }),
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
        },
      }),
    }),
  })),
}));

describe('Unified AI Vision Providers', () => {
  describe('OpenAIVisionAdapter', () => {
    it('throws an error if API key is missing', () => {
      expect(() => new OpenAIVisionAdapter('')).toThrow('OPENAI_API_KEY is not configured');
    });

    it('formats vision completion and parses structured JSON', async () => {
      const adapter = new OpenAIVisionAdapter('test-key', 'gpt-4o');
      const res = await adapter.generateVisionCompletion({
        prompt: 'Detect symbols',
        imageBase64: 'fake-png-base64',
      });

      expect(res.provider).toBe('openai');
      expect(res.model).toBe('gpt-4o');
      expect(res.parsedJson).toEqual({ symbols: [{ asset_type: 'Pump', asset_tag: 'P-101' }] });
      expect(res.usage?.totalTokens).toBe(165);
    });

    it('scans and filters vision-capable models', async () => {
      const adapter = new OpenAIVisionAdapter('test-key');
      const models = await adapter.scanModels('test-key');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).not.toContain('gpt-3.5-turbo');
      expect(models).not.toContain('text-embedding-3-small');
    });

    it('supports custom baseURL (e.g. 9router/OpenRouter gateway)', async () => {
      const adapter = new OpenAIVisionAdapter('test-key', 'gpt-4o', 'https://api.9router.com/v1');
      expect(adapter.name).toBe('openai');
      const models = await adapter.scanModels('test-key', 'https://api.9router.com/v1');
      expect(models).toContain('gpt-4o');
    });
  });

  describe('ClaudeVisionAdapter', () => {
    it('throws an error if API key is missing', () => {
      expect(() => new ClaudeVisionAdapter('')).toThrow('ANTHROPIC_API_KEY is not configured');
    });

    it('formats vision message and parses JSON result', async () => {
      const adapter = new ClaudeVisionAdapter('test-key', 'claude-3-7-sonnet-20250219');
      const res = await adapter.generateVisionCompletion({
        prompt: 'Find valves',
        imageBase64: 'fake-png-base64',
      });

      expect(res.provider).toBe('anthropic');
      expect(res.model).toBe('claude-3-7-sonnet-20250219');
      expect(res.parsedJson).toEqual({ symbols: [{ asset_type: 'Gate Valve', asset_tag: 'GTV-001' }] });
      expect(res.usage?.totalTokens).toBe(200);
    });

    it('scans available claude vision models', async () => {
      const adapter = new ClaudeVisionAdapter('test-key');
      const models = await adapter.scanModels('test-key');
      expect(models).toContain('claude-3-7-sonnet-20250219');
    });
  });

  describe('Factory makeVisionProvider', () => {
    it('instantiates appropriate provider based on parameter', () => {
      const openai = makeVisionProvider('openai', 'key');
      expect(openai.name).toBe('openai');

      const claude = makeVisionProvider('anthropic', 'key');
      expect(claude.name).toBe('anthropic');

      const gemini = makeVisionProvider('gemini', 'key');
      expect(gemini.name).toBe('gemini');
    });
  });
});
