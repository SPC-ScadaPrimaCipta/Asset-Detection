import { pool } from '../lib/db';
import { runHybridPipeline } from '../lib/detection/hybrid-pipeline';
import { getFile } from '../lib/storage';
import { renderPageToPng } from '../lib/pdf-render';

async function main() {
  console.log('Testing runHybridPipeline with current AI config...');
  const docRes = await pool.query('SELECT * FROM documents WHERE id = $1', ['4b21589a-95b6-42c1-975f-a74d7da4666b']);
  const doc = docRes.rows[0];

  const symsRes = await pool.query("SELECT * FROM legend_symbols WHERE legend_id = 'cbfe43d9-8823-4708-9bd5-c9cad05776f1' AND status = 'ACTIVE'");

  const buf = await getFile(doc.file_path) as unknown as Buffer;
  const rendered = await renderPageToPng(buf, 1, 2.0);

  const res = await runHybridPipeline(
    {
      pngBuffer: rendered.png,
      pageImageBase64: rendered.png.toString('base64'),
      pageWidth: rendered.width,
      pageHeight: rendered.height,
      page: 1,
      legendId: 'cbfe43d9-8823-4708-9bd5-c9cad05776f1',
      legendSymbols: symsRes.rows,
      projectId: doc.project_id ?? null,
      drawingType: 'P&ID',
    },
    (msg, extra) => console.log(`[hybrid] ${msg}`, extra ?? '')
  );

  console.log('\n--- HYBRID STATS ---');
  console.log(res.stats);
  console.log('\n--- SAMPLE DETECTIONS BY SOURCE ---');
  const bySource: Record<string, number> = {};
  for (const d of res.detections) {
    bySource[d.detection_source] = (bySource[d.detection_source] ?? 0) + 1;
  }
  console.log('Count by source:', bySource);

  await pool.end();
}

main().catch(console.error);
