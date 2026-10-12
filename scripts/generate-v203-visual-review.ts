#!/usr/bin/env tsx
/**
 * YOLO v203 Offline Visual Review Generator (Offline Preparation Only)
 *
 * SCOPE & CONTRACT:
 * - Generate offline visual review assets from the verified prediction baseline:
 *   fixtures/diagnostics/predictions-v203-baseline.json
 * - Output structure (versioned, under fixtures/diagnostics/review-v203-baseline-v1/):
 *   1. full-page/            -> Full-page image with retained prediction bounding boxes & labels
 *   2. candidate-crops/      -> Bounded crops around each prediction with surrounding context
 *   3. tile-seams/           -> Diagnostic full-page image showing 1024x1024 tile boundaries & overlap
 *   4. class-reference-v203/ -> Table of all 203 raw class names for reviewer reference
 *   5. manifest.json         -> Machine-readable mapping of pages, predictions, crop files, and metadata
 *   6. review-manifest.csv   -> Tabular manifest for reviewer inspection
 *
 * STRICT INTEGRITY RULES:
 * - All candidates retain label: UNREVIEWED_MODEL_PREDICTION
 * - NO TP/FP labeling, NO quality score, NO precision/recall/F1 calculation
 * - Does NOT modify any production or baseline files
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'fixtures', 'diagnostics', 'predictions-v203-baseline.json');
const CLASS_MAP_FILE = path.join(REPO_ROOT, 'model', 'yolo-v203-names.json');
const OUTPUT_DIR = path.join(REPO_ROOT, 'fixtures', 'diagnostics', 'review-v203-baseline-v1');

const FULL_PAGE_DIR = path.join(OUTPUT_DIR, 'full-page');
const CROP_DIR = path.join(OUTPUT_DIR, 'candidate-crops');
const TILE_SEAM_DIR = path.join(OUTPUT_DIR, 'tile-seams');
const CLASS_REF_DIR = path.join(OUTPUT_DIR, 'class-reference-v203');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'review-manifest.csv');

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function generateVisualReviewPackage() {
  console.log('=== Generating YOLO v203 Visual Review Package ===');

  if (!fs.existsSync(BASELINE_FILE)) {
    throw new Error(`Baseline file not found: ${BASELINE_FILE}`);
  }

  const baselineData = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const rawClassNames: Record<string, string> = fs.existsSync(CLASS_MAP_FILE)
    ? JSON.parse(fs.readFileSync(CLASS_MAP_FILE, 'utf8'))
    : {};

  // Create directories
  [OUTPUT_DIR, FULL_PAGE_DIR, CROP_DIR, TILE_SEAM_DIR, CLASS_REF_DIR].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });

  // 1. Generate Class Reference Markdown Table
  console.log('[1/5] Generating v203 raw class reference table...');
  const classRows: string[] = [
    '# YOLO v203 Raw Class Vocabulary Reference (203 Classes)',
    '',
    'This table serves as the primary visual reference during human review.',
    'Semantic mappings are proposal-only; do NOT force-map ambiguous classes.',
    '',
    '| Raw Class ID | Raw Label (ONNX Metadata) | Category | Standard Reference |',
    '|---|---|---|---|',
  ];

  for (let id = 0; id < 203; id++) {
    const rawLabel = rawClassNames[String(id)] || `class_${id}`;
    const parts = rawLabel.split('.');
    const category = parts[0] || 'unknown';
    const standard = parts.length > 2 ? parts[parts.length - 1].toUpperCase() : '-';
    classRows.push(`| ${id} | \`${rawLabel}\` | ${category} | ${standard} |`);
  }

  fs.writeFileSync(path.join(CLASS_REF_DIR, 'v203-raw-label-table.md'), classRows.join('\n'));

  // 2. Process each page
  const manifestPages: any[] = [];
  const csvRows: string[] = [
    'page_id,prediction_id,candidate_id,raw_class_id,raw_label,confidence,page_box_x1,page_box_y1,page_box_x2,page_box_y2,tile_index,crop_file,review_status',
  ];

  let totalCropsGenerated = 0;

  for (let pIdx = 0; pIdx < baselineData.pages.length; pIdx++) {
    const page = baselineData.pages[pIdx];
    const imagePath = path.resolve(REPO_ROOT, page.imagePath);

    if (!fs.existsSync(imagePath)) {
      console.warn(`[WARN] Image not found for page ${page.pageId}: ${imagePath}`);
      continue;
    }

    console.log(`[2/5] Processing Page [${pIdx + 1}/${baselineData.pages.length}] ${page.pageId} (${page.dimensions.width}x${page.dimensions.height})...`);
    const imageBuffer = fs.readFileSync(imagePath);
    const { width: pageW, height: pageH } = page.dimensions;

    // --- A. Full-Page Overlay with Retained Predictions ---
    const fullPageOverlaySvgElements: string[] = [];
    fullPageOverlaySvgElements.push(
      `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
      `<style>
        .bbox { fill: rgba(255, 50, 50, 0.12); stroke: #e60000; stroke-width: 3; stroke-dasharray: none; }
        .lbl-bg { fill: rgba(0, 0, 0, 0.75); rx: 3; ry: 3; }
        .lbl-txt { fill: #ffffff; font-family: monospace, sans-serif; font-size: 13px; font-weight: bold; }
      </style>`,
    );

    const pageManifestCrops: any[] = [];

    for (let cIdx = 0; cIdx < page.retainedDetections.length; cIdx++) {
      const pred = page.retainedDetections[cIdx];
      const box = pred.pageBox;
      const boxX1 = Math.round(box.x1);
      const boxY1 = Math.round(box.y1);
      const boxX2 = Math.round(box.x2);
      const boxY2 = Math.round(box.y2);
      const boxW = Math.max(1, boxX2 - boxX1);
      const boxH = Math.max(1, boxY2 - boxY1);

      // SVG Bbox & Label
      fullPageOverlaySvgElements.push(
        `<rect class="bbox" x="${boxX1}" y="${boxY1}" width="${boxW}" height="${boxH}" />`,
      );

      const labelText = `${pred.rawLabel} (${(pred.confidence * 100).toFixed(1)}%)`;
      const labelW = Math.min(boxW + 80, Math.max(120, Math.round(labelText.length * 8.5 + 12)));
      const labelH = 20;
      const labelY = Math.max(2, boxY1 - labelH - 2);

      fullPageOverlaySvgElements.push(
        `<rect class="lbl-bg" x="${boxX1}" y="${labelY}" width="${labelW}" height="${labelH}" />`,
        `<text class="lbl-txt" x="${boxX1 + 6}" y="${labelY + 14}">${escapeXml(labelText)}</text>`,
      );

      // --- B. Candidate Crop with Surrounding Context ---
      // Add context margin: ~40% padding or minimum 80px around detection
      const padX = Math.max(40, Math.round(boxW * 0.4));
      const padY = Math.max(40, Math.round(boxH * 0.4));

      const cropX1 = Math.max(0, Math.floor(boxX1 - padX));
      const cropY1 = Math.max(0, Math.floor(boxY1 - padY));
      const cropX2 = Math.min(pageW, Math.ceil(boxX2 + padX));
      const cropY2 = Math.min(pageH, Math.ceil(boxY2 + padY));

      const extractW = Math.round(cropX2 - cropX1);
      const extractH = Math.round(cropY2 - cropY1);

      if (extractW >= 10 && extractH >= 10) {
        const cropFileName = `${page.pageId}_${pred.predictionId}_crop.png`;
        const cropFilePath = path.join(CROP_DIR, cropFileName);

        // Bbox coordinates relative to the crop
        const relBoxX = Math.round(boxX1 - cropX1);
        const relBoxY = Math.round(boxY1 - cropY1);

        const cropSvg = Buffer.from(
          `<svg width="${extractW}" height="${extractH}" xmlns="http://www.w3.org/2000/svg">
            <rect x="${relBoxX}" y="${relBoxY}" width="${boxW}" height="${boxH}" fill="rgba(255, 0, 0, 0.15)" stroke="#ff0000" stroke-width="3" />
            <rect x="6" y="6" width="${Math.min(extractW - 12, Math.round(labelText.length * 9 + 16))}" height="22" fill="rgba(0,0,0,0.8)" rx="4" ry="4"/>
            <text x="12" y="21" fill="#00ffcc" font-family="monospace" font-size="13" font-weight="bold">${escapeXml(labelText)}</text>
          </svg>`,
        );

        await sharp(imageBuffer)
          .extract({ left: cropX1, top: cropY1, width: extractW, height: extractH })
          .composite([{ input: cropSvg }])
          .png()
          .toFile(cropFilePath);

        pageManifestCrops.push({
          predictionId: pred.predictionId,
          cropFileName,
          relativeCropPath: `candidate-crops/${cropFileName}`,
          cropCoordinatesInPage: { x1: cropX1, y1: cropY1, x2: cropX2, y2: cropY2 },
        });

        totalCropsGenerated++;

        // Append to CSV
        csvRows.push(
          [
            page.pageId,
            pred.predictionId,
            pred.candidateId,
            pred.rawClassId,
            `"${pred.rawLabel}"`,
            pred.confidence.toFixed(4),
            box.x1,
            box.y1,
            box.x2,
            box.y2,
            pred.tileProvenance.tileIndex,
            `candidate-crops/${cropFileName}`,
            'UNREVIEWED_MODEL_PREDICTION',
          ].join(','),
        );
      }
    }

    fullPageOverlaySvgElements.push('</svg>');
    const fullPageOverlaySvg = Buffer.from(fullPageOverlaySvgElements.join('\n'));

    const fullPageOutPath = path.join(FULL_PAGE_DIR, `${page.pageId}_overlay.png`);
    await sharp(imageBuffer)
      .composite([{ input: fullPageOverlaySvg }])
      .png()
      .toFile(fullPageOutPath);

    // --- C. Tile Seam Diagnostic Layer ---
    const seamSvgElements: string[] = [
      `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`,
      `<style>
        .grid-line { fill: none; stroke: #00ccff; stroke-width: 2; stroke-dasharray: 6,4; opacity: 0.85; }
        .tile-lbl { fill: #002244; font-family: monospace; font-size: 14px; font-weight: bold; }
        .tile-bg { fill: rgba(0, 204, 255, 0.45); rx: 3; ry: 3; }
      </style>`,
    ];

    for (const t of page.tileSummaries) {
      const tx = t.tileOffset.x;
      const ty = t.tileOffset.y;
      const tw = 1024;
      const th = 1024;
      seamSvgElements.push(
        `<rect class="grid-line" x="${tx}" y="${ty}" width="${tw}" height="${th}" />`,
        `<rect class="tile-bg" x="${tx + 6}" y="${ty + 6}" width="160" height="24" />`,
        `<text class="tile-lbl" x="${tx + 12}" y="${ty + 22}">Tile ${t.tileIndex} (R${t.rowIndex} C${t.colIndex}) [${t.mappedPageDetections} det]</text>`,
      );
    }
    seamSvgElements.push('</svg>');

    const seamOutPath = path.join(TILE_SEAM_DIR, `${page.pageId}_tile_grid_seams.png`);
    await sharp(imageBuffer)
      .composite([{ input: Buffer.from(seamSvgElements.join('\n')) }])
      .png()
      .toFile(seamOutPath);

    manifestPages.push({
      pageId: page.pageId,
      sourceImagePath: page.imagePath,
      imageSha256: page.imageSha256,
      dimensions: page.dimensions,
      fullPageOverlay: `full-page/${page.pageId}_overlay.png`,
      tileSeamDiagnostic: `tile-seams/${page.pageId}_tile_grid_seams.png`,
      retainedPredictionCount: page.counts.retainedAfterMerge,
      rawCandidateCount: page.counts.rawCandidatesBeforeMerge,
      crops: pageManifestCrops,
    });
  }

  // 3. Write Manifest JSON and CSV
  console.log('[3/5] Writing review manifest JSON and CSV...');
  const manifestPayload = {
    metadata: {
      packageType: 'yolo_v203_visual_review_package',
      version: '1.0',
      createdAt: new Date().toISOString(),
      baselineSource: 'fixtures/diagnostics/predictions-v203-baseline.json',
      baselineRunId: baselineData.metadata?.runId || 'unknown',
      totalPageRecords: manifestPages.length,
      totalCandidateCrops: totalCropsGenerated,
      reviewStatusNotice: 'All candidates are UNREVIEWED_MODEL_PREDICTION. No automatic ground-truth or quality metrics applied.',
      fullPageReviewNotice: 'Reviewers must inspect full-page images to find missed equipment/symbols not proposed by the model (False Negatives).',
      duplicateClusterNotice: 'sheet-7-p1 and sheet-7-rev-p1 have identical SHA256 hashes and produce identical detections. They are provided as duplicate review targets but should not be double-counted as independent evidence in generalization summaries.',
    },
    pages: manifestPages,
  };

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifestPayload, null, 2));
  fs.writeFileSync(CSV_FILE, csvRows.join('\n'));

  // 4. Summary Output
  console.log('\n=== Visual Review Package Successfully Generated ===');
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log(`- Full Page Overlays: 12 images in ${FULL_PAGE_DIR}`);
  console.log(`- Candidate Crops: ${totalCropsGenerated} images in ${CROP_DIR}`);
  console.log(`- Tile Seam Diagnostics: 12 images in ${TILE_SEAM_DIR}`);
  console.log(`- Class Reference: ${path.join(CLASS_REF_DIR, 'v203-raw-label-table.md')}`);
  console.log(`- Manifest JSON: ${MANIFEST_FILE}`);
  console.log(`- Manifest CSV: ${CSV_FILE}`);
}

if (require.main === module) {
  generateVisualReviewPackage().catch((err) => {
    console.error('[FATAL] Visual review generation failed:', err);
    process.exit(1);
  });
}
