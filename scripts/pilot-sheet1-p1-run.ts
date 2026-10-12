import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import { reserveTarget, finalizeReservation, writeExclusive, makeRunId } from './pilot-output-guard';

const MAX_BUDGET_USD = 0.10;
const MODEL_OVERRIDE = 'gemini-3.5-flash-lite'; // override lokal eksplisit, bukan fallback
const IMAGE_PATH = 'fixtures/pid-eval/sheet-1/page_1.png';
const OUTPUT_DIR = 'fixtures/diagnostics/pilot-sheet-1-p1-v3'; // path tetap v3, bukan makeRunId
const MAX_OUTPUT_TOKENS = 4096;
// Tarif resmi gemini-3.5-flash-lite: input gambar $0.30/M, output $2.50/M.
const INPUT_USD_PER_MILLION = 0.30;
const OUTPUT_USD_PER_MILLION = 2.50;

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function parseJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try { return JSON.parse(candidate); } catch { /* continue */ }
  const start = candidate.indexOf('{'); const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* raw only */ } }
  return null;
}

async function main() {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  // 1. Path tetap v2; runId hanya metadata (titik 1 — fix: bukan pengganti versi)
  const outputDir = OUTPUT_DIR; // fixtures/diagnostics/pilot-sheet-1-p1-v2
  await fs.mkdir(outputDir, { recursive: true });
  const reserve = await reserveTarget(outputDir, runId);
  if (!reserve.reserved) {
    console.error(`PRE_FLIGHT_BLOCKED=${reserve.message}`);
    console.error(`RUN_ID=${runId} OUTPUT_DIR=${outputDir} STATUS=blocked`);
    process.exitCode = 2;
    return;
  }
  console.log(`RESERVED=${reserve.reservationPath} RUN_ID=${runId}`);

  const imageBuf = await fs.readFile(IMAGE_PATH);
  const imageBase64 = imageBuf.toString('base64');
  const imageSha256 = sha256(imageBuf);
  const imageWidth = 3573; const imageHeight = 2526;
  const region = { coordinateSpace: 'source-pixel', x1: 0, y1: 0, x2: imageWidth, y2: imageHeight, width: imageWidth, height: imageHeight, transform: 'identity: source page pixels; model bbox pixels interpreted in this frame' };

  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:12345@localhost:5432/asset_db' });
  const r = await pool.query('SELECT ai_provider, gemini_model, gemini_api_key FROM settings WHERE id=1');
  const row = r.rows[0]; await pool.end();
  if (!row || row.ai_provider !== 'gemini' || !row.gemini_api_key) throw new Error('Effective Gemini configuration/key unavailable');

  const standard = await import('../lib/standard-legends.ts');
  const combined = standard.BUILTIN_LEGENDS.find((l: any) => l.standard_code === 'COMBINED');
  if (!combined) throw new Error('COMBINED built-in legend unavailable');
  const legendSymbols = combined.symbols.map((s: any) => ({ assetType: s.asset_type, symbolName: s.symbol_name, tagPattern: s.tag_pattern, aliases: s.aliases, standardCode: s.standard_code }));
  const legendSource = 'lib/standard-legends.ts :: BUILTIN_LEGENDS[COMBINED]';
  const prompt = `You are an industrial P&ID asset discovery assistant. Perform an independent blind discovery from the supplied original page image only. Do not use reviewer markings, YOLO predictions, candidate boxes, or proposal lists; none are provided.\n\nSelected built-in project reference legend (closed vocabulary):\n${JSON.stringify(legendSymbols)}\n\nPage/source frame: original PNG, width 3573 pixels, height 2526 pixels. Entire image is discovery region, source-pixel bbox [0,0,3573,2526]. Return every physical asset/equipment symbol identifiable, including uncertain candidates. Do not count text alone as an asset. Tags/descriptions must be null unless visibly readable.\n\nReturn JSON only: {\n  "page": 1,\n  "detections": [{\n    "assetType": "one legend assetType or null", "assetTag": "visible tag or null", "description": "explicitly visible description or null", "confidence": 0.0, "bbox": {"x1": 0, "y1": 0, "x2": 0, "y2": 0}, "legendSymbol": "matching symbolName or null", "evidence": ["observable visual evidence"], "needsHumanReview": true\n  }]\n}\n\nBounding boxes must be source-pixel coordinates in the original 3573x2526 image, covering the symbol rather than surrounding pipe or unrelated text. Do not output normalized coordinates.`;

  // 5. Separasi: SDK calls vs observed HTTP (titik 5) — dicatat, bukan diasumsikan
  const sdkCallCounts = { countTokens: 0, generateContent: 0, verification: 0, retry: false, fallback: false };

  const client = new GoogleGenerativeAI(row.gemini_api_key as string);
  const model = client.getGenerativeModel({ model: MODEL_OVERRIDE, generationConfig: { temperature: 0.05, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' } });
  sdkCallCounts.countTokens += 1;
  const count = await model.countTokens([{ text: prompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }]);
  const inputTokens = Number(count.totalTokens ?? 0);
  const estimatedInputCostUsd = inputTokens * INPUT_USD_PER_MILLION / 1_000_000;
  const estimatedOutputCostUsd = MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION / 1_000_000;
  const estimatedUpperBoundUsd = estimatedInputCostUsd + estimatedOutputCostUsd;
  console.log(JSON.stringify({ model: MODEL_OVERRIDE, inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS, estimatedInputCostUsd, estimatedOutputCostUsd, estimatedUpperBoundUsd, budget: MAX_BUDGET_USD }));
  if (!Number.isFinite(inputTokens) || estimatedUpperBoundUsd > MAX_BUDGET_USD) throw new Error(`Budget check failed: estimated upper bound $${estimatedUpperBoundUsd.toFixed(6)} > $${MAX_BUDGET_USD.toFixed(2)}`);

  const generationStartedMs = Date.now(); let rawText = ''; let usage: any = null; let finishReason: string | null = null; let error: string | null = null;
  try {
    sdkCallCounts.generateContent += 1;
    const result = await model.generateContent([{ text: prompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }]);
    rawText = result.response.text(); usage = result.usageMetadata ?? null; finishReason = result.response.candidates?.[0]?.finishReason ?? null;
  } catch (e: any) { error = e instanceof Error ? e.message : String(e); }
  const durationMs = Date.now() - generationStartedMs;
  const parsed: any = rawText ? parseJson(rawText) : null;
  const detections = Array.isArray(parsed?.detections) ? parsed.detections.map((d: any, index: number) => ({ candidateId: `discovery-001-${String(index + 1).padStart(3, '0')}`, assetType: d.assetType ?? null, assetTag: d.assetTag ?? null, description: d.description ?? null, confidence: typeof d.confidence === 'number' ? d.confidence : null, sourcePixelBbox: d.bbox ?? null, legendSymbol: d.legendSymbol ?? null, evidence: Array.isArray(d.evidence) ? d.evidence : [], needsHumanReview: d.needsHumanReview !== false, provenance: { source: 'gemini-discovery', region, coordinateTransform: region.transform } })) : [];

  const output = {
    schemaVersion: 'pilot-discovery-v2',
    runId,
    status: error ? 'failed' : 'completed',
    pageId: 'sheet-1-p1',
    requestedModel: MODEL_OVERRIDE,
    actualModel: null,
    actualModelNote: 'SDK response did not expose authoritative model identifier; requested model recorded separately.',
    provider: 'gemini',
    input: {
      imagePath: IMAGE_PATH,
      imageSha256,
      imageBytes: imageBuf.length,
      dimensions: { width: imageWidth, height: imageHeight },
      region,
      legendSource,
      legendStandardCode: 'COMBINED',
      reviewerMarkersIncluded: false,
      yoloPredictionsIncluded: false,
      reviewerProposalsIncluded: false,
    },
    request: {
      generationCallsPlanned: 1,
      generationCallsAttempted: sdkCallCounts.generateContent,
      verificationCallsAttempted: sdkCallCounts.verification,
      retry: false,
      fallback: false,
      sdkCallCounts,
      observedHttpRequests: null,
      note: 'SDK count by app; HTTP unverified',
    },
    cost: {
      priceSource: 'https://ai.google.dev/gemini-api/docs/pricing',
      pricePeriod: 'through 2026-12-31',
      freeTierRateKnown: true,
      freeTierProjectEnrollmentVerified: false,
      inputUsdPerMillion: INPUT_USD_PER_MILLION,
      outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
      countedInputTokens: inputTokens,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      estimatedInputCostUsd,
      estimatedOutputCostUsd,
      estimatedUpperBoundUsd,
      maxBudgetUsd: MAX_BUDGET_USD,
      actualCostUsd: null,
      note: 'Upper bound uses max output at published Standard rates; actual billing depends on project tier and actual usage.',
    },
    timing: { startedAt, generationDurationMs: durationMs, completedAt: new Date().toISOString() },
    usage,
    finishReason,
    error,
    rawResponse: rawText,
    parsedResponse: parsed,
    candidates: detections,
    comparison: { status: 'not_run', officialMetrics: false },
  };
  const outPath = join(outputDir, 'discovery-result.json');
  const exclusiveWrite = await writeExclusive(outPath, JSON.stringify(output, null, 2));
  if (!exclusiveWrite.ok) {
    console.error(`WRITE_EXCLUSIVE_FAILED=${exclusiveWrite.message}`);
    await finalizeReservation(reserve.reservationPath, 'failed', runId);
    process.exitCode = 3;
    return;
  }
  await finalizeReservation(reserve.reservationPath, error ? 'failed' : 'succeeded', runId); // file reservasi bukan artefak hasil
  console.log(`OUTPUT=${outPath}`); console.log(`STATUS=${output.status} DURATION_MS=${durationMs} CANDIDATES=${detections.length}`); console.log(`USAGE=${JSON.stringify(usage)}`); if (error) { console.error(`ERROR=${error}`); process.exitCode = 1; }
}
main().catch((e) => { console.error(`PRE_GENERATION_OR_RUN_ERROR=${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
