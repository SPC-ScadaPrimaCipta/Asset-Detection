import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import db from '@/lib/db';

const HEADERS = [
  'Equipment Tag / Assets Tag',
  'Short for Equipment Type',
  'Equipment Name',
  'Size / Specifications Assets',
  'From',
  'To',
  'Of',
  'Description',
];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const doc = (await db.query('SELECT filename FROM documents WHERE id=$1', [id])).rows[0];
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Fetch records (if any approved, take approved; otherwise take all non-rejected)
    let rows = (await db.query(
       `SELECT tag_no_proposed, equipment_type_short, equipment_name, size,
               from_value, to_value, of_value, description
        FROM detection_mdo_records
        WHERE document_id=$1 AND approval_status='APPROVED'
        ORDER BY created_at, id`, [id],
    )).rows;

    if (rows.length === 0) {
      rows = (await db.query(
        `SELECT tag_no_proposed, equipment_type_short, equipment_name, size,
                from_value, to_value, of_value, description
         FROM detection_mdo_records
         WHERE document_id=$1 AND approval_status != 'REJECTED'
         ORDER BY created_at, id`, [id],
      )).rows;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Asset_Register_MDO');
    sheet.addRow(HEADERS);

    for (const row of rows) {
      sheet.addRow([
        row.tag_no_proposed ?? '-',
        row.equipment_type_short ?? '-',
        row.equipment_name ?? '-',
        row.size ?? '-',
        row.from_value ?? '-',
        row.to_value ?? '-',
        row.of_value ?? '-',
        row.description ?? '-',
      ]);
    }

    // Styling
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183746' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 24;

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + HEADERS.length)}1` };

    // Set column widths
    const widths = [22, 16, 26, 16, 24, 26, 24, 46];
    sheet.columns.forEach((col, idx) => {
      col.width = widths[idx] ?? 20;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `MDO-Asset-Register-${String(doc.filename).replace(/\.[^.]+$/, '')}.xlsx`;

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
