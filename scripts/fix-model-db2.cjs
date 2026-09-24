const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
p.query("UPDATE settings SET gemini_model='gemini-3.6-flash' WHERE id=1")
  .then(r => { console.log('updated rows:', r.rowCount); return p.query('SELECT gemini_model FROM settings WHERE id=1'); })
  .then(r => { console.log('current model:', r.rows[0].gemini_model); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
