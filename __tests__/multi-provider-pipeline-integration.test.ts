import { extractLegendSymbolsFromPng } from '@/lib/legend-extract';
import { runDetectionAgent } from '@/lib/ai-agent';
import * as aiConfig from '@/lib/ai-config';
import * as aiProviders from '@/lib/ai-providers';

jest.mock('@/lib/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

describe('Multi-Provider Pipeline Integration', () => {
  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('extractLegendSymbolsFromPng works with OpenAI provider', async () => {
    jest.spyOn(aiConfig, 'getAiConfig').mockResolvedValue({
      provider: 'openai',
      geminiKey: undefined,
      openaiKey: 'sk-proj-mock-key',
      anthropicKey: undefined,
      deepseekKey: undefined,
      geminiModel: 'gemini-2.5-flash',
      openaiModel: 'gpt-4o',
      anthropicModel: 'claude-3-7-sonnet-20250219',
      deepseekModel: 'deepseek-chat',
    });

    const mockGenerateVision = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        symbols: [
          {
            name: 'Centrifugal Pump',
            assetType: 'Pump',
            tagPattern: 'P-###',
            description: 'Main pump',
            aliases: ['P'],
            bbox: [100, 100, 200, 200],
          },
        ],
      }),
      model: 'gpt-4o',
    });

    jest.spyOn(aiProviders, 'getVisionProvider').mockResolvedValue({
      name: 'openai',
      generateVisionCompletion: mockGenerateVision,
      scanModels: jest.fn(),
    });

    const symbols = await extractLegendSymbolsFromPng(samplePngBase64, 1);
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].asset_type).toBe('Pump');
    expect(symbols[0].symbol_name).toBe('Centrifugal Pump');
    expect(mockGenerateVision).toHaveBeenCalled();
  });

  test('runDetectionAgent works with Anthropic provider', async () => {
    jest.spyOn(aiConfig, 'getAiConfig').mockResolvedValue({
      provider: 'anthropic',
      geminiKey: undefined,
      openaiKey: undefined,
      anthropicKey: 'sk-ant-mock-key',
      deepseekKey: undefined,
      geminiModel: 'gemini-2.5-flash',
      openaiModel: 'gpt-4o',
      anthropicModel: 'claude-3-7-sonnet-20250219',
      deepseekModel: 'deepseek-chat',
    });

    const mockGenerateVision = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        page: 1,
        detections: [
          {
            assetType: 'Gate Valve',
            assetTag: 'GV-101',
            confidence: 0.95,
            bbox: { x: 300, y: 400, width: 50, height: 50 },
            legendSymbol: 'Gate Valve',
            evidence: ['Visual match'],
          },
        ],
      }),
      model: 'claude-3-7-sonnet-20250219',
    });

    jest.spyOn(aiProviders, 'getVisionProvider').mockResolvedValue({
      name: 'anthropic',
      generateVisionCompletion: mockGenerateVision,
      scanModels: jest.fn(),
    });

    const result = await runDetectionAgent({
      page: 1,
      pageImageBase64: samplePngBase64,
      legendId: 'legend-1',
      legendSymbols: [
        {
          id: 'sym-1',
          legend_id: 'legend-1',
          asset_type: 'Gate Valve',
          symbol_name: 'Gate Valve',
          tag_pattern: 'GV-###',
          description: null,
          aliases: ['GV'],
          standard_code: null,
          isa_function_code: null,
          iso_category: null,
        },
      ],
      pngWidth: 1000,
      pngHeight: 1000,
    });

    expect(result.page).toBe(1);
    expect(result.detections.length).toBe(1);
    expect(result.detections[0].assetTag).toBe('GV-101');
    expect(mockGenerateVision).toHaveBeenCalled();
  });
});
