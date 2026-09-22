/**
 * Accuracy Evaluation Script — TASK 25
 *
 * Compares detection results against a ground truth JSON file and computes:
 *   - Tag Accuracy
 *   - Type Accuracy
 *   - Service Accuracy
 *   - Main Equipment Accuracy
 *   - Description Accuracy
 *   - Symbol-Tag Association Accuracy
 *   - Duplicate Asset Rate
 *   - Missing Metadata Rate (per field)
 *   - NEEDS_REVIEW Rate
 *   - CONFLICT Rate
 *   - False Positive Rate (detected but not in ground truth)
 *   - False Negative Rate (in ground truth but not detected)
 *
 * Usage:
 *   npx ts-node scripts/evaluate-accuracy.ts \
 *     --ground-truth path/to/ground_truth.json \
 *     [--job-id <jobId>] \
 *     [--project-id <projectId>] \
 *     [--confirmed-only]
 *
 * Ground truth JSON format:
 * [
 *   {
 *     "assetTag": "P-101",
 *     "assetType": "Pump",
 *     "service": "Fuel Gas",
 *     "mainEquipment": null,
 *     "description": null,
 *     "pidPage": 1
 *   }
 * ]
 *
 * If no ground truth file provided, script prints DB statistics only
 * (NEEDS_REVIEW rate, duplicate rate, missing metadata rate, confidence distribution).
 *
 * IMPORTANT: Accuracy claims require ground truth. Never fabricate numbers.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GroundTruthAsset {
  assetTag: string | null;
  assetType: string;
  service?: string | null;
  mainEquipment?: string | null;
  description?: string | null;
  pidPage?: number | null;
}

interface DetectionRow {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  service: string | null;
  main_equipment: string | null;
  description: string | null;
  pid_page: number | null;
  confidence: number | null;
  validation_status: string | null;
  detection_status: string;
  field_confidence: string | null;
}

interface FieldAccuracy {
  total: number;
  correct: number;
  null_in_prediction: number;
  null_in_ground_truth: number;
  accuracy: number | null;  // null if no comparable pairs
}

interface EvaluationReport {
  generated_at: string;
  ground_truth_count: number | null;
  detection_count: number;
  matched_pairs: number | null;
  tag_accuracy: FieldAccuracy | null;
  type_accuracy: FieldAccuracy | null;
  service_accuracy: FieldAccuracy | null;
  main_equipment_accuracy: FieldAccuracy | null;
  description_accuracy: FieldAccuracy | null;
  duplicate_rate: number;       // fraction of detections marked DUPLICATE
  needs_review_rate: number;    // fraction with validation_status=NEEDS_REVIEW
  conflict_rate: number;        // fraction with validation_status=CONFLICT
  missing_tag_rate: number;     // fraction with null asset_tag
  missing_service_rate: number;
  missing_main_equipment_rate: number;
  missing_description_rate: number;
  false_positive_count: number | null;  // detected but not in GT
  false_negative_count: number | null;  // in GT but not detected
  confidence_distribution: {
    high_gte_95: number;
    medium_80_94: number;
    review_lt_80: number;
  };
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(): {
  groundTruthPath: string | null;
  jobId: string | null;
  projectId: string | null;
  confirmedOnly: boolean;
} {
  const args = process.argv.slice(2);
  let groundTruthPath: string | null = null;
  let jobId: string | null = null;
  let projectId: string | null = null;
  let confirmedOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ground-truth' && args[i + 1]) groundTruthPath = args[++i];
    else if (args[i] === '--job-id' && args[i + 1]) jobId = args[++i];
    else if (args[i] === '--project-id' && args[i + 1]) projectId = args[++i];
    else if (args[i] === '--confirmed-only') confirmedOnly = true;
  }

  return { groundTruthPath, jobId, projectId, confirmedOnly };
}

// ── Comparison helpers ────────────────────────────────────────────────────────

function normalizeForCompare(s: string | null | undefined): string | null {
  if (s == null) return null;
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}

function stringsMatch(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function computeFieldAccuracy(
  pairs: Array<{ predicted: string | null; groundTruth: string | null }>
): FieldAccuracy {
  let correct = 0;
  let nullInPrediction = 0;
  let nullInGroundTruth = 0;
  const comparable: typeof pairs = [];

  for (const { predicted, groundTruth } of pairs) {
    if (groundTruth === null) { nullInGroundTruth++; continue; }
    comparable.push({ predicted, groundTruth });
    if (predicted === null) { nullInPrediction++; continue; }
    if (stringsMatch(predicted, groundTruth)) correct++;
  }

  return {
    total: comparable.length,
    correct,
    null_in_prediction: nullInPrediction,
    null_in_ground_truth: nullInGroundTruth,
    accuracy: comparable.length > 0 ? correct / comparable.length : null,
  };
}

// ── Match detections to ground truth by tag ──────────────────────────────────

function matchByTag(
  detections: DetectionRow[],
  groundTruth: GroundTruthAsset[]
): Array<{ det: DetectionRow; gt: GroundTruthAsset }> {
  const pairs: Array<{ det: DetectionRow; gt: GroundTruthAsset }> = [];
  const usedGt = new Set<number>();
  const usedDet = new Set<string>();

  // First pass: exact tag match
  for (const det of detections) {
    if (!det.asset_tag) continue;
    const detTag = normalizeForCompare(det.asset_tag);
    for (let i = 0; i < groundTruth.length; i++) {
      if (usedGt.has(i)) continue;
      const gtTag = normalizeForCompare(groundTruth[i].assetTag);
      if (detTag === gtTag) {
        pairs.push({ det, gt: groundTruth[i] });
        usedGt.add(i);
        usedDet.add(det.id);
        break;
      }
    }
  }

  return pairs;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { groundTruthPath, jobId, projectId, confirmedOnly } = parseArgs();

  // Connect to DB
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set.');
    console.error('Usage: DATABASE_URL=<conn> npx ts-node scripts/evaluate-accuracy.ts [options]');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Build query filters
    const conditions: string[] = ["detection_status != 'REJECTED'"];
    const params: unknown[] = [];
    let idx = 1;

    if (confirmedOnly) {
      conditions.push("detection_status = 'CONFIRMED'");
    }
    if (jobId) {
      conditions.push(`job_id = $${idx++}`);
      params.push(jobId);
    }
    if (projectId) {
      conditions.push(`document_id IN (SELECT id FROM documents WHERE project_id = $${idx++})`);
      params.push(projectId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT id, asset_tag, asset_type, service, main_equipment, description,
             pid_page, confidence, validation_status, detection_status, field_confidence
      FROM detections
      ${where}
      ORDER BY created_at
    `;

    const result = await client.query(query, params);
    const detections: DetectionRow[] = result.rows;

    if (detections.length === 0) {
      console.log('No detections found matching filters.');
      console.log('Filters:', { jobId, projectId, confirmedOnly });
      return;
    }

    // ── DB-only statistics (always computed) ─────────────────────────────────

    const total = detections.length;
    const needsReview = detections.filter(d => d.validation_status === 'NEEDS_REVIEW').length;
    const conflict = detections.filter(d => d.validation_status === 'CONFLICT').length;
    const missingTag = detections.filter(d => !d.asset_tag).length;
    const missingService = detections.filter(d => !d.service).length;
    const missingMainEq = detections.filter(d => !d.main_equipment).length;
    const missingDesc = detections.filter(d => !d.description).length;

    // Duplicate detection: count evidence containing "DUPLICATE:"
    // (set by entity resolution in worker)
    const dupQuery = await client.query(
      `SELECT COUNT(*) AS cnt FROM detections
       WHERE evidence::text ILIKE '%DUPLICATE:%'
         ${jobId ? `AND job_id = $1` : ''}`,
      jobId ? [jobId] : []
    );
    const duplicateCount = parseInt(dupQuery.rows[0]?.cnt ?? '0', 10);

    // Confidence distribution
    const highConf = detections.filter(d => (d.confidence ?? 0) >= 0.95).length;
    const medConf = detections.filter(d => {
      const c = d.confidence ?? 0;
      return c >= 0.80 && c < 0.95;
    }).length;
    const lowConf = detections.filter(d => (d.confidence ?? 0) < 0.80).length;

    const report: EvaluationReport = {
      generated_at: new Date().toISOString(),
      ground_truth_count: null,
      detection_count: total,
      matched_pairs: null,
      tag_accuracy: null,
      type_accuracy: null,
      service_accuracy: null,
      main_equipment_accuracy: null,
      description_accuracy: null,
      duplicate_rate: duplicateCount / total,
      needs_review_rate: needsReview / total,
      conflict_rate: conflict / total,
      missing_tag_rate: missingTag / total,
      missing_service_rate: missingService / total,
      missing_main_equipment_rate: missingMainEq / total,
      missing_description_rate: missingDesc / total,
      false_positive_count: null,
      false_negative_count: null,
      confidence_distribution: {
        high_gte_95: highConf,
        medium_80_94: medConf,
        review_lt_80: lowConf,
      },
    };

    // ── Ground truth comparison (only if file provided) ───────────────────────

    if (groundTruthPath) {
      const absPath = path.resolve(groundTruthPath);
      if (!fs.existsSync(absPath)) {
        console.error(`ERROR: Ground truth file not found: ${absPath}`);
        process.exit(1);
      }

      const groundTruth: GroundTruthAsset[] = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
      report.ground_truth_count = groundTruth.length;

      const pairs = matchByTag(detections, groundTruth);
      report.matched_pairs = pairs.length;

      // Per-field accuracy
      report.tag_accuracy = computeFieldAccuracy(
        pairs.map(({ det, gt }) => ({ predicted: det.asset_tag, groundTruth: gt.assetTag }))
      );
      report.type_accuracy = computeFieldAccuracy(
        pairs.map(({ det, gt }) => ({ predicted: det.asset_type, groundTruth: gt.assetType }))
      );
      report.service_accuracy = computeFieldAccuracy(
        pairs.map(({ det, gt }) => ({ predicted: det.service, groundTruth: gt.service ?? null }))
      );
      report.main_equipment_accuracy = computeFieldAccuracy(
        pairs.map(({ det, gt }) => ({ predicted: det.main_equipment, groundTruth: gt.mainEquipment ?? null }))
      );
      report.description_accuracy = computeFieldAccuracy(
        pairs.map(({ det, gt }) => ({ predicted: det.description, groundTruth: gt.description ?? null }))
      );

      // False positives: detected but no matching GT tag
      const matchedDetIds = new Set(pairs.map(p => p.det.id));
      report.false_positive_count = detections.filter(d => !matchedDetIds.has(d.id)).length;

      // False negatives: in GT but no matching detection
      const matchedGtTags = new Set(pairs.map(p => normalizeForCompare(p.gt.assetTag)));
      report.false_negative_count = groundTruth.filter(
        gt => gt.assetTag && !matchedGtTags.has(normalizeForCompare(gt.assetTag))
      ).length;
    }

    // ── Print report ──────────────────────────────────────────────────────────

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ASSET DETECTION — ACCURACY EVALUATION REPORT');
    console.log(`  Generated: ${report.generated_at}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`  Total Detections : ${report.detection_count}`);
    if (report.ground_truth_count !== null) {
      console.log(`  Ground Truth     : ${report.ground_truth_count}`);
      console.log(`  Matched Pairs    : ${report.matched_pairs}`);
    }
    console.log('');

    if (report.tag_accuracy) {
      console.log('── Field Accuracy (requires ground truth) ──────────────────');
      const fields: Array<[string, FieldAccuracy | null]> = [
        ['Tag',            report.tag_accuracy],
        ['Type',           report.type_accuracy],
        ['Service',        report.service_accuracy],
        ['Main Equipment', report.main_equipment_accuracy],
        ['Description',    report.description_accuracy],
      ];
      for (const [name, acc] of fields) {
        if (!acc) continue;
        const pct = acc.accuracy !== null ? `${(acc.accuracy * 100).toFixed(1)}%` : 'N/A';
        console.log(`  ${name.padEnd(16)}: ${pct.padStart(6)}  (${acc.correct}/${acc.total} comparable, ${acc.null_in_prediction} predicted null)`);
      }
      console.log('');

      console.log('── False Positive / Negative ───────────────────────────────');
      console.log(`  False Positives  : ${report.false_positive_count ?? 'N/A'}`);
      console.log(`  False Negatives  : ${report.false_negative_count ?? 'N/A'}`);
      console.log('');
    }

    console.log('── Quality Flags ───────────────────────────────────────────');
    console.log(`  NEEDS_REVIEW     : ${(report.needs_review_rate * 100).toFixed(1)}%  (${needsReview}/${total})`);
    console.log(`  CONFLICT         : ${(report.conflict_rate * 100).toFixed(1)}%  (${conflict}/${total})`);
    console.log(`  DUPLICATE        : ${(report.duplicate_rate * 100).toFixed(1)}%  (${duplicateCount}/${total})`);
    console.log('');

    console.log('── Missing Metadata Rate ────────────────────────────────────');
    console.log(`  Missing Tag      : ${(report.missing_tag_rate * 100).toFixed(1)}%  (${missingTag}/${total})`);
    console.log(`  Missing Service  : ${(report.missing_service_rate * 100).toFixed(1)}%  (${missingService}/${total})`);
    console.log(`  Missing Main Eq  : ${(report.missing_main_equipment_rate * 100).toFixed(1)}%  (${missingMainEq}/${total})`);
    console.log(`  Missing Desc     : ${(report.missing_description_rate * 100).toFixed(1)}%  (${missingDesc}/${total})`);
    console.log('');

    console.log('── Confidence Distribution ──────────────────────────────────');
    console.log(`  High  (>=95%)    : ${report.confidence_distribution.high_gte_95}  (${((report.confidence_distribution.high_gte_95 / total) * 100).toFixed(1)}%)`);
    console.log(`  Medium (80-94%)  : ${report.confidence_distribution.medium_80_94}  (${((report.confidence_distribution.medium_80_94 / total) * 100).toFixed(1)}%)`);
    console.log(`  Review (<80%)    : ${report.confidence_distribution.review_lt_80}  (${((report.confidence_distribution.review_lt_80 / total) * 100).toFixed(1)}%)`);
    console.log('');

    if (!groundTruthPath) {
      console.log('  NOTE: Accuracy metrics require --ground-truth <file>');
      console.log('        Above shows DB quality statistics only.');
      console.log('        Do not claim accuracy improvement without ground truth comparison.');
    }

    console.log('═══════════════════════════════════════════════════════════\n');

    // Also write JSON report to file for comparison tracking
    const reportPath = path.join(process.cwd(), `accuracy-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`  Report saved: ${reportPath}\n`);

  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
