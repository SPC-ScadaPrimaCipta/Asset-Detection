import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.query("UPDATE detections SET detection_status='CONFIRMED', review_status='APPROVED', updated_at=NOW() WHERE id=$1", [id]);
  await db.query("INSERT INTO detection_audits (detection_id, action, old_values, new_values) VALUES ($1,'EDIT',$2,$3)",
    [id, JSON.stringify({ detection_status: d.detection_status, review_status: d.review_status }),
       JSON.stringify({ detection_status: 'CONFIRMED', review_status: 'APPROVED' })]);
  // Upsert into assets
  const exists = await db.query("SELECT id FROM assets WHERE detection_id=$1", [id]);
  if (!exists.rows.length) {
    await db.query(`INSERT INTO assets (id, project_id, document_id, detection_id, asset_tag, asset_type, equipment_class, description, service, location, unit, area, pid_number, pid_page, legend_id, legend_symbol_id, confidence, detection_status, review_status, bbox_x, bbox_y, bbox_w, bbox_h, evidence)
      VALUES ($1,(SELECT project_id FROM documents WHERE id=$2),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'CONFIRMED','APPROVED',$17,$18,$19,$20,$21)`,
      [uuidv4(), d.document_id, d.id, d.asset_tag, d.asset_type, d.equipment_class, d.description, d.service, d.location, d.unit, d.area, d.pid_number, d.pid_page, d.legend_id, d.legend_symbol_id, d.confidence, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h, JSON.stringify(d.evidence)]);
  }
  return NextResponse.json({ status: "CONFIRMED" });
}
