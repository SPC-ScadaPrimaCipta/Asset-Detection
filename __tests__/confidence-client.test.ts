import { cvConfidence } from '@/lib/detection/scoring/confidence-client';

describe('confidence client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns null without candidateId (no wasted call)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('must not be called'));
    await expect(cvConfidence({ candidateId: '', signals: {} })).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null when the service is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(
      cvConfidence({ candidateId: 'cv-1', signals: { geometryScore: 0.9 } })
    ).resolves.toBeNull();
  });

  it('preserves the full auditable contract', async () => {
    const payload = {
      candidateId: 'cv-042',
      confidence: 0.87,
      decisionBand: 'REVIEW',
      topMatch: { symbolId: 'pump-01', label: 'Pump' },
      margin: 0.21,
      evidence: {
        geometryScore: 0.91, contourScore: 0.84, templateScore: 0.77,
        edgeScore: 0.81, scaleScore: 0.95, rotationScore: 1.0,
        legendMatchScore: 0.86, legendMargin: 0.21,
        tagRecognitionScore: 0.93, spatialAssociationScore: 0.88,
        spatialMargin: 0.28, ambiguityPenalty: 0.0,
        missingEvidencePenalty: 0.0, unavailable: [],
      },
      reasons: ['Top Legend match Pump score=0.860'],
      warnings: [],
      configVersion: 'confidence-v1',
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
    const res = await cvConfidence({
      candidateId: 'cv-042',
      signals: { geometryScore: 0.91 },
      legendMatches: [{ legendSymbolId: 'pump-01', label: 'Pump', score: 0.86 }],
      ocr: { isTag: true, confidence: 0.93 },
    });
    expect(res?.decisionBand).toBe('REVIEW');
    expect(res?.evidence.legendMargin).toBe(0.21);
    expect(res?.evidence.unavailable).toEqual([]);
    expect(res?.topMatch.label).toBe('Pump');
  });
});
