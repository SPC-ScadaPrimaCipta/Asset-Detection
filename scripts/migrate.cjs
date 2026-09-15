const { Pool } = require('pg');

async function migrate() {
  const connStr = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/asset_detection';
  const p = new Pool({ connectionString: connStr });
  try {
    console.log('Running migrations...');

    // Migration 001: detection_audits
    await p.query(`
      CREATE TABLE IF NOT EXISTS detection_audits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        detection_id UUID REFERENCES detections(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('CONFIRM','REJECT','EDIT','MANUAL_CREATE')),
        old_values JSONB,
        new_values JSONB,
        performed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_detection_audits_detection ON detection_audits(detection_id)');
    console.log('  001: detection_audits OK');

    // Migration 002: legend_symbols.status, legend_symbols.updated_at, legends.status, legends.updated_at
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='status'
        ) THEN
          ALTER TABLE legend_symbols
            ADD COLUMN status TEXT DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','DRAFT','REJECTED'));
          RAISE NOTICE 'Added legend_symbols.status';
        END IF;
      END $$
    `);
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='updated_at'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
          RAISE NOTICE 'Added legend_symbols.updated_at';
        END IF;
      END $$
    `);
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legends' AND column_name='status'
        ) THEN
          ALTER TABLE legends
            ADD COLUMN status TEXT DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','DRAFT'));
          RAISE NOTICE 'Added legends.status';
        END IF;
      END $$
    `);
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legends' AND column_name='updated_at'
        ) THEN
          ALTER TABLE legends ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
          RAISE NOTICE 'Added legends.updated_at';
        END IF;
      END $$
    `);
    console.log('  002: legend status/updated_at OK');

    const r = await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    console.log('Tables:', r.rows.map(x => x.tablename).join(', '));
    console.log('Migration complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await p.end();
  }
}

migrate();
