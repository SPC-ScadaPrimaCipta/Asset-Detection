import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.query("SELECT * FROM detections WHERE id=$1", [id]);
  if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const allowed = ["asset_tag","asset_type","description","equipment_class","service","location","unit","area","bbox_x","bbox_y","bbox_w","bbox_h","confidence"];
  const sets: string[] = []; const vals: any[] = []; let i = 1;
  for (const k of allowed) if (body[k] !== undefined) { sets.push(`${k}=$${i++}`); vals.push(body[k]); }
  if (!sets.length) return NextResponse.json({ error: "No fields" }, { status: 400 });
  sets.push(`updated_at=NOW()`);
  vals.push(id);
  await db.query(`UPDATE detections SET ${sets.join(", ")} WHERE id=$${i}`, vals);
  const r = await db.query("SELECT * FROM detections WHERE id=$1", [id]);
  return NextResponse.json(r.rows[0]);
}
