import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/legends/[id]/symbols/[symbolId]/recrop/route';

const mockQuery = jest.fn();
const mockGetFile = jest.fn();
const mockSaveFile = jest.fn();
const mockDeleteFile = jest.fn();
const mockRenderPageToPng = jest.fn();
const mockCropPageRegion = jest.fn();
const mockHashImage = jest.fn();

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));
jest.mock('@/lib/storage', () => ({
  getFile: (...args: unknown[]) => mockGetFile(...args),
  saveFile: (...args: unknown[]) => mockSaveFile(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));
jest.mock('@/lib/pdf-render', () => ({
  renderPageToPng: (...args: unknown[]) => mockRenderPageToPng(...args),
}));
jest.mock('@/lib/image-crop', () => ({
  cropPageRegion: (...args: unknown[]) => mockCropPageRegion(...args),
}));
jest.mock('@/lib/symbol-cache', () => ({
  hashImage: (...args: unknown[]) => mockHashImage(...args),
}));

const currentSymbol = {
  id: 'sym-1',
  legend_id: 'leg-1',
  asset_type: 'Valve',
  symbol_name: 'Gate Valve',
  tag_pattern: 'VLV-*',
  description: null,
  aliases: [],
  status: 'ACTIVE',
  pid_page: 1,
  reference_image_url: 'legend-leg-1-p1-oldhash123.png',
  reference_crop_hash: 'oldhash123',
};

function request() {
  return {
    json: jest.fn().mockResolvedValue({
      bbox_x: 10,
      bbox_y: 20,
      bbox_w: 100,
      bbox_h: 80,
    }),
  } as unknown as NextRequest;
}

const params = Promise.resolve({ id: 'leg-1', symbolId: 'sym-1' });

describe('legend recrop replacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFile.mockResolvedValue(Buffer.from('pdf'));
    mockRenderPageToPng.mockResolvedValue({
      png: Buffer.from('png'),
      width: 1000,
      height: 800,
    });
    mockCropPageRegion.mockResolvedValue(Buffer.from('crop').toString('base64'));
    mockHashImage.mockReturnValue('newhash456789');
    mockSaveFile.mockResolvedValue(undefined);
    mockDeleteFile.mockResolvedValue(undefined);
  });

  it('replaces the previous crop file after updating the same symbol row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [currentSymbol] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...currentSymbol, reference_image_url: 'legend-leg-1-p1-newhash45678.png' }] });

    const res = await POST(request(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      replaced: true,
      symbol: { ...currentSymbol, reference_image_url: 'legend-leg-1-p1-newhash45678.png' },
    });
    expect(mockSaveFile).toHaveBeenCalledWith(
      'legend-leg-1-p1-newhash45678.png',
      expect.any(Buffer)
    );
    expect(mockDeleteFile).toHaveBeenCalledWith('legend-leg-1-p1-oldhash123.png');
    expect(body.symbol.id).toBe('sym-1');
    expect(
      mockQuery.mock.calls.some(([text]) => String(text).includes('INSERT INTO legend_symbols'))
    ).toBe(false);
  });

  it('does not delete when the replacement resolves to the same file', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...currentSymbol, reference_image_url: 'legend-leg-1-p1-newhash45678.png' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [currentSymbol] });

    const res = await POST(request(), { params });

    expect(res.status).toBe(200);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('never deletes a previous path outside the legend crop namespace', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...currentSymbol, reference_image_url: '../outside.png' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [currentSymbol] });

    const res = await POST(request(), { params });

    expect(res.status).toBe(200);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
