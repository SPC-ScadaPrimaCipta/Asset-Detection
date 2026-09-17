import OpenAI from 'openai';
import type { Part } from '@google/generative-ai';
import { env } from '@/lib/env';
import { buildDetectionPrompt } from '@/lib/ai-prompt';
import { PageDetectionSchema } from '@/lib/ai-schemas';

export interface DetectionJobInput {
  page: number;
  pageImageBase64?: string;
  fileUri?: string;
  pdfBase64?: string;
  legendId: string;
  legendSymbols: {
    asset_type: string;
    symbol_name?: string | null;
    tag_pattern?: string | null;
    description?: string | null;
    aliases?: string[];
  }[];
  ocrText?: string;
  pngWidth?: number;
  pngHeight?: number;
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

  // Fallback chain — try models in order until one succeeds (quota/404 → next model)
  const FALLBACK_MODELS = [
    process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ].filter((m, i, arr) => arr.indexOf(m) === i); // dedupe

  // Build media part once — same for all models
  let mediaPart: Part;
  let contextText: string;

  if (input.pageImageBase64) {
    mediaPart = { inlineData: { mimeType: 'image/png', data: input.pageImageBase64 } };
    const dimInfo = (input.pngWidth && input.pngHeight)
      ? `Image dimensions: ${input.pngWidth} x ${input.pngHeight} pixels.`
      : 'Image rendered at ~216dpi.';
    contextText = `This is page ${input.page} of a P&ID document, rendered as a PNG image.
${dimInfo}
BBOX INSTRUCTIONS: Return bounding box coordinates in 0-1000 normalized space where (0,0)=top-left and (1000,1000)=bottom-right. DO NOT use pixel coordinates.
Detect ALL equipment symbols on THIS PAGE. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else if (input.fileUri) {
    mediaPart = { fileData: { mimeType: 'application/pdf', fileUri: input.fileUri } };
    contextText = `This is a multi-page P&ID PDF. Analyze ONLY page ${input.page}. Ignore all other pages.
BBOX: normalized 0-1000 space, (0,0)=top-left of page ${input.page}.
Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else if (input.pdfBase64) {
    mediaPart = { inlineData: { mimeType: 'application/pdf', data: input.pdfBase64 } };
    contextText = `Analyze ONLY page ${input.page} of this P&ID PDF. Ignore all other pages.
BBOX: normalized 0-1000 space. Return ONLY valid JSON: { "page": ${input.page}, "detections": [...] }`;
  } else {
    throw new Error('At least one of pageImageBase64, fileUri, or pdfBase64 must be provided');
  }

  let lastError: unknown;

  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`[gemini] trying model=${modelName} page=${input.page}`);
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      });

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
      console.log(`[gemini] success model=${modelName} detections=${parsed.data.detections.length}`);
      return parsed.data;

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const shouldFallback = /429|quota|rate.limit|not.found|no.longer.available|404|503|unavailable/i.test(msg);
      console.warn(`[gemini] model=${modelName} failed: ${msg.slice(0, 200)}`);
      if (shouldFallback) {
        lastError = e;
        // Short delay before trying next model — avoid immediate hammering
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }

  throw lastError ?? new Error('All Gemini models exhausted');
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
  // Strip markdown fences
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = (m ? m[1] : text).trim();

  // Try clean parse first
  try { return JSON.parse(s); } catch { /* continue */ }

  // Try extracting outermost {...}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* continue */ }
  }

  // Truncated JSON recovery — extract complete detection objects from partial array
  // Pattern: response was cut off mid-JSON, partial detections still usable
  if (start !== -1) {
    const partial = s.slice(start);
    // Extract page number
    const pageMatch = partial.match(/"page"\s*:\s*(\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1]) : 1;

    // Extract all complete detection objects using brace matching
    const detections: unknown[] = [];
    const detectionsStart = partial.indexOf('"detections"');
    if (detectionsStart !== -1) {
      const arrStart = partial.indexOf('[', detectionsStart);
      if (arrStart !== -1) {
        let depth = 0;
        let objStart = -1;
        let i = arrStart + 1;
        while (i < partial.length) {
          const c = partial[i];
          if (c === '{') {
            if (depth === 0) objStart = i;
            depth++;
          } else if (c === '}') {
            depth--;
            if (depth === 0 && objStart !== -1) {
              try {
                const obj = JSON.parse(partial.slice(objStart, i + 1));
                detections.push(obj);
              } catch { /* skip malformed object */ }
              objStart = -1;
            }
          }
          i++;
        }
      }
    }

    if (detections.length > 0) {
      console.warn(`[extractJson] Recovered ${detections.length} detections from truncated JSON`);
      return { page, detections };
    }
  }

  throw new Error(`No valid JSON found in response: ${s.slice(0, 300)}`);
}
