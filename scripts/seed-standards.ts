/**
 * Seed built-in standard legends (ISA 5.1 + ISO 10628-2) into the database.
 *
 * Safe to run multiple times — uses upsert logic:
 *   - If legend with same standard_code exists → update name/description, keep id
 *   - If symbols changed → delete old symbols, re-insert (preserves legend_id references)
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-standards.ts
 */

import { pool } from '@/lib/db';
import { BUILTIN_LEGENDS } from '@/lib/standard-legends';
import { v4 as uuidv4 } from 'uuid';

async function seedBuiltinLegends() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const legend of BUILTIN_LEGENDS) {
      console.log(`\n[seed] Processing: ${legend.name}`);

      // Check if already exists
      const existing = await client.query(
        'SELECT id FROM legends WHERE standard_code = $1 AND is_builtin = TRUE',
        [legend.standard_code]
      );

      let legendId: string;

      if (existing.rows.length > 0) {
        // Update existing
        legendId = existing.rows[0].id;
        await client.query(
          `UPDATE legends
           SET name=$1, description=$2, status='ACTIVE', updated_at=NOW()
           WHERE id=$3`,
          [legend.name, legend.description, legendId]
        );
        console.log(`  [seed] Updated legend id=${legendId}`);

        // Delete old symbols — re-seed fresh
        const deleted = await client.query(
          'DELETE FROM legend_symbols WHERE legend_id=$1',
          [legendId]
        );
        console.log(`  [seed] Removed ${deleted.rowCount} old symbols`);
      } else {
        // Insert new
        legendId = uuidv4();
        await client.query(
          `INSERT INTO legends
             (id, name, description, status, is_builtin, standard_code, created_at, updated_at)
           VALUES ($1, $2, $3, 'ACTIVE', TRUE, $4, NOW(), NOW())`,
          [legendId, legend.name, legend.description, legend.standard_code]
        );
        console.log(`  [seed] Inserted legend id=${legendId}`);
      }

      // Insert symbols
      let symbolCount = 0;
      for (const sym of legend.symbols) {
        const symId = uuidv4();
        await client.query(
          `INSERT INTO legend_symbols
             (id, legend_id, asset_type, symbol_name, tag_pattern, description, aliases,
              standard_code, isa_function_code, iso_category, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', NOW(), NOW())`,
          [
            symId,
            legendId,
            sym.asset_type,
            sym.symbol_name,
            sym.tag_pattern ?? null,
            sym.description,
            sym.aliases,
            sym.standard_code,
            sym.isa_function_code ?? null,
            sym.iso_category ?? null,
          ]
        );
        symbolCount++;
      }
      console.log(`  [seed] Inserted ${symbolCount} symbols`);
    }

    await client.query('COMMIT');
    console.log('\n[seed] Done. Built-in standards seeded successfully.\n');

    // Print summary
    const summary = await client.query(
      `SELECT name, standard_code, is_builtin,
              (SELECT COUNT(*) FROM legend_symbols WHERE legend_id=l.id)::int AS symbol_count
       FROM legends l
       WHERE is_builtin=TRUE
       ORDER BY created_at`
    );
    console.log('[seed] Summary:');
    for (const row of summary.rows) {
      console.log(`  ${row.name} [${row.standard_code}] — ${row.symbol_count} symbols`);
    }

    // M17: Seed generic ISA 5.1 rule_engine_rules (idempotent upsert).
    // Only seeds rules derived from ISA 5.1 shape/symbol facts — no company-specific rules.
    // Each asset_type is upserted independently so partial re-runs are safe.
    console.log('\n[seed] Seeding rule_engine_rules (ISA 5.1 generic)...');
    const BUILTIN_RULES = [
      {
        asset_type: 'generic',
        rules: {
          required: [],
          optional: [
            { name: 'has_shape', description: 'Symbol has identifiable shape', check: 'shape', expected: ['circle', 'diamond', 'rectangle', 'triangle', 'parallelogram', 'hexagon'] },
          ],
          penalty: [
            { condition: 'tiny_bbox', check: 'aspect_ratio', expected: 'unknown', penalty: -0.05, description: 'Aspect ratio unknown — bbox may be too small' },
          ],
          bonus: [
            { condition: 'has_inside_text', check: 'inside_text', expected: ['FT', 'PT', 'LT', 'TT', 'AT', 'FI', 'PI', 'LI', 'TI', 'FIC', 'PIC', 'LIC', 'TIC'], bonus: 0.05, description: 'Instrument function letter inside symbol' },
          ],
        },
      },
      {
        asset_type: 'valve',
        rules: {
          required: [],
          optional: [
            { name: 'actuator', description: 'Has actuator symbol', check: 'has_actuator', expected: true },
            { name: 'instrument_line', description: 'Connected by instrument line', check: 'connection', expected: 'instrument_line' },
          ],
          penalty: [],
          bonus: [
            { condition: 'has_actuator', check: 'has_actuator', expected: true, bonus: 0.05, description: 'Actuator confirms valve type' },
          ],
        },
      },
      {
        asset_type: 'instrument',
        rules: {
          required: [
            { name: 'circle_shape', description: 'Instrument uses circle symbol per ISA 5.1', check: 'shape', expected: 'circle' },
          ],
          optional: [
            { name: 'has_function_letter', description: 'Function letter inside circle', check: 'inside_text', expected: ['FT', 'PT', 'LT', 'TT', 'AT', 'FI', 'PI', 'LI', 'TI'] },
          ],
          penalty: [
            { condition: 'not_circle', check: 'shape', expected: ['rectangle', 'triangle'], penalty: -0.15, description: 'Non-circle shape contradicts ISA 5.1 instrument symbol' },
          ],
          bonus: [],
        },
      },
    ] as const;

    let rulesSeeded = 0;
    let rulesUpdated = 0;
    for (const entry of BUILTIN_RULES) {
      const existing = await client.query(
        'SELECT id FROM rule_engine_rules WHERE asset_type = $1 AND is_builtin = TRUE',
        [entry.asset_type]
      );
      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE rule_engine_rules SET rules = $1, updated_at = NOW() WHERE asset_type = $2 AND is_builtin = TRUE`,
          [JSON.stringify(entry.rules), entry.asset_type]
        );
        rulesUpdated++;
      } else {
        await client.query(
          `INSERT INTO rule_engine_rules (asset_type, rules, is_builtin, created_at, updated_at)
           VALUES ($1, $2, TRUE, NOW(), NOW())`,
          [entry.asset_type, JSON.stringify(entry.rules)]
        );
        rulesSeeded++;
      }
    }
    console.log(`[seed] rule_engine_rules: ${rulesSeeded} inserted, ${rulesUpdated} updated.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedBuiltinLegends();
