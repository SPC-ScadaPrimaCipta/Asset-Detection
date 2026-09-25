/**
 * Stage 2 runner — Legend diagnostics for one legend (read-only vs DB).
 *
 * Reads legend_symbols (+ reference crops) + legend PDF pages, calls
 * POST /legend/diagnostics on the CV sidecar, writes artifacts to
 * storage/legend-diagnostics/{legendId}/ and prints statistics.
 *
 * Changes NOTHING in the database. Never deletes/overwrites crops.
 * Usage: npx tsx --env-file=.env.local scripts/legend-diagnose.ts [legendId]
 */
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { renderPageToPng, getPdfPageCountFromBuffer } from '@/lib/pdf-render';
import { env } from '@/lib/env';

async function main() {
  const legendId = process.argv[2] ?? '74cc1ce2-c322-406e-a4fc-6f5aa3526c56';
  const cvBase = env.CV_SERVICE_URL.replace(/\/$/, '');

  const symRows = (
    await db.query(
      `SELECT id, symbol_name, asset_type, bbox_x, bbox_y, bbox_w, bbox_h,
              pid_page, reference_image_url, status
       FROM legend_symbols WHERE legend_id=$1 ORDER BY pid_page, symbol_name`,
      [legendId]
    )
  ).rows as Record<string, unknown>[];

  const symbols: Record<string, unknown>[] = [];
  let missingCrops = 0;
  for (const s of symRows) {
    const url = s.reference_image_url as string | null;
    let b64: string | null = null;
    if (url) {
      try {
        b64 = ((await getFile(url)) as unknown as Buffer).toString('base64');
      } catch {
        missingCrops++;
      }
    } else {
      missingCrops++;
    }
    if (!b64) continue;
    symbols.push({
      symbolId: s.id,
      label: (s.symbol_name as string) || (s.asset_type as string),
      cropPngBase64: b64,
      pageNumber: (s.pid_page as number) ?? 1,
      pageBBox:
        s.bbox_x != null
          ? { x: s.bbox_x, y: s.bbox_y, width: s.bbox_w, height: s.bbox_h }
          : null,
      cropPath: url,
    });
  }
  console.log(`symbols in DB: ${symRows.length}, with readable crops: ${symbols.length}, missing: ${missingCrops}`);

  // Legend page image for overlay (page 1; 0-1000 DB bboxes map to its pixels).
  let pagePngBase64: string | null = null;
  let pageW = 0;
  let pageH = 0;
  try {
    const pdf = (await getFile(`legend-${legendId}.pdf`)) as unknown as Buffer;
    await getPdfPageCountFromBuffer(pdf);
    const rendered = await renderPageToPng(pdf, 1, 3.0);
    pageW = rendered.width;
    pageH = rendered.height;
    pagePngBase64 = rendered.png.toString('base64');
    console.log(`legend page 1 rendered: ${pageW}x${pageH}`);
  } catch (e) {
    console.warn('legend PDF render failed (overlay skipped):', (e as Error).message?.slice(0, 150));
  }

  // DB bboxes are 0-1000 normalized → page pixels for overlay.
  const toPx = (b: Record<string, unknown> | null) =>
    b && pageW > 0
      ? {
          x: Math.round((Number(b.x) / 1000) * pageW),
          y: Math.round((Number(b.y) / 1000) * pageH),
          width: Math.round((Number(b.width) / 1000) * pageW),
          height: Math.round((Number(b.height) / 1000) * pageH),
        }
      : null;
  const payloadSymbols = symbols.map((s) => ({
    ...s,
    pageBBox: toPx(s.pageBBox as Record<string, unknown> | null),
  }));

  const res = await fetch(`${cvBase}/legend/diagnostics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      legendId,
      symbols: payloadSymbols,
      pagePngBase64,
      pageNumber: 1,
    }),
  });
  if (!res.ok) throw new Error(`diagnostics failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    qualities: Record<string, unknown>[];
    statistics: Record<string, unknown>;
    artifacts: { contactSheetPng: string | null; pageOverlayPng: string | null };
    timings: unknown[];
  };

  const outDir = join(process.cwd(), 'storage', 'legend-diagnostics', legendId);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, 'legend-report.json'),
    JSON.stringify(
      { legendId, generatedAt: new Date().toISOString(), ...data, artifacts: undefined },
      null,
      1
    )
  );
  if (data.artifacts.contactSheetPng) {
    await writeFile(join(outDir, 'contact-sheet.png'), Buffer.from(data.artifacts.contactSheetPng, 'base64'));
  }
  if (data.artifacts.pageOverlayPng) {
    await writeFile(join(outDir, 'page-overlay.png'), Buffer.from(data.artifacts.pageOverlayPng, 'base64'));
  }

  console.log('statistics:', JSON.stringify(data.statistics));
  console.log(`artifacts: ${outDir}/legend-report.json, contact-sheet.png, page-overlay.png`);
  await db.end();
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
