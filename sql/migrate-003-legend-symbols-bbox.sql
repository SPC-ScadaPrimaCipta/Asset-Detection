const { Pool } = require('pg');

async function migrate() {
  const connStr = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/asset_detection';
  const p = new Pool({ connectionString: connStr });
  try {
    console.log('Running migrations...');

    // Migration 003: legend_symbols bbox/page
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='bbox_x'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN bbox_x INTEGER;
          ALTER TABLE legend_symbols ADD COLUMN bbox_y INTEGER;
          ALTER TABLE legend_symbols ADD COLUMN bbox_w INTEGER;
          ALTER TABLE legend_symbols ADD COLUMN bbox_h INTEGER;
          ALTER TABLE legend_symbols ADD COLUMN pid_page INTEGER;
          RAISE NOTICE 'Added legend_symbols bbox/page columns';
        END IF;
      END $$
    `);
    console.log('  003: legend_symbols bbox/page OK');

    console.log('Migration complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await p.end();
  }
}

migrate();
