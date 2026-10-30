// Komentar penjelas logika: adapter client verification pilot memakai resolver AI existing.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAiConfig, type AiConfig } from '../lib/ai-config';
import type { VerificationSdk, VerificationSdkResponse } from './pilot-verification-runner';

export interface VerificationClientFactory {
  (apiKey: string): {
    getGenerativeModel(options: {
      model: string;
      generationConfig: {
        temperature: number;
        maxOutputTokens: number;
        responseMimeType: 'application/json';
      };
    }): {
      countTokens(parts: unknown[]): Promise<{ totalTokens?: number }>;
      generateContent(parts: unknown[]): Promise<{
        response: {
          text(): string;
          usageMetadata?: unknown;
          candidates?: Array<{ finishReason?: string | null }>;
        };
      }>;
    };
  };
}

export interface CreateVerificationSdkOptions {
  modelName: string;
  maxOutputTokens: number;
  requestParts: unknown[];
  getConfig?: () => Promise<AiConfig>;
  clientFactory?: VerificationClientFactory;
}

const PLACEHOLDER_KEY = 'your_gemini_key_here';

function isUsableKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim().length > 0 && key.trim() !== PLACEHOLDER_KEY;
}

export async function createVerificationSdk(
  options: CreateVerificationSdkOptions,
): Promise<{ sdk: VerificationSdk; modelName: string }> {
  const resolveConfig = options.getConfig ?? getAiConfig;
  const config = await resolveConfig();
  const key = config.geminiKey;
  if (!isUsableKey(key)) {
    throw new Error('Effective Gemini credential unavailable for verification');
  }

  const createClient = options.clientFactory ?? ((apiKey: string) => new GoogleGenerativeAI(apiKey) as any);
  const client = createClient(key);
  const model = client.getGenerativeModel({
    model: options.modelName,
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: options.maxOutputTokens,
      responseMimeType: 'application/json',
    },
  });

  return {
    modelName: options.modelName,
    sdk: {
      countTokens: async () => {
        const result = await model.countTokens(options.requestParts);
        return Number(result.totalTokens ?? 0);
      },
      generateContent: async (): Promise<VerificationSdkResponse> => {
        const result = await model.generateContent(options.requestParts);
        return {
          rawText: result.response.text(),
          usage: result.response.usageMetadata ?? null,
          finishReason: result.response.candidates?.[0]?.finishReason ?? null,
        };
      },
    },
  };
}
