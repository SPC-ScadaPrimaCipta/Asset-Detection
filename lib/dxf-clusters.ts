/**
 * DXF Symbol Stroke Clustering (Vector-native Lap-1, Blok 2.1)
 *
 * Equipment symbols in XREF-bound P&ID drawings are raw vector strokes
 * (LINE / LWPOLYLINE / ARC / CIRCLE / ELLIPSE) — not block references.
 * Instead of grabbing "whatever geometry is near a tag" (radius-grab → pipe
 * segments → sliver bboxes), cluster TOUCHING strokes via union-find and use
 * each cluster's exact hull as the symbol bbox.
 *
 * Excluded up-front (never cluster members):
 *   - pipe / ignore / title layers (pipes would merge whole networks,
 *     title frames would merge whole sheets)
 *   - very long segments (>8% of scope span — borders, grid lines, pipe runs)
 *
 * Deterministic, no I/O, no AI calls.
 */

import {
  getLayerProfile,
  type LayerProfile,
} from '@/lib/dxf-detection';
import type {
  DxfEntity,
  DxfPageExtents,
  DxfPoint,
} from '@/lib/dxf-parser';

export interface SymbolCluster {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Center in DXF world units (for tag association). */
  cx: number;
  cy: number;
  /** Number of stroke items merged. */
  members: number;
  /** Most frequent layer among members (for evidence). */
  topLayer: string;
}

interface StrokeItem {
  /** Representative contact points (endpoints, cardinal points). */
  pts: DxfPoint[];
  /** Full AABB of the item (for hull). */
  minX: number; minY: number; maxX: number; maxY: number;
  layer: string;
}

function expandHull(
  h: { minX: number; minY: number; maxX: number; maxY: number },
  x: number, y: number,
) {
  if (x < h.minX) h.minX = x;
  if (y < h.minY) h.minY = y;
  if (x > h.maxX) h.maxX = x;
  if (y > h.maxY) h.maxY = y;
}

function itemOfSeg(ax: number, ay: number, bx: number, by: number, layer: string): StrokeItem {
  return {
    pts: [{ x: ax, y: ay }, { x: bx, y: by }],
    minX: Math.min(ax, bx), minY: Math.min(ay, by),
    maxX: Math.max(ax, bx), maxY: Math.max(ay, by),
    layer,
  };
}

/** Flatten entities into clusterable stroke items (null = excluded). */
function toStrokeItems(
  entities: DxfEntity[],
  scopeSpan: number,
  isExcluded: (layer: string) => boolean,
): StrokeItem[] {
  const out: StrokeItem[] = [];
  const maxSegLen = scopeSpan * 0.08;
  for (const e of entities) {
    if (isExcluded(e.layer)) continue;
    if (e.kind === 'LINE') {
      const len = Math.hypot(e.start.x - e.end.x, e.start.y - e.end.y);
      if (len > maxSegLen || len <= 0) continue;
      out.push(itemOfSeg(e.start.x, e.start.y, e.end.x, e.end.y, e.layer));
    } else if (e.kind === 'LWPOLYLINE') {
      const vs = e.vertices;
      for (let i = 0; i + 1 < vs.length; i++) {
        const a = vs[i], b = vs[i + 1];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        if (len > maxSegLen || len <= 0) continue;
        out.push(itemOfSeg(a.x, a.y, b.x, b.y, e.layer));
      }
      if (e.closed && vs.length > 2) {
        const a = vs[vs.length - 1], b = vs[0];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        if (len <= maxSegLen && len > 0) out.push(itemOfSeg(a.x, a.y, b.x, b.y, e.layer));
      }
    } else if (e.kind === 'CIRCLE' || e.kind === 'ARC') {
      const r = e.radius;
      if (r <= 0 || r > maxSegLen) continue;
      const c = e.center;
      out.push({
        pts: [
          { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y },
          { x: c.x, y: c.y - r }, { x: c.x, y: c.y + r },
        ],
        minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r,
        layer: e.layer,
      });
    } else if (e.kind === 'ELLIPSE') {
      const r = e.majorAxisLength;
      if (r <= 0 || r > maxSegLen) continue;
      const c = e.center;
      const minor = r * e.minorAxisRatio;
      out.push({
        pts: [
          { x: c.x - r, y: c.y }, { x: c.x + r, y: c.y },
          { x: c.x, y: c.y - minor }, { x: c.x, y: c.y + minor },
        ],
        minX: c.x - r, minY: c.y - minor, maxX: c.x + r, maxY: c.y + minor,
        layer: e.layer,
      });
    } else if (e.kind === 'SPLINE') {
      const ps = e.controlPoints;
      for (let i = 0; i + 1 < ps.length; i++) {
        const a = ps[i], b = ps[i + 1];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        if (len > maxSegLen || len <= 0) continue;
        out.push(itemOfSeg(a.x, a.y, b.x, b.y, e.layer));
      }
    }
    // INSERT / TEXT / MTEXT / ATTDEF are not strokes — skipped.
  }
  return out;
}

/**
 * Cluster touching strokes. Contact tolerance scales with local text size
 * (symbol gaps are drawn relative to label size), bounded by span fractions.
 */
export function clusterSymbolGeometry(
  entities: DxfEntity[],
  scopeExtents: DxfPageExtents,
  lookup: Map<string, LayerProfile>,
  medianTextHeight?: number,
): SymbolCluster[] {
  const span = Math.max(scopeExtents.width, scopeExtents.height);
  if (span <= 0) return [];
  const isExcluded = (layer: string): boolean => {
    const cat = getLayerProfile(layer, lookup).category;
    return cat === 'pipe' || cat === 'ignore' || cat === 'title';
  };
  const items = toStrokeItems(entities, span, isExcluded);
  if (items.length === 0) return [];

  const tol = Math.min(
    Math.max(medianTextHeight ? medianTextHeight * 1.5 : span * 0.01, span * 0.002),
    span * 0.03,
  );

  // Union-find with spatial grid hashing for near-linear performance.
  const parent = items.map((_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) { const n = parent[a]; parent[a] = r; a = n; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const cell = Math.max(tol, span * 0.001);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  items.forEach((it, idx) => {
    for (const p of it.pts) {
      const k = key(p.x, p.y);
      const arr = grid.get(k);
      if (arr) arr.push(idx); else grid.set(k, [idx]);
    }
  });

  const tol2 = tol * tol;
  items.forEach((it, idx) => {
    for (const p of it.pts) {
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = grid.get(`${gx + dx},${gy + dy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= idx) continue; // each pair once
            const o = items[j];
            // AABB pre-check (expanded by tol) before point math
            if (o.minX - tol > it.maxX + tol || o.maxX + tol < it.minX - tol) {
              // still need point check — skip only if far on both axes
              if (o.minY - tol > it.maxY + tol || o.maxY + tol < it.minY - tol) continue;
            }
            let touch = false;
            for (const a of it.pts) {
              for (const b of o.pts) {
                const ddx = a.x - b.x, ddy = a.y - b.y;
                if (ddx * ddx + ddy * ddy <= tol2) { touch = true; break; }
              }
              if (touch) break;
            }
            if (touch) union(idx, j);
          }
        }
      }
    }
  });

  // Aggregate hulls per root
  const groups = new Map<number, { hull: { minX: number; minY: number; maxX: number; maxY: number }; members: number; layers: Map<string, number> }>();
  items.forEach((it, idx) => {
    const r = find(idx);
    let g = groups.get(r);
    if (!g) {
      g = {
        hull: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        members: 0, layers: new Map(),
      };
      groups.set(r, g);
    }
    expandHull(g.hull, it.minX, it.minY);
    expandHull(g.hull, it.maxX, it.maxY);
    g.members++;
    g.layers.set(it.layer, (g.layers.get(it.layer) ?? 0) + 1);
  });

  const clusters: SymbolCluster[] = [];
  for (const g of groups.values()) {
    // Single stray segment = noise. Single circle/arc counts (members counts
    // items, and circles are 1 item) — keep clusters with ≥2 items OR any
    // cluster whose hull is non-degenerate and reasonably sized.
    if (g.members < 2) continue;
    const w = g.hull.maxX - g.hull.minX, h = g.hull.maxY - g.hull.minY;
    if (w <= 0 || h <= 0) continue;
    // Compactness: pipe runs that slipped through are long-thin.
    if (Math.max(w, h) / Math.min(w, h) > 8) continue;
    // Size sanity vs scope: not dust, not sheet-sized.
    const biggest = Math.max(w, h);
    if (biggest < span * 0.001 || biggest > span * 0.35) continue;
    let topLayer = '', topN = 0;
    for (const [l, n] of g.layers) {
      if (n > topN) { topN = n; topLayer = l; }
    }
    clusters.push({
      minX: g.hull.minX, minY: g.hull.minY,
      maxX: g.hull.maxX, maxY: g.hull.maxY,
      cx: (g.hull.minX + g.hull.maxX) / 2,
      cy: (g.hull.minY + g.hull.maxY) / 2,
      members: g.members,
      topLayer,
    });
  }
  return clusters;
}

/** Nearest cluster centroid to a point within maxDist (DXF world units). */
export function nearestCluster(
  clusters: SymbolCluster[],
  pos: DxfPoint,
  maxDist: number,
): SymbolCluster | null {
  let best: SymbolCluster | null = null;
  let bestD = Infinity;
  for (const c of clusters) {
    const d = Math.hypot(c.cx - pos.x, c.cy - pos.y);
    if (d <= maxDist && d < bestD) { bestD = d; best = c; }
  }
  return best;
}
