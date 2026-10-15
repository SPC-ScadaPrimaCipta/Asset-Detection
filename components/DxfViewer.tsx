'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { DxfViewer as DxfViewerEngine, type LayerInfo } from 'dxf-viewer';
import { ArrowsOutSimple, Eye, EyeSlash, MagnifyingGlassPlus, MagnifyingGlassMinus } from '@phosphor-icons/react';

// ── Bbox color — matches cadBboxColor in detection/page.tsx ──────────────────
function bboxColor(d: { review_status: string; confidence: number | null }): string {
  if (d.review_status === 'APPROVED') return '#00e676';
  if (d.review_status === 'REJECTED') return '#ff5252';
  const conf = d.confidence ?? 0;
  if (conf >= 0.9) return '#00bcd4';
  if (conf >= 0.7) return '#ffd600';
  return '#ff6d00';
}

export interface DxfViewerProps {
  url: string;
  detections?: Array<{
    id: string;
    asset_tag: string | null;
    asset_type: string;
    confidence: number | null;
    bbox_x: number | null;
    bbox_y: number | null;
    bbox_w: number | null;
    bbox_h: number | null;
    detection_status: string;
    review_status: string;
  }>;
  selectedId?: string | null;
  onSelectAsset?: (id: string) => void;
  showAll?: boolean;
  /** Sheet regions (world units) for sheet navigation. Omit = whole-file view. */
  regions?: Array<{
    pidPage: number;
    entityCount: number;
    extents: { minX: number; minY: number; maxX: number; maxY: number };
  }>;
  /** Active sheet to fit (pidPage). Null/undefined = no forced fit. */
  activeSheet?: number | null;
  className?: string;
  style?: React.CSSProperties;
}

export default function DxfViewer({
  url,
  detections = [],
  selectedId = null,
  onSelectAsset,
  showAll = true,
  regions = [],
  activeSheet = null,
  className,
  style,
}: DxfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const viewerRef    = useRef<DxfViewerEngine | null>(null);
  // Ref ke drawOverlay terbaru — Subscribe('viewChanged') di bawah memakai ref
  // ini agar tidak mengikat closure basi (bbox lama / showAll lama).
  const drawOverlayRef = useRef<() => void>(() => {});

  const [loading, setLoading]       = useState(true);
  const [loadPhase, setLoadPhase]   = useState<string>('Loading...');
  const [loadPercent, setLoadPercent] = useState<number>(0);
  const [error, setError]           = useState<string | null>(null);
  const [layers, setLayers]         = useState<LayerInfo[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Map DXF world coord → overlay canvas pixel via current camera. */
  const worldToCanvas = useCallback(
    (wx: number, wy: number, cw: number, ch: number): { x: number; y: number } => {
      const viewer = viewerRef.current;
      if (!viewer) return { x: 0, y: 0 };
      const origin = viewer.GetOrigin();
      const cam = viewer.GetCamera() as THREE.OrthographicCamera | null;
      if (!origin || !cam) return { x: 0, y: 0 };
      const v = new THREE.Vector3(wx - origin.x, wy - origin.y, 0);
      v.project(cam);
      return { x: ((v.x + 1) / 2) * cw, y: ((1 - v.y) / 2) * ch };
    },
    [],
  );

  /** Get valid detections to render based on showAll / selectedId. */
  const getVisible = useCallback(() => {
    const list = showAll
      ? detections
      : detections.filter((d) => d.id === selectedId);
    return list.filter(
      (d) =>
        d.detection_status !== 'REJECTED' &&
        d.review_status    !== 'REJECTED' &&
        d.bbox_x !== null && d.bbox_y !== null &&
        d.bbox_w !== null && d.bbox_h !== null,
    );
  }, [detections, selectedId, showAll]);

  // ── Draw overlay ─────────────────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const viewer = viewerRef.current;
    const canvas = overlayRef.current;
    if (!viewer || !canvas || loading) return;

    const bounds = viewer.GetBounds();
    if (!bounds) return;

    const webglCanvas = viewer.GetCanvas();
    if (!webglCanvas) return;

    const cw = webglCanvas.clientWidth  || webglCanvas.width;
    const ch = webglCanvas.clientHeight || webglCanvas.height;
    if (cw === 0 || ch === 0) return;

    // Skala DPR agar garis tidak blur dan hit-test presisi di layar retina.
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const pxW = Math.round(cw * dpr), pxH = Math.round(ch * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width  = pxW;
      canvas.height = pxH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    if (spanX <= 0 || spanY <= 0) return;

    const visible = getVisible();
    // Draw non-selected first so selected renders on top
    const sorted = [...visible].sort((a, b) =>
      a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0,
    );

    for (const d of sorted) {
      const isSelected = d.id === selectedId;
      const color = bboxColor(d);

      // 0-1000 → DXF world
      const wx1 = bounds.minX + ((d.bbox_x  ?? 0) / 1000) * spanX;
      const wy1 = bounds.maxY - ((d.bbox_y  ?? 0) / 1000) * spanY;
      const wx2 = bounds.minX + (((d.bbox_x ?? 0) + (d.bbox_w ?? 0)) / 1000) * spanX;
      const wy2 = bounds.maxY - (((d.bbox_y ?? 0) + (d.bbox_h ?? 0)) / 1000) * spanY;

      const tl = worldToCanvas(wx1, wy1, cw, ch);
      const br = worldToCanvas(wx2, wy2, cw, ch);

      const rx = Math.min(tl.x, br.x);
      const ry = Math.min(tl.y, br.y);
      const rw = Math.abs(br.x - tl.x);
      const rh = Math.abs(br.y - tl.y);
      if (rw < 2 || rh < 2) continue;

      ctx.save();

      // Fill (selected only)
      if (isSelected) {
        ctx.fillStyle = color + '28';
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, 3);
        ctx.fill();
      }

      // Border
      ctx.strokeStyle = color;
      ctx.lineWidth   = isSelected ? 2.5 : 1.5;
      ctx.globalAlpha = isSelected ? 1.0 : 0.82;
      if (!isSelected) ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 3);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const label    = (d.asset_tag ?? d.asset_type).slice(0, 18);
      const fontSize = isSelected ? 13 : 11;
      ctx.font       = `${isSelected ? 700 : 500} ${fontSize}px ui-monospace, monospace`;
      const textW    = ctx.measureText(label).width + 8;
      const textH    = fontSize + 6;
      const labelY   = ry > textH + 2 ? ry - textH - 2 : ry + rh + 2;

      ctx.globalAlpha = isSelected ? 1.0 : 0.82;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.roundRect(rx, labelY, textW, textH, 3);
      ctx.fill();

      ctx.globalAlpha = 1.0;
      ctx.fillStyle   = '#ffffff';
      ctx.fillText(label, rx + 4, labelY + fontSize);

      ctx.restore();
    }
  }, [detections, selectedId, showAll, loading, worldToCanvas, getVisible]);

  // Selalu tunjuk ke implementasi terbaru (lawan closure basi).
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  // ── Initialize viewer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    if (viewerRef.current) {
      try { viewerRef.current.Destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
    }

    setLoading(true);
    setError(null);
    setLoadPhase('Initializing WebGL CAD viewer...');
    setLoadPercent(0);

    let viewer: DxfViewerEngine | null = null;
    let isCancelled = false;
    let onResize: (() => void) | null = null;

    try {
      viewer = new DxfViewerEngine(containerRef.current, {
        autoResize:       true,
        clearColor:       new THREE.Color(0x161719),
        colorCorrection:  true,
        antialias:        true,
      });
      viewerRef.current = viewer;

      // Redraw overlay on every camera change — via ref (selalu versi terbaru).
      viewer.Subscribe('viewChanged', () => drawOverlayRef.current());
      // Redraw saat container di-resize (canvas WebGL berubah ukuran).
      onResize = () => drawOverlayRef.current();
      window.addEventListener('resize', onResize);

      // Click hit-test via pointerdown + pointerup pair to distinguish click from pan.
      // We record the pointerdown position; if pointerup is within 5px, treat as click.
      let pdX = 0, pdY = 0;

      viewer.Subscribe('pointerdown', (e: { canvasCoord: { x: number; y: number } }) => {
        pdX = e.canvasCoord.x;
        pdY = e.canvasCoord.y;
      });

      viewer.Subscribe('pointerup', (e: { canvasCoord: { x: number; y: number } }) => {
        if (!onSelectAsset) return;
        // Only treat as click if pointer barely moved (not a pan drag)
        const dx = Math.abs(e.canvasCoord.x - pdX);
        const dy = Math.abs(e.canvasCoord.y - pdY);
        if (dx > 5 || dy > 5) return;

        const canvas = overlayRef.current;
        if (!canvas) return;
        const v = viewerRef.current;
        if (!v) return;
        const bounds = v.GetBounds();
        if (!bounds) return;
        // Pakai CSS px (clientWidth), bukan backing store (sudah dikali DPR).
        const cw = canvas.clientWidth || canvas.width;
        const ch = canvas.clientHeight || canvas.height;
        if (!cw || !ch) return;

        const spanX = bounds.maxX - bounds.minX;
        const spanY = bounds.maxY - bounds.minY;
        const mx = e.canvasCoord.x;
        const my = e.canvasCoord.y;

        const cam = v.GetCamera() as THREE.OrthographicCamera | null;
        const origin = v.GetOrigin();
        if (!cam || !origin) return;

        const wts = (wx: number, wy: number) => {
          const v = new THREE.Vector3(wx - origin.x, wy - origin.y, 0);
          v.project(cam);
          return { x: ((v.x + 1) / 2) * cw, y: ((1 - v.y) / 2) * ch };
        };

        const visible = (showAll ? detections : detections.filter(d => d.id === selectedId))
          .filter(d =>
            d.detection_status !== 'REJECTED' && d.review_status !== 'REJECTED' &&
            d.bbox_x !== null && d.bbox_y !== null && d.bbox_w !== null && d.bbox_h !== null,
          );

        for (let i = visible.length - 1; i >= 0; i--) {
          const d = visible[i];
          const wx1 = bounds.minX + ((d.bbox_x  ?? 0) / 1000) * spanX;
          const wy1 = bounds.maxY - ((d.bbox_y  ?? 0) / 1000) * spanY;
          const wx2 = bounds.minX + (((d.bbox_x ?? 0) + (d.bbox_w ?? 0)) / 1000) * spanX;
          const wy2 = bounds.maxY - (((d.bbox_y ?? 0) + (d.bbox_h ?? 0)) / 1000) * spanY;
          const tl = wts(wx1, wy1);
          const br = wts(wx2, wy2);
          const rx = Math.min(tl.x, br.x), ry = Math.min(tl.y, br.y);
          const rw = Math.abs(br.x - tl.x), rh = Math.abs(br.y - tl.y);
          if (mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh) {
            onSelectAsset(d.id);
            return;
          }
        }
      });

      viewer
        .Load({
          url,
          fonts: ['/fonts/default.ttf'],
          progressCbk: (phase, processed, total) => {
            if (isCancelled) return;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            setLoadPhase(
              phase === 'fetch'   ? 'Downloading CAD drawing...'  :
              phase === 'parse'   ? 'Parsing CAD entities...'     :
              phase === 'prepare' ? 'Preparing WebGL scene...'    :
                                    'Loading fonts...',
            );
            setLoadPercent(pct);
          },
        })
        .then(() => {
          if (isCancelled || !viewer) return;
          setLoading(false);
          setLayers(Array.from(viewer.GetLayers(true)));
          viewer.Render();
        })
        .catch((err: unknown) => {
          if (isCancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Gagal memuat CAD DXF: ${msg}`);
          setLoading(false);
        });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`WebGL CAD Error: ${msg}`);
      setLoading(false);
    }

    return () => {
      isCancelled = true;
      if (onResize) window.removeEventListener('resize', onResize);
      if (viewerRef.current) {
        try { viewerRef.current.Destroy(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── Redraw when detections / selection / showAll changes ─────────────────────
  useEffect(() => {
    if (!loading) drawOverlay();
  }, [detections, selectedId, showAll, loading, drawOverlay]);

  // ── Auto zoom to selected detection ─────────────────────────────────────────
  // Hanya saat mode single-select (showAll=false). Saat showAll=true kamera
  // milik user — auto-Fit bikin viewport lompat setiap ganti seleksi/tabel.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loading || !selectedId || showAll) return;

    const det = detections.find((d) => d.id === selectedId);
    if (
      !det ||
      det.bbox_x === null || det.bbox_y === null ||
      det.bbox_w === null || det.bbox_h === null
    ) return;

    const bounds = viewer.GetBounds();
    const origin = viewer.GetOrigin();
    if (!bounds || !origin) return;

    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;

    const wx1 = bounds.minX + (det.bbox_x / 1000) * spanX;
    const wy1 = bounds.maxY - (det.bbox_y / 1000) * spanY;
    const wx2 = bounds.minX + ((det.bbox_x + det.bbox_w) / 1000) * spanX;
    const wy2 = bounds.maxY - ((det.bbox_y + det.bbox_h) / 1000) * spanY;

    // 50% padding for visual context
    const pw = (wx2 - wx1) * 0.5;
    const ph = (wy1 - wy2) * 0.5;

    viewer.FitView(
      wx1 - pw - origin.x,
      wx2 + pw - origin.x,
      wy2 - ph - origin.y,
      wy1 + ph - origin.y,
    );
    viewer.Render();
    drawOverlay();
  }, [selectedId, loading, detections, drawOverlay, showAll]);

  // ── Sheet navigation: fit camera to region world rect ───────────────────────
  const fitRegion = useCallback((pidPage: number) => {
    const viewer = viewerRef.current;
    if (!viewer || loading) return;
    const region = regions.find((r) => r.pidPage === pidPage);
    if (!region) return;
    const origin = viewer.GetOrigin();
    if (!origin) return;
    const padX = (region.extents.maxX - region.extents.minX) * 0.02;
    const padY = (region.extents.maxY - region.extents.minY) * 0.02;
    viewer.FitView(
      region.extents.minX - padX - origin.x,
      region.extents.maxX + padX - origin.x,
      region.extents.minY - padY - origin.y,
      region.extents.maxY + padY - origin.y,
    );
    viewer.Render();
    drawOverlayRef.current();
  }, [regions, loading]);

  // Auto-fit when parent changes sheet (page nav). User pan/zoom after that
  // is untouched (effect only fires on activeSheet change).
  const prevSheetRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loading && activeSheet !== null && activeSheet !== prevSheetRef.current) {
      prevSheetRef.current = activeSheet;
      fitRegion(activeSheet);
    }
  }, [activeSheet, loading, fitRegion]);

  // ── Control handlers ─────────────────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const bounds = viewer.GetBounds();
    const origin = viewer.GetOrigin();
    if (bounds && origin) {
      viewer.FitView(
        bounds.minX - origin.x, bounds.maxX - origin.x,
        bounds.minY - origin.y, bounds.maxY - origin.y,
      );
      viewer.Render();
      drawOverlay();
    }
  }, [drawOverlay]);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const cam = viewer.GetCamera();
    if (cam) {
      cam.zoom *= direction === 'in' ? 1.3 : 0.77;
      cam.updateProjectionMatrix();
      viewer.Render();
      drawOverlay();
    }
  }, [drawOverlay]);

  const toggleLayer = useCallback((layerName: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerName)) {
        next.delete(layerName);
        viewer.ShowLayer(layerName, true);
      } else {
        next.add(layerName);
        viewer.ShowLayer(layerName, false);
      }
      viewer.Render();
      drawOverlay();
      return next;
    });
  }, [drawOverlay]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const activeDetections = detections.filter(
    (d) => d.detection_status !== 'REJECTED' && d.review_status !== 'REJECTED',
  );

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        flex: 1,
        minHeight: '480px',
        background: '#161719',
        overflow: 'hidden',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* WebGL canvas */}
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* 2D overlay canvas — bbox + labels only, pointer-events:none so
          pan/zoom pass through to the WebGL OrbitControls beneath */}
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* Loading */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(22,23,25,0.85)', backdropFilter: 'blur(4px)',
          gap: '12px',
        }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{ color: '#f3f4f6', fontSize: 13, fontWeight: 500 }}>
            {loadPhase} {loadPercent > 0 ? `(${loadPercent}%)` : ''}
          </div>
          <div style={{ color: '#9ca3af', fontSize: 11 }}>
            Akselerasi GPU WebGL — Me-render CAD drawing asli
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(22,23,25,0.9)',
          padding: 24, textAlign: 'center',
        }}>
          <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 14px', borderRadius: 6,
              background: '#2563eb', color: '#fff',
              fontSize: 12, fontWeight: 500,
              cursor: 'pointer', border: 'none',
            }}
          >
            Muat Ulang
          </button>
        </div>
      )}

      {/* HUD controls */}
      {!loading && !error && (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 5,
          display: 'flex', gap: 6,
          background: 'rgba(24,27,31,0.85)', backdropFilter: 'blur(8px)',
          padding: '4px 6px', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <button type="button" onClick={handleFitView} title="Fit to Screen"
            style={{ padding: '6px 10px', background: 'transparent', border: 'none',
              borderRadius: 5, color: '#e5e7eb', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
          >
            <ArrowsOutSimple size={16} /><span>Fit</span>
          </button>
          <button type="button" onClick={() => handleZoom('in')} title="Zoom In"
            style={{ padding: '6px 8px', background: 'transparent', border: 'none',
              borderRadius: 5, color: '#e5e7eb', cursor: 'pointer' }}
          >
            <MagnifyingGlassPlus size={16} />
          </button>
          <button type="button" onClick={() => handleZoom('out')} title="Zoom Out"
            style={{ padding: '6px 8px', background: 'transparent', border: 'none',
              borderRadius: 5, color: '#e5e7eb', cursor: 'pointer' }}
          >
            <MagnifyingGlassMinus size={16} />
          </button>
          {layers.length > 0 && (
            <button type="button" onClick={() => setShowLayerPanel((v) => !v)}
              title="CAD Layers"
              style={{
                padding: '6px 10px', border: 'none', borderRadius: 5,
                background: showLayerPanel ? 'rgba(59,130,246,0.3)' : 'transparent',
                color: showLayerPanel ? '#60a5fa' : '#e5e7eb',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
              }}
            >
              <span>Layers ({layers.length})</span>
            </button>
          )}
        </div>
      )}

      {/* Empty-state jujur: bedakan "data kosong" dari "bug render" */}
      {!loading && !error && activeDetections.length === 0 && (
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 5,
          background: 'rgba(24,27,31,0.85)', backdropFilter: 'blur(8px)',
          padding: '3px 10px', borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 11, color: '#9ca3af',
        }}>
          Tidak ada deteksi untuk tampilan ini
          {detections.length > 0 ? ' (semua terfilter/ditolak)' : ' — jalankan deteksi dulu'}
        </div>
      )}

      {/* Detection count badge (top-left) */}
      {!loading && !error && activeDetections.length > 0 && (
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 5,
          background: 'rgba(24,27,31,0.85)', backdropFilter: 'blur(8px)',
          padding: '3px 10px', borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 11, color: '#9ca3af',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#00e676', display: 'inline-block',
          }} />
          {activeDetections.length} deteksi
          {selectedId && (
            <span style={{ color: '#60a5fa', marginLeft: 4 }}>
              · {detections.find(d => d.id === selectedId)?.asset_tag ??
                 detections.find(d => d.id === selectedId)?.asset_type ?? ''}
            </span>
          )}
        </div>
      )}

      {/* Layers panel */}
      {showLayerPanel && (
        <div style={{
          position: 'absolute', top: 52, right: 12, zIndex: 6,
          width: 240, maxHeight: 320,
          background: 'rgba(24,27,31,0.95)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8, padding: 10,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            marginBottom: 8, paddingBottom: 6,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            CAD Layers Visibility
          </div>
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {layers.map((l) => {
              const isHidden = hiddenLayers.has(l.name);
              const colorHex = '#' + l.color.toString(16).padStart(6, '0');
              return (
                <button key={l.name} type="button" onClick={() => toggleLayer(l.name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 6px', borderRadius: 4,
                    background: isHidden ? 'transparent' : 'rgba(255,255,255,0.04)',
                    border: 'none', color: isHidden ? '#6b7280' : '#e5e7eb',
                    fontSize: 11, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 2,
                      backgroundColor: colorHex,
                      display: 'inline-block', flexShrink: 0,
                    }} />
                    <span style={{ textDecoration: isHidden ? 'line-through' : 'none' }}>
                      {l.displayName || l.name}
                    </span>
                  </span>
                  {isHidden ? <EyeSlash size={14} /> : <Eye size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Color legend (bottom-left) */}
      {!loading && !error && (
        <div style={{
          position: 'absolute', bottom: 10, left: 12, zIndex: 5,
          display: 'flex', gap: 6, flexWrap: 'wrap',
          pointerEvents: 'none',
        }}>
          {([
            { color: '#00e676', label: 'Confirmed' },
            { color: '#00bcd4', label: 'High conf' },
            { color: '#ffd600', label: 'Medium' },
            { color: '#ff6d00', label: 'Review' },
            { color: '#ff5252', label: 'Rejected' },
          ] as const).map(({ color, label }) => (
            <div key={label} style={{
              background: 'rgba(20,22,25,0.75)', backdropFilter: 'blur(4px)',
              padding: '2px 7px', borderRadius: 4,
              fontSize: 10, color: '#9ca3af',
              border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: color, display: 'inline-block',
              }} />
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
