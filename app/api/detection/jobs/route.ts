import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  const documentId = request.nextUrl.searchParams.get("document_id");
  if (documentId) {
    const r = await db.query("SELECT * FROM detection_jobs WHERE document_id=$1 ORDER BY created_at DESC", [documentId]);
    return NextResponse.json(r.rows);
  }
  const r = await db.query("SELECT * FROM detection_jobs ORDER BY created_at DESC LIMIT 50");
  return NextResponse.json(r.rows);
}

export async function POST(request: NextRequest) {
  const { document_id, legend_id, project_id } = await request.json();
  if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });
  const id = uuidv4();
  await db.query("INSERT INTO detection_jobs (id, document_id, legend_id, project_id, status, progress_pct) VALUES ($1,$2,$3,$4,'PENDING',0)", [id, document_id, legend_id ?? null, project_id ?? null]);
  try {
    const { detectionQueue } = await import("@/workers/detection-worker");
    await detectionQueue.add("detection", { jobId: id, legendId: legend_id }, { jobId: id, removeOnComplete: true, removeOnFail: 100 });
  } catch {
    fetch(`${request.nextUrl.origin}/api/detection/jobs/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legend_id }) }).catch(() => {});
  }
  return NextResponse.json({ id, document_id, legend_id, status: "PENDING" }, { status: 201 });
}
