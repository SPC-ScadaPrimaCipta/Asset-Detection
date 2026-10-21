import { pool } from '../lib/db';
import { getFile } from '../lib/storage';
import { parseDxf, splitDxfRegions } from '../lib/dxf-parser';
import { runDxfDetection, collectLayerSamples, classifyLayersWithAI, applyGeminiFallback, type LegendSymbolRef } from '../lib/dxf-detection';
import { renderDxfRegionToPng } from '../lib/dxf-svg-renderer';
import { runHybridPipeline } from '../lib/detection/hybrid-pipeline';
import { mergeVisionDetections } from '../lib/dxf-vision';
import { isValidAssetTag, buildTagRegexes } from '../lib/validation';

async function main() {
  console.log('=== STARTING FULL DXF DETECTION TEST ===');
  const docRes = await pool.query("SELECT * FROM documents WHERE id = '7bef66d3-c814-4dd3-bed2-072797fe091b'");
  const doc = docRes.rows[0];
  console.log('Document:', doc.filename);

  const legendId = 'cbfe43d9-8823-4708-9bd5-c9cad05776f1';
  const symsRes = await pool.query(
    "SELECT id, legend_id, asset_type, symbol_name, tag_pattern, aliases FROM legend_symbols WHERE legend_id = $1 AND status = 'ACTIVE'",
    [legendId]
  );
  const legendSymbols: Array<LegendSymbolRef & { legend_id: string }> = symsRes.rows;
  console.log('Legend symbols count:', legendSymbols.length);

  const buf = await getFile(doc.file_path) as unknown as Buffer;
  console.log('DXF file size:', buf.length);

  // 1. AI Layer pre-pass
  console.log('\n--- 1. AI Layer Classification ---');
  const samples = collectLayerSamples(buf);
  const aiLayers = await classifyLayersWithAI(samples);
  console.log('AI Classified layers:', aiLayers);

  // 2. Parse & run vector detection
  console.log('\n--- 2. Vector Parsing & Detection ---');
  const parsedDxf = parseDxf(buf);
  console.log('Parsed extents:', parsedDxf.extents);
  console.log('Parsed entities:', parsedDxf.entities.length);

  const dxfResult = runDxfDetection(buf, legendSymbols, {
    parsed: parsedDxf,
    adaptiveSpatial: true,
  });
  console.log('Vector detections count:', dxfResult.detections.length);
  console.log('Gemini candidates count:', dxfResult.parseStats.geminiCandidates);

  // 3. AI Text Fallback for unmatched blocks
  console.log('\n--- 3. AI Text Fallback for Unmatched Blocks ---');
  await applyGeminiFallback(
    dxfResult.detections,
    Buffer.alloc(0),
    legendSymbols,
    parsedDxf.extents,
    parsedDxf.entities,
  );
  const afterFallbackUnknowns = dxfResult.detections.filter(d => d.assetType === 'UNKNOWN').length;
  console.log('After text fallback, UNKNOWN count:', afterFallbackUnknowns);

  // 4. Vision Lap-2
  console.log('\n--- 4. Vision Lap-2 per sheet region ---');
  const regions = splitDxfRegions(parsedDxf);
  console.log('Regions count:', regions.length);

  const tagRegexes = buildTagRegexes(legendSymbols.map(s => s.tag_pattern));
  const isTagValid = (t: string | null) => isValidAssetTag(t, tagRegexes);

  for (const vr of regions) {
    console.log(`\nRendering region ${vr.index + 1}...`);
    const { png, width, height, view } = await renderDxfRegionToPng(parsedDxf, vr, { theme: 'light' });
    console.log(`Region ${vr.index + 1} rendered: ${width}x${height}, PNG bytes: ${png.length}`);

    console.log(`Running hybrid pipeline on region ${vr.index + 1}...`);
    const hybrid = await runHybridPipeline(
      {
        pngBuffer: png,
        pageImageBase64: png.toString('base64'),
        pageWidth: width,
        pageHeight: height,
        page: vr.index + 1,
        legendId,
        legendSymbols: legendSymbols as any,
        projectId: doc.project_id ?? null,
        drawingType: 'P&ID',
        skipOcr: true,
      },
      (msg, extra) => console.log(`  [hybrid r${vr.index + 1}] ${msg}`, extra ?? '')
    );

    console.log(`Hybrid detections on region ${vr.index + 1}:`, hybrid.detections.length, hybrid.stats);

    const st = mergeVisionDetections(
      dxfResult.detections,
      hybrid.detections,
      view,
      parsedDxf.extents,
      vr.index + 1,
      vr.index,
      isTagValid,
    );
    console.log(`Merge stats for region ${vr.index + 1}:`, st);
  }

  console.log('\n=== FINAL DETECTIONS SUMMARY ===');
  console.log('Total detections after vision merge:', dxfResult.detections.length);
  const byType: Record<string, number> = {};
  for (const d of dxfResult.detections) {
    byType[d.assetType] = (byType[d.assetType] ?? 0) + 1;
  }
  console.log('Detections by type:', byType);

  await pool.end();
}

main().catch(console.error);
