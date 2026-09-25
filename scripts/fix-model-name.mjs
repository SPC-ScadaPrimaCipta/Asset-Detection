import pg from 'pg';
const { Pool } = pg;
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
try {
  const r = await p.query("UPDATE settings SET gemini_model='gemini-2.0-flash' WHERE id=1");
  console.log('rows updated:', r.rowCount);
} catch (e) {
  console.log('error (ok if settings table empty):', e.message);
}
await p.end();
