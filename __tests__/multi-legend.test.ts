/**
 * Multi-legend detection jobs (1-3 legends per job, ordered by priority).
 *
 * Locks down the user decisions:
 *   1. symbol conflicts resolve by strict priority (legend 1 wins),
 *   2. detections.legend_id records the SOURCE legend of the match,
 *   3. the API rejects 0-invalid/>3 selections with a 400, never mid-sweep.
 */
import {
  MAX_JOB_LEGENDS,
  normalizeLegendIds,
  effectiveJobLegendIds,
  mergeLegendSymbols,
  buildSourcedTagPatterns,
  tagPatternToRegExp,
  type JobLegendWithSymbols,
} from '@/lib/job-legends';
import { buildSymbolDetectorPrompt } from '@/lib/ai-prompts/symbol-detector';
import { associateTagsToSymbols } from '@/lib/spatial';
import {
  resolveLegendSymbol,
  type LegendSymbolRef,
} from '@/lib/detection/persistence/detection-repository';
import type { Detection } from '@/lib/ai-schemas';

function legend(id: string, name: string, assetTypes: string[]): JobLegendWithSymbols {
  return {
    id,
    name,
    symbols: assetTypes.map((t, i) => ({
      id: `${id}-s${i}`,
      asset_type: t,
      symbol_name: `${t} symbol`,
      tag_pattern: `${t[0]}-###`,
      description: null,
      aliases: [],
      standard_code: null,
      isa_function_code: null,
      iso_category: null,
      reference_image_url: null,
    })),
  };
}

describe('normalizeLegendIds', () => {
  it('accepts the legacy singular legend_id', () => {
    expect(normalizeLegendIds({ legend_id: 'a' })).toEqual(['a']);
  });

  it('prefers the array when both are present', () => {
    expect(normalizeLegendIds({ legend_id: 'a', legend_ids: ['b', 'c'] })).toEqual(['b', 'c']);
  });

  it('returns an empty array for no selection (auto-detect stays allowed)', () => {
    expect(normalizeLegendIds({})).toEqual([]);
    expect(normalizeLegendIds({ legend_id: '' })).toEqual([]);
    expect(normalizeLegendIds({ legend_ids: [] })).toEqual([]);
  });

  it('dedupes while preserving order', () => {
    expect(normalizeLegendIds({ legend_ids: ['b', 'a', 'b'] })).toEqual(['b', 'a']);
  });

  it('rejects more than MAX_JOB_LEGENDS', () => {
    expect(MAX_JOB_LEGENDS).toBe(3);
    const res = normalizeLegendIds({ legend_ids: ['a', 'b', 'c', 'd'] });
    expect(res).toEqual({ error: expect.stringContaining('at most 3') });
  });

  it('rejects non-string elements', () => {
    expect(normalizeLegendIds({ legend_ids: ['a', 42] })).toEqual({
      error: expect.stringContaining('array of legend id strings'),
    });
  });

  it('drops blanks', () => {
    expect(normalizeLegendIds({ legend_ids: ['a', '  ', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('effectiveJobLegendIds', () => {
  it('prefers legend_ids over legend_id', () => {
    expect(effectiveJobLegendIds({ legend_ids: ['b', 'c'], legend_id: 'a' })).toEqual(['b', 'c']);
  });

  it('falls back to legend_id for pre-multi-legend jobs', () => {
    expect(effectiveJobLegendIds({ legend_id: 'a' })).toEqual(['a']);
    expect(effectiveJobLegendIds({ legend_ids: null, legend_id: 'a' })).toEqual(['a']);
    expect(effectiveJobLegendIds({ legend_ids: [], legend_id: 'a' })).toEqual(['a']);
  });

  it('returns empty when neither is set', () => {
    expect(effectiveJobLegendIds({})).toEqual([]);
    expect(effectiveJobLegendIds({ legend_ids: null, legend_id: null })).toEqual([]);
  });

  it('caps a corrupt array at MAX_JOB_LEGENDS instead of trusting the DB', () => {
    expect(effectiveJobLegendIds({ legend_ids: ['a', 'b', 'c', 'd', 'e'] })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('mergeLegendSymbols — strict priority', () => {
  it('unions disjoint legends in priority order', () => {
    const merged = mergeLegendSymbols([legend('a', 'A', ['Pump']), legend('b', 'B', ['Valve'])]);
    expect(merged.map((s) => s.asset_type)).toEqual(['Pump', 'Valve']);
    expect(merged[0]).toMatchObject({ sourceLegendId: 'a', sourceLegendName: 'A', sourcePriority: 0 });
    expect(merged[1]).toMatchObject({ sourceLegendId: 'b', sourceLegendName: 'B', sourcePriority: 1 });
  });

  it('lets the primary legend win an exact conflict', () => {
    const l1 = legend('a', 'A', ['Pump']);
    const l2 = legend('b', 'B', ['Pump']);
    l2.symbols[0].tag_pattern = 'P-XXX';
    const merged = mergeLegendSymbols([l1, l2]);
    // Same asset_type + symbol_name in both → one entry, from the primary.
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceLegendId).toBe('a');
    expect(merged[0].tag_pattern).toBe('P-###');
  });

  it('treats the conflict key case-insensitively', () => {
    const l1 = legend('a', 'A', ['Pump']);
    const l2 = legend('b', 'B', ['pump']);
    l2.symbols[0].symbol_name = 'pump symbol';
    const merged = mergeLegendSymbols([l1, l2]);
    expect(merged).toHaveLength(1);
  });

  it('keeps different symbol names of the same asset type', () => {
    const l1 = legend('a', 'A', ['Valve']);
    const l2 = legend('b', 'B', ['Valve']);
    l2.symbols[0].symbol_name = 'Gate valve';
    const merged = mergeLegendSymbols([l1, l2]);
    expect(merged).toHaveLength(2);
  });

  it('handles an empty selection without throwing', () => {
    expect(mergeLegendSymbols([])).toEqual([]);
  });
});

describe('buildSourcedTagPatterns', () => {
  it('unions patterns in priority order with their source', () => {
    const merged = mergeLegendSymbols([legend('a', 'Alpha', ['Pump']), legend('b', 'Beta', ['Valve'])]);
    const sourced = buildSourcedTagPatterns(merged);
    expect(sourced).toHaveLength(2);
    expect(sourced[0].legendName).toBe('Alpha');
    expect(sourced[1].legendName).toBe('Beta');
    expect(sourced[0].regex.test('P-101')).toBe(true);
    expect(sourced[1].regex.test('V-101')).toBe(true);
  });

  it('converts P-### style patterns', () => {
    expect(tagPatternToRegExp('P-###').test('P-101')).toBe(true);
    expect(tagPatternToRegExp('P-###').test('P-10')).toBe(false);
  });
});

describe('prompt grouping', () => {
  it('renders a single legacy block for one legend', () => {
    const merged = mergeLegendSymbols([legend('a', 'Alpha', ['Pump'])]);
    const prompt = buildSymbolDetectorPrompt(merged);
    expect(prompt).toContain('LEGEND (primary reference for symbol identification)');
    expect(prompt).not.toContain('LEGEND 1');
  });

  it('renders grouped blocks with the primary marked when several legends merge', () => {
    const merged = mergeLegendSymbols([legend('a', 'Alpha', ['Pump']), legend('b', 'Beta', ['Valve'])]);
    const prompt = buildSymbolDetectorPrompt(merged);
    expect(prompt).toContain('LEGEND 1 — Alpha (primary)');
    expect(prompt).toContain('LEGEND 2 — Beta');
    expect(prompt).toContain('When legends disagree, follow the lowest-numbered legend.');
  });

  it('renders the legacy block for unmerged symbols (no source fields)', () => {
    const prompt = buildSymbolDetectorPrompt([{ asset_type: 'Pump' }]);
    expect(prompt).toContain('LEGEND (primary reference for symbol identification)');
    expect(prompt).not.toContain('LEGEND 1');
  });
});

describe('spatial evidence with sources', () => {
  const det = (tag: string | null): Detection => ({
    assetType: 'Pump',
    assetTag: tag,
    confidence: 0.9,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    evidence: [],
    description: null,
    equipmentClass: null,
    service: null,
    mainEquipment: null,
    location: null,
    unit: null,
    area: null,
    size: null,
    fromRef: null,
    toRef: null,
    ofOrAtRef: null,
    descriptionProposed: null,
    tagNoProposed: null,
    legendSymbol: null,
  });

  it('names the matching legend when several are selected', () => {
    const out = associateTagsToSymbols([det('P-101')], [tagPatternToRegExp('P-###'), tagPatternToRegExp('V-###')], [
      'Alpha',
      'Beta',
    ]);
    expect(out[0].evidence).toEqual(
      expect.arrayContaining([expect.stringContaining('Tag P-101 matches Legend "Alpha"')]),
    );
    expect(out[0].confidence).toBe(0.9);
  });

  it('keeps the legacy message when sources are omitted', () => {
    const out = associateTagsToSymbols([det('X-1')], [tagPatternToRegExp('P-###')]);
    expect(out[0].evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tag pattern does not match selected Legend — review required'),
      ]),
    );
    expect(out[0].confidence).toBe(0.79);
  });

  it('names the legend count on mismatch in multi-legend mode', () => {
    const out = associateTagsToSymbols([det('X-1')], [tagPatternToRegExp('P-###'), tagPatternToRegExp('V-###')], [
      'Alpha',
      'Beta',
    ]);
    expect(out[0].evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('does not match any of the 2 selected Legends'),
      ]),
    );
  });
});

describe('persist records the source legend', () => {
  it('resolveLegendSymbol returns the ref so the caller can read its legend', () => {
    const refs: LegendSymbolRef[] = [
      { id: 's1', asset_type: 'Pump', legend_id: 'legend-a', sourceLegendId: 'legend-a' },
      { id: 's2', asset_type: 'Valve', legend_id: 'legend-b', sourceLegendId: 'legend-b' },
    ];
    expect(resolveLegendSymbol('Valve', refs)?.sourceLegendId).toBe('legend-b');
    expect(resolveLegendSymbol('s1', refs)?.sourceLegendId).toBe('legend-a');
    expect(resolveLegendSymbol('Unknown', refs)).toBeNull();
  });
});
