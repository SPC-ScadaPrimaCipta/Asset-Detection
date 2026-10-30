/**
 * Validate a ground-truth dataset before running evaluation.
 *
 * Run: npx tsx scripts/validate-ground-truth.ts <dataset.json>
 *
 * Exit code 1 if any ERROR-level issue is found.
 */

import { validateGroundTruth } from '../lib/detection/eval/validate';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/validate-ground-truth.ts <dataset.json>');
    process.exit(1);
  }

  const result = await validateGroundTruth(args[0]);

  console.log('=== GROUND TRUTH VALIDATION ===\n');
  console.log(`Pages:       ${result.pageCount}`);
  console.log(`Annotations: ${result.annotationCount}`);
  console.log(`Dataset ≥10 pages: ${result.belowMinPages ? 'NO (gate requires ≥10)' : 'YES'}\n`);

  console.log('Class distribution:');
  for (const [id, count] of Object.entries(result.classCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  class ${String(id).padStart(2)}: ${count}`);
  }
  console.log('');

  if (result.issues.length === 0) {
    console.log('✅ No issues found.');
  } else {
    for (const issue of result.issues) {
      const prefix = issue.level === 'error' ? '✗ ERROR' : '⚠ WARN ';
      const loc = [issue.pageId, issue.annotationId].filter(Boolean).join(' / ');
      console.log(`${prefix}${loc ? ` [${loc}]` : ''} ${issue.message}`);
    }
    console.log('');
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('VALIDATION ERROR:', e);
  process.exit(1);
});
