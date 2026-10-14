/**
 * Verification API Attempt-4
 *
 * Verifikasi 29 kandidat terkoreksi (dari discovery v3, normalized-0-1000 → source-pixel)
 * menggunakan Gemini Vision. Satu call, no retry, no fallback, no baseline YOLO dalam prompt.
 *
 * Output: fixtures/diagnostics/verification-api-attempt-4/verification-api-attempt-4.json
 * Guard: exclusive write (berhenti jika target / lock / checkpoint sudah ada)
 * Budget: max US$0.10
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import { writeExclusive } from './pilot-output-guard';

// ── Paths ──────────────────────────────────────────────────────────────────
const OUTPUT_DIR = 'fixtures/diagnostics/verification-api-attempt-4';
const OUTPUT_PATH = join(OUTPUT_DIR, 'verification-api-attempt-4.json');
const LOCK_PATH = join(OUTPUT_DIR, 'verification-api-attempt-4.lock');
const CHECKPOINT_PATH = join(OUTPUT_DIR, 'verification-api-attempt-4.checkpoint.json');
const IMAGE_PATH = 'fixtures/pid-eval/sheet-1/page_1.png';

// ── Config ─────────────────────────────────────────────────────────────────
const MODEL = 'gemini-3.8-flash';
const MAX_OUTPUT_TOKENS = 8192;
const MAX_BUDGET_USD = 0.10;
const INPUT_USD_PER_MILLION = 0.10;  // gemini-3.8-flash estimate
const OUTPUT_USD_PER_MILLION = 0.40;
const TIMEOUT_MS = 120_000;

// ── Image dimensions (sheet-1 page_1.png) ─────────────────────────────────
const IMG_W = 3573;
const IMG_H = 2526;

// ── 29 kandidat terkoreksi (raw normalized-0-1000, converted to source-pixel)
// Source: scripts/python/pilot_comparison_coord_corrected.py :: GEMINI_RAW
const CANDIDATES_RAW = [
  { id: 'discovery-001-001', type: 'Vessel',                     tag: 'V-001',  conf: 0.99, x1: 605, y1: 178, x2: 661, y2: 313 },
  { id: 'discovery-001-002', type: 'Vessel',                     tag: 'V-002',  conf: 0.99, x1: 530, y1: 558, x2: 606, y2: 692 },
  { id: 'discovery-001-003', type: 'Tank',                       tag: 'T-012',  conf: 0.99, x1: 453, y1: 128, x2: 492, y2: 181 },
  { id: 'discovery-001-004', type: 'Positive Displacement Pump', tag: 'P-006',  conf: 0.95, x1: 435, y1: 232, x2: 472, y2: 260 },
  { id: 'discovery-001-005', type: 'Electric Motor',             tag: 'M-001A', conf: 0.90, x1: 210, y1: 222, x2: 227, y2: 240 },
  { id: 'discovery-001-006', type: 'Electric Motor',             tag: 'M-001A', conf: 0.90, x1: 249, y1: 302, x2: 266, y2: 320 },
  { id: 'discovery-001-007', type: 'Electric Motor',             tag: 'M-001B', conf: 0.90, x1: 249, y1: 382, x2: 266, y2: 400 },
  { id: 'discovery-001-008', type: 'Electric Motor',             tag: 'M-001G', conf: 0.90, x1: 249, y1: 462, x2: 266, y2: 480 },
  { id: 'discovery-001-009', type: 'Electric Motor',             tag: 'M-001D', conf: 0.90, x1: 249, y1: 530, x2: 266, y2: 548 },
  { id: 'discovery-001-010', type: 'Electric Motor',             tag: 'M-001E', conf: 0.90, x1: 249, y1: 600, x2: 266, y2: 618 },
  { id: 'discovery-001-011', type: 'Electric Motor',             tag: 'M-001F', conf: 0.90, x1: 249, y1: 670, x2: 266, y2: 688 },
  { id: 'discovery-001-012', type: 'Electric Motor',             tag: 'M-001H', conf: 0.90, x1: 249, y1: 810, x2: 266, y2: 828 },
  { id: 'discovery-001-013', type: 'Pressure Safety Valve',      tag: 'PSV-001',conf: 0.95, x1: 583, y1: 133, x2: 601, y2: 154 },
  { id: 'discovery-001-014', type: 'Pressure Safety Valve',      tag: 'PSV-002',conf: 0.95, x1: 579, y1: 490, x2: 597, y2: 511 },
  { id: 'discovery-001-015', type: 'Level Control Valve',        tag: 'LCV-001',conf: 0.95, x1: 693, y1: 361, x2: 713, y2: 393 },
  { id: 'discovery-001-016', type: 'Level Control Valve',        tag: 'LCV-002',conf: 0.95, x1: 741, y1: 732, x2: 759, y2: 761 },
  { id: 'discovery-001-017', type: 'Pressure Control Valve',     tag: 'PCV-001',conf: 0.95, x1: 855, y1: 234, x2: 877, y2: 266 },
  { id: 'discovery-001-018', type: 'Pressure Control Valve',     tag: 'PCV-002',conf: 0.95, x1: 612, y1: 791, x2: 634, y2: 823 },
  { id: 'discovery-001-019', type: 'Flow Element',               tag: null,     conf: 0.90, x1: 847, y1: 182, x2: 858, y2: 204 },
  { id: 'discovery-001-020', type: 'Flow Element',               tag: null,     conf: 0.90, x1: 591, y1: 841, x2: 603, y2: 863 },
  { id: 'discovery-001-021', type: 'Temperature Indicator',      tag: 'TI-001', conf: 0.90, x1: 595, y1: 234, x2: 608, y2: 249 },
  { id: 'discovery-001-022', type: 'Pressure Indicator',         tag: 'PI-001', conf: 0.90, x1: 662, y1: 127, x2: 676, y2: 142 },
  { id: 'discovery-001-023', type: 'Level Indicator',            tag: 'LG',     conf: 0.90, x1: 730, y1: 268, x2: 743, y2: 281 },
  { id: 'discovery-001-024', type: 'Level Indicator',            tag: 'LG',     conf: 0.90, x1: 569, y1: 612, x2: 582, y2: 625 },
  { id: 'discovery-001-025', type: 'Level Controller',           tag: 'LIC-001',conf: 0.90, x1: 772, y1: 196, x2: 790, y2: 217 },
  { id: 'discovery-001-026', type: 'Level Controller',           tag: 'LIC-002',conf: 0.90, x1: 791, y1: 558, x2: 809, y2: 580 },
  { id: 'discovery-001-027', type: 'Check Valve',                tag: null,     conf: 0.85, x1: 465, y1: 242, x2: 483, y2: 252 },
  { id: 'discovery-001-028', type: 'Gate Valve',                 tag: null,     conf: 0.85, x1: 498, y1: 241, x2: 516, y2: 253 },
  { id: 'discovery-001-029', type: 'Check Valve',                tag: null,     conf: 0.85, x1: 194, y1: 222, x2: 208, y2: 234 },
];

// Convert normalized-0-1000 → source-pixel
const CANDIDATES = CANDIDATES_RAW.map(c => ({
  candidateId: c.id,
  assetType: c.type,
  assetTag: c.tag,
  discoveryConfidence: c.conf,
  sourcePixelBbox: {
    x1: Math.round(c.x1 / 1000 * IMG_W * 100) / 100,
    y1: Math.round(c.y1 / 1000 * IMG_H * 100) / 100,
    x2: Math.round(c.x2 / 1000 * IMG_W * 100) / 100,
    y2: Math.round(c.y2 / 1000 * IMG_H * 100) / 100,
  },
}));

// ── Legend (COMBINED subset — asset types present in candidates) ───────────
const LEGEND_LABELS = [
  'Vessel', 'Tank', 'Positive Displacement Pump', 'Electric Motor',
  'Pressure Safety Valve', 'Level Control Valve', 'Pressure Control Valve',
  'Flow Element', 'Temperature Indicator', 'Pressure Indicator',
  'Level Indicator', 'Level Controller', 'Check Valve', 'Gate Valve',
];

// ── Helpers ────────────────────────────────────────────────────────────────
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function parseJson(text: string): unknown | null {
  try { return JSON.parse(text); } catch { /* continue */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) try { return JSON.parse(text.slice(s, e + 1)); } catch { /* continue */ }
  return null;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function writeCheckpoint(data: object) {
  await fs.writeFile(CHECKPOINT_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();

  // ── Preflight guards (berhenti sebelum API jika ada konflik) ──────────────
  if (await exists(OUTPUT_PATH)) {
    console.error(`GUARD: output already exists: ${OUTPUT_PATH}`);
    process.exitCode = 2; return;
  }
  if (await exists(LOCK_PATH)) {
    console.error(`GUARD: lock already exists: ${LOCK_PATH}`);
    process.exitCode = 2; return;
  }
  if (await exists(CHECKPOINT_PATH)) {
    console.error(`GUARD: checkpoint already exists: ${CHECKPOINT_PATH}`);
    process.exitCode = 2; return;
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Exclusive lock
  try {
    const fd = await fs.open(LOCK_PATH, 'wx');
    await fd.writeFile(JSON.stringify({ status: 'reserved', startedAt }) + '\n');
    await fd.close();
  } catch (e: any) {
    console.error(`GUARD: exclusive lock failed: ${e?.message}`);
    process.exitCode = 2; return;
  }

  await writeCheckpoint({ status: 'reserved', startedAt });
  console.log(`LOCK_PATH=${LOCK_PATH}`);

  // ── Load image ────────────────────────────────────────────────────────────
  const imageBuf = await fs.readFile(IMAGE_PATH);
  const imageBase64 = imageBuf.toString('base64');
  const imageSha256 = sha256(imageBuf);
  console.log(`IMAGE sha256=${imageSha256} bytes=${imageBuf.length}`);

  // ── Get API key from DB ────────────────────────────────────────────────────
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/asset_detection',
  });
  let geminiKey: string;
  try {
    const r = await pool.query('SELECT gemini_api_key FROM settings WHERE id=1');
    geminiKey = r.rows[0]?.gemini_api_key;
    if (!geminiKey || geminiKey === 'your_gemini_key_here') {
      throw new Error('Gemini API key unavailable from DB settings');
    }
  } finally {
    await pool.end();
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const candidateList = CANDIDATES.map((c, i) =>
    `${i + 1}. candidateId="${c.candidateId}" assetType="${c.assetType}" assetTag=${c.assetTag ?? 'null'} ` +
    `confidence=${c.discoveryConfidence} bbox=[${c.sourcePixelBbox.x1},${c.sourcePixelBbox.y1},${c.sourcePixelBbox.x2},${c.sourcePixelBbox.y2}]`
  ).join('\n');

  const prompt = `You are an industrial P&ID asset verification assistant.

You are given:
1. The original P&ID page image (3573x2526 pixels, source-pixel coordinate space).
2. A list of ${CANDIDATES.length} asset candidates from a prior discovery pass.
3. The closed vocabulary of valid asset types (legend).

Your task: verify each candidate by inspecting the bounding box region in the image.

Legend (valid asset types): ${LEGEND_LABELS.join(', ')}

Candidates to verify:
${candidateList}

For each candidate, determine:
- verdict: one of "confirmed", "corrected", "rejected", "uncertain"
  - confirmed: symbol at bbox matches assetType and tag (if provided) is readable
  - corrected: symbol present but assetType or tag differs from candidate — provide correctedAssetType and/or correctedAssetTag
  - rejected: no matching asset symbol found at bbox location
  - uncertain: symbol present but cannot reliably determine type or tag
- evidence: 1–3 brief observable visual facts supporting verdict
- correctedAssetType: string or null (only when verdict=corrected)
- correctedAssetTag: string or null (only when verdict=corrected and tag differs)

Rules:
- Inspect ONLY the bbox region indicated, do not use surrounding context to invent data
- Bounding boxes are in source-pixel coordinates of the 3573x2526 image
- Do not fabricate asset tags or descriptions not visible in the image
- Return valid JSON only

Return JSON:
{
  "verifications": [
    {
      "candidateId": "discovery-001-001",
      "verdict": "confirmed|corrected|rejected|uncertain",
      "evidence": ["observable fact 1", "observable fact 2"],
      "correctedAssetType": null,
      "correctedAssetTag": null
    }
  ]
}`;

  await writeCheckpoint({ status: 'input_ready', startedAt, candidateCount: CANDIDATES.length });
  console.log(`INPUT_READY candidates=${CANDIDATES.length}`);

  // ── countTokens + budget check ─────────────────────────────────────────────
  const client = new GoogleGenerativeAI(geminiKey);
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.05, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
  });

  const requestParts = [
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: imageBase64 } },
  ];

  let inputTokens: number;
  try {
    const countResult = await model.countTokens(requestParts);
    inputTokens = Number(countResult.totalTokens ?? 0);
  } catch (e: any) {
    console.error(`COUNT_TOKENS_ERROR: ${e?.message}`);
    await writeCheckpoint({ status: 'failed', error: `countTokens: ${e?.message}`, startedAt });
    await fs.writeFile(LOCK_PATH, JSON.stringify({ status: 'failed', completedAt: new Date().toISOString() }) + '\n');
    process.exitCode = 1; return;
  }

  const estimatedInputUsd = inputTokens * INPUT_USD_PER_MILLION / 1_000_000;
  const estimatedOutputUsd = MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION / 1_000_000;
  const estimatedUpperBoundUsd = estimatedInputUsd + estimatedOutputUsd;

  console.log(JSON.stringify({
    model: MODEL, inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS,
    estimatedInputUsd, estimatedOutputUsd, estimatedUpperBoundUsd, budget: MAX_BUDGET_USD,
  }));

  if (!Number.isFinite(inputTokens) || estimatedUpperBoundUsd > MAX_BUDGET_USD) {
    const msg = `Budget exceeded: $${estimatedUpperBoundUsd.toFixed(6)} > $${MAX_BUDGET_USD}`;
    console.error(`BUDGET_FAIL: ${msg}`);
    await writeCheckpoint({ status: 'failed', error: msg, startedAt, estimatedUpperBoundUsd });
    await fs.writeFile(LOCK_PATH, JSON.stringify({ status: 'failed', completedAt: new Date().toISOString() }) + '\n');
    process.exitCode = 1; return;
  }

  await writeCheckpoint({ status: 'budget_checked', startedAt, inputTokens, estimatedUpperBoundUsd });
  console.log(`BUDGET_OK inputTokens=${inputTokens} upperBound=$${estimatedUpperBoundUsd.toFixed(6)}`);

  // ── generateContent (single call, no retry) ────────────────────────────────
  const generationStartedMs = Date.now();
  await writeCheckpoint({ status: 'sdk_call_started', startedAt, inputTokens });
  console.log(`GENERATION_START model=${MODEL}`);

  let rawText = '';
  let usage: unknown = null;
  let finishReason: string | null = null;
  let generationError: string | null = null;

  try {
    const result = await withTimeout(model.generateContent(requestParts), TIMEOUT_MS);
    rawText = result.response.text();
    usage = result.response.usageMetadata ?? null;
    finishReason = result.response.candidates?.[0]?.finishReason ?? null;
  } catch (e: any) {
    generationError = e instanceof Error ? e.message : String(e);
  }

  const generationDurationMs = Date.now() - generationStartedMs;
  console.log(`GENERATION_DONE durationMs=${generationDurationMs} finishReason=${finishReason} error=${generationError ?? 'none'}`);

  if (generationError) {
    await writeCheckpoint({ status: 'failed', error: generationError, startedAt });
    await fs.writeFile(LOCK_PATH, JSON.stringify({ status: 'failed', completedAt: new Date().toISOString() }) + '\n');
    process.exitCode = 1; return;
  }

  await writeCheckpoint({ status: 'response_received', startedAt, inputTokens, finishReason });

  // ── Parse + build output ──────────────────────────────────────────────────
  const parsed = rawText ? parseJson(rawText) : null;
  const verifications: any[] = (parsed as any)?.verifications ?? [];

  // ── Exclusive write ────────────────────────────────────────────────────────
  const output = {
    schemaVersion: 'verification-api-attempt-4-v1',
    runId: `verif-4-${Date.now()}`,
    status: 'completed',
    model: MODEL,
    pageId: 'sheet-1-p1',
    input: {
      imagePath: IMAGE_PATH,
      imageSha256,
      imageBytes: imageBuf.length,
      dimensions: { width: IMG_W, height: IMG_H },
      legendSource: 'lib/standard-legends.ts :: COMBINED (subset)',
      baselineIncluded: false,
      candidateCount: CANDIDATES.length,
      coordinateNote: 'converted from normalized-0-1000 (discovery v3) to source-pixel',
    },
    request: {
      sdkCallCounts: { countTokens: 1, generateContent: 1 },
      observedHttpRequests: null,
      retry: false,
      fallback: false,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    cost: {
      inputTokens, estimatedInputUsd, estimatedOutputUsd, estimatedUpperBoundUsd,
      maxBudgetUsd: MAX_BUDGET_USD, actualCostUsd: null,
      inputUsdPerMillion: INPUT_USD_PER_MILLION,
      outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
      priceSource: 'https://ai.google.dev/gemini-api/docs/pricing (estimate)',
      note: 'Upper bound uses max output tokens; actual may be lower.',
    },
    timing: { startedAt, generationDurationMs, completedAt: new Date().toISOString() },
    usage,
    finishReason,
    rawResponse: rawText,
    parsedResponse: parsed,
    originalCandidates: CANDIDATES,
    verifications,
    summary: {
      total: CANDIDATES.length,
      confirmed: verifications.filter((v: any) => v.verdict === 'confirmed').length,
      corrected: verifications.filter((v: any) => v.verdict === 'corrected').length,
      rejected: verifications.filter((v: any) => v.verdict === 'rejected').length,
      uncertain: verifications.filter((v: any) => v.verdict === 'uncertain').length,
      parsed: verifications.length,
      notGroundTruth: true,
    },
  };

  const writeResult = await writeExclusive(OUTPUT_PATH, JSON.stringify(output, null, 2));
  if (!writeResult.ok) {
    console.error(`WRITE_EXCLUSIVE_FAILED: ${writeResult.message}`);
    await fs.writeFile(LOCK_PATH, JSON.stringify({ status: 'failed', completedAt: new Date().toISOString() }) + '\n');
    process.exitCode = 3; return;
  }

  await fs.writeFile(LOCK_PATH, JSON.stringify({ status: 'succeeded', completedAt: new Date().toISOString() }) + '\n');

  console.log(`OUTPUT=${OUTPUT_PATH}`);
  console.log(`STATUS=completed DURATION_MS=${generationDurationMs} VERIFIED=${verifications.length}/${CANDIDATES.length}`);
  console.log(`SUMMARY=${JSON.stringify(output.summary)}`);
  if (usage) console.log(`USAGE=${JSON.stringify(usage)}`);
}

main().catch(e => {
  console.error(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
