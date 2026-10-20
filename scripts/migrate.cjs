const { Pool } = require('pg');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

// Load .env.local so `npm run migrate` uses the same DATABASE_URL as the app.
// (dotenv is a direct dependency; fallback to manual parse if unavailable.)
(function loadEnv() {
  try {
    require('dotenv').config({ path: join(__dirname, '..', '.env.local') });
  } catch {
    try {
      const f = join(__dirname, '..', '.env.local');
      if (existsSync(f)) {
        require('fs').readFileSync(f, 'utf-8').split('\n').forEach((line) => {
          const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
          if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
        });
      }
    } catch { /* env fallback: use built-in default connStr */ }
  }
})();

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

    // Migration 003: legend_symbols bbox + pid_page for highlight overlay
    for (const col of ['bbox_x', 'bbox_y', 'bbox_w', 'bbox_h', 'pid_page']) {
      await p.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='legend_symbols' AND column_name='${col}'
          ) THEN
            ALTER TABLE legend_symbols ADD COLUMN ${col} INTEGER;
            RAISE NOTICE 'Added legend_symbols.${col}';
          END IF;
        END $$
      `);
    }
    console.log('  003: legend_symbols bbox/pid_page OK');

    // Migration 005: legend_symbols reference image (few-shot detection)
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='reference_image_url'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN reference_image_url TEXT;
          RAISE NOTICE 'Added legend_symbols.reference_image_url';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='reference_crop_hash'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN reference_crop_hash TEXT;
          RAISE NOTICE 'Added legend_symbols.reference_crop_hash';
        END IF;
      END $$
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_legend_symbols_ref_hash ON legend_symbols(reference_crop_hash)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_legend_symbols_legend_status ON legend_symbols(legend_id, status)');
    console.log('  005: legend_symbols reference_image_url/reference_crop_hash OK');

    // Migration 006: builtin standard legends (ISA 5.1 / ISO 10628-2)
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legends' AND column_name='is_builtin'
        ) THEN
          ALTER TABLE legends ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT FALSE;
          RAISE NOTICE 'Added legends.is_builtin';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legends' AND column_name='standard_code'
        ) THEN
          ALTER TABLE legends ADD COLUMN standard_code TEXT;
          RAISE NOTICE 'Added legends.standard_code';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='standard_code'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN standard_code TEXT;
          RAISE NOTICE 'Added legend_symbols.standard_code';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='isa_function_code'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN isa_function_code TEXT;
          RAISE NOTICE 'Added legend_symbols.isa_function_code';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='legend_symbols' AND column_name='iso_category'
        ) THEN
          ALTER TABLE legend_symbols ADD COLUMN iso_category TEXT;
          RAISE NOTICE 'Added legend_symbols.iso_category';
        END IF;
      END $$
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_legends_is_builtin ON legends(is_builtin)');
    await p.query('CREATE INDEX IF NOT EXISTS idx_legends_standard_code ON legends(standard_code)');
    await p.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='rule_engine_rules' AND column_name='is_builtin'
        ) THEN
          ALTER TABLE rule_engine_rules ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT FALSE;
          RAISE NOTICE 'Added rule_engine_rules.is_builtin';
        END IF;
      END $$
    `);
    console.log('  006: legends/legend_symbols builtin standard columns OK');

    // Migration 007: legend quality lifecycle + semantic classes (Stage 3).
    // Idempotent .sql file (IF NOT EXISTS) — safe to re-run.
    try {
      const qsql = join(__dirname, '..', 'sql', 'migrate-007-legend-quality-classes.sql');
      if (existsSync(qsql)) {
        await p.query(readFileSync(qsql, 'utf-8'));
        console.log('  007: legend quality + classes OK');
      }
    } catch (e) {
      console.warn('  007 migration warning (non-fatal):', e.message);
    }

    // Migration 008: DXF document support (file_type + dxf_entities).
    try {
      const dxfsql = join(__dirname, '..', 'sql', 'migrate-008-dxf-support.sql');
      if (existsSync(dxfsql)) {
        await p.query(readFileSync(dxfsql, 'utf-8'));
        console.log('  008-dxf: documents.file_type + document_pages.dxf_entities OK');
      }
    } catch (e) {
      console.warn('  008-dxf migration warning (non-fatal):', e.message);
    }

    // Migration 008: legend review decision reason (Stage 3.5).
    // Idempotent .sql file (IF NOT EXISTS) — safe to re-run.
    try {
      const rsql = join(__dirname, '..', 'sql', 'migrate-008-legend-review.sql');
      if (existsSync(rsql)) {
        await p.query(readFileSync(rsql, 'utf-8'));
        console.log('  008: legend review_reason OK');
      }
    } catch (e) {
      console.warn('  008 migration warning (non-fatal):', e.message);
    }

    // Migration 009: settings.tuning (runtime tuning overrides).
    // Idempotent .sql file (IF NOT EXISTS guard) — safe to re-run.
    try {
      const tsql = join(__dirname, '..', 'sql', 'migrate-009-settings-tuning.sql');
      if (existsSync(tsql)) {
        await p.query(readFileSync(tsql, 'utf-8'));
        console.log('  009: settings.tuning OK');
      }
    } catch (e) {
      console.warn('  009 migration warning (non-fatal):', e.message);
    }

    // Migration 010: multi-legend detection jobs (detection_jobs.legend_ids).
    // Idempotent .sql file (IF NOT EXISTS guards) — safe to re-run.
    try {
      const msql = join(__dirname, '..', 'sql', 'migrate-010-detection-multi-legend.sql');
      if (existsSync(msql)) {
        await p.query(readFileSync(msql, 'utf-8'));
        console.log('  010: detection_jobs.legend_ids OK');
      }
    } catch (e) {
      console.warn('  010 migration warning (non-fatal):', e.message);
    }

    // Migration V2-Phase2: deterministic geometry + AI-verification columns.
    // Idempotent .sql file (IF NOT EXISTS) — safe to re-run.
    try {
      const v2sql = join(__dirname, '..', 'sql', 'migrate-v2-detection-extensions.sql');
      if (existsSync(v2sql)) {
        await p.query(readFileSync(v2sql, 'utf-8'));
        console.log('  V2-Phase2: detections V2 extensions OK');
      }
    } catch (e) {
      console.warn('  V2-Phase2 migration warning (non-fatal):', e.message);
    }

    // Migration 009-dxf-layer-profiles: configurable layer mapping for DXF detection.
    try {
      const dlsql = join(__dirname, '..', 'sql', 'migrate-009-dxf-layer-profiles.sql');
      if (existsSync(dlsql)) {
        await p.query(readFileSync(dlsql, 'utf-8'));
        console.log('  009-dxf-layer-profiles: dxf_layer_profiles + dxf_layer_analysis OK');
      }
    } catch (e) {
      console.warn('  009-dxf-layer-profiles migration warning (non-fatal):', e.message);
    }

    // Migration 011: valve size column support on detections and assets tables.
    // Idempotent .sql file (IF NOT EXISTS) — safe to re-run.
    try {
      const sizesql = join(__dirname, '..', 'sql', 'migrate-011-valve-size.sql');
      if (existsSync(sizesql)) {
        await p.query(readFileSync(sizesql, 'utf-8'));
        console.log('  011: detections.size + assets.size OK');
      }
    } catch (e) {
      console.warn('  011 migration warning (non-fatal):', e.message);
    }

    // Migration 012: Multi-Provider Vision AI (OpenAI & Anthropic Claude columns)
    try {
      const aisql = join(__dirname, '..', 'sql', 'migrate-012-multi-provider-ai.sql');
      if (existsSync(aisql)) {
        await p.query(readFileSync(aisql, 'utf-8'));
        console.log('  012: settings.openai_* + settings.anthropic_* OK');
      }
    } catch (e) {
      console.warn('  012 migration warning (non-fatal):', e.message);
    }

    // Migration 013: Custom OpenAI-compatible Base URL (e.g. 9router)
    try {
      const baseurlsql = join(__dirname, '..', 'sql', 'migrate-013-openai-base-url.sql');
      if (existsSync(baseurlsql)) {
        await p.query(readFileSync(baseurlsql, 'utf-8'));
        console.log('  013: settings.openai_base_url OK');
      }
    } catch (e) {
      console.warn('  013 migration warning (non-fatal):', e.message);
    }


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
