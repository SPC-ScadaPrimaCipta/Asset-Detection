import { NextRequest } from 'next/server';
import { POST } from '@/app/api/settings/scan-models/route';

jest.mock('@/lib/ai-config', () => ({
  getAiConfig: jest.fn().mockResolvedValue({
    provider: 'gemini',
    geminiKey: '',
    openaiKey: '',
    anthropicKey: '',
    deepseekKey: '',
  }),
}));

jest.mock('@/lib/ai-providers', () => ({
  OpenAIVisionAdapter: jest.fn().mockImplementation(() => ({
    scanModels: jest.fn().mockResolvedValue(['gpt-4o', 'gpt-4o-mini', 'o1']),
  })),
  ClaudeVisionAdapter: jest.fn().mockImplementation(() => ({
    scanModels: jest.fn().mockResolvedValue([
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ]),
  })),
}));

describe('Scan Models API Route', () => {
  it('returns 400 when api_key is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/scan-models', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', api_key: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('API key required');
  });

  it('scans OpenAI models successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/scan-models', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', api_key: 'sk-valid-key' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.models).toEqual([
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      { id: 'o1', name: 'o1' },
    ]);
  });

  it('scans Anthropic Claude models successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/scan-models', {
      method: 'POST',
      body: JSON.stringify({ provider: 'anthropic', api_key: 'sk-ant-valid-key' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.models).toContainEqual({
      id: 'claude-3-7-sonnet-20250219',
      name: 'claude-3-7-sonnet-20250219',
    });
  });

  it('scans OpenAI-compatible models with custom base_url (e.g. 9router)', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/scan-models', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        api_key: 'sk-9router-key',
        base_url: 'https://api.9router.com/v1',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.quota?.info).toContain('https://api.9router.com/v1');
  });
});
