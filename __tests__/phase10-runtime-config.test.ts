import { detectionConfig } from '@/lib/detection/config';

describe('Phase 10 local runtime configuration', () => {
  it('enables the validated deterministic stages and disables Gemini fallback', () => {
    expect(detectionConfig.pipelineVersion).toBe('phase10');
    expect(detectionConfig.aiMode).toBe('disabled');
    expect(detectionConfig.cv.masking).toBe(true);
    expect(detectionConfig.cv.lineSplit).toBe(true);
    expect(detectionConfig.cv.reunion).toBe(true);
    expect(detectionConfig.cv.bboxRefine).toBe(true);
    expect(detectionConfig.cv.matchRepair).toBe(true);
  });
});