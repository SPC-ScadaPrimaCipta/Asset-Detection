/**
 * Detection pipeline is 100% Gemini Vision.
 *
 * These tests lock the contract points that changed when the OCR / OpenCV /
 * YOLO stages were removed and Run Detection was aligned with Scan Legend:
 *   1. No OCR text ever reaches the model (DetectionJobInput has no such field).
 *   2. DeepSeek is refused for images with the same message Scan Legend uses.
 *   3. The rendered page PNG is the only model input.
 *
 * @/lib/ai-config and @/lib/model-resolver are mocked so no DB or API key is
 * needed; runDetectionAgent reads the config on every call, so a single module
 * instance is enough.
 */
import { runDetectionAgent, type DetectionJobInput } from '@/lib/ai-agent';

jest.mock('@/lib/ai-config', () => ({
  getAiConfig: jest.fn(),
}));

jest.mock('@/lib/model-resolver', () => ({
  resolveGeminiModels: jest.fn(async () => ['gemini-test-model']),
}));

import { getAiConfig } from '@/lib/ai-config';

const getAiConfigMock = getAiConfig as unknown as jest.Mock;

function baseInput(): DetectionJobInput {
  return { page: 1, pageImageBase64: 'AAAA', legendId: 'legend-1', legendSymbols: [] };
}

function setConfig(overrides: Record<string, unknown>) {
  getAiConfigMock.mockResolvedValue({
    provider: 'gemini',
    geminiKey: 'test-key',
    deepseekKey: undefined,
    geminiModel: 'gemini-test-model',
    deepseekModel: 'deepseek-chat',
    ...overrides,
  });
}

beforeEach(() => {
  getAiConfigMock.mockReset();
  setConfig({});
});

describe('DetectionJobInput contract — vision only', () => {
  it('carries no OCR text field', () => {
    expect('ocrText' in baseInput()).toBe(false);
  });

  it('carries no PDF file-URI / base64 fallback fields', () => {
    const input = baseInput();
    expect('fileUri' in input).toBe(false);
    expect('pdfBase64' in input).toBe(false);
  });

  it('carries no gap-filler context field', () => {
    expect('gapFillerContext' in baseInput()).toBe(false);
  });

  it('requires the rendered page PNG', () => {
    expect(baseInput().pageImageBase64).toBe('AAAA');
  });
});

describe('runDetectionAgent — DeepSeek is refused for images', () => {
  beforeEach(() => {
    setConfig({ provider: 'deepseek', geminiKey: undefined, deepseekKey: 'test-key' });
  });

  it('throws the same message Scan Legend uses', async () => {
    await expect(runDetectionAgent(baseInput())).rejects.toThrow(
      /DeepSeek cannot analyse images/,
    );
  });

  it('names the remedy in the error so the UI message is actionable', async () => {
    await expect(runDetectionAgent(baseInput())).rejects.toThrow(
      /switch provider to Gemini in Settings/,
    );
  });

  it('refuses before touching the model — no request is attempted', async () => {
    const { resolveGeminiModels } = jest.requireMock('@/lib/model-resolver');
    await expect(runDetectionAgent(baseInput())).rejects.toThrow();
    expect(resolveGeminiModels).not.toHaveBeenCalled();
  });
});

describe('runDetectionAgent — Gemini key required', () => {
  it('fails fast with an actionable message when no key is configured', async () => {
    setConfig({ geminiKey: undefined });
    await expect(runDetectionAgent(baseInput())).rejects.toThrow(
      /GEMINI_API_KEY not configured/,
    );
  });
});
