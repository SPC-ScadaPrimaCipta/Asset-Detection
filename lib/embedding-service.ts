/**
 * Embedding Service
 *
 * Generates text embeddings ONLY from canonical feature strings.
 * Model configurable via EMBEDDING_MODEL (default text-embedding-004,
 * 768 dimensions — must match vector(768) columns).
 *
 * Never embeds free-form descriptions.
 * Input must always be a canonical feature string from serializeFeatures().
 */

import { getAiConfig } from '@/lib/ai-config';

// P3: model configurable — text-embedding-004 me-return 404 di v1beta
// (retired). Set EMBEDDING_MODEL ke model aktif, mis. gemini-embedding-001
// (pastikan output 768 dim — kolom DB vector(768)).
// EMBEDDING_MODEL_FALLBACKS: comma list, dicoba berurutan jika primary gagal.
function embeddingModelChain(): string[] {
  const primary = (process.env.EMBEDDING_MODEL ?? 'text-embedding-004').trim();
  const fallbacks = (process.env.EMBEDDING_MODEL_FALLBACKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...fallbacks].filter((m, i, a) => a.indexOf(m) === i);
}
const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingResult {
  embedding: number[];   // 768-dim vector
  dimensions: number;
  model: string;
  canonical: string;     // the input canonical string (for audit)
}

/**
 * Generate embedding from a canonical feature string.
 * Input MUST be output of serializeFeatures() — never raw text or descriptions.
 *
 * Returns null on failure — caller must handle gracefully (fallback to next pipeline step).
 */
export async function embedCanonical(canonical: string): Promise<EmbeddingResult | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.geminiKey) {
      console.warn('[embedding] No Gemini key — skipping embedding');
      return null;
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genai = new GoogleGenerativeAI(cfg.geminiKey);

    let lastErr: unknown = null;
    for (const modelName of embeddingModelChain()) {
      try {
        const model = genai.getGenerativeModel({ model: modelName });
        const result = await model.embedContent(canonical);
        const embedding = result.embedding.values;

        if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
          console.warn(`[embedding] ${modelName}: unexpected dimensions: ${embedding?.length} (expected ${EMBEDDING_DIMENSIONS})`);
          lastErr = new Error(`dimension mismatch: ${embedding?.length}`);
          continue;
        }

        return {
          embedding,
          dimensions: EMBEDDING_DIMENSIONS,
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
 * Batch embed multiple canonical strings.
 * Returns array parallel to input — null for failed items.
 * Uses sequential calls to avoid rate limiting.
 */
export async function batchEmbedCanonical(canonicals: string[]): Promise<(EmbeddingResult | null)[]> {
  const results: (EmbeddingResult | null)[] = [];
  for (const canonical of canonicals) {
    results.push(await embedCanonical(canonical));
    // Small delay between calls to respect rate limits
    if (canonicals.length > 1) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns 0-1 where 1 = identical.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Format embedding vector for pgvector storage.
 * pgvector expects: '[0.1,0.2,...]'
 */
export function formatEmbeddingForPg(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
