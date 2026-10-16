import {
  calculateAdaptiveTagBBox,
  extractBestTagFromText,
} from '@/lib/ocr-engine';

describe('Adaptive Tag OCR ROI & Tag Extraction', () => {
  const pageW = 2000;
  const pageH = 1500;

  it('calculates expanded adaptive bbox strictly clamped to page bounds', () => {
    const symbolBbox = { x: 100, y: 100, width: 80, height: 80 };
    const expanded = calculateAdaptiveTagBBox(symbolBbox, pageW, pageH, {
      expandX: 50,
      expandY: 70,
    });

    // left: max(0, 100 - 50) = 50
    // top: max(0, 100 - 70) = 30
    // right: min(2000, 100 + 80 + 50) = 230 -> width = 180
    // bottom: min(1500, 100 + 80 + 70) = 250 -> height = 220
    expect(expanded.x).toBe(50);
    expect(expanded.y).toBe(30);
    expect(expanded.width).toBe(180);
    expect(expanded.height).toBe(220);
  });

  it('clamps to zero when symbol is near the top-left boundary', () => {
    const symbolBbox = { x: 20, y: 10, width: 60, height: 60 };
    const expanded = calculateAdaptiveTagBBox(symbolBbox, pageW, pageH, {
      expandX: 50,
      expandY: 50,
    });

    expect(expanded.x).toBe(0);
    expect(expanded.y).toBe(0);
  });

  it('clamps to page limits when symbol is near bottom-right boundary', () => {
    const symbolBbox = { x: 1950, y: 1460, width: 40, height: 30 };
    const expanded = calculateAdaptiveTagBBox(symbolBbox, pageW, pageH, {
      expandX: 60,
      expandY: 60,
    });

    expect(expanded.x + expanded.width).toBe(pageW);
    expect(expanded.y + expanded.height).toBe(pageH);
  });

  it('extracts valid tag token from multiline noisy OCR text', () => {
    const multilineOcr = '3" CS-150\nP-101A\nMOTOR 15kW';
    const tag = extractBestTagFromText(multilineOcr);
    expect(tag).toBe('P-101A');
  });

  it('extracts instrument tag token from noisy OCR text', () => {
    const multilineOcr = 'LINE NO. 401\nXV-2003B\nOPEN';
    const tag = extractBestTagFromText(multilineOcr);
    expect(tag).toBe('XV-2003B');
  });

  it('returns null if text contains no tag pattern', () => {
    const multilineOcr = 'JUST RANDOM NOISE 123 456';
    const tag = extractBestTagFromText(multilineOcr);
    expect(tag).toBeNull();
  });
});
