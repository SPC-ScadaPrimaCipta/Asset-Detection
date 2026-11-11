const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:databasepassword@127.0.0.1:5433/asset_detection',
});

async function checkMdo() {
  try {
    const res = await pool.query(`
      SELECT 
        tag_no_proposed, 
        equipment_type_short, 
        equipment_name, 
        size, 
        from_value, 
        to_value, 
        of_value, 
        description,
        created_at
      FROM detection_mdo_records 
      ORDER BY created_at DESC 
      LIMIT 30
    `);
    
    console.log(`\n=== Recent MDO Records (${res.rows.length}) ===\n`);
    
    // Group by instrument vs non-instrument
    const instruments = [];
    const nonInstruments = [];
    
    for (const row of res.rows) {
      const shortCode = (row.equipment_type_short || '').toUpperCase();
      const fullName = (row.equipment_name || '').toUpperCase();
      
      // Standard ISA instrument codes
      const isInstByCode = /^(PT|TT|FT|LT|PI|TI|FI|LI|PG|TG|LG|FG|PSH|PSL|TSH|TSL|LSH|LSL|FSH|FSL|PDT|TIT|FIT|LIT|PDIT|WIT|TE|FE|LE|PE)$/i.test(shortCode);
      
      // Also check full name for instrument keywords
      const isInstByName = fullName.includes('TRANSMITTER') || 
                           fullName.includes('INDICATOR') || 
                           fullName.includes('GAUGE') ||
                           fullName.includes('SENSOR') ||
                           fullName.includes('ELEMENT');
      
      if (isInstByCode || isInstByName) {
        instruments.push(row);
      } else {
        nonInstruments.push(row);
      }
    }
    
    console.log('INSTRUMENTS (should have from_value=null, to_value=null):');
    console.log('─'.repeat(80));
    instruments.forEach(r => {
      const fromOk = r.from_value === null ? '✓' : '✗';
      const toOk = r.to_value === null ? '✓' : '✗';
      console.log(`${fromOk}${toOk} ${r.tag_no_proposed?.padEnd(15) || 'null'.padEnd(15)} ${r.equipment_type_short?.padEnd(6) || 'null'.padEnd(6)} FROM=${String(r.from_value).padEnd(12)} TO=${String(r.to_value).padEnd(12)} OF=${r.of_value || 'null'}`);
    });
    
    console.log('\nNON-INSTRUMENTS (can have from_value/to_value):');
    console.log('─'.repeat(80));
    nonInstruments.forEach(r => {
      console.log(`  ${r.tag_no_proposed?.padEnd(15) || 'null'.padEnd(15)} ${r.equipment_type_short?.padEnd(6) || 'null'.padEnd(6)} FROM=${String(r.from_value).padEnd(12)} TO=${String(r.to_value).padEnd(12)} OF=${r.of_value || 'null'}`);
    });
    
    // Check for violations
    const violations = instruments.filter(r => r.from_value !== null || r.to_value !== null);
    if (violations.length > 0) {
      console.log(`\n⚠️  ${violations.length} INSTRUMENT(S) WITH FROM/TO (VIOLATION):`);
      violations.forEach(r => {
        console.log(`   ${r.tag_no_proposed} (${r.equipment_type_short}): FROM=${r.from_value}, TO=${r.to_value}`);
      });
    } else {
      console.log(`\n✓ All ${instruments.length} instruments have from_value=null & to_value=null (CORRECT)`);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkMdo();
