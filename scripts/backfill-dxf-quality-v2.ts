import db from '@/lib/db';
import { getFile } from '@/lib/storage';
import { parseDxf, splitDxfRegions } from '@/lib/dxf-parser';

async function main() {
  const docs = (await db.query(`SELECT id, file_path FROM documents WHERE file_type='dxf'`)).rows;
  let updated = 0;
  for (const doc of docs) {
    const parsed = parseDxf((await getFile(doc.file_path)) as Buffer);
    const regions = splitDxfRegions(parsed);
    const rows = (await db.query(`SELECT id,bbox_x,bbox_y,bbox_w,bbox_h,pid_page,confidence,asset_tag,asset_type,evidence FROM detections WHERE document_id=$1`, [doc.id])).rows;
    for (const row of rows) {
      if ([row.bbox_x, row.bbox_y, row.bbox_w, row.bbox_h].some((v) => v == null)) continue;
      const x = Number(row.bbox_x), y = Number(row.bbox_y), w = Number(row.bbox_w), h = Number(row.bbox_h);
      const g = parsed.extents;
      const wx = g.minX + (x / 1000) * g.width;
      const wy = g.maxY - ((y + h) / 1000) * g.height;
      const ww = (w / 1000) * g.width;
      const wh = (h / 1000) * g.height;
      const region = regions.find((r) => r.index + 1 === (row.pid_page ?? 1))?.extents ?? g;
      const sx = ((wx - region.minX) / region.width) * 1000;
      const sy = ((region.maxY - wy - wh) / region.height) * 1000;
      const sw = (ww / region.width) * 1000;
      const sh = (wh / region.height) * 1000;
      const evidence = Array.isArray(row.evidence) ? row.evidence : [];
      await db.query(
        `UPDATE detections SET bbox_frame='GLOBAL_NORMALIZED', world_bbox_x=$1,world_bbox_y=$2,world_bbox_w=$3,world_bbox_h=$4,
          sheet_bbox_x=$5,sheet_bbox_y=$6,sheet_bbox_w=$7,sheet_bbox_h=$8,
          asset_confidence=$9,tag_confidence=$10,bbox_confidence=$11,legend_confidence=$12,flow_confidence=0,relation_confidence=0
         WHERE id=$13`,
        [wx, wy, ww, wh, sx, sy, sw, sh, Number(row.confidence ?? 0), row.asset_tag ? 0.9 : 0, evidence.some((e: string) => /bbox from .*geometry/i.test(e)) ? 0.9 : 0.55, row.asset_type && row.asset_type !== 'UNKNOWN' ? 0.85 : 0, row.id],
      );
      updated++;
    }
  }
  console.log({ documents: docs.length, updated });
  await db.end();
}
main().catch((error) => { console.error(error); process.exit(1); });
