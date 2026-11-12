/**
 * Quick migration patch: add training tracking columns
 */
import db from '../lib/db';

async function main() {
  try {
    console.log('Adding training tracking columns...');
    
    await db.query(`
      ALTER TABLE detections ADD COLUMN IF NOT EXISTS included_in_training BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ Added included_in_training column');
    
    await db.query(`
      ALTER TABLE detections ADD COLUMN IF NOT EXISTS training_exported_at TIMESTAMPTZ;
    `);
    console.log('✓ Added training_exported_at column');
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_detections_training 
      ON detections(detection_status, validation_status, included_in_training) 
      WHERE (detection_status = 'CONFIRMED' OR validation_status = 'VALID');
    `);
    console.log('✓ Created index idx_detections_training');
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS training_exports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        confirmed_count INT NOT NULL,
        unique_classes INT NOT NULL DEFAULT 0,
        zip_size_bytes BIGINT,
        exported_at TIMESTAMPTZ DEFAULT NOW(),
        notes TEXT
      );
    `);
    console.log('✓ Created training_exports table');
    
    console.log('\n✅ Training tracking migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
