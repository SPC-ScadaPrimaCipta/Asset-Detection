import OpenAI from 'openai';
import type { Part } from '@google/generative-ai';
import { env } from '@/lib/env';
import { buildDetectionPrompt } from '@/lib/ai-prompt';
import { PageDetectionSchema } from '@/lib/ai-schemas';

export interface DetectionJobInput {
  page: number;
  /**
   * Primary (highest accuracy): per-page PNG image rendered by mupdf at ~216dpi.
   * Gemini Vision processes this as image/png — one page, full focus, accurate bounding boxes.
   */
  pageImageBase64?: string;
  /**
   * Fallback A: Gemini Files API URI (uploaded once per job).
   * Used when pageImageBase64 is unavailable (render failed).
   */
  fileUri?: string;
  /**
   * Fallback B: full PDF base64.
   * Used when both pageImageBase64 and fileUri are unavailable.
   */
  pdfBase64?: string;
  legendId: string;
  legendSymbols: {
    asset_type: string;
    symbol_name?: string | null;
    tag_pattern?: string | null;
    description?: string | null;
    aliases?: string[];
  }[];
  ocrText?: string; // for DeepSeek fallback
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|rate|timeout|503|ECONN|fetch|network/i.test(msg);
      if (!retryable || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw last;
}

export async function runDetectionAgent(input: DetectionJobInput) {
  const prompt = buildDetectionPrompt(input.legendSymbols as Parameters<typeof buildDetectionPrompt>[0]);
  if (env.AI_PROVIDER === 'deepseek' && env.DEEPSEEK_API_KEY) {
    return withRetry(() => runWithDeepSeek(input, prompt));
  }
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required for image analysis');
  return withRetry(() => runWithGemini(input, prompt));
}

async function runWithGemini(input: DetectionJobInput, prompt: string) {
  const { getGeminiClient } = await import('@/lib/gemini');
  const client = getGeminiClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: {
      // Temperature 0 = deterministic, maximum consistency for structured extraction
      temperature: 0,
      // Large output budget — P&ID with many assets can produce long JSON
      maxOutputTokens: 8192,
      // Force JSON response format where supported
      responseMimeType: 'application/json',
    },
  });

  // Priority: PNG image > Gemini Files API URI > inline PDF base64
  let mediaPart: Part;
  let contextText: string;

  if (input.pageImageBase64) {
    mediaPart = {
      inlineData: { mimeType: 'image/png', data: input.pageImageBase64 },
    };
    contextText = `Analyze page ${input.page} of this P&ID document (rendered as high-resolution PNG at ~288dpi).
Detect ALL equipment symbols and assets. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else if (input.fileUri) {
    mediaPart = {
      fileData: { mimeType: 'application/pdf', fileUri: input.fileUri },
    };
    contextText = `Analyze page ${input.page} of this P&ID PDF. Focus ONLY on page ${input.page}.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else if (input.pdfBase64) {
    mediaPart = {
      inlineData: { mimeType: 'application/pdf', data: input.pdfBase64 },
    };
    contextText = `Analyze page ${input.page} of this P&ID PDF. Focus ONLY on page ${input.page}.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else {
    throw new Error('At least one of pageImageBase64, fileUri, or pdfBase64 must be provided');
  }

  const result = await model.generateContent([
    { text: prompt },
    { text: contextText },
    mediaPart,
  ]);

  const raw = result.response.text();
  const json = extractJson(raw) as Record<string, unknown>;
  const parsed = PageDetectionSchema.safeParse(
    json.page !== undefined ? json : { ...json, page: input.page }
  );
  if (!parsed.success) {
    throw new Error(
      `Schema validation failed: ${JSON.stringify(parsed.error.flatten())} — raw: ${raw.slice(0, 800)}`
    );
  }
  parsed.data.page = input.page;
  return parsed.data;
}

async function runWithDeepSeek(input: DetectionJobInput, prompt: string) {
  const client = new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY!,
    baseURL: 'https://api.deepseek.com/v1',
  });
  const ocr = input.ocrText
    ? `\n\nOCR text from page ${input.page}:\n${input.ocrText.slice(0, 8000)}`
    : '';
  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Analyze page ${input.page} of this P&ID. Image not supported — use OCR text proxy.${ocr}\nReturn JSON: { "page": ${input.page}, "detections": [...] }`,
      },
    ],
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0].message.content || '{}';
  const json = JSON.parse(text) as Record<string, unknown>;
  const parsed = PageDetectionSchema.safeParse(
    json.page !== undefined ? json : { ...json, page: input.page }
  );
  if (!parsed.success) {
    throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  }
  parsed.data.page = input.page;
  return parsed.data;
}

function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = m ? m[1] : text.trim();
  try {
    return JSON.parse(s);
  } catch {
    /* try raw extraction */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) return JSON.parse(s.slice(start, end + 1));
  throw new Error(`No JSON found in response: ${s.slice(0, 600)}`);
}
