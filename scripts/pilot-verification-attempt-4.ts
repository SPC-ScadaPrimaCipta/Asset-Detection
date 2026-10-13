/**
 * pilot-verification-attempt-4.ts
 *
 * Foreground verification: kirim gambar asli + 29 kandidat terkoreksi ke Gemini
 * untuk verifikasi. Tidak ada baseline YOLO dalam prompt. Tidak ada retry atau
 * discovery ulang. Satu generateContent call, guard eksklusif.
 *
 * Output: fixtures/diagnostics/pilot-sheet-1-p1-v3/verification-api-attempt-4.json
 *
 * Jalankan: npx ts-node --project tsconfig.scripts.json scripts/pilot-verification-attempt-4.ts
 * atau: npx tsx scripts/pilot-verification-attempt-4.ts
 */

// env MUST be first: db.ts reads process.env.DATABASE_URL at import time.
// Without this, Pool is created with connectionString: undefined and
// getAiConfig() falls back to env (which has a placeholder key).
import '../lib/env';

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getAiConfig } from '../lib/ai-config';
import { runVerification } from './pilot-verification-runner';
import { createVerificationSdk } from './pilot-verification-client';

const REPO_ROOT = path.resolve(__dirname, '..');

const IMAGE_PATH = path.join(REPO_ROOT, 'fixtures/pid-eval/sheet-1/page_1.png');
const CORRECTED_CANDIDATES_PATH = path.join(
  REPO_ROOT,
  'fixtures/diagnostics/pilot-sheet-1-p1-v3/discovery-coordinate-corrected.json',
);
const OUTPUT_DIR = path.join(REPO_ROOT, 'fixtures/diagnostics/pilot-sheet-1-p1-v3');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'verification-api-attempt-4.json');

// Harga Standard tier (through 2026-12-31). Source: https://ai.google.dev/gemini-api/docs/pricing
const INPUT_USD_PER_MILLION = 0.30;
const OUTPUT_USD_PER_MILLION = 2.50;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_BUDGET_USD = 0.10;
const TIMEOUT_MS = 120_000;

const LEGEND_SUMMARY = `
COMBINED Standard Legend (ISA 5.1 + ISO 10628-2):

Equipment:
- Pump (P-###): centrifugal and positive displacement pumps
- Compressor (C-###): gas compressors
- Vessel / Pressure Vessel (V-###): drums, separators, reactors
- Tank / Storage Tank (T-###): atmospheric storage tanks
- Heat Exchanger (E-###, HX-###): shell-and-tube, plate heat exchangers
- Filter / Strainer: process filters and strainers
- Electric Motor (M-###): electric motor driver
- Fan / Blower: fans, blowers

Valves:
- Gate Valve: isolation valve, wedge gate
- Globe Valve: throttling / control
- Check Valve: non-return valve
- Ball Valve: quarter-turn ball valve
- Butterfly Valve: quarter-turn butterfly
- Plug Valve: quarter-turn plug
- Needle Valve: fine throttling
- Control Valve / Level Control Valve (LCV-###): pneumatic/hydraulic actuated level control
- Pressure Control Valve (PCV-###): pneumatic/hydraulic actuated pressure control
- Flow Control Valve (FCV-###): flow control
- Pressure Safety Valve / PSV (PSV-###): pressure relief / safety

Instrumentation (ISA 5.1):
- Pressure Indicator (PI-###): local pressure gauge
- Pressure Transmitter (PT-###): remote pressure signal
- Pressure Controller (PC-###, PIC-###): pressure control loop
- Temperature Indicator (TI-###, TG-###): local temperature gauge
- Temperature Transmitter (TT-###): remote temperature signal
- Level Indicator / Level Glass (LG-###, LI-###): local level gauge
- Level Transmitter (LT-###): remote level signal
- Level Controller (LC-###, LIC-###): level control loop
- Flow Indicator (FI-###): local flow indicator
- Flow Transmitter (FT-###): remote flow signal
- Flow Controller (FC-###, FIC-###): flow control loop
- Flow Element (FE-###): orifice plate, flow nozzle, venturi
- Analyzer (AI-###, AT-###): process analyzer
`.trim();

function buildVerificationPrompt(candidates: unknown[], legendSummary: string): string {
  return `You are an industrial P&ID verification AI.

TASK: Verify each detection candidate listed below against the P&ID image provided.
For each candidate, determine whether it is CONFIRMED, CORRECTED, REJECTED, or UNCERTAIN.

LEGEND REFERENCE (COMBINED ISA 5.1 + ISO 10628-2):
${legendSummary}

COORDINATE SYSTEM:
All convertedBbox coordinates are source-pixel in the original 3573x2526 image.
Format: { "x1": left, "y1": top, "x2": right, "y2": bottom }

CANDIDATES TO VERIFY (29 total):
${JSON.stringify(candidates, null, 2)}

INSTRUCTIONS:
1. For each candidateId, visually locate the symbol at the given convertedBbox position in the image.
2. Determine verdict:
   - "CONFIRMED": symbol and tag match the claimed assetType at that location
   - "CORRECTED": symbol exists but assetType or assetTag is wrong; provide corrected values
   - "REJECTED": no symbol found at that location, or bbox is clearly wrong
   - "UNCERTAIN": symbol is ambiguous or partially visible
3. Do NOT include YOLO or any baseline predictions. Use only the image and legend above.
4. Every verdict must cite visual evidence from the image.
5. Return ONLY valid JSON, no prose.

REQUIRED OUTPUT SCHEMA:
{
  "schemaVersion": "pilot-verification-v1",
  "pageId": "sheet-1-p1",
  "imageDimensions": { "width": 3573, "height": 2526 },
  "totalCandidates": 29,
  "verifications": [
    {
      "candidateId": "discovery-001-001",
      "verdict": "CONFIRMED" | "CORRECTED" | "REJECTED" | "UNCERTAIN",
      "assetTypeVerified": "<string or null>",
      "assetTagVerified": "<string or null>",
      "confidence": <0.0-1.0>,
      "evidence": ["<evidence string>"],
      "correctedAssetType": "<string or null, only if CORRECTED>",
      "correctedAssetTag": "<string or null, only if CORRECTED>",
      "note": "<optional string>"
    }
  ],
  "summary": {
    "confirmed": <count>,
    "corrected": <count>,
    "rejected": <count>,
    "uncertain": <count>
  }
}`;
}

async function computeSha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  console.log('[attempt-4] Starting verification foreground run...');

  // Guard: check output already exists
  try {
    await fs.access(OUTPUT_PATH);
    console.error(`[attempt-4] BLOCKED: ${OUTPUT_PATH} already exists. Stopping before API.`);
    process.exit(1);
  } catch { /* not found — proceed */ }

  // Load corrected candidates
  const correctedRaw = JSON.parse(await fs.readFile(CORRECTED_CANDIDATES_PATH, 'utf8'));
  const candidates: unknown[] = correctedRaw.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 29) {
    console.error(`[attempt-4] Expected 29 candidates, got ${Array.isArray(candidates) ? candidates.length : 'non-array'}`);
    process.exit(1);
  }
  console.log(`[attempt-4] Loaded ${candidates.length} corrected candidates.`);

  // Load image
  const imageBytes = (await fs.stat(IMAGE_PATH)).size;
  const imageSha256 = await computeSha256(IMAGE_PATH);
  const imageBase64 = (await fs.readFile(IMAGE_PATH)).toString('base64');
  console.log(`[attempt-4] Image: ${imageBytes} bytes, sha256=${imageSha256.slice(0, 16)}...`);

  // Resolve AI config — key only, model is fixed for pilot
  const config = await getAiConfig();
  // Pilot model is fixed independently of Settings/DB gemini_model.
  const modelName = 'gemini-3.5-flash-lite';
  console.log(`[attempt-4] Pilot model: ${modelName} (fixed, not from Settings)`);
  console.log(`[attempt-4] Config provider: ${config.provider}`);

  // Build prompt parts
  const promptText = buildVerificationPrompt(candidates, LEGEND_SUMMARY);
  const requestParts = [
    { text: promptText },
    { inlineData: { mimeType: 'image/png', data: imageBase64 } },
  ];

  // Create SDK
  const { sdk } = await createVerificationSdk({
    modelName,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    requestParts,
    getConfig: async () => config,
  });

  // Run verification with guard, budget check, and exclusive write
  console.log('[attempt-4] Running verification (countTokens → budget check → generateContent)...');
  const result = await runVerification({
    outputPath: OUTPUT_PATH,
    model: modelName,
    imagePath: IMAGE_PATH,
    imageSha256,
    imageBytes,
    imageDimensions: { width: 3573, height: 2526 },
    legendSource: 'lib/standard-legends.ts :: BUILTIN_LEGENDS[COMBINED]',
    candidates,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    inputUsdPerMillion: INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
    maxBudgetUsd: MAX_BUDGET_USD,
    timeoutMs: TIMEOUT_MS,
    sdk,
  });

  console.log(`[attempt-4] Status: ${result.status}`);
  console.log(`[attempt-4] SDK calls: countTokens=${result.sdkCallCounts.countTokens}, generateContent=${result.sdkCallCounts.generateContent}`);
  console.log(`[attempt-4] Output written: ${result.outputWritten}`);
  if (result.error) {
    console.error(`[attempt-4] Error: ${result.error}`);
  }
  if (result.lastCheckpoint) {
    console.log(`[attempt-4] Last checkpoint: ${result.lastCheckpoint}`);
  }

  if (result.status === 'blocked') {
    console.error('[attempt-4] Run was blocked — guard triggered before SDK.');
    process.exit(2);
  }
  if (result.status === 'failed') {
    console.error('[attempt-4] Run failed. Check output file for details.');
    process.exit(3);
  }

  // Read back and report summary
  const outputRaw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
  const cost = outputRaw.cost ?? {};
  const timing = outputRaw.timing ?? {};
  const parsed = outputRaw.parsedResponse ?? outputRaw.verificationCandidates;
  const summary = parsed?.summary ?? null;

  console.log('\n=== VERIFICATION RESULT ===');
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Duration: ${timing.generationDurationMs ?? '?'}ms`);
  console.log(`Input tokens: ${cost.inputTokens ?? '?'}`);
  console.log(`Estimated cost (upper bound): $${cost.estimatedUpperBoundUsd?.toFixed(6) ?? '?'}`);
  console.log(`Finish reason: ${outputRaw.finishReason ?? '?'}`);
  if (summary) {
    console.log(`\nSummary:`);
    console.log(`  confirmed:  ${summary.confirmed ?? '?'}`);
    console.log(`  corrected:  ${summary.corrected ?? '?'}`);
    console.log(`  rejected:   ${summary.rejected ?? '?'}`);
    console.log(`  uncertain:  ${summary.uncertain ?? '?'}`);
  }
}

main().catch(err => {
  console.error('[attempt-4] Fatal:', err);
  process.exit(1);
});
