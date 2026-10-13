#!/usr/bin/env tsx
/**
 * Offline human review package for sheet-1-p1.
 * No API, inference, production, baseline, or source-artifact mutation.
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'fixtures', 'diagnostics', 'pilot-sheet-1-p1-v3');
const IMAGE_PATH = path.join(ROOT, 'fixtures', 'pid-eval', 'sheet-1', 'page_1.png');
const COMPARISON_PATH = path.join(INPUT_DIR, 'comparison-postverification-result.json');
const BASELINE_PATH = path.join(ROOT, 'fixtures', 'diagnostics', 'predictions-v203-baseline.json');
const OUTPUT_DIR = path.join(INPUT_DIR, 'human-review-sheet-1-p1-v1');
const CROPS_DIR = path.join(OUTPUT_DIR, 'crops');
const OVERLAY_PATH = path.join(OUTPUT_DIR, 'sheet-1-p1-overlay.png');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const CSV_PATH = path.join(OUTPUT_DIR, 'review-list.csv');
const HTML_PATH = path.join(OUTPUT_DIR, 'review.html');
const README_PATH = path.join(OUTPUT_DIR, 'README.md');

interface Box { x1: number; y1: number; x2: number; y2: number }
interface ReviewItem {
  reviewId: string;
  source: 'AI_POST_VERIFICATION' | 'YOLO_BASELINE';
  sourceId: string;
  assetType: string;
  assetTag: string | null;
  confidence: number | null;
  bbox: Box;
  verificationVerdict: string | null;
  comparisonStatus: string;
  priority: string[];
  cropPath: string;
  matchedSourceId?: string;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}
function csv(value: unknown): string { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function boxLabel(box: Box): string { return `${Math.round(box.x1)},${Math.round(box.y1)}–${Math.round(box.x2)},${Math.round(box.y2)}`; }
function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - intersection;
  return intersection / union;
}

async function main() {
  if (fs.existsSync(OUTPUT_DIR)) throw new Error(`BLOCKED: output already exists: ${OUTPUT_DIR}`);
  for (const input of [IMAGE_PATH, COMPARISON_PATH, BASELINE_PATH]) {
    if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  }

  const comparison = JSON.parse(fs.readFileSync(COMPARISON_PATH, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const page = baseline.pages.find((entry: any) => entry.pageId === 'sheet-1-p1');
  if (!page) throw new Error('YOLO page sheet-1-p1 not found');
  const metadata = await sharp(IMAGE_PATH).metadata();
  const width = metadata.width ?? 3573;
  const height = metadata.height ?? 2526;

  fs.mkdirSync(CROPS_DIR, { recursive: true });
  const correctionIds = new Set((comparison.correctionsSummary ?? []).map((c: any) => c.candidateId));
  const aiItems: ReviewItem[] = [];
  const aiRecords = [
    ...(comparison.matchedPairs ?? []).map((pair: any) => ({
      candidateId: pair.postVerif_id, assetType: pair.postVerif_type, assetTag: pair.postVerif_tag,
      confidence: null, bbox: pair.postVerif_bbox, verificationVerdict: null,
      comparisonStatus: 'MATCHED_GEOMETRY', matchedSourceId: pair.yolo_id,
    })),
    ...(comparison.postVerifOnly ?? []).map((candidate: any) => ({
      candidateId: candidate.candidateId, assetType: candidate.assetType, assetTag: candidate.assetTag,
      confidence: candidate.confidence, bbox: candidate.convertedBbox,
      verificationVerdict: candidate.verification?.verdict ?? null, comparisonStatus: 'AI_ONLY',
    })),
  ];
  const yoloRecords = (page.retainedDetections ?? []).map((prediction: any) => ({
    predictionId: prediction.predictionId, assetType: prediction.rawLabel, assetTag: null,
    confidence: prediction.confidence, bbox: prediction.pageBox,
    verificationVerdict: null,
    comparisonStatus: (comparison.matchedPairs ?? []).some((pair: any) => pair.yolo_id === prediction.predictionId) ? 'MATCHED_GEOMETRY' : 'YOLO_ONLY',
  }));

  const addPriority = (sourceId: string, type: string, tag: string | null, status: string): string[] => {
    const reasons: string[] = [];
    if (sourceId.startsWith('discovery-') && correctionIds.has(sourceId)) reasons.push('verification correction');
    if (tag === 'LG-001' || tag === 'LG-002') reasons.push('corrected legend tag');
    if (tag === 'M-001A') reasons.push('duplicate/sequence review: M-001A');
    if (tag === 'PCV-002' || type === 'valve.ball.iso') reasons.push('PCV-002 versus valve.ball.iso conflict');
    if (status === 'YOLO_ONLY') reasons.push('unmatched YOLO candidate');
    if (sourceId.startsWith('discovery-') && status === 'AI_ONLY') reasons.push('unmatched AI candidate');
    return reasons;
  };

  const items: ReviewItem[] = [];
  for (const record of aiRecords) {
    const reviewId = `ai-${record.candidateId}`;
    items.push({ reviewId, source: 'AI_POST_VERIFICATION', sourceId: record.candidateId, assetType: record.assetType,
      assetTag: record.assetTag, confidence: record.confidence, bbox: record.bbox,
      verificationVerdict: record.verificationVerdict, comparisonStatus: record.comparisonStatus,
      priority: addPriority(record.candidateId, record.assetType, record.assetTag, record.comparisonStatus),
      cropPath: '', matchedSourceId: record.matchedSourceId });
  }
  for (const record of yoloRecords) {
    const reviewId = `yolo-${record.predictionId}`;
    items.push({ reviewId, source: 'YOLO_BASELINE', sourceId: record.predictionId, assetType: record.assetType,
      assetTag: record.assetTag, confidence: record.confidence, bbox: record.bbox,
      verificationVerdict: record.verificationVerdict, comparisonStatus: record.comparisonStatus,
      priority: addPriority(record.predictionId, record.assetType, record.assetTag, record.comparisonStatus),
      cropPath: '' });
  }

  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const overlayElements = [`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>
    .ai{fill:rgba(0,200,120,.10);stroke:#00b878;stroke-width:4}.yolo{fill:rgba(255,150,0,.10);stroke:#ff9600;stroke-width:3;stroke-dasharray:12 7}
    text{font-family:monospace;font-size:16px;font-weight:bold;paint-order:stroke;stroke:#111;stroke-width:4;stroke-linejoin:round;fill:white}
  </style>`];
  for (const item of items) {
    const box = item.bbox;
    const x = Math.max(0, Math.floor(box.x1)), y = Math.max(0, Math.floor(box.y1));
    const w = Math.max(1, Math.min(width - x, Math.ceil(box.x2 - box.x1)));
    const h = Math.max(1, Math.min(height - y, Math.ceil(box.y2 - box.y1)));
    const cls = item.source === 'AI_POST_VERIFICATION' ? 'ai' : 'yolo';
    overlayElements.push(`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x + 4}" y="${Math.max(18, y - 4)}">${esc(item.reviewId)}</text>`);
  }
  overlayElements.push('</svg>');
  await sharp(imageBuffer).composite([{ input: Buffer.from(overlayElements.join('')) }]).png().toFile(OVERLAY_PATH);

  for (const item of items) {
    const box = item.bbox;
    const padX = Math.max(80, Math.round((box.x2 - box.x1) * 0.6));
    const padY = Math.max(80, Math.round((box.y2 - box.y1) * 0.6));
    const left = Math.max(0, Math.floor(box.x1 - padX)), top = Math.max(0, Math.floor(box.y1 - padY));
    const right = Math.min(width, Math.ceil(box.x2 + padX)), bottom = Math.min(height, Math.ceil(box.y2 + padY));
    const cropWidth = Math.max(10, right - left), cropHeight = Math.max(10, bottom - top);
    const relX = Math.max(0, Math.round(box.x1 - left)), relY = Math.max(0, Math.round(box.y1 - top));
    const color = item.source === 'AI_POST_VERIFICATION' ? '#00b878' : '#ff9600';
    const label = `${item.reviewId} ${item.assetType}${item.assetTag ? ` ${item.assetTag}` : ''}`;
    const svg = Buffer.from(`<svg width="${cropWidth}" height="${cropHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="${relX}" y="${relY}" width="${Math.max(1, box.x2 - box.x1)}" height="${Math.max(1, box.y2 - box.y1)}" fill="rgba(0,0,0,0.05)" stroke="${color}" stroke-width="5"/><rect x="4" y="4" width="${Math.min(cropWidth - 8, Math.max(160, label.length * 9))}" height="24" fill="rgba(0,0,0,.8)"/><text x="10" y="21" fill="white" font-family="monospace" font-size="13">${esc(label)}</text><circle cx="${relX}" cy="${relY}" r="8" fill="#e11"/></svg>`);
    const fileName = `${item.reviewId}.png`;
    await sharp(imageBuffer).extract({ left, top, width: cropWidth, height: cropHeight }).composite([{ input: svg }]).png().toFile(path.join(CROPS_DIR, fileName));
    item.cropPath = `crops/${fileName}`;
  }

  const priorities = items.filter(item => item.priority.length > 0);
  const manifest = {
    schemaVersion: 'pilot-human-review-package-v1', generatedAt: new Date().toISOString(), pageId: 'sheet-1-p1',
    disclaimer: 'Human review preparation only. AI verification is not a human decision; no decisions are pre-filled. Comparison is not ground truth.',
    image: { path: 'sheet-1-p1-overlay.png', source: 'fixtures/pid-eval/sheet-1/page_1.png', width, height },
    counts: { aiPostVerification: aiRecords.length, yoloBaseline: yoloRecords.length, totalReviewItems: items.length, priorityItems: priorities.length },
    items,
    missedByBoth: [{ row: 1, description: '', bbox: '', class: '', tag: '', notes: '' }, { row: 2, description: '', bbox: '', class: '', tag: '', notes: '' }, { row: 3, description: '', bbox: '', class: '', tag: '', notes: '' }],
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  const csvRows = ['review_id,source,source_id,class,tag,confidence,bbox,comparison_status,verification_verdict,priority,human_decision,corrected_class,corrected_tag,corrected_bbox,duplicate_relation,notes'];
  for (const item of items) csvRows.push([item.reviewId, item.source, item.sourceId, item.assetType, item.assetTag ?? '', item.confidence == null ? '' : item.confidence, boxLabel(item.bbox), item.comparisonStatus, item.verificationVerdict ?? '', item.priority.join('; '), '', '', '', '', '', ''].map(csv).join(','));
  csvRows.push('', 'MISSED_BY_BOTH,,,,,,,,,,,,,,');
  fs.writeFileSync(CSV_PATH, csvRows.join('\n'));

  const priorityRows = priorities.map(item => `<li><code>${esc(item.reviewId)}</code> — ${esc(item.priority.join('; '))}</li>`).join('');
  const rows = items.map(item => `<tr class="${item.priority.length ? 'priority' : ''}"><td><img src="${esc(item.cropPath)}" loading="lazy" alt="${esc(item.reviewId)} crop"></td><td><code>${esc(item.reviewId)}</code><br>${esc(item.source)}<br>${esc(item.sourceId)}</td><td>${esc(item.assetType)}</td><td>${esc(item.assetTag ?? '')}</td><td>${item.confidence == null ? '' : `${Math.round(item.confidence * 100)}%`}</td><td><code>${esc(boxLabel(item.bbox))}</code></td><td>${esc(item.comparisonStatus)}<br>${esc(item.verificationVerdict ?? '')}</td><td><input aria-label="decision ${esc(item.reviewId)}" placeholder="accept / correct / reject / unresolved"><br><input aria-label="corrected class ${esc(item.reviewId)}" placeholder="corrected class"><br><input aria-label="corrected tag ${esc(item.reviewId)}" placeholder="corrected tag"><br><input aria-label="corrected bbox ${esc(item.reviewId)}" placeholder="corrected bbox"><br><input aria-label="duplicate relation ${esc(item.reviewId)}" placeholder="duplicate relation"></td><td><textarea aria-label="notes ${esc(item.reviewId)}"></textarea></td></tr>`).join('');
  fs.writeFileSync(HTML_PATH, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Human Review Sheet 1 P1</title><style>body{font:14px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3da;padding:8px;vertical-align:top}th{position:sticky;top:0;background:#eef2f5;text-align:left}img{width:300px;max-width:35vw;height:auto}.priority{background:#fff7dd}input,textarea{width:220px;box-sizing:border-box;margin:2px 0;padding:5px}textarea{height:56px}code{font-size:12px}section{margin:20px 0}.legend{display:inline-block;padding:6px 10px;border:1px solid #ccd3da;margin-right:8px}.ai{color:#008c5a}.yolo{color:#c66d00}</style></head><body><h1>Human Review — sheet-1-p1</h1><p><b>Offline package.</b> Decisions intentionally blank. This is not ground truth.</p><p><span class="legend ai">Green = AI post-verification</span><span class="legend yolo">Orange = YOLO baseline</span><span class="legend">Red dot = crop location marker</span></p><p><a href="sheet-1-p1-overlay.png">Open full-page overlay</a> · <a href="review-list.csv">Open CSV review list</a> · <a href="README.md">Acceptance criteria</a></p><h2>Priority review</h2><ul>${priorityRows}</ul><h2>All candidates (${items.length})</h2><table><thead><tr><th>Crop</th><th>ID / source</th><th>Class</th><th>Tag</th><th>Conf.</th><th>BBox</th><th>Comparison / AI verdict</th><th>Human decision + corrections</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table><h2>Objects missed by both models</h2><p>Use the CSV rows or add entries below. Do not infer completeness from this package.</p><table><tr><th>Description</th><th>BBox</th><th>Class</th><th>Tag</th><th>Notes</th></tr><tr><td><input></td><td><input></td><td><input></td><td><input></td><td><textarea></textarea></td></tr><tr><td><input></td><td><input></td><td><input></td><td><input></td><td><textarea></textarea></td></tr><tr><td><input></td><td><input></td><td><input></td><td><input></td><td><textarea></textarea></td></tr></table></body></html>`);

  fs.writeFileSync(README_PATH, `# Human review package — sheet-1-p1\n\nGenerated locally from the original image, 29 post-verification AI candidates, 60 YOLO baseline predictions, and comparison-postverification-result.json. No API call, inference, retraining, or production integration.\n\n## Open\n\nOpen [review.html](./review.html). Use [review-list.csv](./review-list.csv) for spreadsheet review. [sheet-1-p1-overlay.png](./sheet-1-p1-overlay.png) shows all boxes; green is AI and orange is YOLO. Each crop includes context, a colored bbox, and a red location marker.\n\n## Review rules\n\n- Human decision fields are blank by design. AI verdicts are evidence, not human decisions.\n- Same tag does not establish a definite duplicate. Record duplicate relation only when supported by visual/location evidence.\n- Review class, tag, bbox, missed objects, and possible duplication separately.\n- Priorities include M-001B→M-001C, LG-001/LG-002, both M-001A entries, PCV-002 versus valve.ball.iso, unmapped/ambiguous YOLO labels, and every unmatched candidate.\n\n## Proposed acceptance criteria for approval\n\n1. Class/tag/bbox accuracy is assessed from human decisions, with the reviewer approving thresholds and sampling scope.\n2. Missed objects and duplication are explicitly recorded; same-tag occurrences are not auto-collapsed.\n3. Benefit versus YOLO is judged using the reviewed object set, not raw unmatched counts alone.\n4. Review time, process time, and API cost are recorded separately.\n5. No pass/fail threshold is set by this package; approval must define the thresholds and adjudication process first.\n`);

  console.log(`[review] Wrote ${OUTPUT_DIR}`);
  console.log(`[review] Items: ${items.length} (AI ${aiRecords.length}, YOLO ${yoloRecords.length})`);
}

main().catch(error => { console.error('[review] ERROR:', error instanceof Error ? error.message : error); process.exit(1); });
