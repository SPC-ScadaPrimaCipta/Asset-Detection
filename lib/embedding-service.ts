/**
 * Embedding Service
 *
 * Generates text embeddings ONLY from canonical feature strings.
 * Uses Gemini text-embedding-004 (768 dimensions).
 *
 * Never embeds free-form descriptions.
 * Input must always be a canonical feature string from serializeFeatures().
 */

import { getAiConfig } from '@/lib/ai-config';

const EMBEDDING_MODEL = 'text-embedding-004';
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
    const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });

    const result = await model.embedContent(canonical);
    const embedding = result.embedding.values;

    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`[embedding] Unexpected dimensions: ${embedding?.length} (expected ${EMBEDDING_DIMENSIONS})`);
      return null;
    }

    return {
      embedding,
      dimensions: EMBEDDING_DIMENSIONS,
      model: EMBEDDING_MODEL,
      canonical,
    };
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
