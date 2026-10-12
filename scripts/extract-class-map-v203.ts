#!/usr/bin/env tsx
/**
 * Extract YOLO v203 class map from ONNX metadata (deterministic).
 *
 * Usage: npx tsx scripts/extract-class-map-v203.ts [--update]
 *
 * Without --update: prints the raw class map JSON to stdout.
 * With --update: validates lib/detection/yolo/yolo-class-map-v203.ts against
 *   the ONNX metadata and reports any discrepancy.
 *
 * The ONNX model's custom metadata property 'names' is the single source of
 * truth. This script does NOT hardcode any class names — it reads them from
 * the model binary.
 */

import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

const MODEL_PATH = path.resolve(process.cwd(), 'model/yolo-pid-v8n-203.onnx');

/** Extract raw class names from ONNX metadata (key-value custom properties). */
async function extractNamesFromModel(modelPath: string): Promise<Record<number, string>> {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    logSeverityLevel: 3,
  });

  let namesJson = '';
  for (const prop of (session as any).handler?.metadata || []) {
    if (prop.key === 'names') {
      namesJson = prop.value;
      break;
    }
  }

  if (!namesJson) {
    // Fallback: onnxruntime-node handler.metadata may not be accessible;
    // try reading via protobuf.
    throw new Error('Could not access model metadata. Ensure the model file is hydrated and has custom properties.');
  }

  // Parse Ultralytics format: {0: 'label.0', 1: 'label.1', ...}
  const regex = /(\d+)\s*:\s*'([^']*)'/g;
  const names: Record<number, string> = {};
  let match: RegExpExecArray | null;
  while ((match = regex.exec(namesJson)) !== null) {
    names[parseInt(match[1])] = match[2];
  }

  return names;
}

/** Simple diff between extracted metadata and TypeScript class map. */
function diffClassMaps(
  onnxNames: Record<number, string>,
  tsMap: Record<number, { yoloLabel: string; isValid: boolean }>,
): string[] {
  const diffs: string[] = [];
  const tsIds = new Set(Object.keys(tsMap).map(Number));
  const onnxIds = new Set(Object.keys(onnxNames).map(Number));

  // Missing from TS
  for (const id of onnxIds) {
    if (!tsIds.has(id)) {
      diffs.push(`Class ${id} in ONNX but missing in TS map (${onnxNames[id]})`);
    }
  }

  // Extra in TS
  for (const id of tsIds) {
    if (!onnxIds.has(Number(id))) {
      diffs.push(`Class ${id} in TS map but not in ONNX metadata`);
    }
  }

  // Mismatched labels
  for (const id of onnxIds) {
    if (tsIds.has(id)) {
      const onnxLabel = onnxNames[id];
      const tsLabel = tsMap[id]?.yoloLabel;
      if (onnxLabel !== tsLabel) {
        diffs.push(`Class ${id}: ONNX="${onnxLabel}" vs TS="${tsLabel}"`);
      }
    }
  }

  return diffs;
}

/**
 * Validate class map TypeScript file against ONNX model metadata.
 * Uses line-by-line regex to find the RAW_CLASS_NAMES_V203 record
 * without importing the module (avoids side effects).
 */
function validateTsClassMap(onnxNames: Record<number, string>): { passed: boolean; diffs: string[] } {
  const tsFilePath = path.resolve(process.cwd(), 'lib/detection/yolo/yolo-class-map-v203.ts');
  const content = fs.readFileSync(tsFilePath, 'utf8');

  // Extract the RAW_CLASS_NAMES_V203 record from TS source.
  // Format: 0: 'label', 1: 'label', ...
  const recordRegex = /const RAW_CLASS_NAMES_V203:\s*Record<number,\s*string>\s*=\s*\{([\s\S]*?)\}\s*;/;
  const match = content.match(recordRegex);
  if (!match) {
    throw new Error('Could not find RAW_CLASS_NAMES_V203 record in TypeScript file');
  }

  const recordContent = match[1];
  const tsRegex = /(\d+)\s*:\s*'([^']*)'/g;
  let tsMatch: RegExpExecArray | null;
  const tsNames: Record<number, string> = {};
  while ((tsMatch = tsRegex.exec(recordContent)) !== null) {
    tsNames[parseInt(tsMatch[1])] = tsMatch[2];
  }

  // Build a simplified TS map with yoloLabel + isValid
  const tsMap: Record<number, { yoloLabel: string; isValid: boolean }> = {};
  const isValidRegex = /(\d+)\s*:\s*\{[^}]*yoloLabel\s*:\s*'([^']*)'[^}]*isValid\s*:\s*(true|false)/g;
  let validMatch: RegExpExecArray | null;
  while ((validMatch = isValidRegex.exec(content)) !== null) {
    tsMap[parseInt(validMatch[1])] = {
      yoloLabel: validMatch[2],
      isValid: validMatch[3] === 'true',
    };
  }

  // If isValidRegex didn't match all, fall back to extracting all entries
  if (Object.keys(tsMap).length !== Object.keys(tsNames).length) {
    // Re-extract using broader pattern
    const fullEntryRegex = /(\d+)\s*:\s*\{[^}]*yoloLabel\s*:\s*'([^']*)'[^}]*\}/g;
    let fullMatch: RegExpExecArray | null;
    while ((fullMatch = fullEntryRegex.exec(content)) !== null) {
      const id = parseInt(fullMatch[1]);
      const label = fullMatch[2];
      // Find isValid for this id
      const isValidPattern = new RegExp(`${id}\s*:\s*\{[^}]{0,500}isValid\s*:\s*(true|false)[^}]{0,200}\}`);
      const isValidMatch = content.match(isValidPattern);
      tsMap[id] = {
        yoloLabel: label,
        isValid: isValidMatch ? isValidMatch[1] === 'true' : true,
      };
    }
  }

  const diffs = diffClassMaps(onnxNames, tsMap);
  return { passed: diffs.length === 0, diffs };
}

async function main() {
  const updateMode = process.argv.includes('--update');

  console.log('🔍 Extracting YOLO v203 class map from ONNX metadata...');
  console.log(`   Model: ${MODEL_PATH}`);

  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`❌ Model not found: ${MODEL_PATH}`);
    console.error('   Download the hydrated model first (git lfs pull).');
    process.exit(1);
  }

  const onnxNames = await extractNamesFromModel(MODEL_PATH);
  const ids = Object.keys(onnxNames).map(Number).sort((a, b) => a - b);

  console.log(`\n✅ Extracted ${ids.length} class names from ONNX metadata.`);
  console.log(`   Range: ${ids[0]}..${ids[ids.length - 1]}`);
  console.log(`   Contiguous: ${ids.length === (ids[ids.length - 1] - ids[0] + 1) ? '✓' : '✗'}`);

  if (updateMode) {
    console.log('\n📋 Validating TypeScript class map against ONNX metadata...');
    try {
      const result = validateTsClassMap(onnxNames);
      if (result.passed) {
        console.log('   ✅ TypeScript class map matches ONNX metadata exactly.');
      } else {
        console.log(`   ❌ Found ${result.diffs.length} discrepancy/discrepancies:`);
        for (const d of result.diffs) {
          console.log(`      - ${d}`);
        }
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`   ❌ Validation error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('\n📋 Raw class map (JSON):');
    console.log(JSON.stringify(onnxNames, null, 2));
    console.log('\n💡 Run with --update to validate against TypeScript class map.');
  }
}

main().catch((err) => {
  console.error('❌ Extraction failed:', err);
  process.exit(1);
});

