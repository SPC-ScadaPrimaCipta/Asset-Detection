/**
 * Stage 3.5: shared legend-crop helper contract.
 * - Null/invalid bbox → nulls (never throws, never writes).
 * - Invalid image data → nulls (non-fatal by contract).
 */
import { cropAndSaveSymbol } from '@/lib/legend-crop';

describe('cropAndSaveSymbol', () => {
  it('returns nulls for null bbox without touching storage', async () => {
    const out = await cropAndSaveSymbol(
      'AAAA', { x: null, y: 0, width: 10, height: 10 }, 100, 100, 'leg-test', 1
    );
    expect(out).toEqual({ refUrl: null, refHash: null });
  });

  it('returns nulls for invalid image data instead of throwing', async () => {
    const out = await cropAndSaveSymbol(
      '!!!not-base64!!!', { x: 0, y: 0, width: 50, height: 50 }, 100, 100, 'leg-test', 1
    );
    expect(out).toEqual({ refUrl: null, refHash: null });
  });

  it('returns nulls for zero image dimensions', async () => {
    const out = await cropAndSaveSymbol(
      'AAAA', { x: 0, y: 0, width: 50, height: 50 }, 0, 100, 'leg-test', 1
    );
    expect(out).toEqual({ refUrl: null, refHash: null });
  });
});
