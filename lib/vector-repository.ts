/**
 * Vector Repository
 * pgvector CRUD for symbol embeddings.
 * Cosine similarity search for top-5 nearest neighbors.
 */

import { pool } from '@/lib/db';
import { formatEmbeddingForPg } from '@/lib/embedding-service';
import { v4 as uuidv4 } from 'uuid';

export interface SymbolEmbeddingRecord {
  id: string;
  project_id: string | null;
  asset_type: string;
  asset_name: string;
  tag_prefix: string | null;
  canonical_features: string;
  crop_hash: string | null;
  confirmed_count: number;
  created_at: string;
  updated_at: string;
}

export interface SimilarityMatch extends SymbolEmbeddingRecord {
  similarity: number;  // 0-1, cosine similarity
}

/**
 * Store a symbol embedding.
 * If same crop_hash + project_id already exists → increment confirmed_count + update embedding.
 */
export async function storeEmbedding(opts: {
  projectId: string | null;
  assetType: string;
  assetName: string;
  tagPrefix: string | null;
  canonical: string;
  embedding: number[];
  cropHash: string | null;
}): Promise<SymbolEmbeddingRecord> {
  const { projectId, assetType, assetName, tagPrefix, canonical, embedding, cropHash } = opts;
  const embeddingStr = formatEmbeddingForPg(embedding);

  // Check for existing by crop_hash + project
  if (cropHash) {
    const existing = await pool.query(
      `SELECT id FROM symbol_embeddings
       WHERE crop_hash=$1 AND ($2::uuid IS NULL AND project_id IS NULL OR project_id=$2::uuid)
       LIMIT 1`,
      [cropHash, projectId ?? null]
    );

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE symbol_embeddings
         SET confirmed_count = confirmed_count + 1,
             asset_type = $1,
             asset_name = $2,
             canonical_features = $3,
             embedding = $4::vector,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [assetType, assetName, canonical, embeddingStr, existing.rows[0].id]
      );
      return updated.rows[0] as SymbolEmbeddingRecord;
    }
  }

  // Insert new
  const id = uuidv4();
  const inserted = await pool.query(
    `INSERT INTO symbol_embeddings
       (id, project_id, asset_type, asset_name, tag_prefix, canonical_features, embedding, crop_hash, confirmed_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, 1)
     RETURNING *`,
    [id, projectId ?? null, assetType, assetName, tagPrefix ?? null, canonical, embeddingStr, cropHash ?? null]
  );
  return inserted.rows[0] as SymbolEmbeddingRecord;
}

/**
 * Top-5 cosine similarity search.
 * Searches project-scoped first, then falls back to global.
 *
 * @param embedding  query vector (768 dims)
 * @param projectId  scope to project (also returns global entries)
 * @param limit      max results (default 5)
 * @returns sorted by similarity DESC
 */
export async function searchSimilar(opts: {
  embedding: number[];
  projectId: string | null;
  limit?: number;
}): Promise<SimilarityMatch[]> {
  const { embedding, projectId, limit = 5 } = opts;
  const embeddingStr = formatEmbeddingForPg(embedding);

  // pgvector cosine distance: 1 - cosine_similarity
  // <=> operator = cosine distance, so similarity = 1 - distance
  const scopeClause = projectId
    ? `AND (project_id = $2 OR project_id IS NULL)`
    : '';
  const params: unknown[] = [embeddingStr];
  if (projectId) params.push(projectId);
  params.push(limit);

  const result = await pool.query(
    `SELECT *,
            1 - (embedding <=> $1::vector) AS similarity
     FROM symbol_embeddings
     WHERE 1=1 ${scopeClause}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(row => ({
    ...row,
    similarity: parseFloat(row.similarity),
  })) as SimilarityMatch[];
}

/**
 * Get embedding by crop_hash (exact match lookup).
 */
export async function findByCropHash(
  cropHash: string,
  projectId: string | null
): Promise<SymbolEmbeddingRecord | null> {
  const result = await pool.query(
    `SELECT * FROM symbol_embeddings
     WHERE crop_hash = $1
       AND ($2::uuid IS NULL AND project_id IS NULL OR project_id = $2::uuid)
     ORDER BY confirmed_count DESC
     LIMIT 1`,
    [cropHash, projectId ?? null]
  );
  return result.rows[0] ?? null;
}

/**
 * Delete embedding by id.
 */
export async function deleteEmbedding(id: string): Promise<void> {
  await pool.query('DELETE FROM symbol_embeddings WHERE id=$1', [id]);
}

/**
 * Get all embeddings for a project (for admin/review).
 */
export async function getProjectEmbeddings(projectId: string): Promise<SymbolEmbeddingRecord[]> {
  const result = await pool.query(
    `SELECT id, project_id, asset_type, asset_name, tag_prefix, canonical_features, crop_hash, confirmed_count, created_at, updated_at
     FROM symbol_embeddings
     WHERE project_id=$1 OR project_id IS NULL
     ORDER BY confirmed_count DESC, asset_type ASC`,
    [projectId]
  );
  return result.rows as SymbolEmbeddingRecord[];
}
