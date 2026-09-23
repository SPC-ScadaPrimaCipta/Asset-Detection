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

    // Phase 5: validasi bbox koreksi manual (0-1000 normalized, w/h >= 10).
    // Clamp agar tidak keluar kanvas; tolak jika bukan angka.
    const bboxKeys = ["bbox_x", "bbox_y", "bbox_w", "bbox_h"] as const;
    const bboxTouched = bboxKeys.some((k) => body[k] !== undefined);
    if (bboxTouched) {
      for (const k of ["bbox_x", "bbox_y"] as const) {
        if (body[k] !== undefined) {
          const v = Number(body[k]);
          if (!Number.isFinite(v)) return NextResponse.json({ error: `${k} must be a number` }, { status: 400 });
          body[k] = Math.max(0, Math.min(1000, Math.round(v)));
        }
      }
      for (const k of ["bbox_w", "bbox_h"] as const) {
        if (body[k] !== undefined) {
          const v = Number(body[k]);
          if (!Number.isFinite(v)) return NextResponse.json({ error: `${k} must be a number` }, { status: 400 });
          body[k] = Math.max(10, Math.min(1000, Math.round(v)));
        }
      }
      // Pastikan box tidak keluar kanvas setelah clamp
      const nx = body.bbox_x ?? d.bbox_x ?? 0;
      const ny = body.bbox_y ?? d.bbox_y ?? 0;
      let nw = body.bbox_w ?? d.bbox_w ?? 50;
      let nh = body.bbox_h ?? d.bbox_h ?? 50;
      nw = Math.min(nw, 1000 - nx);
      nh = Math.min(nh, 1000 - ny);
      if (body.bbox_w !== undefined) body.bbox_w = nw;
      if (body.bbox_h !== undefined) body.bbox_h = nh;
    }

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

    // Phase 5: koreksi bbox manual → catat evidence + naikkan NEEDS_REVIEW → VALID.
    // Best-effort: kolom validation_status mungkin belum ada di DB lama.
    if (bboxTouched) {
      try {
        const note = `BBox manually corrected by user (x=${body.bbox_x ?? d.bbox_x}, y=${body.bbox_y ?? d.bbox_y}, w=${body.bbox_w ?? d.bbox_w}, h=${body.bbox_h ?? d.bbox_h})`;
        await db.query(`UPDATE detections SET evidence = COALESCE(evidence, '[]'::jsonb) || $1::jsonb WHERE id=$2`, [JSON.stringify([note]), id]);
      } catch { /* evidence append non-fatal */ }
      try {
        await db.query(
          `UPDATE detections SET validation_status='VALID' WHERE id=$1 AND validation_status='NEEDS_REVIEW'`,
          [id]
        );
      } catch { /* kolom belum ada → abaikan */ }
    }

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
