import { LegendSymbolSchema, LegendSchema } from '@/lib/legend-schemas';

describe('LegendSchema', () => {
  it('accepts valid legend', () => {
    const r = LegendSchema.safeParse({ name: 'Plant A Standard', description: 'Main P&ID legend' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = LegendSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });

  it('defaults status to ACTIVE', () => {
    const r = LegendSchema.safeParse({ name: 'Test' });
    expect(r.success && r.data.status).toBe('ACTIVE');
  });
});

describe('LegendSymbolSchema', () => {
  it('accepts full valid symbol', () => {
    const r = LegendSymbolSchema.safeParse({
      asset_type: 'Pump',
      symbol_name: 'Centrifugal Pump',
      tag_pattern: 'P-###',
      description: 'Centrifugal pump symbol',
      aliases: ['P', 'PUMP'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty asset_type', () => {
    const r = LegendSymbolSchema.safeParse({ asset_type: '' });
    expect(r.success).toBe(false);
  });

  it('defaults aliases to []', () => {
    const r = LegendSymbolSchema.safeParse({ asset_type: 'Valve' });
    expect(r.success && r.data.aliases).toEqual([]);
  });

  it('rejects invalid status', () => {
    const r = LegendSymbolSchema.safeParse({ asset_type: 'Pump', status: 'INVALID' });
    expect(r.success).toBe(false);
  });

  it('accepts null nullable fields', () => {
    const r = LegendSymbolSchema.safeParse({
      asset_type: 'Vessel',
      symbol_name: null,
      tag_pattern: null,
      description: null,
    });
    expect(r.success).toBe(true);
  });
});
