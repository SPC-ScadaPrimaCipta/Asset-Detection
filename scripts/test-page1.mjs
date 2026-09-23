import { readFileSync } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const key = 'AQ.Ab8RN6JZjLazcoZBkvdPwYzCNt-5nxSlzn8qfN-NYxo_Ly2hFg';
const client = new GoogleGenerativeAI(key);
const model = client.getGenerativeModel({
  model: 'gemini-3.6-flash',
  generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' }
});

const pngBuf = readFileSync('D:/Asset-Detection/storage/_debug_page1.png');
const b64 = pngBuf.toString('base64');

// Image is 1684x2382px
const W = 1684, H = 2382;

const prompt = `You are an expert P&ID analyst. Detect EVERY equipment symbol on this P&ID page.

Image dimensions: ${W} x ${H} pixels.
BBOX: normalized 0-1000 space. x_norm = round((x_pixel/${W}) * 1000), y_norm = round((y_pixel/${H}) * 1000)

Detect ALL of:
- Pumps (PDT-11, PDT-12, PDT-13, PDT-19 visible as pump symbols)
- Tanks/vessels (D-12, D-13, D-19 day tanks)
- Valves (gate, ball, check valves on pipelines)
- Instruments (pressure gauges, level indicators)
- Junction boxes (JB-03)
- Panels (MCFA, local control panel)
- Any other equipment

Return JSON only:
{"page":1,"detections":[{"assetType":"Pump","assetTag":"PDT-11","confidence":0.95,"bbox":{"x":100,"y":200,"width":50,"height":50},"evidence":["Pump symbol visible","Tag PDT-11 labeled"],"legendSymbol":null}]}`;

try {
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/png', data: b64 } }
  ]);
  const raw = result.response.text();
  console.log('Response length:', raw.length);
  const parsed = JSON.parse(raw);
  console.log('DETECTED:', parsed.detections?.length, 'items');
  parsed.detections?.forEach(d => {
    console.log(` - ${d.assetTag ?? 'null'} | ${d.assetType} | conf=${d.confidence} | bbox=${JSON.stringify(d.bbox)}`);
  });
} catch(e) {
  console.error('ERROR:', e.message?.slice(0, 300));
}
