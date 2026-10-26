import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { assembleMdoDescription } from '@/lib/mdo-description';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await req.json();

  if (action === 'approve') {
    await db.query(
      `UPDATE detection_mdo_records
       SET approval_status='APPROVED', approved_at=NOW(), approved_by='USER', rejection_reason=NULL, updated_at=NOW()
       WHERE id=$1`,
      [id]
    );
  } else if (action === 'reject') {
    await db.query(
      `UPDATE detection_mdo_records
       SET approval_status='REJECTED', approved_at=NULL, approved_by=NULL, rejection_reason='Manually rejected', updated_at=NOW()
       WHERE id=$1`,
      [id]
    );
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const existing = (await db.query('SELECT * FROM detection_mdo_records WHERE id=$1', [id])).rows[0];
    if (!existing) {
      return NextResponse.json({ error: 'MDO record not found' }, { status: 404 });
    }

    const tagNoProposed = body.tag_no_proposed !== undefined ? body.tag_no_proposed : existing.tag_no_proposed;
    const equipmentTypeShort = body.equipment_type_short !== undefined ? body.equipment_type_short : existing.equipment_type_short;
    const equipmentName = body.equipment_name !== undefined ? body.equipment_name : existing.equipment_name;
    const size = body.size !== undefined ? body.size : existing.size;
    const fromValue = body.from_value !== undefined ? body.from_value : existing.from_value;
    const toValue = body.to_value !== undefined ? body.to_value : existing.to_value;
    const ofValue = body.of_value !== undefined ? body.of_value : existing.of_value;
    const atValue = body.at_value !== undefined ? body.at_value : existing.at_value;
    const locationPrefix = body.location_prefix !== undefined ? body.location_prefix : existing.location_prefix;

    // Recalculate description using rule engine, unless manually overridden
    const description = body.description !== undefined && body.description !== null
      ? body.description
      : assembleMdoDescription({
          locationPrefix,
          equipmentTypeShort: equipmentTypeShort || 'EQ',
          size,
          ofValue,
          fromValue,
          toValue,
          atValue,
        });

    const res = await db.query(
      `UPDATE detection_mdo_records
       SET tag_no_proposed=$1,
           equipment_type_short=$2,
           equipment_name=$3,
           size=$4,
           from_value=$5,
           to_value=$6,
           of_value=$7,
           at_value=$8,
           description=$9,
           location_prefix=$10,
           updated_at=NOW()
       WHERE id=$11
       RETURNING *`,
      [
        tagNoProposed,
        equipmentTypeShort,
        equipmentName,
        size,
        fromValue,
        toValue,
        ofValue,
        atValue,
        description,
        locationPrefix,
        id,
      ]
    );

    return NextResponse.json({ ok: true, record: res.rows[0] });
  } catch (error) {
    console.error('[mdo-patch]', error);
    return NextResponse.json({ error: 'Failed to update MDO record' }, { status: 500 });
  }
}
