require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await p.query(
    "UPDATE settings SET gemini_model='gemini-3.6-flash' WHERE id=1 RETURNING gemini_model, ai_provider"
  );
  if (r.rowCount === 0) {
    // Insert if not exists
    await p.query(
      "INSERT INTO settings (id, ai_provider, gemini_model) VALUES (1, 'gemini', 'gemini-3.6-flash') ON CONFLICT (id) DO UPDATE SET gemini_model='gemini-3.6-flash'"
    );
    console.log('Inserted/updated settings with gemini-3.6-flash');
  } else {
    console.log('Updated:', JSON.stringify(r.rows[0]));
  }
  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
