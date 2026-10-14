import { NextRequest, NextResponse } from 'next/server';

// Temporary debug endpoint — diagnose DXF upload issues
// DELETE this file after fixing the issue
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // First 200 bytes as hex + ascii
    const first200 = buffer.slice(0, 200);
    const hex = first200.toString('hex').match(/.{1,2}/g)!.join(' ');
    const ascii = first200.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
    const utf8safe = first200.toString('utf-8').replace(/[^\x20-\x7E]/g, '.');

    // Check for BOM
    const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    const hasBinaryMagic = buffer.slice(0, 18).toString('ascii') === 'AutoCAD Binary DXF';

    // Count null bytes in first 128
    let nulls = 0;
    for (let i = 0; i < Math.min(128, buffer.length); i++) {
      if (buffer[i] === 0) nulls++;
    }

    // Count CRLF vs LF
    const str = buffer.slice(0, 2000).toString('latin1');
    const crlfCount = (str.match(/\r\n/g) || []).length;
    const lfOnlyCount = (str.match(/(?<!\r)\n/g) || []).length;

    // Try dxf-parser directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DxfParser = require('dxf-parser');
    const parser = new DxfParser();

    let parseResult: { ok: boolean; entities?: number; error?: string } = { ok: false };
    for (const enc of ['utf-8', 'latin1', 'utf-8'] as const) {
      try {
        let text = buffer.toString(enc);
        if (enc === 'utf-8') text = text.replace(/^\uFEFF/, ''); // strip BOM
        const dxf = parser.parseSync(text);
        parseResult = { ok: true, entities: dxf?.entities?.length ?? 0 };
        break;
      } catch (e) {
        parseResult = { ok: false, error: (e as Error).message };
      }
    }

    // First 10 lines
    const lines = buffer.toString('latin1').split(/\r?\n/).slice(0, 20);

    return NextResponse.json({
      filename: file.name,
      size: file.size,
      mimeType: file.type,
      hasBOM,
      hasBinaryMagic,
      nullBytesInFirst128: nulls,
      lineEndings: { crlf: crlfCount, lf: lfOnlyCount },
      first20Lines: lines,
      parseResult,
      firstBytesHex: hex.slice(0, 120),
      firstBytesAscii: ascii.slice(0, 80),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
