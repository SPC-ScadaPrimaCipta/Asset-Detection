import { pool } from '@/lib/db';
import { getAiConfig } from '@/lib/ai-config';
import { getVisionProvider } from '@/lib/ai-providers';
import { getFile } from '@/lib/storage';
import { renderPageToPng } from '@/lib/pdf-render';
import sharp from 'sharp';

async function main() {
  const lRes = await pool.query('SELECT id, name FROM legends ORDER BY created_at DESC LIMIT 1');
  const legend = lRes.rows[0];
  console.log('Testing legend:', legend.name, legend.id);

  const pdfBuf = await getFile(`legend-${legend.id}.pdf`);
  const rendered = await renderPageToPng(pdfBuf, 1, 2.0);
  const meta = await sharp(rendered.png).metadata();
  console.log('Rendered size:', meta.width, 'x', meta.height);

  // Take top-left region: Col 0 Row 0 (Pumps section)
  const cropW = Math.round((meta.width ?? 1000) / 6);
  const cropH = Math.round((meta.height ?? 1000) / 4);
  const cropBuf = await sharp(rendered.png)
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .resize(1000, null, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  console.log('Crop dimensions: width=', cropW, 'height=', cropH);

  const cfg = await getAiConfig();
  console.log('AI Provider:', cfg.provider, 'Model:', cfg.openaiModel, 'BaseURL:', cfg.openaiBaseUrl);

  const provider = await getVisionProvider(cfg);
  const prompt = `You are a P&ID legend digitizer analyzing a CROPPED REGION of a legend sheet.
This crop shows: Column 1 Row 1 (Pumps section).

CRITICAL INSTRUCTION:
Each item has TWO elements:
(1) THE DRAWING/ICON (the graphic/sketch on the left)
(2) THE TEXT LABEL (the words like "VERTICAL TURBINE", "CENTRIFUGAL PUMP")

YOU MUST PROVIDE THE BOUNDING BOX OF THE DRAWING/ICON ONLY!
Coordinates 0-1000 where (0,0)=top-left of this crop, (1000,1000)=bottom-right.
Format: [ymin, xmin, ymax, xmax].

Return JSON ONLY:
{"symbols":[{"name":"string","assetType":"string","bbox":[ymin,xmin,ymax,xmax]}]}`;

  const res = await provider.generateVisionCompletion({
    model: cfg.openaiModel,
    prompt,
    imageBase64: cropBuf.toString('base64'),
    mimeType: 'image/png',
    temperature: 0.1,
  });

  console.log('\n--- RAW MODEL RESPONSE ---');
  console.log(res.text);
  console.log('--------------------------\n');
}

main().catch(console.error).finally(() => process.exit(0));
