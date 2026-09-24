import {
  cvLabelMatch,
  cvLegendExtract,
  cvLegendMatch,
} from '@/lib/detection/legend/legend-client';
import {
  coerceLegendDefinition,
  normalizeLegendLabel,
  summarizeLegendDefinitions,
} from '@/lib/detection/legend/legend-model';

const mockFetch = (payload: unknown, ok = true) =>
  jest.fn().mockResolvedValue({ ok, json: async () => payload });

describe('legend client — graceful degradation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null when the service is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(cvLegendMatch('leg1', 'png', 1, [{ id: 'q', bbox: { x: 1, y: 1, width: 2, height: 2 } }], [])).resolves.toBeNull();
    await expect(cvLegendExtract('leg1', [{ pageNumber: 1, pngBase64: 'png' }])).resolves.toBeNull();
    await expect(cvLabelMatch('Pump', { label: 'Pump', aliases: [] })).resolves.toBeNull();
  });

  it('returns null without a selected legend (matching unavailable)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('must not be called'));
    await expect(cvLegendMatch('', 'png', 1, [{ id: 'q', bbox: { x: 1, y: 1, width: 2, height: 2 } }], [])).resolves.toBeNull();
    await expect(cvLegendExtract('', [{ pageNumber: 1, pngBase64: 'png' }])).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('legend contract — normalization and validation metadata', () => {
  it('normalizes text labels and derives validation status', () => {
    const def = coerceLegendDefinition({
      legendId: 'leg1',
      symbolId: 'sym-1',
      label: '  Gate   Valve  ',
      aliases: ['GATE VALVE'],
      category: '',
      bbox: { x: 10, y: 20, width: 40, height: 30 },
      geometry: { aspectRatio: 1.3, relativeArea: 0.02, width: 40, height: 30 },
      visualFeatures: { huMoments: [1, 2, 3, 4, 5, 6, 7], edgeDensity: 0.5, lineCount: 3, componentCount: 2, contourCount: 1, templateSize: [128, 128] },
      variants: [],
      sourcePage: 3,
      rotationInvariant: false,
      provenance: ['reference-crop:human-reviewed'],
      version: 'v2.0.0',
    });

    expect(normalizeLegendLabel('  Gate   Valve  ')).toBe('gate valve');
    expect(def.normalizedLabel).toBe('gate valve');
    expect(def.classId).toBe('sym-1');
    expect(def.status).toBe('validated');
    expect(def.source?.pageNumber).toBe(3);
  });

  it('summarizes valid, review, rejected, and duplicate class counts', () => {
    const stats = summarizeLegendDefinitions([
      coerceLegendDefinition({ legendId: 'leg1', symbolId: 'sym-1', label: 'Pump', bbox: { x: 1, y: 2, width: 3, height: 4 }, geometry: { aspectRatio: 1, relativeArea: 0.1, width: 3, height: 4 }, visualFeatures: { huMoments: [1, 2, 3, 4, 5, 6, 7], edgeDensity: 0.2, lineCount: 1, componentCount: 1, contourCount: 1, templateSize: [128, 128] }, variants: [], sourcePage: 1, rotationInvariant: false, provenance: [], version: 'v2.0.0', status: 'validated' as const }),
      coerceLegendDefinition({ legendId: 'leg1', symbolId: 'sym-2', label: 'Pump', bbox: { x: 5, y: 6, width: 7, height: 8 }, geometry: { aspectRatio: 1, relativeArea: 0.1, width: 7, height: 8 }, visualFeatures: { huMoments: [1, 2, 3, 4, 5, 6, 7], edgeDensity: 0.2, lineCount: 1, componentCount: 1, contourCount: 1, templateSize: [128, 128] }, variants: [], sourcePage: 1, rotationInvariant: false, provenance: [], version: 'v2.0.0', status: 'review' as const }),
      coerceLegendDefinition({ legendId: 'leg1', symbolId: 'sym-3', label: 'Valve', bbox: { x: 9, y: 10, width: 11, height: 12 }, geometry: { aspectRatio: 1, relativeArea: 0.1, width: 11, height: 12 }, visualFeatures: { huMoments: [1, 2, 3, 4, 5, 6, 7], edgeDensity: 0.2, lineCount: 1, componentCount: 1, contourCount: 1, templateSize: [128, 128] }, variants: [], sourcePage: 1, rotationInvariant: false, provenance: [], version: 'v2.0.0', status: 'rejected' as const }),
    ]);

    expect(stats.validated).toBe(1);
    expect(stats.review).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.uniqueClasses).toBe(2);
    expect(stats.duplicateReferences).toBe(1);
  });
});

describe('legend client — provenance passthrough', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves selectedLegendId and feature evidence', async () => {
    const payload = {
      selectedLegendId: 'leg1',
      results: [{
        candidateId: 'q1',
        matches: [{
          legendSymbolId: 'leg1-sym-0', legendId: 'leg1', selectedLegendId: 'leg1',
          label: 'Pump', variantId: 'v1',
          features: { geometryScore: 1, contourScore: 0.9, templateScore: 0.8, edgeScore: 0.7, scaleScore: 1, rotationScore: 0 },
          score: 0.85, reasons: ['aspect compatibility=1.000'],
        }],
      }],
      instrumentation: { attempted: 4, skippedGeometry: 0, skippedContour: 0, fullComparisons: 4, accepted: 1, timings: {} },
      timings: [], pipelineVersion: 'v2.0.0',
    };
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch(payload));
    const res = await cvLegendMatch('leg1', 'png', 1, [{ id: 'q1', bbox: { x: 1, y: 1, width: 2, height: 2 } }], []);
    expect(res?.results[0].matches[0].selectedLegendId).toBe('leg1');
    expect(res?.results[0].matches[0].features.contourScore).toBe(0.9);
    expect(res?.instrumentation.attempted).toBe(4);
  });

  it('surfaces LEGEND_UNAVAILABLE warning for empty definitions', async () => {
    const payload = {
      selectedLegendId: 'leg1',
      results: [{ candidateId: 'q1', matches: [], warning: 'LEGEND_UNAVAILABLE: no definitions supplied' }],
      instrumentation: { attempted: 0, skippedGeometry: 0, skippedContour: 0, fullComparisons: 0, accepted: 0, timings: {} },
      timings: [], pipelineVersion: 'v2.0.0',
    };
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch(payload));
    const res = await cvLegendMatch('leg1', 'png', 1, [{ id: 'q1', bbox: { x: 1, y: 1, width: 2, height: 2 } }], []);
    expect(res?.results[0].matches).toEqual([]);
    expect(res?.results[0].warning).toMatch(/LEGEND_UNAVAILABLE/);
  });
});
