/**
 * Tag-prefix coverage audit (Blok 7).
 *
 * Lists every tag prefix found in a DXF file and maps it to its resolution
 * source: user legend pattern → ISA → ISO → NEEDS FILL (no pattern anywhere).
 * Uncovered prefixes are a DATA task (fill legend tag_pattern), never code.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit-tag-coverage.ts [path-to.dxf]
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parseDxf } from '@/lib/dxf-parser';
import { pool } from '@/lib/db';

function patternToRegex(pattern: string): RegExp | null {
  try {
    const esc = pattern
      .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      .replace(/#/g, '\\d')
      .replace(/\*/g, '.*');
    return new RegExp(`^${esc}$`, 'i');
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fallback = resolve('storage/9880cba6-3f38-4526-bea4-6d2a4b1d9bd6-INTAN_GS.dxf');
  const file = args[0] ?? (existsSync(fallback) ? fallback : resolve('scratch/test-pid.dxf'));
  if (!existsSync(file)) {
    console.error(`file not found: ${file}`);
    process.exit(1);
  }

  const parsed = parseDxf(readFileSync(file));
  const TAG_RE = /^[A-Z]{1,6}[-_][0-9]{2,6}[A-Z]{0,2}[-_]?[A-Z0-9]{0,4}$/i;
  const tags = new Set<string>();
  for (const e of parsed.entities) {
    if (e.kind !== 'TEXT' && e.kind !== 'MTEXT') continue;
    const t = e.text.trim();
    if (TAG_RE.test(t) && !/^\d/.test(t)) tags.add(t);
  }

  const rows = (await pool.query(
    `SELECT ls.asset_type, ls.tag_pattern, l.name AS legend, l.is_builtin,
            l.standard_code
     FROM legend_symbols ls
     JOIN legends l ON l.id = ls.legend_id
     WHERE ls.status = 'ACTIVE' AND ls.tag_pattern IS NOT NULL`,
  )).rows as Array<{
    asset_type: string; tag_pattern: string; legend: string;
    is_builtin: boolean; standard_code: string | null;
  }>;

  const patterns = rows
    .map((r) => ({ ...r, re: patternToRegex(r.tag_pattern) }))
    .filter((r) => r.re);

  const byPrefix = new Map<string, string[]>();
  for (const t of tags) {
    const prefix = (t.split(/[-_.]/)[0] ?? '').toUpperCase();
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(t);
  }

  console.log(`file=${file} unique_tags=${tags.size} patterns=${patterns.length}`);
  const uncovered: string[] = [];
  // Mirror findInLegend (rule-validator.ts): full-pattern → prefix-part → alias.
  // Prefix-part is EXACT ("P" matches "P-###" but not "PI-###").
  const prefixPart = (pattern: string) =>
    pattern.split('-')[0].replace(/#|\*/g, '').toUpperCase();
  const tagPrefixOf = (tag: string) => (tag.split(/[-_.]/)[0] ?? '').toUpperCase();
  for (const [prefix, samples] of [...byPrefix.entries()].sort()) {
    const hits = patterns.filter((p) =>
      samples.some(
        (s) =>
          p.re!.test(s) ||
          (p.tag_pattern && prefixPart(p.tag_pattern) === tagPrefixOf(s)),
      ),
    );
    const userHit = hits.find((h) => !h.is_builtin);
    const stdHit = hits.find((h) => h.is_builtin);
    const src = userHit
      ? `LEGEND "${userHit.legend}" → ${userHit.asset_type}`
      : stdHit
        ? `${stdHit.standard_code} → ${stdHit.asset_type}`
        : 'NEEDS FILL (no pattern anywhere)';
    if (!userHit && !stdHit) uncovered.push(prefix);
    console.log(
      `  ${prefix} x${samples.length} e.g. ${samples.slice(0, 3).join(', ')} → ${src}`,
    );
  }
  console.log(
    uncovered.length === 0
      ? 'COVERAGE COMPLETE: every prefix resolves.'
      : `UNCOVERED (${uncovered.length}): ${uncovered.join(', ')} — fill legend tag_pattern for these.`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
