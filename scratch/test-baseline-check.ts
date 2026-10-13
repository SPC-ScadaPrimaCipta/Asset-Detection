import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const { computeIoU } = await import("../lib/detection/yolo/yolo-geo2-runner");

  const baselinePath = path.resolve(process.cwd(), "fixtures/diagnostics/tuning-experiments/review-package/full-page/index.html");
  const fullPageHtml = fs.readFileSync(baselinePath, "utf8");
  const match = fullPageHtml.match(/const data = (\{[\s\S]*?\});\n/);
  const fullPageData = JSON.parse(match![1]);
  const baselineItems: Array<{
    id: string;
    rawLabel: string;
    confidence: number;
    box: { x1: number; y1: number; x2: number; y2: number };
  }> = fullPageData.configs.geo2.items;

  const detRes = await db.query("SELECT * FROM detections WHERE job_id = 'b397f43a-464b-40d0-81a5-b4cd69e36bab'");
  const detections = detRes.rows;

  let matchedCount = 0;
  let maxCoordDiff = 0;
  let maxConfDiff = 0;

  for (const b of baselineItems) {
    let bestIoU = 0;
    let matchedDet: any = null;

    for (const d of detections) {
      const iou = computeIoU(
        {
          x1: d.symbol_bbox_x,
          y1: d.symbol_bbox_y,
          x2: d.symbol_bbox_x + d.symbol_bbox_w,
          y2: d.symbol_bbox_y + d.symbol_bbox_h,
        },
        b.box
      );
      if (iou > bestIoU) {
        bestIoU = iou;
        matchedDet = d;
      }
    }

    const evStr = Array.isArray(matchedDet?.evidence)
      ? matchedDet.evidence.join("; ")
      : JSON.stringify(matchedDet?.evidence);
    const cb = typeof matchedDet?.confidence_breakdown === 'string'
      ? JSON.parse(matchedDet.confidence_breakdown)
      : matchedDet?.confidence_breakdown;

    const labelMatches = cb?.rawLabel === b.rawLabel || evStr.includes(b.rawLabel);

    if (bestIoU >= 0.90 && matchedDet && labelMatches) {
      matchedCount++;
      const cDiff = Math.abs(matchedDet.confidence - b.confidence);
      if (cDiff > maxConfDiff) maxConfDiff = cDiff;
      const bDiff = Math.max(
        Math.abs(matchedDet.symbol_bbox_x - b.box.x1),
        Math.abs(matchedDet.symbol_bbox_y - b.box.y1),
        Math.abs(matchedDet.symbol_bbox_x + matchedDet.symbol_bbox_w - b.box.x2),
        Math.abs(matchedDet.symbol_bbox_y + matchedDet.symbol_bbox_h - b.box.y2),
      );
      if (bDiff > maxCoordDiff) maxCoordDiff = bDiff;
    }
  }

  console.log(`Matched against baseline: ${matchedCount} / 87`);
  console.log(`Max coordinate diff: ${maxCoordDiff.toFixed(3)} px (integer rounding tolerance)`);
  console.log(`Max confidence diff: ${maxConfDiff.toExponential(4)}`);

  await db.end();
}

main().catch(console.error);
