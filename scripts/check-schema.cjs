require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await p.query(
    "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'detections'"
  );
  r.rows.forEach(x => console.log(x.column_name, '|', x.is_nullable, '|', x.data_type));
  
  // Also try a direct insert to see the error
  try {
    await p.query(
      `INSERT INTO detections (id, job_id, document_id, document_page_id, asset_tag, asset_type, equipment_class, description, service, location, unit, area, pid_number, pid_page, legend_id, legend_symbol_id, confidence, bbox_x, bbox_y, bbox_w, bbox_h, evidence, detection_status, review_status)
       VALUES ('a0000000-0000-0000-0000-000000000001', 'fe6342d1-2851-4aba-b01e-eeec7e22b879', '9ddfe31d-078c-4b74-b3ae-816a45267771', NULL, 'V-101', 'Vessel', NULL, NULL, NULL, NULL, NULL, NULL, 'test.pdf', 1, 'a15198ed-f27e-47f6-9ffc-6393b1b16c8e', NULL, 0.96, 100, 100, 200, 200, '["test evidence"]', 'DETECTED', 'PENDING')`
    );
    console.log('INSERT OK');
    await p.query("DELETE FROM detections WHERE id = 'a0000000-0000-0000-0000-000000000001'");
  } catch(e) {
    console.error('INSERT ERROR:', e.message);
  }
  
  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
