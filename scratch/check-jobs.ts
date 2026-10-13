import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const res = await db.query("SELECT status, count(*) FROM detection_jobs GROUP BY status");
  console.log("detection_jobs status count:", res.rows);
  const pending = await db.query("SELECT id, status, document_id, created_at FROM detection_jobs WHERE status='PENDING'");
  console.log("PENDING jobs:", pending.rows);
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
