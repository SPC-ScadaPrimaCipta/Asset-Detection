/**
 * Repair legacy asset_type values that were persisted as raw YOLO fragments.
 *
 * Before humanizeYoloLabel()/sanitizeAssetType() were applied in the hybrid
 * pipeline, `valve.ball.iso` persisted as "iso", `equipment.pump.niso` as
 * "niso", etc. The evidence column still carries the original label, so the
 * type can be reconstructed without re-running detection.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx --env-file=.env.local scripts/repair-detection-types.ts
 *   npx tsx --env-file=.env.local scripts/repair-detection-types.ts --apply
 */
import db from '@/lib/db';
import { humanizeYoloLabel, resolveAssetType } from '@/lib/validation';

const JUNK = new Set(['iso', 'pip', 'niso']);

interface Row {
  id: string;
  asset_type: string;
  evidence: unknown;
}

function evidenceText(evidence: unknown): string {
  if (Array.isArray(evidence)) return evidence.join('\n');
  if (typeof evidence === 'string') return evidence;
  return '';
}

function yoloLabelFromEvidence(evidence: unknown): string | null {
  const m = /YOLO GEO-2:\s*([^\s(]+)/.exec(evidenceText(evidence));
  return m ? m[1] : null;
}

/** "Step 2: Legend match \"GATE VALVE (...)\"" carries the symbol that was matched. */
function legendLabelFromEvidence(evidence: unknown): string | null {
  const m = /Legend match\s+"([^"]+)"/.exec(evidenceText(evidence));
  return m ? m[1].trim() : null;
}

/** "GATE VALVE (GATE VALVE) 1) OPEN POSITION" → "Gate Valve". */
function typeFromSymbolName(name: string): string | null {
  const cleaned = name
    .replace(/\s+\d\)\s.*$/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const GENERIC_TYPE = new Set(['valve', 'instrument', 'other', 'equipment', 'unknown']);

async function main() {
  const apply = process.argv.includes('--apply');

  // Same vocabulary gate the worker applies before insert: a type outside the
  // active legend standards becomes UNKNOWN, not a guess.
  const vocabRows = (await db.query<{ t: string }>(
    `SELECT DISTINCT ls.asset_type AS t FROM legend_symbols ls
     LEFT JOIN legends l ON l.id = ls.legend_id
     WHERE ls.status='ACTIVE' AND ls.asset_type IS NOT NULL
       AND COALESCE(l.is_builtin, FALSE) = TRUE`,
  )).rows;
  const vocab = new Set(vocabRows.map((r) => r.t).filter(Boolean));

  const rows = (await db.query<Row>(
    `SELECT id, asset_type, evidence
     FROM detections
     WHERE detection_status <> 'REJECTED'
       AND (LOWER(asset_type) = ANY($1::text[]) OR asset_type LIKE '%.%' OR UPPER(asset_type) = 'UNKNOWN')`,
    [Array.from(JUNK)],
  )).rows;

  const fixes: Array<{ id: string; from: string; to: string; label: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = yoloLabelFromEvidence(row.evidence);
    if (!label) continue;
    const humanized = humanizeYoloLabel(label);
    if (!humanized) continue;
    const resolved = resolveAssetType(humanized, vocab.size > 0 ? vocab : undefined).assetType;
    if (!resolved || resolved.toLowerCase() === row.asset_type.toLowerCase()) continue;
    fixes.push({ id: row.id, from: row.asset_type, to: resolved, label });
    seen.add(row.id);
  }

  // Second pass: DXF vision persisted generic types ("Valve", "Instrument",
  // "other") even though the evidence names the legend symbol that matched.
  const genericRows = (await db.query<Row>(
    `SELECT id, asset_type, evidence
     FROM detections
     WHERE detection_status <> 'REJECTED'
       AND LOWER(asset_type) = ANY($1::text[])`,
    [['valve', 'instrument', 'other']],
  )).rows;
  const symbolRows = (await db.query<{ symbol_name: string | null; asset_type: string | null }>(
    `SELECT symbol_name, asset_type FROM legend_symbols
     WHERE status='ACTIVE' AND asset_type IS NOT NULL`,
  )).rows;
  const bySymbol = new Map<string, { symbolName: string | null; assetType: string }>();
  for (const s of symbolRows) {
    const entry = { symbolName: s.symbol_name, assetType: s.asset_type! };
    if (s.symbol_name) bySymbol.set(s.symbol_name.trim().toLowerCase(), entry);
    bySymbol.set(s.asset_type!.trim().toLowerCase(), entry);
  }
  for (const row of genericRows) {
    if (seen.has(row.id)) continue;
    const label = legendLabelFromEvidence(row.evidence);
    if (!label) continue;
    const entry = bySymbol.get(label.trim().toLowerCase());
    const sourceType =
      entry && !GENERIC_TYPE.has(entry.assetType.toLowerCase())
        ? entry.assetType
        : (entry?.symbolName ? typeFromSymbolName(entry.symbolName) : null) ?? label;
    const resolved = resolveAssetType(sourceType, vocab.size > 0 ? vocab : undefined).assetType;
    if (!resolved || resolved.toLowerCase() === row.asset_type.toLowerCase()) continue;
    fixes.push({ id: row.id, from: row.asset_type, to: resolved, label });
    seen.add(row.id);
  }

  const byType = new Map<string, number>();
  for (const f of fixes) {
    const key = `${f.from} → ${f.to}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }

  console.log(`junk/dotted rows scanned: ${rows.length}`);
  console.log(`repairable: ${fixes.length}`);
  for (const [key, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${n}`);
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to persist.');
    return;
  }

  for (const f of fixes) {
    await db.query(
      `UPDATE detections
       SET asset_type = $1,
           validation_status = CASE WHEN validation_status = 'CONFLICT' THEN 'CONFLICT' ELSE 'NEEDS_REVIEW' END
       WHERE id = $2`,
      [f.to, f.id],
    );
  }
  console.log(`\nupdated ${fixes.length} row(s).`);
}

main()
  .then(() => db.end())
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
