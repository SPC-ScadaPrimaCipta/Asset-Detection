import { pool } from '@/lib/db';
import { getAiConfig } from '@/lib/ai-config';
import { getVisionProvider } from '@/lib/ai-providers';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import sharp from 'sharp';

async function main() {
  const lRes = await pool.query('SELECT id, name FROM legends ORDER BY created_at DESC LIMIT 1');
  const legend = lRes.rows[0];

  const pdfBuf = await getFile(`legend-${legend.id}.pdf`);
  const rendered = await renderPageToPng(pdfBuf, 1, 2.0);
  const imgW = rendered.width;
  const imgH = rendered.height;

  // Region 0 with 0.05 overlap exactly as lib/legend-extract.ts does
  const cols = 6, rows = 4, overlap = 0.05;
  const colW = 1 / cols, rowH = 1 / rows;
  const x = Math.max(0, 0 * colW - overlap);
  const y = Math.max(0, 0 * rowH - overlap);
  const x2 = Math.min(1, 1 * colW + overlap);
  const y2 = Math.min(1, 1 * rowH + overlap);
  const cropX = Math.round(x * imgW);
  const cropY = Math.round(y * imgH);
  const cropW = Math.max(10, Math.round((x2 - x) * imgW));
  const cropH = Math.max(10, Math.round((y2 - y) * imgH));

  const cropBuf = await sharp(rendered.png)
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .resize(1000, null, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const cfg = await getAiConfig();
  const provider = await getVisionProvider(cfg);

  const prompt = `You are an expert P&ID legend digitizer analyzing a crop of a P&ID legend sheet.
This crop contains equipment symbols in the Pumps section.

Each item in this table consists of TWO distinct visual parts:
1. The DRAWING / ICON / GRAPHIC: The physical drawing of the equipment (impeller, casing, nozzle, circle, lines).
2. The TEXT LABEL: The printed alphanumeric text (e.g. "CENTRIFUGAL PUMP").

For each equipment item in this crop:
- "name": the text label
- "assetType": asset type (e.g. Pump)
- "label_bbox": [ymin, xmin, ymax, xmax] coordinates of the TEXT WORDS ONLY (0-1000 space)
- "graphic_bbox": [ymin, xmin, ymax, xmax] coordinates of the DRAWING / ICON ONLY (0-1000 space). Look to the left of the label to locate the drawing.

Return JSON ONLY:
{
  "symbols": [
    {
      "name": "CENTRIFUGAL PUMP",
      "assetType": "Pump",
      "label_bbox": [ymin, xmin, ymax, xmax],
      "graphic_bbox": [ymin, xmin, ymax, xmax]
    }
  ]
}`;

  console.log('Sending request to', cfg.openaiModel, 'via', cfg.openaiBaseUrl);
  const res = await provider.generateVisionCompletion({
    model: cfg.openaiModel,
    prompt,
    imageBase64: cropBuf.toString('base64'),
    mimeType: 'image/png',
    temperature: 0.1,
  });

  console.log('\n--- MODEL RESPONSE ---');
  console.log(res.text);
  console.log('----------------------\n');
}

main().catch(console.error).finally(() => process.exit(0));
