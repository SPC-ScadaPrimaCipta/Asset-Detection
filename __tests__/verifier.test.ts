import {
  clearVerifierCache,
  createVerifierSession,
  enforceLegendLock,
  type VerifierRequest,
} from '@/lib/detection/ai/verifier';
import { buildVerifierPrompt } from '@/lib/detection/ai/verifier-prompt';

const det = (over: Record<string, unknown> = {}) => ({
  confidence: 0.72,
  decisionBand: 'REVIEW' as const,
  topLabel: 'Pump',
  topSymbolId: 'pump-01',
  margin: 0.2,
  reasons: ['Top Legend match Pump score=0.860'],
  configVersion: 'confidence-v1',
  ...over,
});

const req = (over: Partial<VerifierRequest> = {}): VerifierRequest => ({
  candidateId: 'cv-042',
  pageId: 'page-1',
  deterministic: det(),
  ocr: { rawText: 'P-101A', normalizedText: 'P-101A', isTag: true },
  selectedLegend: {
    legendId: 'leg1',
    version: 'legend-v1',
    labels: [
      { symbolId: 'pump-01', label: 'Pump' },
      { symbolId: 'valve-02', label: 'Valve' },
    ],
  },
  crops: {
    candidateCropB64: 'AAA',
    contextCropB64: 'BBB',
    tagCropB64: null,
    legendRefB64: null,
    cropHash: 'hash-1',
  },
  ...over,
});

const CONFIRM_JSON = JSON.stringify({
  verdict: 'CONFIRM',
  suggestedSymbolId: 'pump-01',
  suggestedLabel: 'Pump',
  confidence: 0.98,
  reasonCodes: ['VISUAL_MATCH', 'LEGEND_CONSISTENT'],
  explanation: 'Crop clearly shows the pump symbol matching the legend reference.',
  uncertainties: [],
  needsHumanReview: false,
});

const transportOk = (text: string = CONFIRM_JSON) =>
  jest.fn().mockResolvedValue({ text, model: 'gemini-test' });

beforeEach(() => clearVerifierCache());

describe('routing (Gemini is fallback intelligence, not the pipeline)', () => {
  it('HIGH → no call, CONTINUE', async () => {
    const t = transportOk();
    const s = createVerifierSession({}, t);
    const out = await s.verify(req({ deterministic: det({ decisionBand: 'HIGH', confidence: 0.95 }) }));
    expect(t).not.toHaveBeenCalled();
    expect(out.gemini.called).toBe(false);
    expect(out.finalRouting).toBe('CONTINUE');
    expect(s.stats().skipped).toBe(1);
  });

  it('REVIEW → calls Gemini, routes HUMAN_REVIEW (no auto-accept even at 0.98)', async () => {
    const s = createVerifierSession({}, transportOk());
    const out = await s.verify(req());
    expect(out.gemini.called).toBe(true);
    expect(out.gemini.verdict).toBe('CONFIRM');
    expect(out.finalRouting).toBe('HUMAN_REVIEW');
  });

  it('LOW → skipped by default; called only when verifyLowBand enabled', async () => {
    const t = transportOk();
    const s = createVerifierSession({}, t);
    const out = await s.verify(req({ deterministic: det({ decisionBand: 'LOW', confidence: 0.4 }) }));
    expect(t).not.toHaveBeenCalled();
    expect(out.finalRouting).toBe('HUMAN_REVIEW');

    const t2 = transportOk();
    const s2 = createVerifierSession({ verifyLowBand: true }, t2);
    const out2 = await s2.verify(req({ deterministic: det({ decisionBand: 'LOW', confidence: 0.4 }) }));
    expect(t2).toHaveBeenCalledTimes(1);
    expect(out2.finalRouting).toBe('HUMAN_REVIEW');
  });
});

describe('budget + cache', () => {
  it('never exceeds maxCallsPerPage', async () => {
    const t = transportOk();
    const s = createVerifierSession({ maxCallsPerPage: 2 }, t);
    for (let i = 0; i < 4; i++) {
      await s.verify(req({ candidateId: `cv-${i}`, crops: { candidateCropB64: 'A', contextCropB64: 'B', cropHash: `h${i}` } }));
    }
    expect(t).toHaveBeenCalledTimes(2);
    expect(s.stats().calls).toBe(2);
    expect(s.stats().skipped).toBe(2);
  });

  it('same crop never re-verified (cache dedup)', async () => {
    const t = transportOk();
    const s = createVerifierSession({}, t);
    await s.verify(req());
    await s.verify(req());
    expect(t).toHaveBeenCalledTimes(1);
    expect(s.stats().cacheHits).toBe(1);
  });
});

describe('structured validation + legend lock', () => {
  it('invalid JSON → failed, deterministic preserved', async () => {
    const s = createVerifierSession({}, transportOk('Looks like a pump.'));
    const out = await s.verify(req());
    expect(out.gemini.status).toBe('failed');
    expect(out.gemini.failureReason).toMatch(/invalid_json/);
    expect(out.deterministic.confidence).toBe(0.72);
    expect(out.deterministic.topLabel).toBe('Pump');
    expect(out.finalRouting).toBe('HUMAN_REVIEW');
  });

  it('schema violation → failed with reason', async () => {
    const s = createVerifierSession({}, transportOk(JSON.stringify({ verdict: 'MAYBE' })));
    const out = await s.verify(req());
    expect(out.gemini.status).toBe('failed');
    expect(out.gemini.failureReason).toMatch(/schema_mismatch/);
  });

  it('invented label (Compressor) → coerced UNKNOWN + UNCERTAIN', async () => {
    const bad = JSON.stringify({
      verdict: 'CORRECT', suggestedSymbolId: 'comp-99', suggestedLabel: 'Compressor',
      confidence: 0.9, reasonCodes: ['VISUAL_MATCH'],
      explanation: 'Looks like a compressor.', uncertainties: [], needsHumanReview: false,
    });
    const s = createVerifierSession({}, transportOk(bad));
    const out = await s.verify(req());
    expect(out.gemini.status).toBe('success');
    expect(out.gemini.suggestedLabel).toBe('UNKNOWN');
    expect(out.gemini.verdict).toBe('UNCERTAIN');
    expect(out.gemini.coerced).toBe(true);
    expect(out.gemini.reasonCodes).toContain('NOT_IN_SELECTED_LEGEND');
  });

  it('CORRECT with valid in-legend label passes through', async () => {
    const good = JSON.stringify({
      verdict: 'CORRECT', suggestedSymbolId: 'valve-02', suggestedLabel: 'Valve',
      confidence: 0.82, reasonCodes: ['VISUAL_MISMATCH', 'LEGEND_CONSISTENT'],
      explanation: 'Bowtie shape matches Valve reference.', uncertainties: [], needsHumanReview: true,
    });
    const s = createVerifierSession({}, transportOk(good));
    const out = await s.verify(req());
    expect(out.gemini.verdict).toBe('CORRECT');
    expect(out.gemini.suggestedLabel).toBe('Valve');
    expect(out.gemini.coerced).toBe(false);
  });
});

describe('failure isolation', () => {
  it('429 → rate_limit reason, deterministic intact', async () => {
    const t = jest.fn().mockRejectedValue(new Error('429 quota exceeded'));
    const s = createVerifierSession({}, t);
    const out = await s.verify(req());
    expect(out.gemini.status).toBe('failed');
    expect(out.gemini.failureReason).toMatch(/rate_limit/);
    expect(out.deterministic.confidence).toBe(0.72);
  });

  it('timeout → timeout reason', async () => {
    const t = jest.fn().mockRejectedValue(new Error('gemini timeout'));
    const s = createVerifierSession({}, t);
    const out = await s.verify(req());
    expect(out.gemini.failureReason).toMatch(/timeout/);
  });
});

describe('no-overwrite guarantee', () => {
  it('deterministic echo is byte-identical after CORRECT', async () => {
    const good = JSON.stringify({
      verdict: 'CORRECT', suggestedSymbolId: 'valve-02', suggestedLabel: 'Valve',
      confidence: 0.81, reasonCodes: ['VISUAL_MISMATCH'],
      explanation: 'More consistent with Valve.', uncertainties: [], needsHumanReview: true,
    });
    const s = createVerifierSession({}, transportOk(good));
    const before = det();
    const out = await s.verify(req({ deterministic: before }));
    expect(out.deterministic).toEqual(before);
    expect(out.deterministic.confidence).toBe(0.72); // NOT 0.81
    expect(out.deterministic.topLabel).toBe('Pump'); // NOT Valve
  });
});

describe('enforceLegendLock unit', () => {
  const labels = [{ symbolId: 'pump-01', label: 'Pump' }];
  const base = {
    verdict: 'CONFIRM' as const, suggestedSymbolId: 'pump-01', suggestedLabel: 'Pump',
    confidence: 0.9, reasonCodes: ['VISUAL_MATCH' as const],
    explanation: 'ok', uncertainties: [], needsHumanReview: false,
  };
  it('passes valid labels untouched', () => {
    expect(enforceLegendLock(base, labels).coerced).toBe(false);
  });
  it('allows explicit UNKNOWN', () => {
    const { payload, coerced } = enforceLegendLock(
      { ...base, verdict: 'UNCERTAIN', suggestedSymbolId: null, suggestedLabel: 'UNKNOWN',
        reasonCodes: ['NOT_IN_SELECTED_LEGEND' as const] }, labels);
    expect(coerced).toBe(false);
    expect(payload.suggestedLabel).toBe('UNKNOWN');
  });
});

describe('prompt rules', () => {
  it('encodes tag≠type and closed-legend rules', () => {
    const p = buildVerifierPrompt({
      candidateId: 'cv-1',
      deterministic: { confidence: 0.7, decisionBand: 'REVIEW', topLabel: 'Pump', topSymbolId: 'pump-01', margin: 0.2, reasons: [] },
      ocr: { rawText: 'P-101', normalizedText: 'P-101', isTag: true },
      selectedLegendLabels: [{ symbolId: 'pump-01', label: 'Pump' }],
    });
    expect(p).toMatch(/NEVER decides the symbol type/);
    expect(p).toMatch(/MUST be one of the labels above, or "UNKNOWN"/);
    expect(p).toMatch(/NEVER invent labels/);
    expect(p).toMatch(/"UNKNOWN"/);
  });
});
