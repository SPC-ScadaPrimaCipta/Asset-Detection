import { getAiConfig, type AiConfig, type AIProvider } from '@/lib/ai-config';
import { IVisionProvider } from './types';
import { GeminiVisionAdapter } from './gemini-adapter';
import { OpenAIVisionAdapter } from './openai-adapter';
import { ClaudeVisionAdapter } from './claude-adapter';

export * from './types';
export * from './gemini-adapter';
export * from './openai-adapter';
export * from './claude-adapter';

/**
 * Returns the active Vision AI Provider based on system settings or supplied config.
 */
export async function getVisionProvider(overrideConfig?: AiConfig): Promise<IVisionProvider> {
  const config = overrideConfig || await getAiConfig();

  switch (config.provider) {
    case 'openai':
      return new OpenAIVisionAdapter(config.openaiKey, config.openaiModel, config.openaiBaseUrl);

    case 'anthropic':
      return new ClaudeVisionAdapter(config.anthropicKey, config.anthropicModel);

    case 'deepseek':
      throw new Error(
        'DeepSeek does not currently support Multimodal/Vision tasks. Please select Google Gemini, OpenAI, or Anthropic in Settings.',
      );

    case 'gemini':
    default:
      return new GeminiVisionAdapter(config.geminiKey, config.geminiModel);
  }
}

/**
 * Creates an explicit vision provider instance with specific credentials (e.g. for testing / scanning).
 */
export function makeVisionProvider(
  provider: AIProvider,
  apiKey: string,
  model?: string,
  baseURL?: string,
): IVisionProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIVisionAdapter(apiKey, model, baseURL);
    case 'anthropic':
      return new ClaudeVisionAdapter(apiKey, model);
    case 'gemini':
      return new GeminiVisionAdapter(apiKey, model);
    default:
      throw new Error(`Unsupported vision provider: ${provider}`);
  }
}
