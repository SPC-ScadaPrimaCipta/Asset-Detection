import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const res = await db.query(
    "SELECT asset_type, legend_symbol_id, confidence, symbol_bbox_x, symbol_bbox_y, symbol_bbox_w, symbol_bbox_h, bbox_x, bbox_y, bbox_w, bbox_h FROM detections WHERE job_id = 'b397f43a-464b-40d0-81a5-b4cd69e36bab' LIMIT 5"
  );
  console.log("Sample 5 detections:", res.rows);
  await db.end();
}

main().catch(console.error);
