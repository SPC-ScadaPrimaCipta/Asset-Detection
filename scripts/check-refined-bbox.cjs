const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:5433/asset_detection' });
p.query("SELECT asset_type, symbol_name, bbox_x, bbox_y, bbox_w, bbox_h FROM legend_symbols WHERE legend_id='7045609b-cede-4509-b480-4d5a555f3fd7' ORDER BY bbox_y, bbox_x LIMIT 15")
  .then(r => {
    console.log('Refined symbols:');
    r.rows.forEach(x => console.log(`  [x:${x.bbox_x} y:${x.bbox_y} w:${x.bbox_w} h:${x.bbox_h}] ${x.asset_type} — ${x.symbol_name}`));
    p.end();
  })
  .catch(e => { console.error(e.message); p.end(); });
