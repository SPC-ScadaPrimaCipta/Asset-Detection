import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/db";
import { saveCompanyKnowledge } from "@/lib/knowledge-db";
import { extractTagPrefix } from "@/lib/rule-validator";
import { storeCache } from "@/lib/symbol-cache";
import { storeEmbedding } from "@/lib/vector-repository";

/**
 * Infer drawing type from filename — mirrors worker logic.
 * Needed here so confirmed detections populate company_knowledge with correct
 * drawing_type, enabling Level 1 hierarchy on future jobs.
 */
function inferDrawingType(filename: string): string | null {
  const upper = filename.toUpperCase();
  if (/\bPFD\b/.test(upper)) return 'PFD';
  if (/ISOMETR/i.test(upper)) return 'ISOMETRIC';
  if (/\bPID\b|\bP&ID\b|P_ID|P-ID/.test(upper)) return 'P&ID';
  if (/\.PDF$/i.test(filename)) return 'P&ID';
  return null;
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const d = (await db.query("SELECT * FROM detections WHERE id=$1", [id])).rows[0];
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.query(
      "UPDATE detections SET detection_status='CONFIRMED', review_status='APPROVED', candidate_status='APPROVED', candidate_reviewed_at=NOW(), updated_at=NOW() WHERE id=$1",
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

    // ── Learning Agent: save confirmed detection to company_knowledge ──────
    // When user confirms a detection, we save it as learned knowledge.
    // Next time similar symbol appears, Company KB step will find it before ISA/ISO/Vision.
    // Only save if asset_type is known (not UNKNOWN) and has a meaningful tag or type.
    if (d.asset_type && d.asset_type !== 'UNKNOWN') {
      try {
        const projectRow = await db.query(
          "SELECT d.project_id, d.filename FROM documents d WHERE d.id=$1",
          [d.document_id]
        );
        const projectId = projectRow.rows[0]?.project_id ?? null;
        // F6 fix: infer drawing_type from document filename so Level 1 company KB hierarchy
        // (project + drawing_type + tag_prefix) is populated correctly at confirm time.
        // Previously this was always null, degrading KB quality.
        const drawingType = projectRow.rows[0]?.filename
          ? inferDrawingType(projectRow.rows[0].filename)
          : null;
        const tagPrefix = extractTagPrefix(d.asset_tag);

        await saveCompanyKnowledge({
          project_id: projectId,
          drawing_type: drawingType,
          tag_prefix: tagPrefix,
          asset_type: d.asset_type,
          asset_name: d.asset_type, // use asset_type as name; user can refine later
          category: d.equipment_class ?? null,
          symbol_description: null, // future: extract from bbox crop
          geometry_hints: null,
          source_detection_id: d.id,
        });

        console.log(`[learning] saved knowledge: ${d.asset_type} [${tagPrefix ?? 'no-prefix'}] project=${projectId}`);
      } catch (learnErr) {
        // Learning failure must not block confirmation
        console.warn('[learning] save failed (non-fatal):', learnErr instanceof Error ? learnErr.message : learnErr);
      }
    }

    // ── Embedding Save ────────────────────────────────────────────────────
    // Save embedding if canonical_features stored on detection (set by worker during detection)
    if (d.asset_type && d.asset_type !== 'UNKNOWN' && d.canonical_features) {
      try {
        const projectRow2 = await db.query("SELECT project_id FROM documents WHERE id=$1", [d.document_id]);
        const projectId2 = projectRow2.rows[0]?.project_id ?? null;
        const tagPrefix2 = extractTagPrefix(d.asset_tag);

        // If embedding already stored on detection row, use it
        // Otherwise we'll generate it asynchronously (non-blocking)
        if (d.embedding) {
          const embeddingArr = typeof d.embedding === 'string'
            ? JSON.parse(d.embedding.replace(/^\[/, '[').replace(/\]$/, ']'))
            : d.embedding;
          await storeEmbedding({
            projectId: projectId2,
            assetType: d.asset_type,
            assetName: d.asset_type,
            tagPrefix: tagPrefix2,
            canonical: d.canonical_features,
            embedding: embeddingArr,
            cropHash: d.crop_hash ?? null,
          });
          console.log(`[embedding] stored for: ${d.asset_type} [${tagPrefix2 ?? 'no-prefix'}]`);
        }

        // Also update symbol cache with confirmed result
        if (d.crop_hash) {
          await storeCache({
            imageHash: d.crop_hash,
            projectId: projectId2,
            assetName: d.asset_type,
            assetType: d.asset_type,
            tagPrefix: tagPrefix2,
            canonicalFeatures: d.canonical_features,
            confidence: d.confidence ?? 0.9,
            confidenceBreakdown: d.confidence_breakdown ?? null,
            detectionSource: d.detection_source ?? 'CONFIRMED',
          });
          console.log(`[cache] stored confirmed: ${d.crop_hash?.slice(0, 12)}…`);
        }
      } catch (embErr) {
        console.warn('[embedding] save failed (non-fatal):', embErr instanceof Error ? embErr.message : embErr);
      }
    }

    // Upsert into assets — update if already exists
    const exists = await db.query("SELECT id FROM assets WHERE detection_id=$1", [id]);
    if (exists.rows.length > 0) {
      // Update existing asset with latest detection values.
      // Fix #4: include main_equipment, field_confidence, field_provenance —
      // previously these were persisted to detections but never copied to assets,
      // so asset register lost per-field metadata after confirm.
      await db.query(
        `UPDATE assets SET
          asset_tag=$1, asset_type=$2, equipment_class=$3, description=$4,
          service=$5, location=$6, unit=$7, area=$8,
          pid_number=$9, pid_page=$10,
          legend_id=$11, legend_symbol_id=$12,
          confidence=$13, detection_status='CONFIRMED', review_status='APPROVED',
          bbox_x=$14, bbox_y=$15, bbox_w=$16, bbox_h=$17,
          evidence=$18,
          main_equipment=$19, field_confidence=$20, field_provenance=$21,
          size=$22,
          updated_at=NOW()
         WHERE detection_id=$23`,
        [
          d.asset_tag, d.asset_type, d.equipment_class, d.description,
          d.service, d.location, d.unit, d.area,
          d.pid_number, d.pid_page,
          d.legend_id, d.legend_symbol_id,
          d.confidence, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
          JSON.stringify(d.evidence),
          d.main_equipment ?? null,
          d.field_confidence ? JSON.stringify(d.field_confidence) : null,
          d.field_provenance ? JSON.stringify(d.field_provenance) : null,
          d.size ?? null,
          id,
        ]
      );
    } else {
      const projectRow = await db.query("SELECT project_id FROM documents WHERE id=$1", [d.document_id]);
      const projectId = projectRow.rows[0]?.project_id ?? null;
      // Fix #4: include main_equipment, field_confidence, field_provenance in INSERT
      await db.query(
        `INSERT INTO assets (id, project_id, document_id, detection_id, asset_tag, asset_type, equipment_class,
          description, service, location, unit, area, pid_number, pid_page,
          legend_id, legend_symbol_id, confidence, detection_status, review_status,
          bbox_x, bbox_y, bbox_w, bbox_h, evidence,
          main_equipment, field_confidence, field_provenance, size)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'CONFIRMED','APPROVED',$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [
          uuidv4(), projectId, d.document_id, d.id,
          d.asset_tag, d.asset_type, d.equipment_class, d.description,
          d.service, d.location, d.unit, d.area,
          d.pid_number, d.pid_page,
          d.legend_id, d.legend_symbol_id, d.confidence,
          d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
          JSON.stringify(d.evidence),
          d.main_equipment ?? null,
          d.field_confidence ? JSON.stringify(d.field_confidence) : null,
          d.field_provenance ? JSON.stringify(d.field_provenance) : null,
          d.size ?? null,
        ]
      );
    }

    // ── Dataset Collection for Future YOLO Fine-Tuning ──
    // Non-blocking save of confirmed asset crop + metadata for active learning
    (async () => {
      try {
        if (!d.document_page_id || !d.asset_type) return;
        const pageRow = await db.query("SELECT image_path FROM document_pages WHERE id = $1", [d.document_page_id]);
        const imgPath = pageRow.rows[0]?.image_path;
        if (!imgPath) return;

        const sharp = (await import('sharp')).default;
        const fullImgPath = path.isAbsolute(imgPath) ? imgPath : path.resolve(process.cwd(), imgPath);
        if (!fs.existsSync(fullImgPath)) return;

        const datasetDir = path.resolve(process.cwd(), 'storage/dataset');
        const imgDir = path.join(datasetDir, 'images');
        const labelDir = path.join(datasetDir, 'labels');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        if (!fs.existsSync(labelDir)) fs.mkdirSync(labelDir, { recursive: true });

        // Save metadata
        const labelData = {
          id: d.id,
          assetType: d.asset_type,
          assetTag: d.asset_tag,
          bbox: { x: d.bbox_x, y: d.bbox_y, w: d.bbox_w, h: d.bbox_h },
          confirmedAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(labelDir, `${d.id}.json`), JSON.stringify(labelData, null, 2), 'utf8');

        // Extract and save crop image
        let imgMeta: import('sharp').Metadata | null = null;
        if (d.bbox_w > 0 && d.bbox_h > 0) {
          imgMeta = await sharp(fullImgPath).metadata();
          if (imgMeta.width && imgMeta.height) {
            const left = Math.max(0, Math.min(imgMeta.width - 1, Math.round((d.bbox_x / 1000) * imgMeta.width)));
            const top = Math.max(0, Math.min(imgMeta.height - 1, Math.round((d.bbox_y / 1000) * imgMeta.height)));
            const width = Math.max(1, Math.min(imgMeta.width - left, Math.round((d.bbox_w / 1000) * imgMeta.width)));
            const height = Math.max(1, Math.min(imgMeta.height - top, Math.round((d.bbox_h / 1000) * imgMeta.height)));
            await sharp(fullImgPath)
              .extract({ left, top, width, height })
              .png()
              .toFile(path.join(imgDir, `${d.id}.png`));
          }
        }
        
        // ── Python Learning Worker: Continuous Learning via pgvector ──
        // Call Python API untuk process approved detection → pgvector embeddings
        try {
          const projectRow = await db.query("SELECT project_id FROM documents WHERE id=$1", [d.document_id]);
          const projectId = projectRow.rows[0]?.project_id ?? null;
          
          if (projectId && d.bbox_w > 0 && d.bbox_h > 0) {
            const pythonResponse = await fetch('http://127.0.0.1:8765/learning/process-approval', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                detection_id: d.id,
                project_id: projectId,
                asset_tag: d.asset_tag || 'UNKNOWN',
                asset_type: d.asset_type,
                symbol_category: d.equipment_class || d.asset_type,
                bbox_px: {
                  x: Math.round((d.bbox_x / 1000) * (imgMeta?.width || 1)),
                  y: Math.round((d.bbox_y / 1000) * (imgMeta?.height || 1)),
                  width: Math.round((d.bbox_w / 1000) * (imgMeta?.width || 1)),
                  height: Math.round((d.bbox_h / 1000) * (imgMeta?.height || 1))
                },
                bbox_dxf: {
                  x_min: d.bbox_x,
                  y_min: d.bbox_y,
                  x_max: d.bbox_x + d.bbox_w,
                  y_max: d.bbox_y + d.bbox_h
                },
                image_path: fullImgPath,
                confidence_original: d.confidence || 0.9,
                approved_by: null, // Future: get from auth session
              }),
            });
            
            if (pythonResponse.ok) {
              const result = await pythonResponse.json();
              console.log(`[learning-python] pgvector embedding saved: ${result.embedding_id}`);
            } else {
              console.warn('[learning-python] API call failed:', await pythonResponse.text());
            }
          }
        } catch (pyErr) {
          console.warn('[learning-python] call failed (non-fatal):', pyErr instanceof Error ? pyErr.message : pyErr);
        }
        
      } catch (dsErr) {
        console.warn('[dataset] auto-save failed (non-fatal):', dsErr instanceof Error ? dsErr.message : dsErr);
      }
    })();

    return NextResponse.json({ status: "CONFIRMED" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confirm]", msg);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
