import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const { default: db } = await import("../lib/db");
  const docs = await db.query("SELECT id, project_id, filename, file_path, page_count FROM documents");
  console.log("All documents in DB:");
  for (const d of docs.rows) {
    console.log(`- ID: ${d.id}, File: ${d.filename}, Path: ${d.file_path}, Pages: ${d.page_count}`);
  }
  await db.end();
}

main().catch(console.error);
