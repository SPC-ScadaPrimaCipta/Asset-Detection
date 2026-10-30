import Anthropic from '@anthropic-ai/sdk';
import {
  IVisionProvider,
  VisionCompletionOptions,
  VisionCompletionResult,
} from './types';
import { optimizeImageForVision } from './image-utils';

/**
 * Anthropic Claude Multimodal / Vision Provider Adapter
 * Supports Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
 */
export class ClaudeVisionAdapter implements IVisionProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured — please set it in Settings or .env.local');
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = model || 'claude-3-7-sonnet-20250219';
  }

  async generateVisionCompletion(
    options: VisionCompletionOptions,
  ): Promise<VisionCompletionResult> {
    const contentParts: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

    // System instruction can also be appended to prompt or system parameter
    const promptWithSchema = options.responseSchema
      ? `${options.prompt}\n\nIMPORTANT: Return ONLY a valid JSON object matching the requested schema. No markdown fences, no explanatory text.`
      : options.prompt;

    contentParts.push({
      type: 'text',
      text: promptWithSchema,
    });

    // Main image part (optional)
    if (options.imageBase64 && options.imageBase64.trim().length > 0) {
      const { base64: optMainB64, mimeType: optMainMime } = await optimizeImageForVision(
        options.imageBase64,
        options.mimeType || 'image/png',
      );
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (optMainMime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'),
          data: optMainB64,
        },
      });
    }

    // Reference crops if provided
    if (options.inlineCropCrops && options.inlineCropCrops.size > 0) {
      for (const [key, cropB64] of options.inlineCropCrops) {
        const { base64: optCropB64, mimeType: optCropMime } = await optimizeImageForVision(
          cropB64,
          'image/png',
        );
        contentParts.push({
          type: 'text',
          text: `[Reference Symbol: ${key}]`,
        });
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (optCropMime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'),
            data: optCropB64,
          },
        });
      }
    }

    const message = await this.client.messages.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.1,
      system: options.systemPrompt || 'You are an expert industrial P&ID and engineering drawing analysis AI.',
      messages: [
        {
          role: 'user',
          content: contentParts,
        },
      ],
    });

    const firstBlock = message.content[0];
    const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';

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

    return {
      text,
      parsedJson,
      provider: 'anthropic',
      model: this.defaultModel,
      usage: {
        promptTokens: message.usage?.input_tokens,
        completionTokens: message.usage?.output_tokens,
        totalTokens: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
      },
    };
  }

  async scanModels(apiKey: string): Promise<string[]> {
    // Anthropic provides official stable multimodal models
    const officialVisionModels = [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];

    if (!apiKey) return officialVisionModels;

    try {
      // Test key validity by querying models endpoint if available
      const testClient = new Anthropic({ apiKey });
      const res = await testClient.models.list();
      const models: string[] = [];
      for await (const m of res) {
        if (m.id.includes('claude-3')) {
          models.push(m.id);
        }
      }
      if (models.length > 0) {
        return models;
      }
    } catch {
      // Fallback to official verified vision list
    }

    return officialVisionModels;
  }
}
