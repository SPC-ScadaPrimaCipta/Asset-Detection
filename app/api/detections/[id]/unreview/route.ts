import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await db.query("SELECT id FROM detections WHERE id=$1", [id]);
    if (!r.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.query(
      "UPDATE detections SET review_status='PENDING', detection_status='DETECTED', updated_at=NOW() WHERE id=$1",
      [id]
    );
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[detections/[id] unreview]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
