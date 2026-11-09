const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:databasepassword@127.0.0.1:5433/asset_detection',
});

async function checkDxfMdo() {
  try {
    // Get recent DXF documents with MDO
    const res = await pool.query(`
      SELECT 
        d.id as doc_id,
        d.filename,
        dm.tag_no_proposed,
        dm.equipment_type_short,
        dm.equipment_name,
        dm.from_value,
        dm.to_value,
        dm.of_value,
        dm.at_value,
        dm.description,
        dm.created_at
      FROM detection_mdo_records dm
      JOIN detections det ON dm.detection_id = det.id
      JOIN documents d ON dm.document_id = d.id
      WHERE d.filename LIKE '%.dxf'
      ORDER BY dm.created_at DESC
      LIMIT 30
    `);
    
    if (res.rows.length === 0) {
      console.log('\n❌ Tidak ada MDO DXF. Jalankan deteksi pada dokumen .dxf dulu.\n');
      return;
    }
    
    console.log(`\n=== DXF MDO Records (${res.rows.length}) dari ${res.rows[0].filename} ===\n`);
    
    const instruments = [];
    const valves = [];
    
    for (const row of res.rows) {
      const shortCode = (row.equipment_type_short || '').toUpperCase();
      const fullName = (row.equipment_name || '').toUpperCase();
      
      // ISA instrument codes (PT, TI, FI, LI, dll)
      const isInst = /^(PT|TT|FT|LT|PI|TI|FI|LI|HI|WI|PG|TG|LG|FG|PSH|PSL|TSH|TSL|LSH|LSL|PDT|TIT|FIT|LIT|WIT|TE|FE|LE|PE)$/i.test(shortCode);
      
      if (isInst) {
        instruments.push(row);
      } else {
        valves.push(row);
      }
    }
    
    console.log('INSTRUMENTS (harus from_value=null, to_value=null):');
    console.log('─'.repeat(110));
    
    if (instruments.length === 0) {
      console.log('  (tidak ada instrument di sample ini)');
    } else {
      instruments.forEach(r => {
        const fromOk = r.from_value === null ? '✓' : '✗';
        const toOk = r.to_value === null ? '✓' : '✗';
        console.log(
          `${fromOk}${toOk} ${(r.tag_no_proposed || 'null').padEnd(15)} ` +
          `${(r.equipment_type_short || '?').padEnd(6)} ` +
          `FROM=${String(r.from_value).padEnd(15)} ` +
          `TO=${String(r.to_value).padEnd(15)} ` +
          `OF=${(r.of_value || 'null').padEnd(12)} ` +
          `AT=${r.at_value || 'null'}`
        );
      });
    }
    
    console.log('\nVALVES & EQUIPMENT (boleh punya FROM/TO/OF):');
    console.log('─'.repeat(110));
    
    valves.forEach(r => {
      console.log(
        `   ${(r.tag_no_proposed || 'null').padEnd(15)} ` +
        `${(r.equipment_type_short || '?').padEnd(6)} ` +
        `FROM=${String(r.from_value).padEnd(15)} ` +
        `TO=${String(r.to_value).padEnd(15)} ` +
        `OF=${(r.of_value || 'null').padEnd(12)} ` +
        `AT=${r.at_value || 'null'}`
      );
    });
    
    // Validation
    const violations = instruments.filter(r => r.from_value !== null || r.to_value !== null);
    
    console.log('\n' + '='.repeat(110));
    if (violations.length > 0) {
      console.log(`❌ ${violations.length} INSTRUMENT(S) MASIH PUNYA FROM/TO (SALAH!):`);
      violations.forEach(r => {
        console.log(`   ${r.tag_no_proposed} (${r.equipment_type_short}): FROM=${r.from_value}, TO=${r.to_value}`);
      });
      console.log('\n⚠️  Logic instrument filter BELUM diterapkan atau ada bug di buildDxfMdoRecordWithFlowAnalysis()');
    } else {
      console.log(`✅ BENAR: Semua ${instruments.length} instrument punya from_value=null & to_value=null`);
      console.log('✅ Logic Raden (commit 2adc341) sudah berjalan dengan benar di DXF flow analysis.');
    }
    
    // Check if flow analysis captured FROM/TO for valves
    const valvesWithFlow = valves.filter(v => v.from_value !== null || v.to_value !== null);
    console.log(`\nℹ️  ${valvesWithFlow.length}/${valves.length} valve punya FROM/TO (flow analysis aktif)\n`);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkDxfMdo();
