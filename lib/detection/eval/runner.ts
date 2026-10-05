/**
 * YOLO evaluation runner — executes evaluation on a dataset, outputs JSON, CSV,
 * and annotated visual images with TP (green), FP (red), FN (magenta), Confusions (orange).
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { runYoloInference } from '@/lib/detection/yolo/yolo-inference';
import { type YoloDetection } from '@/lib/detection/yolo/yolo-decoder';
import { getYoloModelPath } from '@/lib/detection/feature-flags';
import { aggregateThresholdResult } from './matcher';
import type {
  EvaluationReport,
  GroundTruthDataset,
  GroundTruthPage,
  ThresholdResult,
} from './types';

export interface RunEvaluationOptions {
  datasetPath: string;
  outputDir: string;
  modelPath?: string;
  thresholds?: number[];
  iouThreshold?: number;
  generateVisuals?: boolean;
}

/**
 * Generate an annotated PNG for one page at a given threshold.
 *
 * Legend:
 * - Green: True Positive (model detected, GT matched)
 * - Red: False Positive (model detected, no GT)
 * - Magenta/Pink: False Negative (GT exists, model missed)
 * - Orange: Confusion (IoU matched a GT box of a DIFFERENT class)
 */
export async function renderAnnotatedPage(
  imagePath: string,
  page: GroundTruthPage,
  result: ThresholdResult,
  outputPath: string,
): Promise<void> {
  const imageBuffer = fs.readFileSync(imagePath);
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || page.width;
  const height = metadata.height || page.height;

  const pageMatches = result.matches.filter((m) => m.pageId === page.pageId);
  const pageFps = result.falsePositives.filter((f) => f.pageId === page.pageId);
  const pageFns = result.falseNegatives.filter((f) => f.pageId === page.pageId);
  const pageConfusions = result.confusions.filter((c) => c.pageId === page.pageId);

  const svgElements: string[] = [];

  // TP (Green)
  for (const m of pageMatches) {
    const b = m.detectionBbox;
    svgElements.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="rgba(0,255,0,0.15)" stroke="#00cc00" stroke-width="4"/>` +
        `<text x="${b.x}" y="${Math.max(30, b.y - 8)}" font-size="28" fill="#00aa00" font-weight="bold" font-family="monospace">TP: ${m.label} ${m.confidence.toFixed(2)} (iou:${m.iou.toFixed(2)})</text>`,
    );
  }

  // FP (Red)
  for (const fp of pageFps) {
    const b = fp.bbox;
    svgElements.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="rgba(255,0,0,0.2)" stroke="#ff0000" stroke-width="5" stroke-dasharray="8,4"/>` +
        `<text x="${b.x}" y="${Math.max(30, b.y - 8)}" font-size="28" fill="#cc0000" font-weight="bold" font-family="monospace">FP: ${fp.label} ${fp.confidence.toFixed(2)}</text>`,
    );
  }

  // FN (Magenta / Dashed)
  for (const fn of pageFns) {
    const b = fn.bbox;
    const bestDetInfo = fn.bestDetectionConfidence !== null
      ? ` (best det: ${fn.bestDetectionConfidence.toFixed(2)})`
      : ' (no det)';
    svgElements.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="rgba(255,0,255,0.1)" stroke="#cc00cc" stroke-width="4" stroke-dasharray="12,6"/>` +
        `<text x="${b.x}" y="${Math.min(height - 10, b.y + b.height + 26)}" font-size="28" fill="#aa00aa" font-weight="bold" font-family="monospace">FN: ${fn.label}${bestDetInfo}</text>`,
    );
  }

  // Confusions (Orange)
  for (const c of pageConfusions) {
    svgElements.push(
      `<text x="${10}" y="${height - 40}" font-size="32" fill="#ff6600" font-weight="bold" font-family="monospace">CONFUSION: pred ${c.predictedLabel} vs gt ${c.gtLabel} (${c.confidence.toFixed(2)})</text>`,
    );
  }

  const overlaySvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgElements.join('')}</svg>`,
  );

  await sharp(imageBuffer)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png()
    .toFile(outputPath);
}

/**
 * Format evaluation results as CSV text for spreadsheets.
 */
export function formatPerClassCsv(result: ThresholdResult): string {
  const rows = [
    'class_id,label,gt_count,tp,fp,fn,precision,recall,f1,insufficient_sample',
    ...result.perClass.map(
      (c) =>
        `${c.classId},"${c.label}",${c.gtCount},${c.tp},${c.fp},${c.fn},${c.precision.toFixed(4)},${c.recall.toFixed(4)},${c.f1.toFixed(4)},${c.insufficientSample}`,
    ),
  ];
  return rows.join('\n');
}

export function formatPerPageCsv(result: ThresholdResult): string {
  const rows = [
    'page_id,tp,fp,fn,precision,recall,f1',
    ...result.perPage.map(
      (p) =>
        `"${p.pageId}",${p.tp},${p.fp},${p.fn},${p.precision.toFixed(4)},${p.recall.toFixed(4)},${p.f1.toFixed(4)}`,
    ),
  ];
  return rows.join('\n');
}

/**
 * Main evaluation entrypoint.
 */
export async function runDatasetEvaluation(
  options: RunEvaluationOptions,
): Promise<EvaluationReport> {
  const datasetAbsPath = path.resolve(process.cwd(), options.datasetPath);
  if (!fs.existsSync(datasetAbsPath)) {
    throw new Error(`Ground truth dataset not found at: ${datasetAbsPath}`);
  }

  const rawJson = fs.readFileSync(datasetAbsPath, 'utf8');
  const dataset: GroundTruthDataset = JSON.parse(rawJson);

  const modelPath = options.modelPath ?? getYoloModelPath();
  const thresholds = options.thresholds ?? [0.25, 0.50, 0.75];
  const iouThreshold = options.iouThreshold ?? dataset.iouThreshold ?? 0.5;
  const generateVisuals = options.generateVisuals ?? true;

  const datasetDir = path.dirname(datasetAbsPath);
  fs.mkdirSync(options.outputDir, { recursive: true });

  console.log(`\n=== YOLO MODEL ACCURACY EVALUATION ===`);
  console.log(`Dataset:    ${datasetAbsPath} (${dataset.pages.length} pages)`);
  console.log(`Model:      ${modelPath}`);
  console.log(`IoU Thresh: ${iouThreshold}`);
  console.log(`Thresholds: ${thresholds.join(', ')}\n`);

  // Step 1: Run raw inference (at lowest threshold 0.10) ONCE per page and cache detections.
  const pageDetections = new Map<string, YoloDetection[]>();
  let totalAnnotations = 0;

  for (let i = 0; i < dataset.pages.length; i++) {
    const page = dataset.pages[i];
    totalAnnotations += page.annotations.length;

    const imgAbsPath = path.isAbsolute(page.imagePath)
      ? page.imagePath
      : path.resolve(datasetDir, page.imagePath);

    if (!fs.existsSync(imgAbsPath)) {
      throw new Error(`Page image not found: ${imgAbsPath} (pageId: ${page.pageId})`);
    }

    console.log(`[${i + 1}/${dataset.pages.length}] Running YOLO on ${page.pageId} (${page.width}x${page.height})...`);
    const imgBuffer = fs.readFileSync(imgAbsPath);

    // Run inference with low threshold to capture all candidates down to 0.10
    const rawDetections = await runYoloInference(imgBuffer, {
      modelPath,
      config: {
        confidenceThreshold: 0.10,
        nmsIouThreshold: 0.50,
        maxDetections: 500,
      },
    });

    console.log(`   -> ${rawDetections.length} raw detections, ${page.annotations.length} GT annotations`);
    pageDetections.set(page.pageId, rawDetections);
  }

  // Step 2: Compute metrics across all requested confidence thresholds.
  const thresholdResults: ThresholdResult[] = [];

  for (const t of thresholds) {
    const res = aggregateThresholdResult(
      t,
      dataset.pages,
      pageDetections,
      iouThreshold,
    );
    thresholdResults.push(res);

    // Save CSV summaries for this threshold
    const csvDir = path.join(options.outputDir, `conf_${(t * 100).toFixed(0)}`);
    fs.mkdirSync(csvDir, { recursive: true });
    fs.writeFileSync(path.join(csvDir, 'per_class.csv'), formatPerClassCsv(res));
    fs.writeFileSync(path.join(csvDir, 'per_page.csv'), formatPerPageCsv(res));

    // Save annotated visual output
    if (generateVisuals) {
      console.log(`\nGenerating visual overlays for conf >= ${t}...`);
      for (const page of dataset.pages) {
        const imgAbsPath = path.isAbsolute(page.imagePath)
          ? page.imagePath
          : path.resolve(datasetDir, page.imagePath);
        const outVisualPath = path.join(csvDir, `${page.pageId}_annotated.png`);
        await renderAnnotatedPage(imgAbsPath, page, res, outVisualPath);
      }
    }
  }

  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    modelPath,
    datasetPath: datasetAbsPath,
    iouThreshold,
    minSamplesPerClass: 5,
    pageCount: dataset.pages.length,
    annotationCount: totalAnnotations,
    thresholds: thresholdResults,
  };

  const reportJsonPath = path.join(options.outputDir, 'evaluation-report.json');
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written: ${reportJsonPath}`);

  return report;
}
