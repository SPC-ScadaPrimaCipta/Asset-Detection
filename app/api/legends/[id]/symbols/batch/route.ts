import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { validateTagPattern } from '@/lib/legend-schemas';

const BatchTagPatternSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1, 'Symbol ID is required'),
      tag_pattern: z.string().nullable().optional(),
    })
  ).min(1, 'Updates array must contain at least one symbol update'),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: legendId } = await params;

    // Check if legend exists and block modification of built-in standard legends
    const legendRow = await db.query(
      'SELECT id, is_builtin FROM legends WHERE id = $1',
      [legendId],
    );
    if (legendRow.rows.length === 0) {
      return NextResponse.json({ error: 'Legend not found' }, { status: 404 });
    }
    if (legendRow.rows[0]?.is_builtin) {
      return NextResponse.json(
        { error: 'Built-in standard legends cannot be modified.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = BatchTagPatternSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
    }

    // Validate tag patterns
    for (const item of parsed.data.updates) {
      if (item.tag_pattern) {
        const err = validateTagPattern(item.tag_pattern);
        if (err) {
          return NextResponse.json(
            { error: `Invalid tag pattern "${item.tag_pattern}": ${err}` },
            { status: 400 },
          );
        }
      }
    }

    // Execute updates
    let updatedCount = 0;
    for (const item of parsed.data.updates) {
      const trimmedPattern = item.tag_pattern ? item.tag_pattern.trim() : null;
      const res = await db.query(
        `UPDATE legend_symbols
         SET tag_pattern = $1, updated_at = NOW()
         WHERE id = $2 AND legend_id = $3`,
        [trimmedPattern, item.id, legendId],
      );
      updatedCount += res.rowCount ?? 0;
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      message: `Updated tag patterns for ${updatedCount} symbol(s)`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to update tag patterns: ${msg}` },
      { status: 500 },
    );
  }
}
