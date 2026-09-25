const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
const key = process.argv[2];
if (!key) { console.error('Usage: node scripts/update-key.cjs YOUR_API_KEY'); process.exit(1); }
p.query('UPDATE settings SET gemini_api_key=$1 WHERE id=1', [key])
  .then(r => { console.log('OK, rows updated:', r.rowCount); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
