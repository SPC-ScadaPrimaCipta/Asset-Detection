import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const res = await db.query("SELECT id, status, progress_pct, error_detail, started_at, completed_at FROM detection_jobs WHERE id='84cea9e5-75bb-4ccf-84c2-f64aeb5538d3'");
  console.log("Job status:", res.rows[0]);

  const detCount = await db.query("SELECT count(*) FROM detections WHERE job_id='84cea9e5-75bb-4ccf-84c2-f64aeb5538d3'");
  console.log("Detections count:", detCount.rows[0]);

  const agentRun = await db.query("SELECT id, model, prompt_version, status, input_metadata, output_metadata, error FROM agent_runs WHERE job_id='84cea9e5-75bb-4ccf-84c2-f64aeb5538d3'");
  console.log("Agent run:", agentRun.rows[0]);

  await db.end();
}

main().catch(console.error);
