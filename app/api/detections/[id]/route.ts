import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await db.query("SELECT * FROM detections WHERE id=$1", [id]);
    if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[detections/[id] GET]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const allowed = [
      "asset_tag", "asset_type", "description", "equipment_class",
      "service", "location", "unit", "area",
      "bbox_x", "bbox_y", "bbox_w", "bbox_h", "confidence",
    ];

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    for (const k of allowed) {
      if (body[k] !== undefined) {
        sets.push(`${k}=$${i++}`);
        vals.push(body[k]);
      }
    }
    if (!sets.length) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    sets.push(`updated_at=NOW()`);
    vals.push(id);
    await db.query(`UPDATE detections SET ${sets.join(", ")} WHERE id=$${i}`, vals);

    const changedFields: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) changedFields[k] = { old: d[k], new: body[k] };
    }
    await db.query(
      "INSERT INTO detection_audits (detection_id, action, old_values, new_values) VALUES ($1,'EDIT',$2,$3)",
      [id, JSON.stringify(d), JSON.stringify(changedFields)]
    );

    const r = await db.query("SELECT * FROM detections WHERE id=$1", [id]);
    return NextResponse.json(r.rows[0]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[detections/[id] PUT]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
