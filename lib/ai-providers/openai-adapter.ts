import OpenAI from 'openai';
import {
  IVisionProvider,
  VisionCompletionOptions,
  VisionCompletionResult,
} from './types';
import { optimizeImageForVision } from './image-utils';

/**
 * OpenAI Multimodal / Vision Provider Adapter
 * Supports GPT-4o, GPT-4o-mini, o1, etc.
 */
export class OpenAIVisionAdapter implements IVisionProvider {
  readonly name = 'openai' as const;
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string, baseURL?: string) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured — please set it in Settings or .env.local');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL?.trim() ? baseURL.trim() : undefined,
    });
    this.defaultModel = model || 'gpt-4o';
  }

  async generateVisionCompletion(
    options: VisionCompletionOptions,
  ): Promise<VisionCompletionResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    const userParts: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: options.prompt },
    ];

    if (options.imageBase64 && options.imageBase64.trim().length > 0) {
      const { base64: optMainB64, mimeType: optMainMime } = await optimizeImageForVision(
        options.imageBase64,
        options.mimeType || 'image/png',
      );
      userParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${optMainMime};base64,${optMainB64}`,
          detail: 'high',
        },
      });
    }

    if (options.inlineCropCrops && options.inlineCropCrops.size > 0) {
      for (const [key, cropB64] of options.inlineCropCrops) {
        const { base64: optCropB64, mimeType: optCropMime } = await optimizeImageForVision(
          cropB64,
          'image/png',
        );
        userParts.push({
          type: 'text',
          text: `[Reference Symbol: ${key}]`,
        });
        userParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${optCropMime};base64,${optCropB64}`,
            detail: 'low',
          },
        });
      }
    }

    messages.push({ role: 'user', content: userParts });

    const completion = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    });

    const choice = completion.choices[0];
    const text = choice?.message?.content || '';

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
      provider: 'openai',
      model: this.defaultModel,
      usage: {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      },
    };
  }

  async scanModels(apiKey: string, baseURL?: string): Promise<string[]> {
    const scanClient = new OpenAI({
      apiKey,
      baseURL: baseURL?.trim() ? baseURL.trim() : undefined,
    });
    const response = await scanClient.models.list();
    const models: string[] = [];
    const allModels: string[] = [];

    for await (const model of response) {
      allModels.push(model.id);
      const id = model.id.toLowerCase();
      // Filter models with vision capability
      if (
        (id.includes('gpt-4o') ||
          id.includes('gpt-4-turbo') ||
          id.includes('gpt-4-vision') ||
          id.includes('o1') ||
          id.includes('chatgpt-4o') ||
          id.includes('vision') ||
          id.includes('sonnet') ||
          id.includes('flash') ||
          id.includes('gemini') ||
          id.includes('claude')) &&
        !id.includes('audio') &&
        !id.includes('realtime')
      ) {
        models.push(model.id);
      }
    }

    // If custom proxy uses non-standard names, fallback to returning all available models
    const pool = models.length > 0 ? models : allModels;

    // Sort: flagship models first
    return pool.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      if (aLower === 'gpt-4o') return -1;
      if (bLower === 'gpt-4o') return 1;
      if (aLower === 'gpt-4o-mini') return -1;
      if (bLower === 'gpt-4o-mini') return 1;
      return a.localeCompare(b);
    });
  }
}
