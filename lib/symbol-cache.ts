/**
 * Symbol Cache
 * SHA256-based exact match cache for symbol crops.
 * Fastest pipeline stage — checked before everything else.
 * Expires only on manual invalidation.
 */

import { createHash } from 'crypto';
import { pool } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export interface CacheEntry {
  id: string;
  image_hash: string;
  project_id: string | null;
  asset_name: string;
  asset_type: string;
  tag_prefix: string | null;
  canonical_features: string | null;
  confidence: number;
  confidence_breakdown: Record<string, number> | null;
  detection_source: string;
  verified: boolean;
  invalidated: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Generate SHA256 hash from base64-encoded image data.
 */
export function hashImage(imageBase64: string): string {
  return createHash('sha256').update(imageBase64).digest('hex');
}

/**
 * Look up cache by image hash.
 * Returns null if not found or invalidated.
 * Cache is global (not project-scoped) — same physical symbol = same hash regardless of project.
 */
export async function lookupCache(imageHash: string): Promise<CacheEntry | null> {
  const result = await pool.query(
    `SELECT * FROM symbol_cache
     WHERE image_hash = $1
       AND invalidated = FALSE
       AND verified = TRUE
     ORDER BY updated_at DESC
     LIMIT 1`,
    [imageHash]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return {
    ...row,
    confidence_breakdown: row.confidence_breakdown
      ? (typeof row.confidence_breakdown === 'string'
          ? JSON.parse(row.confidence_breakdown)
          : row.confidence_breakdown)
      : null,
  } as CacheEntry;
}

/**
 * Store or update cache entry.
 * If same hash exists (even invalidated) → update in-place.
 */
export async function storeCache(entry: {
  imageHash: string;
  projectId: string | null;
  assetName: string;
  assetType: string;
  tagPrefix: string | null;
  canonicalFeatures: string | null;
  confidence: number;
  confidenceBreakdown: Record<string, number> | null;
  detectionSource: string;
}): Promise<CacheEntry> {
  const existing = await pool.query(
    'SELECT id FROM symbol_cache WHERE image_hash=$1 LIMIT 1',
    [entry.imageHash]
  );

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE symbol_cache SET
         asset_name=$1, asset_type=$2, tag_prefix=$3,
         canonical_features=$4, confidence=$5, confidence_breakdown=$6,
         detection_source=$7, verified=TRUE, invalidated=FALSE, updated_at=NOW()
       WHERE image_hash=$8
       RETURNING *`,
      [
        entry.assetName, entry.assetType, entry.tagPrefix ?? null,
        entry.canonicalFeatures ?? null, entry.confidence,
        entry.confidenceBreakdown ? JSON.stringify(entry.confidenceBreakdown) : null,
        entry.detectionSource, entry.imageHash,
      ]
    );
    return updated.rows[0] as CacheEntry;
  }

  const id = uuidv4();
  const inserted = await pool.query(
    `INSERT INTO symbol_cache
       (id, image_hash, project_id, asset_name, asset_type, tag_prefix,
        canonical_features, confidence, confidence_breakdown, detection_source, verified, invalidated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,FALSE)
     RETURNING *`,
    [
      id, entry.imageHash, entry.projectId ?? null,
      entry.assetName, entry.assetType, entry.tagPrefix ?? null,
      entry.canonicalFeatures ?? null, entry.confidence,
      entry.confidenceBreakdown ? JSON.stringify(entry.confidenceBreakdown) : null,
      entry.detectionSource,
    ]
  );
  return inserted.rows[0] as CacheEntry;
}

/**
 * Invalidate a cache entry by image hash.
 * Does not delete — keeps history, marks as invalidated.
 * User can call this from review UI to force re-detection.
 */
export async function invalidateCache(imageHash: string): Promise<void> {
  await pool.query(
    'UPDATE symbol_cache SET invalidated=TRUE, updated_at=NOW() WHERE image_hash=$1',
    [imageHash]
  );
}

/**
 * Invalidate all cache entries for a project.
 */
export async function invalidateProjectCache(projectId: string): Promise<number> {
  const result = await pool.query(
    'UPDATE symbol_cache SET invalidated=TRUE, updated_at=NOW() WHERE project_id=$1 AND invalidated=FALSE',
    [projectId]
  );
  return result.rowCount ?? 0;
}
