import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.query("UPDATE detections SET detection_status='REJECTED', review_status='REJECTED', updated_at=NOW() WHERE id=$1", [id]);
  await db.query("DELETE FROM assets WHERE detection_id=$1", [id]);
  await db.query("INSERT INTO detection_audits (detection_id, action, old_values, new_values) VALUES ($1,'REJECT',$2,$3)",
    [id, JSON.stringify({ detection_status: d.detection_status, review_status: d.review_status }),
        JSON.stringify({ detection_status: 'REJECTED', review_status: 'REJECTED' })]);
  return NextResponse.json({ status: "REJECTED" });
}
