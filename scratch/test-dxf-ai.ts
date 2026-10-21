import { pool } from '../lib/db';
import { getFile } from '../lib/storage';
import { collectLayerSamples, classifyLayersWithAI, applyGeminiFallback } from '../lib/dxf-detection';

async function main() {
  console.log('Testing DXF AI functions...');
  const docRes = await pool.query("SELECT * FROM documents WHERE id = '7bef66d3-c814-4dd3-bed2-072797fe091b'");
  const doc = docRes.rows[0];
  console.log('Document:', doc.filename);

  const buf = await getFile(doc.file_path) as unknown as Buffer;
  console.log('DXF Buffer size:', buf.length);

  const samples = collectLayerSamples(buf);
  console.log('Collected layer samples count:', samples.length);
  console.log('Samples:', samples.map(s => ({ short: s.shortName, texts: s.sampleTexts.slice(0, 3) })));

  console.log('\n--- Testing classifyLayersWithAI ---');
  const aiResults = await classifyLayersWithAI(samples.slice(0, 3));
  console.log('classifyLayersWithAI results:', aiResults);

  console.log('\n--- Testing applyGeminiFallback ---');
  const mockDets = [
    {
      assetTag: null,
      assetType: 'UNKNOWN',
      blockName: 'FTG_FILL_CUP',
      confidence: 0.4,
      needsGeminiClassification: true,
      rawPosition: { x: 100, y: 100 },
      evidence: [],
      bbox: { x: 10, y: 10, width: 20, height: 20 },
      layer: '0',
      source: 'VECTOR',
      regionIndex: 0,
      pidPage: 1,
    }
  ];
  const symsRes = await pool.query(
    "SELECT id, asset_type, symbol_name, tag_pattern, aliases FROM legend_symbols WHERE legend_id = 'cbfe43d9-8823-4708-9bd5-c9cad05776f1' AND status = 'ACTIVE' LIMIT 20"
  );
  await applyGeminiFallback(
    mockDets as any,
    Buffer.alloc(0),
    symsRes.rows,
    { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 },
  );
  console.log('applyGeminiFallback result on mock candidate:', mockDets[0]);

  await pool.end();
}

main().catch(console.error);
