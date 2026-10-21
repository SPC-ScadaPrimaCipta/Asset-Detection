import db from "@/lib/db";
import { inferAssetTypeFromEvidence, GENERIC_ASSET_TYPE, isSyntheticTag } from "@/lib/detection/type-inference";

async function run() {
  console.log("Starting backfill for zero UNKNOWN...");

  // 1. Clear synthetic tags (set to NULL)
  const syn = await db.query(
    `UPDATE detections SET asset_tag = NULL WHERE asset_tag ILIKE 'UNK-%' RETURNING id`
  );
  console.log(`Cleared synthetic tags on ${syn.rowCount} rows`);

  // 2. Fetch legend symbols to assist inference
  const symRows = (await db.query(
    `SELECT symbol_name, asset_type, tag_pattern FROM legend_symbols WHERE status='ACTIVE'`
  )).rows;

  // 3. For all UNKNOWN detections: infer or assign fallback
  const unkRows = (await db.query(
    `SELECT id, asset_tag, evidence, confidence, review_status FROM detections WHERE UPPER(asset_type) = 'UNKNOWN'`
  )).rows;

  console.log(`Found ${unkRows.length} UNKNOWN detections to process`);

  let inferredCount = 0;
  let genericCount = 0;
  let deletedNoiseCount = 0;

  for (const r of unkRows) {
    const inferred = inferAssetTypeFromEvidence({
      evidence: r.evidence,
      assetTag: r.asset_tag,
      legendSymbols: symRows,
    });

    if (inferred) {
      const ev = Array.isArray(r.evidence) ? r.evidence : [];
      ev.push(`Type inferred: ${inferred.reason}`);
      await db.query(
        `UPDATE detections SET asset_type = $1, evidence = $2, validation_status = 'NEEDS_REVIEW' WHERE id = $3`,
        [inferred.assetType, JSON.stringify(ev), r.id]
      );
      inferredCount++;
    } else if (r.asset_tag) {
      // Has real tag, but no type could be inferred -> Fallback to Equipment
      const ev = Array.isArray(r.evidence) ? r.evidence : [];
      ev.push(`No evidence-based type; assigned fallback: ${GENERIC_ASSET_TYPE}`);
      await db.query(
        `UPDATE detections SET asset_type = $1, evidence = $2, validation_status = 'NEEDS_REVIEW' WHERE id = $3`,
        [GENERIC_ASSET_TYPE, JSON.stringify(ev), r.id]
      );
      genericCount++;
    } else {
      // Untagged noise that couldn't be resolved
      if (r.review_status === 'APPROVED' || r.review_status === 'REVIEWED') {
        await db.query(
          `UPDATE detections SET asset_type = $1, validation_status = 'NEEDS_REVIEW' WHERE id = $2`,
          [GENERIC_ASSET_TYPE, r.id]
        );
        genericCount++;
      } else {
        await db.query(`DELETE FROM detections WHERE id = $1`, [r.id]);
        deletedNoiseCount++;
      }
    }
  }

  console.log({
    inferredCount,
    genericCount,
    deletedNoiseCount,
  });

  const check = await db.query(`SELECT count(*) FROM detections WHERE UPPER(asset_type) = 'UNKNOWN'`);
  console.log(`Remaining UNKNOWN: ${check.rows[0].count}`);

  await db.end();
}

run().catch(console.error);
