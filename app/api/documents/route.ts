import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { saveFile } from '@/lib/storage';
import { validatePdfFile, getPdfPageCountFromBuffer } from '@/lib/pdf-render';
import { PDFDocument } from 'pdf-lib';

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
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('project_id') as string | null;

    if (!file || !projectId)
      return NextResponse.json({ error: 'Missing file or project_id' }, { status: 400 });

    const v = validatePdfFile(file);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
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

    // Save file and DB insert in parallel — no dependency between them
    const [, id] = await Promise.all([
      saveFile(storedName, buffer),
      (async () => {
        const docId = uuidv4();
        await db.query(
          'INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [docId, projectId, file.name, storedName, pageCount, file.type || 'application/pdf', file.size]
        );
        return docId;
      })(),
    ]);

    // Collect all page dimensions at once, then batch insert (1 query, not N)
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

    // Batch insert all pages in a single query
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
      { id, filename: file.name, file_path: storedName, page_count: pageCount },
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[documents POST]', msg);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
