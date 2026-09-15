import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.query(
      "UPDATE detections SET detection_status='CONFIRMED', review_status='APPROVED', updated_at=NOW() WHERE id=$1",
      [id]
    );

    // Audit with correct action 'CONFIRM'
    await db.query(
      "INSERT INTO detection_audits (detection_id, action, old_values, new_values) VALUES ($1,'CONFIRM',$2,$3)",
      [
        id,
        JSON.stringify({ detection_status: d.detection_status, review_status: d.review_status }),
        JSON.stringify({ detection_status: 'CONFIRMED', review_status: 'APPROVED' }),
      ]
    );

    // Upsert into assets — update if already exists
    const exists = await db.query("SELECT id FROM assets WHERE detection_id=$1", [id]);
    if (exists.rows.length > 0) {
      // Update existing asset with latest detection values
      await db.query(
        `UPDATE assets SET
          asset_tag=$1, asset_type=$2, equipment_class=$3, description=$4,
          service=$5, location=$6, unit=$7, area=$8,
          pid_number=$9, pid_page=$10,
          legend_id=$11, legend_symbol_id=$12,
          confidence=$13, detection_status='CONFIRMED', review_status='APPROVED',
          bbox_x=$14, bbox_y=$15, bbox_w=$16, bbox_h=$17,
          evidence=$18, updated_at=NOW()
         WHERE detection_id=$19`,
        [
          d.asset_tag, d.asset_type, d.equipment_class, d.description,
          d.service, d.location, d.unit, d.area,
          d.pid_number, d.pid_page,
          d.legend_id, d.legend_symbol_id,
          d.confidence, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
          JSON.stringify(d.evidence), id,
        ]
      );
    } else {
      const projectRow = await db.query("SELECT project_id FROM documents WHERE id=$1", [d.document_id]);
      const projectId = projectRow.rows[0]?.project_id ?? null;
      await db.query(
        `INSERT INTO assets (id, project_id, document_id, detection_id, asset_tag, asset_type, equipment_class,
          description, service, location, unit, area, pid_number, pid_page,
          legend_id, legend_symbol_id, confidence, detection_status, review_status,
          bbox_x, bbox_y, bbox_w, bbox_h, evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'CONFIRMED','APPROVED',$18,$19,$20,$21,$22)`,
        [
          uuidv4(), projectId, d.document_id, d.id,
          d.asset_tag, d.asset_type, d.equipment_class, d.description,
          d.service, d.location, d.unit, d.area,
          d.pid_number, d.pid_page,
          d.legend_id, d.legend_symbol_id, d.confidence,
          d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
          JSON.stringify(d.evidence),
        ]
      );
    }

    return NextResponse.json({ status: "CONFIRMED" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confirm]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
