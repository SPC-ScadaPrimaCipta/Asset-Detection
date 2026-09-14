import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.query("SELECT id FROM detections WHERE id=$1", [id]);
  if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.query("UPDATE detections SET detection_status='REJECTED', review_status='REJECTED', updated_at=NOW() WHERE id=$1", [id]);
  await db.query("DELETE FROM assets WHERE detection_id=$1", [id]);
  return NextResponse.json({ status: "REJECTED" });
}
