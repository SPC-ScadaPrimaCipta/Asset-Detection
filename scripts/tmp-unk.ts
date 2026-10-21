import db from "@/lib/db";
(async () => {
  const s = await db.query(`SELECT count(*) n,
      count(*) FILTER (WHERE asset_tag IS NULL) untagged,
      count(*) FILTER (WHERE asset_tag LIKE 'UNK-%') synthetic,
      count(*) FILTER (WHERE evidence::text LIKE '%No legend match%') no_legend,
      count(*) FILTER (WHERE evidence::text LIKE '%Vision-only%') vision_only,
      count(*) FILTER (WHERE evidence::text LIKE '%Destination label%') dest_label
    FROM detections WHERE upper(asset_type)='UNKNOWN'`);
  console.table(s.rows);
  const r = await db.query(`SELECT id, asset_tag, confidence, left(evidence::text, 240) ev FROM detections
    WHERE upper(asset_type)='UNKNOWN' ORDER BY (asset_tag IS NULL), confidence DESC LIMIT 40`);
  for (const row of r.rows) console.log(`${row.asset_tag ?? '-'} | ${row.confidence} | ${row.ev}`);
  await db.end();
})();
