import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";

export async function POST(request: NextRequest) {
  const b = await request.json();
  if (!b.asset_type) return NextResponse.json({ error: "asset_type required" }, { status: 400 });
  const id = uuidv4();
  await db.query(
    `INSERT INTO detections (id, job_id, document_id, asset_tag, asset_type, equipment_class, description, service, location, unit, area, pid_number, pid_page, legend_id, confidence, bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'MANUAL','PENDING')`,
    [id, b.job_id ?? null, b.document_id ?? null, b.asset_tag ?? null, b.asset_type, b.equipment_class ?? null, b.description ?? null, b.service ?? null, b.location ?? null, b.unit ?? null, b.area ?? null, b.pid_number ?? null, b.pid_page ?? null, b.legend_id ?? null, 1.0, b.bbox_x ?? 0, b.bbox_y ?? 0, b.bbox_w ?? 100, b.bbox_h ?? 100, JSON.stringify(b.evidence ?? ["Manually added"])]
  );
  await db.query("INSERT INTO detection_audits (detection_id, action, new_values) VALUES ($1,'MANUAL_CREATE',$2)",
    [id, JSON.stringify({ asset_type: b.asset_type, asset_tag: b.asset_tag ?? null, description: b.description ?? null })]);
  return NextResponse.json({ id }, { status: 201 });
}
