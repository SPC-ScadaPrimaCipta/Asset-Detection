import {
  groupLegendClasses,
  isMatcherEligible,
} from '@/lib/detection/legend/legend-classes';
import { normalizeLegendLabel } from '@/lib/detection/legend/legend-model';

describe('groupLegendClasses (exact normalized-label only)', () => {
  const sym = (id: string, symbol_name: string | null, asset_type = '') => ({
    id,
    symbol_name,
    asset_type,
  });

  it('groups case/whitespace variants of the same description', () => {
    const groups = groupLegendClasses([
      sym('a', 'GATE VALVE'),
      sym('b', 'Gate Valve'),
      sym('c', ' gate valve '),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('gate valve');
    expect(groups[0].symbolIds).toEqual(['a', 'b', 'c']);
  });

  it('never merges distinct semantic labels', () => {
    const groups = groupLegendClasses([
      sym('a', 'GATE VALVE'),
      sym('b', 'ACTUATED GATE VALVE'),
      sym('c', 'BALL VALVE'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.key).sort()).toEqual([
      'actuated gate valve',
      'ball valve',
      'gate valve',
    ]);
  });

  it('falls back to asset_type only when symbol_name is empty', () => {
    const groups = groupLegendClasses([sym('a', null, 'Pump'), sym('b', '', 'Pump')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('pump');
  });

  it('skips unlabeled symbols instead of inventing a class', () => {
    expect(groupLegendClasses([sym('a', null, ''), sym('b', '  ', '')])).toEqual([]);
  });

  it('uses the single normalizeLegendLabel implementation', () => {
    expect(normalizeLegendLabel('Gate  Valve')).toBe('gate valve');
  });

  it('has no tag input anywhere (Asset Tag never enters classes)', () => {
    const keys = Object.keys(
      groupLegendClasses([{ id: 'a', symbol_name: 'VLV-101' }])[0] ?? {}
    );
    expect(keys).toEqual(['key', 'label', 'symbolIds']);
  });
});

describe('isMatcherEligible', () => {
  it('validated + readable crop → eligible', () => {
    expect(isMatcherEligible({ quality_status: 'validated', cropReadable: true }))
      .toEqual({ eligible: true, reason: 'validated + crop readable' });
  });

  it('review is never auto-eligible', () => {
    expect(isMatcherEligible({ quality_status: 'review', cropReadable: true }).eligible).toBe(false);
  });

  it('rejected is never eligible', () => {
    expect(isMatcherEligible({ quality_status: 'rejected', cropReadable: true }).eligible).toBe(false);
  });

  it('missing crop is never eligible even when validated', () => {
    expect(isMatcherEligible({ quality_status: 'validated', cropReadable: false }).eligible).toBe(false);
  });

  it('unassessed (null) is never eligible', () => {
    expect(isMatcherEligible({ quality_status: null, cropReadable: true }).eligible).toBe(false);
  });
});
