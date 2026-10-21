import { pool } from '../lib/db';

async function main() {
  const res = await pool.query(`
    SELECT id, legend_id, symbol_name, asset_type, bbox_x, bbox_y, bbox_w, bbox_h, reference_image_url, created_at 
    FROM legend_symbols 
    ORDER BY created_at DESC 
    LIMIT 15
  `);
  console.log('Symbols count:', res.rowCount);
  for (const row of res.rows) {
    console.log(`[${row.created_at?.toISOString()}] ${row.symbol_name} (${row.asset_type}) bbox: [${row.bbox_x}, ${row.bbox_y}, ${row.bbox_w}, ${row.bbox_h}] img: ${row.reference_image_url}`);
  }
  await pool.end();
}

main().catch(console.error);
