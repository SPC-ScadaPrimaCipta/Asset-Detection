// Komentar penjelas logika: adapter diuji dengan resolver dan client mock, tanpa jaringan.
import { createVerificationSdk } from '../scripts/pilot-verification-client';
import type { AiConfig } from '@/lib/ai-config';

function makeMockConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'gemini',
    geminiKey: 'resolver-key-not-displayed',
    openaiKey: undefined,
    anthropicKey: undefined,
    deepseekKey: undefined,
    geminiModel: 'gemini-3.5-flash-lite',
    openaiModel: '',
    anthropicModel: '',
    deepseekModel: '',
    ...overrides,
  };
}

function makeModelMock() {
  return {
    countTokens: jest.fn(async () => ({ totalTokens: 10 })),
    generateContent: jest.fn(async () => ({
      response: {
        text: () => '{"verification":[]}',
        usageMetadata: null,
        candidates: [{ finishReason: 'STOP' }],
      },
    })),
  };
}

describe('pilot-verification-client resolver lokal', () => {
  it('meneruskan key resolver ke client verification', async () => {
    const model = makeModelMock();
    const clientFactory = jest.fn(() => ({
      getGenerativeModel: jest.fn(() => model),
    }));
    await createVerificationSdk({
      modelName: 'gemini-3.5-flash-lite',
      maxOutputTokens: 4096,
      requestParts: [],
      getConfig: async () => makeMockConfig(),
      clientFactory,
    });
    expect(clientFactory).toHaveBeenCalledWith('resolver-key-not-displayed');
  });

  it('placeholder environment tidak menggantikan key resolver', async () => {
    const original = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'your_gemini_key_here';
    try {
      const clientFactory = jest.fn(() => ({ getGenerativeModel: () => makeModelMock() }));
      await createVerificationSdk({
        modelName: 'gemini-3.5-flash-lite', maxOutputTokens: 4096, requestParts: [],
        getConfig: async () => makeMockConfig(), clientFactory,
      });
      expect(clientFactory).toHaveBeenCalledTimes(1);
      expect((clientFactory.mock.calls as unknown as string[][])[0][0]).not.toBe('your_gemini_key_here');
    } finally {
      if (original === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = original;
    }
  });

  it('resolver kosong atau placeholder berhenti sebelum SDK client dibuat', async () => {
    for (const key of ['', 'your_gemini_key_here']) {
      const clientFactory = jest.fn(() => ({ getGenerativeModel: () => makeModelMock() }));
      await expect(createVerificationSdk({
        modelName: 'gemini-3.5-flash-lite', maxOutputTokens: 4096, requestParts: [],
        getConfig: async () => makeMockConfig({ geminiKey: key }), clientFactory,
      })).rejects.toThrow('Effective Gemini credential unavailable');
      expect(clientFactory).not.toHaveBeenCalled();
    }
  });
});
