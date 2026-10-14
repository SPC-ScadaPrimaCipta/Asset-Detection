import 'dotenv/config';
import db from '../lib/db';

async function main() {
  const r = await db.query("SELECT id, filename, file_path, file_type, created_at FROM documents ORDER BY created_at DESC");
  console.log('Total documents:', r.rows.length);
  for (const row of r.rows) {
    console.log(row.id, row.filename, row.file_type, row.file_path);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
