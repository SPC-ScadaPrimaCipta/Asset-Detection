const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
c.connect()
  .then(() => c.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'detections'"
  ))
  .then(r => {
    console.log('detections columns:');
    r.rows.forEach(row => console.log(' ', row.column_name.padEnd(30), row.data_type));
    const needed = ['canonical_features','crop_hash','embedding','detection_source','confidence_breakdown'];
    const found = r.rows.map(x => x.column_name);
    console.log('\nChecking new columns:');
    needed.forEach(col => console.log(' ', col, ':', found.includes(col) ? 'OK' : 'MISSING'));
  })
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => c.end());
