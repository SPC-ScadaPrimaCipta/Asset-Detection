import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { saveFile } from '@/lib/storage';
import { validatePdfFile, getPdfPageCountFromBuffer } from '@/lib/pdf-render';
import { PDFDocument } from 'pdf-lib';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getTuning } from '@/lib/tuning';
import { parseDxf } from '@/lib/dxf-parser';

// Raise timeout for large file uploads (DXF can be 10-60MB)
export const maxDuration = 60;

const DXF_MIME_TYPES = new Set([
  'image/vnd.dxf',
  'application/dxf',
  'application/octet-stream', // common fallback for DXF uploads
]);
const DXF_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function isDxfFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'dxf';
}

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('project_id');
    if (projectId) {
      const result = await db.query(
        'SELECT * FROM documents WHERE project_id=$1 ORDER BY created_at DESC',
        [projectId]
      );
      return NextResponse.json(result.rows);
    }
    const result = await db.query('SELECT * FROM documents ORDER BY created_at DESC');
    return NextResponse.json(result.rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[documents GET]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const maxUploads = (await getTuning()).performance.rateLimitDocumentUploads;
    const rl = checkRateLimit(`upload:${ip}`, maxUploads, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Try again later.' },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('project_id') as string | null;

    if (!file || !projectId)
      return NextResponse.json({ error: 'Missing file or project_id' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── DXF path ────────────────────────────────────────────────────────────
    if (isDxfFile(file)) {
      if (file.size > DXF_MAX_SIZE_BYTES) {
        return NextResponse.json(
          { error: `DXF file too large (max ${DXF_MAX_SIZE_BYTES / 1024 / 1024} MB)` },
          { status: 400 }
        );
      }

      // Validate by parsing — catches binary garbage
      let parsed: Awaited<ReturnType<typeof parseDxf>>;
      try {
        parsed = parseDxf(buffer);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[documents DXF parse error]', {
          filename: file.name,
          size: file.size,
          mime: file.type,
          firstBytes: buffer.slice(0, 20).toString('hex'),
          error: msg,
        });
        return NextResponse.json({ error: 'Invalid or corrupted DXF file', details: msg }, { status: 400 });
      }

      if (parsed.entities.length === 0) {
        console.warn('[documents DXF] zero entities', {
          filename: file.name,
          layers: parsed.layers,
          blockNames: parsed.blockNames,
          extents: parsed.extents,
        });
        return NextResponse.json({ error: 'DXF file contains no drawable entities' }, { status: 400 });
      }

      const storedName = `${uuidv4()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const docId = uuidv4();
      const pageId = uuidv4();

      await Promise.all([
        saveFile(storedName, buffer),
        (async () => {
          await db.query(
            `INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size, file_type)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'dxf')`,
            [docId, projectId, file.name, storedName, 1, 'image/vnd.dxf', file.size]
          );
          // DXF = single "page". Store parsed entities + layer map.
          await db.query(
            `INSERT INTO document_pages (id, document_id, page_number, width, height, dxf_entities, dxf_layer_map)
             VALUES ($1,$2,1,$3,$4,$5,$6)
             ON CONFLICT (document_id, page_number) DO UPDATE
               SET dxf_entities=EXCLUDED.dxf_entities, dxf_layer_map=EXCLUDED.dxf_layer_map`,
            [
              pageId,
              docId,
              Math.round(parsed.extents.width),
              Math.round(parsed.extents.height),
              JSON.stringify({
                entities: parsed.entities.slice(0, 5000), // cap to avoid huge JSONB
                extents: parsed.extents,
                blockNames: parsed.blockNames,
                units: parsed.units,
              }),
              JSON.stringify(parsed.layerMap),
            ]
          );
        })(),
      ]);

      return NextResponse.json(
        {
          id: docId,
          filename: file.name,
          file_path: storedName,
          page_count: 1,
          file_type: 'dxf',
          dxf_stats: {
            entities: parsed.entities.length,
            layers: parsed.layers.length,
            blockNames: parsed.blockNames.length,
            extents: parsed.extents,
          },
        },
        { status: 201 }
      );
    }

    // ── PDF path (existing) ─────────────────────────────────────────────────
    const v = validatePdfFile(file);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    let pageCount: number;
    let pdfDoc: Awaited<ReturnType<typeof PDFDocument.load>> | null = null;
    try {
      pdfDoc = await PDFDocument.load(buffer as unknown as Uint8Array, { ignoreEncryption: true });
      pageCount = pdfDoc.getPageCount();
      if (pageCount === 0) throw new Error('Empty PDF: 0 pages');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: 'Invalid or corrupted PDF', details: msg }, { status: 400 });
    }

    const storedName = `${uuidv4()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const [, id] = await Promise.all([
      saveFile(storedName, buffer),
      (async () => {
        const docId = uuidv4();
        await db.query(
          `INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size, file_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pdf')`,
          [docId, projectId, file.name, storedName, pageCount, file.type || 'application/pdf', file.size]
        );
        return docId;
      })(),
    ]);

    const pageRows: { p: number; w: number | null; h: number | null }[] = [];
    for (let p = 1; p <= pageCount; p++) {
      let w: number | null = null;
      let h: number | null = null;
      try {
        if (pdfDoc) {
          const pg = pdfDoc.getPage(p - 1);
          const sz = pg.getSize();
          w = Math.round(sz.width * 4);
          h = Math.round(sz.height * 4);
        }
      } catch { /* non-fatal */ }
      pageRows.push({ p, w, h });
    }

    if (pageRows.length > 0) {
      const values: unknown[] = [];
      const placeholders = pageRows.map((row, i) => {
        const base = i * 5;
        values.push(uuidv4(), id, row.p, row.w, row.h);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
      });
      await db.query(
        `INSERT INTO document_pages (id, document_id, page_number, width, height)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (document_id, page_number) DO UPDATE SET width=EXCLUDED.width, height=EXCLUDED.height`,
        values
      );
    }

    return NextResponse.json(
      { id, filename: file.name, file_path: storedName, page_count: pageCount, file_type: 'pdf' },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[documents POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
