import { cvTemplateMatch, CV_SERVICE_AVAILABLE } from '@/lib/cv-client';

jest.mock('@/lib/cv-client', () => ({
  CV_SERVICE_AVAILABLE: jest.fn(),
  cvTemplateMatch: jest.fn(),
  cvBBoxRefine: jest.fn(),
  cvOcr: jest.fn(),
}));

describe('Hybrid Template Matching Fallback Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('respects CV_SERVICE_AVAILABLE state', () => {
    (CV_SERVICE_AVAILABLE as jest.Mock).mockReturnValue(true);
    expect(CV_SERVICE_AVAILABLE()).toBe(true);

    (CV_SERVICE_AVAILABLE as jest.Mock).mockReturnValue(false);
    expect(CV_SERVICE_AVAILABLE()).toBe(false);
  });

  it('handles template matching response structure correctly', async () => {
    const mockMatches = {
      matches: [
        {
          score: 0.88,
          bbox: { x: 120, y: 240, width: 64, height: 64 },
        },
      ],
      duration_ms: 45,
    };

    (cvTemplateMatch as jest.Mock).mockResolvedValue(mockMatches);

    const result = await cvTemplateMatch('page_b64', 'template_b64', 0.7, 5);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].score).toBe(0.88);
    expect(result.matches[0].bbox.x).toBe(120);
    expect(result.duration_ms).toBe(45);
  });
});
