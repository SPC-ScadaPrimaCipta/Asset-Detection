/**
 * Unified Vision AI Provider Types & Interface
 */

export interface VisionCompletionOptions {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  imageBase64?: string;          // Optional Base64-encoded PNG image data (text-only when omitted)
  mimeType?: string;            // Default: 'image/png'
  temperature?: number;         // Generation temperature (0.0 to 1.0)
  maxTokens?: number;           // Max output tokens
  responseFormat?: 'json' | 'text'; // Optional response format
  responseSchema?: unknown;     // Optional JSON schema or structured output description
  inlineCropCrops?: Map<string, string>; // Optional reference crops
}

export interface VisionCompletionResult {
  text: string;
  parsedJson?: Record<string, unknown> | null;
  provider: 'gemini' | 'openai' | 'anthropic';
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface IVisionProvider {
  readonly name: 'gemini' | 'openai' | 'anthropic';
  generateVisionCompletion(options: VisionCompletionOptions): Promise<VisionCompletionResult>;
  scanModels(apiKey: string): Promise<string[]>;
}
