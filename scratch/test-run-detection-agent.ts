import { pool } from '../lib/db';
import { runDetectionAgent } from '../lib/ai-agent';
import { getFile } from '../lib/storage';
import { renderPageToPng } from '../lib/pdf-render';

async function main() {
  console.log('Testing runDetectionAgent on doc 4b21589a-95b6-42c1-975f-a74d7da4666b...');
  const docRes = await pool.query('SELECT * FROM documents WHERE id = $1', ['4b21589a-95b6-42c1-975f-a74d7da4666b']);
  const doc = docRes.rows[0];
  console.log('Doc filename:', doc.filename);

  const symsRes = await pool.query("SELECT * FROM legend_symbols WHERE legend_id = 'cbfe43d9-8823-4708-9bd5-c9cad05776f1' AND status = 'ACTIVE'");
  console.log('Active symbols count:', symsRes.rowCount);

  const buf = await getFile(doc.file_path) as unknown as Buffer;
  const rendered = await renderPageToPng(buf, 1, 2.0);
  console.log('Rendered page 1:', rendered.width, 'x', rendered.height);

  try {
    const result = await runDetectionAgent({
      page: 1,
      pageImageBase64: rendered.png.toString('base64'),
      legendId: 'cbfe43d9-8823-4708-9bd5-c9cad05776f1',
      legendSymbols: symsRes.rows,
      pngWidth: rendered.width,
      pngHeight: rendered.height,
    });
    console.log('Success! Detections count:', result.detections.length);
  } catch (err: any) {
    console.error('ERROR in runDetectionAgent:', err.message);
    console.error(err.stack);
  }

  await pool.end();
}

main().catch(console.error);
