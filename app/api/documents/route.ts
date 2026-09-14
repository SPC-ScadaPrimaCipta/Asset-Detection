import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { saveFile } from '@/lib/storage';
import { validatePdfFile, getPdfPageCountFromBuffer } from '@/lib/pdf-render';

export async function GET() {
  const result = await db.query('SELECT * FROM documents ORDER BY created_at DESC');
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const projectId = formData.get('project_id') as string | null;
  if (!file || !projectId) return NextResponse.json({ error: 'Missing file or project_id' }, { status: 400 });

  const v = validatePdfFile(file);
  if (v) return NextResponse.json({ error: v }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let pageCount: number;
  try {
    pageCount = await getPdfPageCountFromBuffer(buffer);
  } catch (e: any) {
    return NextResponse.json({ error: 'Invalid or corrupted PDF', details: e.message }, { status: 400 });
  }

  const storedName = `${uuidv4()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await saveFile(storedName, buffer);

  const id = uuidv4();
  await db.query('INSERT INTO documents (id, project_id, filename, file_path, page_count, mime_type, file_size) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, projectId, file.name, storedName, pageCount, file.type || 'application/pdf', file.size]);

  // Initialize document_pages rows
  for (let p = 1; p <= pageCount; p++) {
    await db.query('INSERT INTO document_pages (id, document_id, page_number) VALUES ($1,$2,$3)', [uuidv4(), id, p]);
  }

  return NextResponse.json({ id, filename: file.name, file_path: storedName, page_count: pageCount }, { status: 201 });
}