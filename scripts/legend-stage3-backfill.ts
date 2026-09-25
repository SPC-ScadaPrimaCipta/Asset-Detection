/**
 * Stage 3 backfill — persist diagnostics quality + semantic classes.
 *
 * For one legend:
 *  1. Loads legend_symbols (+ readable crops).
 *  2. Calls POST /legend/diagnostics (same engine as legend-diagnose.ts).
 *  3. UPDATEs each symbol: computed_features, quality_status,
 *     quality_reasons, pipeline_version. Missing crops → left NULL
 *     (honest: not assessed), never force-filled.
 *  4. Groups by EXACT normalized label → INSERTs legend_classes →
 *     UPDATEs class_id. No visual merging, no tag involvement.
 *  5. Prints statistics incl. matcher-eligible count
 *     (validated + crop readable).
 *
 * Never deletes, never overwrites crops, never touches detection.
 * Usage: npx tsx --env-file=.env.local scripts/legend-stage3-backfill.ts [legendId]
 */
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { env } from '@/lib/env';
import {
  groupLegendClasses,
  isMatcherEligible,
} from '@/lib/detection/legend/legend-classes';

const PIPELINE_VERSION = 'legend-diag-v1';

async function main() {
  const legendId = process.argv[2] ?? '74cc1ce2-c322-406e-a4fc-6f5aa3526c56';
  const cvBase = env.CV_SERVICE_URL.replace(/\/$/, '');

  const symRows = (
    await db.query(
      `SELECT id, symbol_name, asset_type, reference_image_url
       FROM legend_symbols WHERE legend_id=$1 ORDER BY symbol_name`,
      [legendId]
    )
  ).rows as Record<string, unknown>[];

  const inputs: Record<string, unknown>[] = [];
  const readable = new Set<string>();
  for (const s of symRows) {
    const url = s.reference_image_url as string | null;
    if (!url) continue;
    try {
      const buf = ((await getFile(url)) as unknown as Buffer).toString('base64');
      readable.add(s.id as string);
      inputs.push({
        symbolId: s.id,
        label: ((s.symbol_name as string) || (s.asset_type as string) || '').slice(0, 120),
        cropPngBase64: buf,
      });
    } catch {
      /* missing crop file — left unassessed */
    }
  }
  console.log(`symbols: ${symRows.length}, readable crops: ${inputs.length}`);

  const res = await fetch(`${cvBase}/legend/diagnostics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ legendId, symbols: inputs }),
  });
  if (!res.ok) throw new Error(`diagnostics failed: ${res.status}`);
  const data = (await res.json()) as {
    qualities: Record<string, unknown>[];
  };

  let assessed = 0;
  for (const q of data.qualities) {
    const m = q as Record<string, unknown>;
    await db.query(
      `UPDATE legend_symbols
       SET computed_features=$1, quality_status=$2, quality_reasons=$3,
           pipeline_version=$4, updated_at=NOW()
       WHERE id=$5`,
      [
        JSON.stringify({
          inkDensity: m.inkDensity,
          borderScore: m.borderScore,
          textScore: m.textScore,
          whitespaceScore: m.whitespaceScore,
          aspectRatio: m.aspectRatio,
          area: m.area,
          duplicateGroup: m.duplicateGroup ?? null,
        }),
        m.status,
        JSON.stringify(m.reasons ?? []),
        PIPELINE_VERSION,
        m.symbolId,
      ]
    );
    assessed++;
  }

  // Candidate classes from exact normalized labels (DB labels, not OCR).
  const groups = groupLegendClasses(
    symRows.map((s) => ({
      id: s.id as string,
      symbol_name: s.symbol_name as string | null,
      asset_type: s.asset_type as string | null,
    }))
  );
  let linked = 0;
  for (const g of groups) {
    const classId = uuidv4();
    await db.query(
      `INSERT INTO legend_classes (id, legend_id, label, normalized_label)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (legend_id, normalized_label) DO UPDATE SET label=EXCLUDED.label, updated_at=NOW()
       RETURNING id`,
      [classId, legendId, g.label, g.key]
    ).then(async (r) => {
      const cid = (r.rows[0]?.id as string) ?? classId;
      const up = await db.query(
        `UPDATE legend_symbols SET class_id=$1 WHERE id = ANY($2::uuid[])`,
        [cid, `{${g.symbolIds.join(',')}}`]
      );
      linked += up.rowCount ?? 0;
    });
  }

  const dist = await db.query(
    `SELECT quality_status, count(*) AS n FROM legend_symbols
     WHERE legend_id=$1 GROUP BY quality_status ORDER BY 1`,
    [legendId]
  );
  const classes = await db.query(
    `SELECT c.normalized_label, count(s.id) AS refs
     FROM legend_classes c LEFT JOIN legend_symbols s ON s.class_id = c.id
     WHERE c.legend_id=$1 GROUP BY c.normalized_label ORDER BY 2 DESC, 1`,
    [legendId]
  );
  const eligible = await db.query(
    `SELECT count(*) AS n FROM legend_symbols
     WHERE legend_id=$1 AND quality_status='validated' AND reference_image_url IS NOT NULL`,
    [legendId]
  );
  console.log('quality distribution:', JSON.stringify(dist.rows));
  console.log(`classes: ${classes.rows.length}, references linked: ${linked}, assessed: ${assessed}`);
  console.log('matcher-eligible (validated + crop):', (eligible.rows[0] as Record<string, unknown>).n);
  console.log('top classes:', JSON.stringify(classes.rows.slice(0, 8)));
  await db.end();
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
