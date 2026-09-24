const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });

// Ganti dengan API key baru kamu
const NEW_KEY = process.argv[2];
if (!NEW_KEY || !NEW_KEY.startsWith('AIzaSy')) {
  console.error('Usage: node scripts/set-gemini-key.cjs AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXX');
  console.error('Key harus mulai dengan AIzaSy...');
  process.exit(1);
}

p.query("UPDATE settings SET gemini_api_key=$1, gemini_model='gemini-2.0-flash-exp' WHERE id=1", [NEW_KEY])
  .then(r => {
    console.log('updated rows:', r.rowCount);
    console.log('key prefix:', NEW_KEY.slice(0, 12) + '...');
    p.end();
  })
  .catch(e => { console.error(e.message); p.end(); });
