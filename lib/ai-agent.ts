import OpenAI from 'openai';
import { env } from '@/lib/env';
import { buildDetectionPrompt } from '@/lib/ai-prompt';
import { PageDetectionSchema } from '@/lib/ai-schemas';

export interface DetectionJobInput {
  page: number;
  pdfBase64: string; // full PDF base64 — Gemini accepts application/pdf directly (no PNG render needed for MVP)
  legendId: string;
  legendSymbols: { asset_type: string; symbol_name?: string | null; tag_pattern?: string | null; description?: string | null; aliases?: string[] }[];
  ocrText?: string; // for DeepSeek fallback
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e: unknown) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /429|rate|timeout|503|ECONN|fetch|network/i.test(msg);
      if (!retryable || i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (i + 1)));
    }
  }
  throw last;
}

export async function runDetectionAgent(input: DetectionJobInput) {
  const prompt = buildDetectionPrompt(input.legendSymbols as any[]);
  if (env.AI_PROVIDER === 'deepseek' && env.DEEPSEEK_API_KEY) {
    return withRetry(() => runWithDeepSeek(input, prompt));
  }
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY required for image analysis');
  return withRetry(() => runWithGemini(input, prompt));
}

async function runWithGemini(input: DetectionJobInput, prompt: string) {
  const { getGeminiModel } = await import('@/lib/gemini');
  const model = getGeminiModel();

  const result = await model.generateContent([
    { text: prompt },
    { text: `Analyze page ${input.page} of this P&ID PDF. The PDF is attached. Return strictly valid JSON: { "page": ${input.page}, "detections": [...] }` },
    { inlineData: { mimeType: 'application/pdf', data: input.pdfBase64 } },
  ]);

  const raw = result.response.text();
  const json = extractJson(raw) as Record<string, unknown>;
  const parsed = PageDetectionSchema.safeParse((json as Record<string, unknown>).page !== undefined ? json : { ...(json as Record<string, unknown>), page: input.page });
  if (!parsed.success) throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.flatten())} — raw: ${raw.slice(0, 800)}`);
  // Normalize: enforce page
  parsed.data.page = input.page;
  return parsed.data;
}

async function runWithDeepSeek(input: DetectionJobInput, prompt: string) {
  const client = new OpenAI({ apiKey: env.DEEPSEEK_API_KEY!, baseURL: 'https://api.deepseek.com/v1' });
  const ocr = input.ocrText ? `\n\nOCR text from page ${input.page}:\n${input.ocrText.slice(0, 8000)}` : '';
  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Analyze page ${input.page} of this P&ID. PDF attached as context (image not supported — use OCR proxy).${ocr}\nReturn JSON: { "page": ${input.page}, "detections": [...] }` },
    ],
    response_format: { type: 'json_object' },
  });
  const text = completion.choices[0].message.content || '{}';
  const json = JSON.parse(text) as Record<string, unknown>;
  const parsed = PageDetectionSchema.safeParse((json as Record<string, unknown>).page !== undefined ? json : { ...(json as Record<string, unknown>), page: input.page });
  if (!parsed.success) throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.flatten())}`);
  parsed.data.page = input.page;
  return parsed.data;
}

function extractJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = m ? m[1] : text.trim();
  // Gemini sometimes prefixes with prose — extract outermost { ... } if JSON.parse fails
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) return JSON.parse(s.slice(start, end + 1));
  throw new Error(`No JSON found in response: ${s.slice(0, 600)}`);
}
