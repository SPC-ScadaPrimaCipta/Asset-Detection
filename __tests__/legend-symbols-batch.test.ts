import { PUT } from '@/app/api/legends/[id]/symbols/batch/route';
import { NextRequest } from 'next/server';
import db from '@/lib/db';

jest.mock('@/lib/db', () => ({
  query: jest.fn(),
}));

describe('Batch Symbol Tag Pattern API', () => {
  const legendId = '11111111-1111-1111-1111-111111111111';
  const symbolId1 = '22222222-2222-2222-2222-222222222222';
  const symbolId2 = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects update if legend is not found', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const req = new NextRequest(`http://localhost:3000/api/legends/${legendId}/symbols/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: symbolId1, tag_pattern: 'GTV-###' }],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: legendId }) });
    expect(res.status).toBe(404);
  });

  it('rejects update if legend is built-in', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: legendId, is_builtin: true }] });

    const req = new NextRequest(`http://localhost:3000/api/legends/${legendId}/symbols/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: symbolId1, tag_pattern: 'GTV-###' }],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: legendId }) });
    expect(res.status).toBe(403);
  });

  it('updates valid tag patterns across multiple symbols', async () => {
    (db.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: legendId, is_builtin: false }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const req = new NextRequest(`http://localhost:3000/api/legends/${legendId}/symbols/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { id: symbolId1, tag_pattern: 'GTV-###' },
          { id: symbolId2, tag_pattern: 'BV-###' },
        ],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: legendId }) });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.updatedCount).toBe(2);
  });
});
