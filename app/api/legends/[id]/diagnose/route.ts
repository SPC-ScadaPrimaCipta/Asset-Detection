import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getFile, saveFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import { groupLegendClasses } from '@/lib/detection/legend/legend-classes';

export const maxDuration = 300;

const PIPELINE_VERSION = 'legend-diag-v1';

/**
 * POST /api/legends/[id]/diagnose — server-side Legend quality pipeline.
 *
 * 1. Loads symbols + readable crops, calls CV POST /legend/diagnostics.
 * 2. UPDATEs computed_features / quality_status / quality_reasons / pipeline_version.
 *    Missing crops stay NULL (honest: not assessed).
 * 3. Groups by exact normalized label → upserts legend_classes → sets class_id.
 * 4. Returns statistics incl. matcher-eligible count.
 *
 * Never deletes, never overwrites crops, never touches detection.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: legendId } = await params;
  try {
    const legend = await db.query('SELECT id FROM legends WHERE id=$1', [legendId]);
    if (legend.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      const row = await db.query('SELECT is_builtin FROM legends WHERE id=$1', [legendId]);
      if (row.rows[0]?.is_builtin) {
        return NextResponse.json({ error: 'Built-in legends cannot be reprocessed.' }, { status: 403 });
      }
    } catch { /* column missing — allow */ }

    const symRows = (
      await db.query(
        `SELECT id, symbol_name, asset_type, reference_image_url
         FROM legend_symbols WHERE legend_id=$1 ORDER BY symbol_name`,
        [legendId]
      )
    ).rows as Record<string, unknown>[];

    const inputs: Record<string, unknown>[] = [];
    let missing = 0;
    for (const s of symRows) {
      const url = s.reference_image_url as string | null;
      if (!url) { missing++; continue; }
      try {
        const buf = ((await getFile(url)) as unknown as Buffer).toString('base64');
        inputs.push({
          symbolId: s.id,
          label: ((s.symbol_name as string) || (s.asset_type as string) || '').slice(0, 120),
          cropPngBase64: buf,
        });
      } catch {
        missing++;
      }
    }

    const cvBase = (process.env.CV_SERVICE_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, '');
    const res = await fetch(`${cvBase}/legend/diagnostics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ legendId, symbols: inputs }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Diagnostics service failed (${res.status}). Is the CV sidecar running? ${t.slice(0, 120)}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { qualities: Record<string, unknown>[] };

    // Never overwrite a human validation (see validate route) — the manual
    // fix already resolved this reference; CV re-assessment must not regress it.
    const hv = await db.query(
      `SELECT id FROM legend_symbols WHERE legend_id=$1 AND pipeline_version='human-validated-v1'`,
      [legendId]
    );
    const humanValidated = new Set((hv.rows as Record<string, unknown>[]).map((r) => r.id as string));
    let assessed = 0;
    let preserved = 0;
    for (const q of data.qualities) {
      if (humanValidated.has(q.symbolId as string)) { preserved++; continue; }
      await db.query(
        `UPDATE legend_symbols
         SET computed_features=$1, quality_status=$2, quality_reasons=$3,
             pipeline_version=$4, updated_at=NOW()
         WHERE id=$5`,
        [
          JSON.stringify({
            inkDensity: q.inkDensity,
            borderScore: q.borderScore,
            textScore: q.textScore,
            whitespaceScore: q.whitespaceScore,
            aspectRatio: q.aspectRatio,
            area: q.area,
            duplicateGroup: q.duplicateGroup ?? null,
          }),
          q.status,
          JSON.stringify(q.reasons ?? []),
          PIPELINE_VERSION,
          q.symbolId,
        ]
      );
      assessed++;
    }

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
      const r = await db.query(
        `INSERT INTO legend_classes (id, legend_id, label, normalized_label)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (legend_id, normalized_label) DO UPDATE SET label=EXCLUDED.label, updated_at=NOW()
         RETURNING id`,
        [classId, legendId, g.label, g.key]
      );
      const cid = (r.rows[0]?.id as string) ?? classId;
      const up = await db.query(
        `UPDATE legend_symbols SET class_id=$1 WHERE id = ANY($2::uuid[])`,
        [cid, `{${g.symbolIds.join(',')}}`]
      );
      linked += up.rowCount ?? 0;
    }

    const dist = await db.query(
      `SELECT quality_status, count(*) AS n FROM legend_symbols
       WHERE legend_id=$1 GROUP BY quality_status ORDER BY 1`,
      [legendId]
    );
    const eligible = await db.query(
      `SELECT count(*) AS n FROM legend_symbols
       WHERE legend_id=$1 AND quality_status='validated' AND reference_image_url IS NOT NULL`,
      [legendId]
    );
    return NextResponse.json({
      legendId,
      symbols: symRows.length,
      assessed,
      preserved,
      missing,
      quality: dist.rows,
      classes: groups.length,
      linked,
      eligible: Number((eligible.rows[0] as Record<string, unknown>).n),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[legend diagnose POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
