/**
 * Negative Learning Module
 *
 * Stores negative feedback when user rejects AI predictions.
 * Maintains prediction history — never overwrites old records.
 * Increments negative_count for repeated wrong predictions on same symbol.
 *
 * Used by: reject route, future confidence penalty system.
 */

import { pool } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { getTuning } from '@/lib/tuning';

export interface NegativeLearningRecord {
  id: string;
  detection_id: string | null;
  project_id: string | null;
  predicted_asset_type: string;
  correct_asset_type: string | null;
  canonical_features: string | null;
  crop_hash: string | null;
  prediction_confidence: number | null;
  negative_count: number;
  created_at: string;
  updated_at: string;
}

export interface RecordNegativeFeedbackOpts {
  detectionId: string | null;
  projectId: string | null;
  predictedAssetType: string;
  correctAssetType: string | null;
  canonicalFeatures: string | null;
  cropHash: string | null;
  predictionConfidence: number | null;
}

/**
 * Record negative feedback for a rejected detection.
 *
 * Dedup logic:
 *   - Same crop_hash + predicted_asset_type + project → increment existing record
 *   - Otherwise (no crop_hash or new combination) → insert new record
 *
 * Never deletes old records — full history preserved.
 */
export async function recordNegativeFeedback(
  opts: RecordNegativeFeedbackOpts
): Promise<NegativeLearningRecord> {
  const {
    detectionId, projectId, predictedAssetType,
    correctAssetType, canonicalFeatures, cropHash, predictionConfidence,
  } = opts;

  // Try to find existing record by crop_hash + predicted type + project
  if (cropHash) {
    const existing = await pool.query(
      `SELECT id, negative_count FROM negative_learning
       WHERE crop_hash = $1
         AND predicted_asset_type = $2
         AND ($3::uuid IS NULL AND project_id IS NULL OR project_id = $3::uuid)
       ORDER BY negative_count DESC
       LIMIT 1`,
      [cropHash, predictedAssetType, projectId ?? null]
    );

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE negative_learning
         SET negative_count = negative_count + 1,
             correct_asset_type = COALESCE($1, correct_asset_type),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [correctAssetType, existing.rows[0].id]
      );
      console.log(`[negative-learning] incremented: type="${predictedAssetType}" count=${updated.rows[0].negative_count}`);
      return updated.rows[0] as NegativeLearningRecord;
    }
  }

  // Insert new record
  const id = uuidv4();
  const inserted = await pool.query(
    `INSERT INTO negative_learning
       (id, detection_id, project_id, predicted_asset_type, correct_asset_type,
        canonical_features, crop_hash, prediction_confidence, negative_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     RETURNING *`,
    [
      id,
      detectionId ?? null,
      projectId ?? null,
      predictedAssetType,
      correctAssetType ?? null,
      canonicalFeatures ?? null,
      cropHash ?? null,
      predictionConfidence ?? null,
    ]
  );
  console.log(`[negative-learning] recorded: predicted="${predictedAssetType}" correct="${correctAssetType ?? 'unknown'}"`);
  return inserted.rows[0] as NegativeLearningRecord;
}

/**
 * Get the negative learning penalty for a predicted asset type.
 *
 * Returns a confidence penalty (0, or a negative value) sized by how often this
 * asset type has been rejected. Tier boundaries and penalties come from
 * `validator.rejection*` tuning (Settings → .env → fallback), so a site that
 * learns faster or slower can retune it without touching code.
 */
export async function getNegativePenalty(opts: {
  predictedAssetType: string;
  projectId: string | null;
  cropHash?: string | null;
}): Promise<number> {
  const { predictedAssetType, projectId, cropHash } = opts;

  const result = await pool.query(
    `SELECT COALESCE(SUM(negative_count), 0) AS total_negatives
     FROM negative_learning
     WHERE predicted_asset_type = $1
       AND ($2::uuid IS NULL AND project_id IS NULL OR project_id = $2::uuid)
       ${cropHash ? 'AND (crop_hash = $3 OR crop_hash IS NULL)' : ''}`,
    cropHash
      ? [predictedAssetType, projectId ?? null, cropHash]
      : [predictedAssetType, projectId ?? null]
  );

  const total = parseInt(result.rows[0]?.total_negatives ?? '0', 10);
  if (total === 0) return 0;

  const {
    rejectionTierLowMax,
    rejectionTierMediumMax,
    rejectionTierHighMax,
    rejectionPenaltyLow,
    rejectionPenaltyMedium,
    rejectionPenaltyHigh,
    rejectionPenaltyCritical,
  } = (await getTuning()).validator;

  if (total <= rejectionTierLowMax) return -rejectionPenaltyLow;
  if (total <= rejectionTierMediumMax) return -rejectionPenaltyMedium;
  if (total <= rejectionTierHighMax) return -rejectionPenaltyHigh;
  return -rejectionPenaltyCritical;
}

/**
 * Get all negative learning records for a project.
 */
export async function getProjectNegativeLearning(
  projectId: string
): Promise<NegativeLearningRecord[]> {
  const result = await pool.query(
    `SELECT * FROM negative_learning
     WHERE project_id = $1 OR project_id IS NULL
     ORDER BY negative_count DESC, updated_at DESC`,
    [projectId]
  );
  return result.rows as NegativeLearningRecord[];
}

/**
 * Get all negative learning records (global admin view).
 */
export async function getAllNegativeLearning(): Promise<NegativeLearningRecord[]> {
  const result = await pool.query(
    `SELECT nl.*, p.name as project_name
     FROM negative_learning nl
     LEFT JOIN projects p ON p.id = nl.project_id
     ORDER BY nl.negative_count DESC, nl.updated_at DESC`
  );
  return result.rows as NegativeLearningRecord[];
}

/**
 * Delete a negative learning record (admin correction).
 */
export async function deleteNegativeLearning(id: string): Promise<void> {
  await pool.query('DELETE FROM negative_learning WHERE id = $1', [id]);
}
