import { computeTileGrid } from '@/lib/pdf-render';
import { tileToPage } from '@/lib/detection/geometry/coordinate-transform';

describe('computeTileGrid — single tile', () => {
  it('returns one tile covering a small page', () => {
    const tiles = computeTileGrid(800, 600, 1280, 0.2);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ tileX: 0, tileY: 0, width: 800, height: 600 });
  });
});

describe('computeTileGrid — multiple horizontal tiles', () => {
  it('splits a wide page into overlapping columns', () => {
    // page 3000px, tile 1280, overlap 0.2 → step 1024 → cols = ceil((3000-1280)/1024)+1 = 3
    const tiles = computeTileGrid(3000, 600, 1280, 0.2);
    expect(tiles.length).toBe(3);
    // consecutive tiles overlap
    expect(tiles[1].tileX).toBeLessThan(tiles[0].tileX + tiles[0].width);
    // last tile snaps to right edge
    const last = tiles[tiles.length - 1];
    expect(last.tileX + last.width).toBe(3000);
  });
});

describe('computeTileGrid — multiple vertical tiles', () => {
  it('splits a tall page into overlapping rows', () => {
    const tiles = computeTileGrid(800, 3000, 1280, 0.2);
    expect(tiles.length).toBe(3);
    expect(tiles[1].tileY).toBeLessThan(tiles[0].tileY + tiles[0].height);
    const last = tiles[tiles.length - 1];
    expect(last.tileY + last.height).toBe(3000);
  });
});

describe('computeTileGrid — edge tiles', () => {
  it('covers full page: union of tiles spans [0,W]x[0,H]', () => {
    const W = 5100;
    const H = 3600;
    const tiles = computeTileGrid(W, H, 1280, 0.2);
    expect(tiles.length).toBeGreaterThan(1);
    const minX = Math.min(...tiles.map((t) => t.tileX));
    const minY = Math.min(...tiles.map((t) => t.tileY));
    const maxX = Math.max(...tiles.map((t) => t.tileX + t.width));
    const maxY = Math.max(...tiles.map((t) => t.tileY + t.height));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(maxX).toBe(W);
    expect(maxY).toBe(H);
    // every tile stays inside the page
    for (const t of tiles) {
      expect(t.tileX).toBeGreaterThanOrEqual(0);
      expect(t.tileY).toBeGreaterThanOrEqual(0);
      expect(t.tileX + t.width).toBeLessThanOrEqual(W);
      expect(t.tileY + t.height).toBeLessThanOrEqual(H);
    }
  });
});

describe('computeTileGrid — non-divisible dimensions', () => {
  it('handles page sizes that are not multiples of step', () => {
    const tiles = computeTileGrid(2000, 1500, 1280, 0.2);
    const maxX = Math.max(...tiles.map((t) => t.tileX + t.width));
    const maxY = Math.max(...tiles.map((t) => t.tileY + t.height));
    expect(maxX).toBe(2000);
    expect(maxY).toBe(1500);
  });
});

describe('tile → page bbox conversion', () => {
  it('maps a tile-local box to exact page coordinates', () => {
    const tiles = computeTileGrid(3000, 600, 1280, 0.2);
    const t = tiles[1]; // tileX = 1024
    const pageBox = tileToPage({ x: 50, y: 60, width: 96, height: 88 }, { x: t.tileX, y: t.tileY });
    expect(pageBox).toEqual({ x: t.tileX + 50, y: t.tileY + 60, width: 96, height: 88 });
    // result lies inside the page
    expect(pageBox.x + pageBox.width).toBeLessThanOrEqual(3000);
  });
});
