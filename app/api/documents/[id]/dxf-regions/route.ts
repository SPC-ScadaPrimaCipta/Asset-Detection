import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';

export const maxDuration = 60;

/**
 * GET /api/documents/[id]/dxf-regions
 * Sheet regions of a DXF file (world-unit extents per sheet) for viewer
 * navigation. Non-DXF documents return { regions: [] }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const docRow = await db.query(
      'SELECT file_path, file_type FROM documents WHERE id=$1',
      [id],
    );
    if (docRow.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const { file_path, file_type } = docRow.rows[0] as {
      file_path: string;
      file_type: string;
    };
    if (file_type !== 'dxf') {
      return NextResponse.json({ regions: [] });
    }

    const buf = (await getFile(file_path)) as unknown as Buffer;
    const parsed = parseDxf(buf);
    const regions = splitDxfRegions(parsed);

    return NextResponse.json(
      {
        regions: regions.map((r) => ({
          pidPage: r.index + 1,
          entityCount: r.entities.length,
          extents: {
            minX: r.extents.minX,
            minY: r.extents.minY,
            maxX: r.extents.maxX,
            maxY: r.extents.maxY,
          },
        })),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600',
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[documents/[id]/dxf-regions GET]', msg.slice(0, 200));
    return NextResponse.json({ error: 'Failed to split DXF regions' }, { status: 500 });
  }
}
