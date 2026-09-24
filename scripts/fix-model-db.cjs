const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
p.query("UPDATE settings SET gemini_model='gemini-2.0-flash', deepseek_model='deepseek-chat' WHERE id=1")
  .then(r => { console.log('updated rows:', r.rowCount); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
