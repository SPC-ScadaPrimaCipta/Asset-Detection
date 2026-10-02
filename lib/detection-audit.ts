/**
 * Detection Audit Trail
 * Stores complete decision path for every detection.
 * Every step in the pipeline records its result.
 */

import { pool } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export interface AuditStep {
  step: string;              // e.g. 'Cache', 'Legend', 'CompanyKB', 'Embedding', 'RuleEngine', 'Vision'
  result: 'hit' | 'miss' | 'skip' | 'error';
  confidence: number | null;
  detail: string;
  duration_ms?: number;
}

export interface DetectionAuditRecord {
  id: string;
  detection_id: string | null;
  job_id: string | null;
  decision_path: string[];
  confidence_history: number[];
  confidence_breakdown: Record<string, number> | null;
  evidence_sources: AuditStep[];
  processing_time_ms: number;
  final_source: string;
  created_at: string;
}

export class DetectionAudit {
  private steps: AuditStep[] = [];
  private confidenceHistory: number[] = [];
  private startTime: number;
  private detectionId: string | null = null;
  private jobId: string | null = null;

  constructor(jobId: string | null = null) {
    this.startTime = Date.now();
    this.jobId = jobId;
  }

  setDetectionId(id: string) {
    this.detectionId = id;
  }

  /**
   * Record a pipeline step result.
   */
  addStep(step: AuditStep) {
    this.steps.push(step);
    if (step.confidence !== null) {
      this.confidenceHistory.push(step.confidence);
    }
  }

  /**
   * Convenience: record a hit (source found a match).
   */
  hit(stepName: string, confidence: number, detail: string, duration_ms?: number) {
    this.addStep({ step: stepName, result: 'hit', confidence, detail, duration_ms });
  }

  /**
   * Convenience: record a miss (source checked but no match).
   */
  miss(stepName: string, detail: string, duration_ms?: number) {
    this.addStep({ step: stepName, result: 'miss', confidence: null, detail, duration_ms });
  }

  /**
   * Convenience: record a skip (source not checked due to earlier hit).
   */
  skip(stepName: string) {
    this.addStep({ step: stepName, result: 'skip', confidence: null, detail: 'Skipped — earlier step resolved' });
  }

  getDecisionPath(): string[] {
    return this.steps.filter(s => s.result !== 'skip').map(s => s.step);
  }

  getProcessingTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Persist audit to detection_audit_trail table.
   */
  async persist(opts: {
    finalSource: string;
    confidenceBreakdown: Record<string, number> | null;
  }): Promise<void> {
    if (!this.detectionId && !this.jobId) return; // nothing to associate to
    try {
      await pool.query(
        `INSERT INTO detection_audit_trail
           (id, detection_id, job_id, decision_path, confidence_history,
            confidence_breakdown, evidence_sources, processing_time_ms, final_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          this.detectionId ?? null,
          this.jobId ?? null,
          JSON.stringify(this.getDecisionPath()),
          JSON.stringify(this.confidenceHistory),
          opts.confidenceBreakdown ? JSON.stringify(opts.confidenceBreakdown) : null,
          JSON.stringify(this.steps),
          this.getProcessingTime(),
          opts.finalSource,
        ]
      );
    } catch (err) {
      // Audit persistence failure must never break detection
      console.warn('[audit] persist failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Get audit summary for embedding in detection result.
   */
  getSummary() {
    return {
      decision_path: this.getDecisionPath(),
      processing_time: this.getProcessingTime(),
      confidence_history: this.confidenceHistory,
    };
  }
}

/**
 * Get audit trail for a detection.
 */
export async function getDetectionAudit(detectionId: string): Promise<DetectionAuditRecord | null> {
  const result = await pool.query(
    'SELECT * FROM detection_audit_trail WHERE detection_id=$1 ORDER BY created_at DESC LIMIT 1',
    [detectionId]
  );
  return result.rows[0] ?? null;
}
