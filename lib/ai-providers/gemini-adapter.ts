import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import {
  IVisionProvider,
  VisionCompletionOptions,
  VisionCompletionResult,
} from './types';
import { resolveGeminiModels } from '@/lib/model-resolver';

/**
 * Google Gemini Vision Provider Adapter
 */
export class GeminiVisionAdapter implements IVisionProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenerativeAI;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured — please set it in Settings or .env.local');
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.defaultModel = model || 'gemini-2.0-flash';
  }

  async generateVisionCompletion(
    options: VisionCompletionOptions,
  ): Promise<VisionCompletionResult> {
    const model = this.client.getGenerativeModel({
      model: options.model || this.defaultModel,
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: options.maxTokens ?? 4096,
        responseMimeType: 'application/json',
      },
    });

    const parts: Array<string | Part> = [];

    // System instructions can be prefixed or injected
    if (options.systemPrompt) {
      parts.push(`[System Instruction]\n${options.systemPrompt}\n\n`);
    }

    parts.push(options.prompt);

    // Primary image part (optional)
    if (options.imageBase64 && options.imageBase64.trim().length > 0) {
      parts.push({
        inlineData: {
          data: options.imageBase64,
          mimeType: options.mimeType || 'image/png',
        },
      });
    }

    // Reference crops if provided
    if (options.inlineCropCrops && options.inlineCropCrops.size > 0) {
      for (const [key, cropB64] of options.inlineCropCrops) {
        parts.push(`[Reference Symbol: ${key}]`);
        parts.push({
          inlineData: {
            data: cropB64,
            mimeType: 'image/png',
          },
        });
      }
    }

    const res = await model.generateContent(parts);
    const text = res.response.text();

    let parsedJson: Record<string, unknown> | null = null;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          parsedJson = JSON.parse(match[1]);
        } catch {}
      }
    }

    const usageMetadata = res.response.usageMetadata;

    return {
      text,
      parsedJson,
      provider: 'gemini',
      model: this.defaultModel,
      usage: {
        promptTokens: usageMetadata?.promptTokenCount,
        completionTokens: usageMetadata?.candidatesTokenCount,
        totalTokens: usageMetadata?.totalTokenCount,
      },
    };
  }

  async scanModels(apiKey: string): Promise<string[]> {
    if (!apiKey) return [];
    try {
      const models = await resolveGeminiModels();
      return models;
    } catch {
      return ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    }
  }
}
