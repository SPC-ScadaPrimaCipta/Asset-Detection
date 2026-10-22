import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import db from '@/lib/db';

const HEADERS = [
  'Equipment Tag No Proposed', 'Equipment Type For Description', 'Component Name',
  'From', 'To', 'Of', 'At', 'Size',
];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const doc = (await db.query('SELECT filename FROM documents WHERE id=$1', [id])).rows[0];
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const rows = (await db.query(
       `SELECT tag_no_proposed, equipment_type, component_name, from_value, to_value, of_value, at_value, size
        FROM detection_mdo_records
        WHERE document_id=$1 AND approval_status='APPROVED'
        ORDER BY created_at, id`, [id],
    )).rows;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('MDO');
    sheet.addRow(HEADERS);
    for (const row of rows) sheet.addRow(HEADERS.map((header) => {
      const key = ({
        'Equipment Tag No Proposed': 'tag_no_proposed', 'Equipment Type For Description': 'equipment_type',
        'Component Name': 'component_name', 'From': 'from_value', 'To': 'to_value',
        'Of': 'of_value', 'At': 'at_value', 'Size': 'size',
      } as Record<string, string>)[header];
      return row[key] ?? '-';
    }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183746' } };
    header.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + HEADERS.length)}1` };
    for (const column of sheet.columns) column.width = 22;
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `MDO-${String(doc.filename).replace(/\.[^.]+$/, '')}.xlsx`;
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[mdo-export]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'MDO export failed' }, { status: 500 });
  }
}
