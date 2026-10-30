import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { invalidateCache } from "@/lib/symbol-cache";
import { recordNegativeFeedback } from "@/lib/learning/negative-learning";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Accept optional correct_asset_type from body (user may specify what it actually is)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const correctAssetType = (body.correct_asset_type as string | undefined) ?? null;

    await db.query(
      "UPDATE detections SET detection_status='REJECTED', review_status='REJECTED', candidate_status='NOISE', candidate_reviewed_at=NOW(), updated_at=NOW() WHERE id=$1",
      [id]
    );
    await db.query("DELETE FROM assets WHERE detection_id=$1", [id]);
    await db.query("DELETE FROM detection_mdo_records WHERE detection_id=$1", [id]);
    await db.query(
      "INSERT INTO detection_audits (detection_id, action, old_values, new_values) VALUES ($1,'REJECT',$2,$3)",
      [
        id,
        JSON.stringify({ detection_status: d.detection_status, review_status: d.review_status }),
        JSON.stringify({ detection_status: "REJECTED", review_status: "REJECTED", correct_asset_type: correctAssetType }),
      ]
    );

    // ── Negative Learning ────────────────────────────────────────────────
    // Save negative feedback: predicted wrong → helps reduce future confidence for same prediction
    try {
      const projectRow = await db.query("SELECT project_id FROM documents WHERE id=$1", [d.document_id]);
      const projectId = projectRow.rows[0]?.project_id ?? null;

      await recordNegativeFeedback({
        detectionId: d.id,
        projectId,
        predictedAssetType: d.asset_type,
        correctAssetType: correctAssetType ?? null,
        canonicalFeatures: d.canonical_features ?? null,
        cropHash: d.crop_hash ?? null,
        predictionConfidence: d.confidence ?? null,
      });
    } catch (learnErr) {
      console.warn('[negative-learning] save failed (non-fatal):', learnErr instanceof Error ? learnErr.message : learnErr);
    }

    // ── Invalidate symbol cache for this crop hash ───────────────────────
    // If this exact symbol was cached, invalidate so it gets re-processed next time
    if (d.crop_hash) {
      try {
        await invalidateCache(d.crop_hash);
        console.log(`[cache] invalidated hash=${d.crop_hash.slice(0, 12)}… after rejection`);
      } catch (cacheErr) {
        console.warn('[cache] invalidation failed (non-fatal):', cacheErr instanceof Error ? cacheErr.message : cacheErr);
      }
    }

    return NextResponse.json({ status: "REJECTED" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reject]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
