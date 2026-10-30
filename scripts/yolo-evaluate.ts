/**
 * YOLO Model Accuracy Evaluation — CLI runner.
 *
 * Run: npx tsx --env-file=.env.local scripts/yolo-evaluate.ts <dataset.json>
 *
 * OFFLINE ONLY. Does NOT integrate with production detection pipeline.
 * Purpose: measure YOLO model accuracy against manual ground truth.
 *
 * Output:
 *   - evaluation-report.json (full structured results)
 *   - conf_XX/per_class.csv (per-class metrics at confidence XX)
 *   - conf_XX/per_page.csv (per-page metrics at confidence XX)
 *   - conf_XX/<pageId>_annotated.png (visual overlays: TP green, FP red, FN magenta)
 *
 * Acceptance gate (from Stage 1.5 specification):
 *   - Dataset: ≥10 annotated P&ID pages
 *   - Global precision at operating threshold: ≥0.80
 *   - Global recall for supported classes: ≥0.50
 *   - No systematic high-confidence false positives (pump→rupture disk, text→symbol)
 *   - Per-class results reported; insufficient sample flagged
 */

import * as path from 'path';
import { runDatasetEvaluation } from '../lib/detection/eval/runner';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
YOLO Model Accuracy Evaluation

Usage:
  npx tsx --env-file=.env.local scripts/yolo-evaluate.ts <dataset.json> [options]

Arguments:
  dataset.json       Path to ground-truth JSON file

Options:
  --output <dir>     Output directory (default: ./eval-results)
  --model <path>     ONNX model path (default: from YOLO_MODEL_PATH env)
  --thresholds X,Y   Confidence thresholds to evaluate (default: 0.25,0.50,0.75)
  --iou <value>      IoU threshold for matching (default: 0.50)
  --no-visuals       Skip generating annotated PNG overlays

Example:
  npx tsx --env-file=.env.local scripts/yolo-evaluate.ts \\
    fixtures/ground-truth/dataset-v1.json \\
    --output ./eval-results \\
    --thresholds 0.30,0.50,0.70

Output:
  ./eval-results/evaluation-report.json
  ./eval-results/conf_30/per_class.csv
  ./eval-results/conf_30/per_page.csv
  ./eval-results/conf_30/<pageId>_annotated.png (TP green, FP red, FN magenta)
`);
    process.exit(0);
  }

  const datasetPath = args[0];
  let outputDir = './eval-results';
  let modelPath: string | undefined = undefined;
  let thresholds: number[] = [0.25, 0.50, 0.75];
  let iouThreshold = 0.5;
  let generateVisuals = true;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--model' && args[i + 1]) {
      modelPath = args[++i];
    } else if (args[i] === '--thresholds' && args[i + 1]) {
      thresholds = args[++i].split(',').map(parseFloat);
    } else if (args[i] === '--iou' && args[i + 1]) {
      iouThreshold = parseFloat(args[++i]);
    } else if (args[i] === '--no-visuals') {
      generateVisuals = false;
    }
  }

  try {
    const report = await runDatasetEvaluation({
      datasetPath,
      outputDir,
      modelPath,
      thresholds,
      iouThreshold,
      generateVisuals,
    });

    // Print summary to console.
    console.log('\n=== EVALUATION SUMMARY ===\n');
    console.log(`Pages annotated:    ${report.pageCount}`);
    console.log(`GT annotations:     ${report.annotationCount}`);
    console.log(`IoU threshold:      ${report.iouThreshold}`);
    console.log(`Min samples/class:  ${report.minSamplesPerClass}\n`);

    for (const tr of report.thresholds) {
      console.log(`--- Confidence Threshold: ${tr.threshold} ---`);
      console.log(`  Global Precision: ${tr.global.precision.toFixed(4)}`);
      console.log(`  Global Recall:    ${tr.global.recall.toFixed(4)}`);
      console.log(`  Global F1:        ${tr.global.f1.toFixed(4)}`);
      console.log(`  TP: ${tr.global.tp}, FP: ${tr.global.fp}, FN: ${tr.global.fn}`);
      console.log(`  Confusions:       ${tr.confusions.length}`);

      const insufficientClasses = tr.perClass.filter((c) => c.insufficientSample);
      if (insufficientClasses.length > 0) {
        console.log(
          `  Insufficient sample: ${insufficientClasses.map((c) => c.label).join(', ')}`,
        );
      }
      console.log('');
    }

    // Gate check at operating threshold 0.50.
    const opThreshold = report.thresholds.find((t) => t.threshold === 0.5);
    if (opThreshold) {
      console.log('=== ACCEPTANCE GATE CHECK (threshold 0.50) ===\n');

      const pass = {
        precision: opThreshold.global.precision >= 0.8,
        recall: opThreshold.global.recall >= 0.5,
      };

      console.log(`✓ Precision ≥ 0.80:  ${pass.precision ? 'PASS' : 'FAIL'} (${opThreshold.global.precision.toFixed(4)})`);
      console.log(`✓ Recall ≥ 0.50:     ${pass.recall ? 'PASS' : 'FAIL'} (${opThreshold.global.recall.toFixed(4)})`);

      // Check for systematic high-confidence FPs in critical categories.
      const criticalFps = opThreshold.falsePositives.filter(
        (fp) => fp.confidence >= 0.7 && (fp.category === 'equipment_misclassification' || fp.category === 'text_annotation'),
      );

      console.log(`✓ No critical FPs:  ${criticalFps.length === 0 ? 'PASS' : `FAIL (${criticalFps.length} found)`}`);

      if (criticalFps.length > 0) {
        console.log('\n  Critical false positives (conf ≥ 0.70):');
        for (const fp of criticalFps.slice(0, 5)) {
          console.log(`    - ${fp.label} (${fp.confidence.toFixed(2)}) on ${fp.pageId}`);
        }
      }

      const overallPass = pass.precision && pass.recall && criticalFps.length === 0;
      console.log(`\n${overallPass ? '✅ GATE PASSED' : '❌ GATE FAILED'} — see full report for details.\n`);
    }

    console.log(`Full report: ${path.resolve(outputDir, 'evaluation-report.json')}\n`);
    process.exit(0);
  } catch (err) {
    console.error('EVALUATION ERROR:', err);
    process.exit(1);
  }
}

main();
