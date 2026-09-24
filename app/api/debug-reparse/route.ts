import { NextRequest, NextResponse } from 'next/server';
import { getAiConfig } from '@/lib/ai-config';
import { getGeminiClient } from '@/lib/gemini';
import { resolveGeminiModels } from '@/lib/model-resolver';
import { getFile } from '@/lib/storage';
import { renderPageToPng, getPdfPageCountFromBuffer } from '@/lib/pdf-render';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { legendId } = await req.json();
  if (!legendId) return NextResponse.json({ error: 'legendId required' }, { status: 400 });

  const cfg = await getAiConfig();
  const client = await getGeminiClient();
  const candidates = await resolveGeminiModels();

  let buf: Buffer;
  try { buf = await getFile(`legend-${legendId}.pdf`) as unknown as Buffer; }
  catch (e: any) { return NextResponse.json({ error: 'PDF not found', detail: e.message }); }

  const pageCount = await getPdfPageCountFromBuffer(buf);
  const { png } = await renderPageToPng(buf, 1, 2.0);
  const pngBase64 = png.toString('base64');

  const modelName = candidates[0];
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.1, maxOutputTokens: 512, responseMimeType: 'application/json' },
  });

  const prompt = `List 3 symbols from this P&ID legend image. Return JSON only: {"symbols":[{"name":"string","assetType":"string"}]}`;

  let rawText = '';
  let error = '';
  try {
    const r = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: 'image/png', data: pngBase64 } },
    ]);
    rawText = r.response.text();
  } catch (e: any) {
    error = e.message;
  }

  return NextResponse.json({
    model: modelName,
    provider: cfg.provider,
    candidates: candidates.slice(0, 5),
    pages: pageCount,
    pngSize: png.length,
    rawTextLength: rawText.length,
    rawTextPreview: rawText.slice(0, 500),
    error,
  });
}
