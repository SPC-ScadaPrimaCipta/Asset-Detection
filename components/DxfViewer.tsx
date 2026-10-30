'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { DxfViewer as DxfViewerEngine, type LayerInfo } from 'dxf-viewer';
import { ArrowsOutSimple, Eye, EyeSlash, MagnifyingGlassPlus, MagnifyingGlassMinus } from '@phosphor-icons/react';

import { getAssetTypeColor } from '@/lib/asset-type-colors';

// ── Bbox color — per asset type, override for review status ──────────────────
function bboxColor(d: { asset_type: string; review_status: string; detection_status: string }): string {
  if (d.review_status === 'APPROVED' || d.detection_status === 'CONFIRMED') return '#00e676';
  if (d.review_status === 'REJECTED' || d.detection_status === 'REJECTED') return '#ff5252';
  return getAssetTypeColor(d.asset_type).stroke;
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
    pid_page?: number | null;
    world_bbox_x?: number | null;
    world_bbox_y?: number | null;
    world_bbox_w?: number | null;
    world_bbox_h?: number | null;
    sheet_bbox_x?: number | null;
    sheet_bbox_y?: number | null;
    sheet_bbox_w?: number | null;
    sheet_bbox_h?: number | null;
    detection_status: string;
    review_status: string;
    candidate_status?: string | null;
  }>;
  selectedId?: string | null;
  onSelectAsset?: (id: string) => void;
  showAll?: boolean;
  showReviewCandidates?: boolean;
  textTokens?: Array<{ text: string; x: number; y: number; w: number; h: number }>;
  showText?: boolean;
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
  showReviewCandidates = false,
  textTokens = [],
  showText = true,
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
    const sheetDetections = activeSheet === null || activeSheet === undefined
      ? detections
      : detections.filter((d) => d.pid_page === null || d.pid_page === activeSheet);
    const list = showAll
      ? sheetDetections
      : sheetDetections.filter((d) => d.id === selectedId);
    return list.filter(
      (d) =>
        d.detection_status !== 'REJECTED' &&
        d.review_status    !== 'REJECTED' &&
        d.bbox_x !== null && d.bbox_y !== null &&
        d.bbox_w !== null && d.bbox_h !== null,
    );
  }, [detections, selectedId, showAll, activeSheet]);

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
    const labelRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const placeLabel = (x: number, y: number, w: number, h: number) => {
      const candidates = [
        { x, y }, { x, y: y + h + 4 }, { x, y: y - h - 4 },
        { x: x + w + 4, y }, { x: Math.max(2, x - w - 4), y },
      ];
      for (const candidate of candidates) {
        const rect = { ...candidate, w, h };
        if (rect.x >= 0 && rect.y >= 0 && rect.x + w <= cw && rect.y + h <= ch && !labelRects.some((other) => overlaps(rect, other))) {
          labelRects.push(rect);
          return rect;
        }
      }
      const fallback = { x: Math.max(0, Math.min(cw - w, x)), y: Math.max(0, Math.min(ch - h, y)), w, h };
      labelRects.push(fallback);
      return fallback;
    };
    // Draw non-selected first so selected renders on top
    const sorted = [...visible].sort((a, b) =>
      a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0,
    );

    for (const d of sorted) {
      const isSelected = d.id === selectedId;
      const isReviewCandidate = d.candidate_status === 'REVIEW_CANDIDATE';
      const color = bboxColor(d);

      // 0-1000 → DXF world
      const activeRegion = activeSheet == null ? null : regions.find((r) => r.pidPage === activeSheet);
      const hasSheetBox = activeRegion && d.sheet_bbox_x != null && d.sheet_bbox_y != null && d.sheet_bbox_w != null && d.sheet_bbox_h != null && d.pid_page === activeSheet;
      const hasWorldBox = d.world_bbox_x != null && d.world_bbox_y != null && d.world_bbox_w != null && d.world_bbox_h != null;
      const wx1 = hasSheetBox ? activeRegion!.extents.minX + (d.sheet_bbox_x! / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! : bounds.minX + ((d.bbox_x  ?? 0) / 1000) * spanX;
      const wy1 = hasSheetBox ? activeRegion!.extents.maxY - ((d.sheet_bbox_y! + d.sheet_bbox_h!) / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! + d.world_bbox_h! : bounds.maxY - ((d.bbox_y  ?? 0) / 1000) * spanY;
      const wx2 = hasSheetBox ? activeRegion!.extents.minX + ((d.sheet_bbox_x! + d.sheet_bbox_w!) / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! + d.world_bbox_w! : bounds.minX + (((d.bbox_x ?? 0) + (d.bbox_w ?? 0)) / 1000) * spanX;
      const wy2 = hasSheetBox ? activeRegion!.extents.maxY - (d.sheet_bbox_y! / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! : bounds.maxY - (((d.bbox_y ?? 0) + (d.bbox_h ?? 0)) / 1000) * spanY;

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
      ctx.lineWidth   = isSelected ? 2.5 : isReviewCandidate ? 1 : 1.5;
      ctx.globalAlpha = isSelected ? 1.0 : isReviewCandidate ? 0.55 : 0.82;
      if (!isSelected) ctx.setLineDash(isReviewCandidate ? [4, 4] : [8, 4]);
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 3);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const label    = (d.asset_tag ?? d.asset_type).slice(0, 18);
      // Show All must expose every detected candidate. AI Candidates only
      // controls verbose emphasis; it must not hide source labels entirely.
      const showLabel = !isReviewCandidate || showReviewCandidates || showAll || isSelected;
      if (!showLabel) { ctx.restore(); continue; }
      const fontSize = isSelected ? 13 : isReviewCandidate ? 9 : 11;
      ctx.font       = `${isSelected ? 700 : 500} ${fontSize}px ui-monospace, monospace`;
      const textW    = ctx.measureText(label).width + 8;
      const textH    = fontSize + 6;
      const labelRect = placeLabel(rx, ry > textH + 2 ? ry - textH - 2 : ry + rh + 2, textW, textH);
      const labelY = labelRect.y;

      ctx.globalAlpha = isSelected ? 1.0 : 0.82;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.roundRect(labelRect.x, labelY, textW, textH, 3);
      ctx.fill();

      ctx.globalAlpha = 1.0;
      ctx.fillStyle   = '#ffffff';
      ctx.fillText(label, labelRect.x + 4, labelY + fontSize);

      ctx.restore();
    }

    if (showText) {
      ctx.save();
      ctx.textBaseline = 'top';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillStyle = '#f5f5f5';
      for (const token of textTokens) {
        const wx = bounds.minX + (token.x / 1000) * spanX;
        const wy = bounds.maxY - (token.y / 1000) * spanY;
        const point = worldToCanvas(wx, wy, cw, ch);
        const textHeightWorld = Math.max(0.001, (token.h / 1000) * spanY);
        const textTop = worldToCanvas(wx, wy - textHeightWorld, cw, ch);
        const fontSize = Math.max(6, Math.min(72, Math.abs(point.y - textTop.y)));
        ctx.font = `${fontSize}px ui-monospace, monospace`;
        if (point.x < -500 || point.x > cw + 500 || point.y < -100 || point.y > ch + 100) continue;
        ctx.strokeText(token.text, point.x, point.y);
        ctx.fillText(token.text, point.x, point.y);
      }
      ctx.restore();
    }
  }, [detections, selectedId, showAll, showReviewCandidates, textTokens, showText, loading, worldToCanvas, getVisible]);

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
        clearColor:       new THREE.Color(0x111C27),
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

      viewer.Subscribe('pointerdown', (e?: { canvasCoord?: { x: number; y: number } }) => {
        if (!e?.canvasCoord) return;
        pdX = e.canvasCoord.x;
        pdY = e.canvasCoord.y;
      });

      viewer.Subscribe('pointerup', (e?: { canvasCoord?: { x: number; y: number } }) => {
        if (!onSelectAsset || !e?.canvasCoord) return;
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

        const sheetDetections = activeSheet === null || activeSheet === undefined
          ? detections
          : detections.filter(d => d.pid_page === null || d.pid_page === activeSheet);
        const candidateFiltered = sheetDetections.filter(d => showReviewCandidates || d.id === selectedId || d.candidate_status !== 'REVIEW_CANDIDATE');
        const visible = (showAll ? candidateFiltered : candidateFiltered.filter(d => d.id === selectedId))
          .filter(d =>
            d.detection_status !== 'REJECTED' && d.review_status !== 'REJECTED' &&
            d.bbox_x !== null && d.bbox_y !== null && d.bbox_w !== null && d.bbox_h !== null,
          );

        for (let i = visible.length - 1; i >= 0; i--) {
          const d = visible[i];
          const activeRegion = activeSheet == null ? null : regions.find((r) => r.pidPage === activeSheet);
          const hasSheetBox = activeRegion && d.sheet_bbox_x != null && d.sheet_bbox_y != null && d.sheet_bbox_w != null && d.sheet_bbox_h != null && d.pid_page === activeSheet;
          const hasWorldBox = d.world_bbox_x != null && d.world_bbox_y != null && d.world_bbox_w != null && d.world_bbox_h != null;
          const wx1 = hasSheetBox ? activeRegion!.extents.minX + (d.sheet_bbox_x! / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! : bounds.minX + ((d.bbox_x  ?? 0) / 1000) * spanX;
          const wy1 = hasSheetBox ? activeRegion!.extents.maxY - ((d.sheet_bbox_y! + d.sheet_bbox_h!) / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! + d.world_bbox_h! : bounds.maxY - ((d.bbox_y  ?? 0) / 1000) * spanY;
          const wx2 = hasSheetBox ? activeRegion!.extents.minX + ((d.sheet_bbox_x! + d.sheet_bbox_w!) / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! + d.world_bbox_w! : bounds.minX + (((d.bbox_x ?? 0) + (d.bbox_w ?? 0)) / 1000) * spanX;
          const wy2 = hasSheetBox ? activeRegion!.extents.maxY - (d.sheet_bbox_y! / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! : bounds.maxY - (((d.bbox_y ?? 0) + (d.bbox_h ?? 0)) / 1000) * spanY;
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
          background: '#111C27',
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
          background: 'rgba(16,26,34,0.88)', backdropFilter: 'blur(4px)',
          gap: '12px',
        }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid rgba(125,211,252,0.16)',
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
          background: 'rgba(16,26,34,0.92)',
          padding: 24, textAlign: 'center',
        }}>
          <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 14px', borderRadius: 6,
              background: '#22D3EE', color: '#07131A',
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
            background: 'rgba(24,40,50,0.88)', backdropFilter: 'blur(8px)',
          padding: '4px 6px', borderRadius: 8,
          border: '1px solid #30424E',
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
                background: showLayerPanel ? 'rgba(34,211,238,0.16)' : 'transparent',
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
          background: 'rgba(24,40,50,0.88)', backdropFilter: 'blur(8px)',
          padding: '3px 10px', borderRadius: 20,
          border: '1px solid #30424E',
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
          background: 'rgba(24,40,50,0.90)', backdropFilter: 'blur(8px)',
          padding: '3px 10px', borderRadius: 20,
          border: '1px solid #30424E',
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
          background: 'rgba(28,46,58,0.97)', backdropFilter: 'blur(12px)',
          border: '1px solid #46606D',
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

      {/* Color legend (bottom-left) — per asset type + status overrides */}
      {!loading && !error && (
        <div style={{
          position: 'absolute', bottom: 10, left: 12, zIndex: 5,
          display: 'flex', gap: 4, flexWrap: 'wrap',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 24px)',
        }}>
          {/* Status overrides first */}
          {[
            { color: '#00e676', label: 'Confirmed' },
            { color: '#ff5252', label: 'Rejected' },
          ].map(({ color, label }) => (
            <div key={label} style={{
              background: 'rgba(24,40,50,0.92)', backdropFilter: 'blur(4px)',
              padding: '2px 7px', borderRadius: 4,
              fontSize: 10, color: '#9ca3af',
              border: '1px solid #30424E',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {label}
            </div>
          ))}
          {/* Per-type colors from actual detections */}
          {Array.from(
            new Map(
              activeDetections
                .filter(d => d.review_status !== 'APPROVED' && d.detection_status !== 'CONFIRMED' && d.review_status !== 'REJECTED' && d.detection_status !== 'REJECTED')
                .map(d => {
                  const c = getAssetTypeColor(d.asset_type);
                  return [c.stroke, { color: c.stroke, label: c.label !== 'Other' ? c.label : d.asset_type }];
                })
            ).values()
          ).map(({ color, label }) => (
            <div key={color} style={{
              background: 'rgba(24,40,50,0.92)', backdropFilter: 'blur(4px)',
              padding: '2px 7px', borderRadius: 4,
              fontSize: 10, color: '#9ca3af',
              border: `1px solid ${color}55`,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
