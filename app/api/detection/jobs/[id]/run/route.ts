import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let legend_id: string | undefined;
  try { ({ legend_id } = await request.json()); } catch { legend_id = undefined; }
  const job = await db.query("SELECT * FROM detection_jobs WHERE id=$1", [id]);
  if (job.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.query("UPDATE detection_jobs SET legend_id=$1 WHERE id=$2", [legend_id ?? null, id]);
  try {
    const { detectionQueue } = await import("@/workers/detection-worker");
    await detectionQueue.add("detection", { jobId: id, legendId: legend_id }, { jobId: id, removeOnComplete: true, removeOnFail: 100 });
  } catch {
    // Redis unavailable — mark queued; client can poll, worker picks up when available
    await db.query("UPDATE detection_jobs SET status='PENDING' WHERE id=$1", [id]);
  }
  return NextResponse.json({ id, status: "QUEUED" });
}
