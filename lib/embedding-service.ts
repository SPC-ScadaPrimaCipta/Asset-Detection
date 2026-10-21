/**
 * Embedding Service
 *
 * Generates text embeddings ONLY from canonical feature strings. Free-form
 * descriptions are never embedded — the input is always the output of
 * `serializeFeatures()`.
 *
 * Model, fallback chain and width are tuning (`performance.embedding*`):
 * Settings → .env → fallback. `embeddingDimensions` MUST match the DB column
 * width (`vector(768)`); a mismatch fails every insert, so the check is
 * explicit rather than truncating silently.
 */
import { getAiConfig } from '@/lib/ai-config';
import { getTuning } from '@/lib/tuning';
import { env } from '@/lib/env';

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  /** The input canonical string, kept for audit. */
  canonical: string;
}

/**
 * Generate an embedding from a canonical feature string.
 *
 * Returns null on failure so the caller can fall through to the next pipeline
 * step instead of failing the detection.
 */
export async function embedCanonical(canonical: string): Promise<EmbeddingResult | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.geminiKey) {
      console.warn('[embedding] No Gemini key — skipping embedding');
      return null;
    }
    const { performance } = await getTuning();
    const { embeddingModel, embeddingModelFallbacks, embeddingDimensions } = performance;
    const chain = [embeddingModel, ...embeddingModelFallbacks].filter(
      (m, i, a) => a.indexOf(m) === i,
    );

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genai = new GoogleGenerativeAI(cfg.geminiKey);

    let lastErr: unknown = null;
    for (const modelName of chain) {
      try {
        const model = genai.getGenerativeModel({ model: modelName });
        const result = await model.embedContent(canonical, {
          timeout: env.GEMINI_REQUEST_TIMEOUT_MS,
        });
        const embedding = result.embedding.values;

        if (!embedding || embedding.length !== embeddingDimensions) {
          console.warn(
            `[embedding] ${modelName}: unexpected dimensions: ${embedding?.length} ` +
              `(expected ${embeddingDimensions}) — check EMBEDDING_DIMENSIONS matches the DB column width`,
          );
          lastErr = new Error(`dimension mismatch: ${embedding?.length}`);
          continue;
        }

        return {
          embedding,
          dimensions: embeddingDimensions,
          model: modelName,
          canonical,
        };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[embedding] ${modelName} failed: ${msg.slice(0, 200)}`);
      }
    }
    console.warn('[embedding] all models exhausted — skipping embedding (non-fatal)');
    void lastErr;
    return null;
  } catch (err) {
    console.warn('[embedding] generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Batch embed canonical strings. Returns one entry per input, null on failure.
 * Sequential, with a tuning-controlled pause, to stay under rate limits.
 */
export async function batchEmbedCanonical(
  canonicals: string[],
): Promise<(EmbeddingResult | null)[]> {
  const { performance } = await getTuning();
  const delayMs = performance.embeddingRequestDelayMs;
  const results: (EmbeddingResult | null)[] = [];
  for (const canonical of canonicals) {
    results.push(await embedCanonical(canonical));
    if (canonicals.length > 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

/**
 * Cosine similarity of two vectors, 0–1 (1 = identical).
 * Returns 0 for a length mismatch rather than comparing misaligned arrays.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Format an embedding for pgvector storage, which expects '[0.1,0.2,...]'. */
export function formatEmbeddingForPg(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
