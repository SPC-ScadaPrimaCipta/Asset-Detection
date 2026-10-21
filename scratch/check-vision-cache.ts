import db from "@/lib/db";
import { getCachedVision, putCachedVision } from "@/lib/dxf-vision-cache";

const key = `probe-${Date.now()}`;

async function main() {
  const payload = {
    detections: [{ assetTag: "P-101", assetType: "Pump", confidence: 0.9 }],
    stats: { yoloDetections: 1, geminiFallbackDetections: 0 },
  };

  await putCachedVision(key, { legendId: null, model: "probe", regionIndex: 0 }, payload);
  const first = await getCachedVision(key);
  const second = await getCachedVision(key);

  if (!first || first.detections.length !== 1) {
    throw new Error(`roundtrip failed: ${JSON.stringify(first)}`);
  }
  if (!second || second.detections.length !== 1) {
    throw new Error(`second read failed: ${JSON.stringify(second)}`);
  }

  const row = (
    await db.query("SELECT hits FROM dxf_vision_cache WHERE key=$1", [key])
  ).rows[0] as { hits: number };
  console.log("cache roundtrip OK", { hits: row.hits });

  await db.query("DELETE FROM dxf_vision_cache WHERE key=$1", [key]);

  const missing = await getCachedVision("definitely-not-present");
  console.log("miss returns", missing);
}

main()
  .then(() => db.end())
  .catch(async (err) => {
    console.error(err);
    await db.end();
    process.exit(1);
  });
