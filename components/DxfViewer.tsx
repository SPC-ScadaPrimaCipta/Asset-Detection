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

export interface DxfDrawBbox {
  x: number;
  y: number;
  width: number;
  height: number;
  world?: { x: number; y: number; width: number; height: number };
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
  /** Hard-delete the selected detection after the user confirms. */
  onDeleteAsset?: (id: string) => void;
  /** Recrop bbox for selected detection. */
  onRecrop?: (id: string) => void;
  /** Edit detection metadata (tag, type, etc). */
  onEdit?: (detection: any) => void;
  /** Update existing detection bbox (drag/resize). */
  onBboxUpdate?: (id: string, bbox: { x: number; y: number; width: number; height: number; world?: { x: number; y: number; width: number; height: number } }) => void;
  /** Enable bbox drag/edit mode. */
  editEnabled?: boolean;
  /** Enable drag-to-draw manual bounding box mode. */
  drawingEnabled?: boolean;
  onDrawComplete?: (bbox: DxfDrawBbox) => void;
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
  onDeleteAsset,
  onRecrop,
  onEdit,
  onBboxUpdate,
  editEnabled = false,
  drawingEnabled = false,
  onDrawComplete,
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
  const [selectedRect, setSelectedRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [viewSize, setViewSize] = useState({ w: 1200, h: 800 });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  // Drag existing bbox state (move only untuk DXF, resize bisa tambah nanti)
  const [dragBbox, setDragBbox] = useState<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

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

  /** Map overlay canvas pixel → DXF world coord via current camera. */
  const canvasToWorld = useCallback(
    (cx: number, cy: number, cw: number, ch: number): { x: number; y: number } | null => {
      const viewer = viewerRef.current;
      if (!viewer) return null;
      const origin = viewer.GetOrigin();
      const cam = viewer.GetCamera() as THREE.OrthographicCamera | null;
      if (!origin || !cam) return null;
      const v = new THREE.Vector3((cx / cw) * 2 - 1, -(cy / ch) * 2 + 1, 0).unproject(cam);
      return { x: v.x + origin.x, y: v.y + origin.y };
    },
    [],
  );

  /** Get valid detections to render based on showAll / selectedId. */
  const getVisible = useCallback(() => {
    console.log('[DxfViewer] getVisible called:', { 
      totalDetections: detections.length, 
      showAll, 
      selectedId 
    });
    // For DXF (single-sheet), ignore activeSheet filtering entirely
    // Only filter by showAll and selectedId
    const list = showAll
      ? detections
      : detections.filter((d) => d.id === selectedId);
    console.log('[DxfViewer] after showAll/selected filter:', list.length);
    
    const visible = list.filter(
      (d) =>
        d.detection_status !== 'REJECTED' &&
        d.review_status    !== 'REJECTED' &&
        d.bbox_x !== null && d.bbox_y !== null &&
        d.bbox_w !== null && d.bbox_h !== null,
    );
    console.log('[DxfViewer] final visible count:', visible.length);
    console.log('[DxfViewer] sample bbox:', visible[0] ? {
      id: visible[0].id,
      x: visible[0].bbox_x,
      y: visible[0].bbox_y,
      w: visible[0].bbox_w,
      h: visible[0].bbox_h
    } : 'none');
    return visible;
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
    setViewSize((prev) => (prev.w === cw && prev.h === ch ? prev : { w: cw, h: ch }));

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
    let selRect: { x: number; y: number; w: number; h: number } | null = null;

    console.log('[DxfViewer] drawOverlay:', {
      visibleCount: sorted.length,
      boundsWorld: bounds,
      canvasSize: { cw, ch }
    });

    let renderedCount = 0;
    let outsideViewportCount = 0;

    for (const d of sorted) {
      const isSelected = d.id === selectedId;
      const isReviewCandidate = d.candidate_status === 'REVIEW_CANDIDATE';
      const color = bboxColor(d);

      // 0-1000 → DXF world
      const activeRegion = activeSheet == null ? null : regions.find((r) => r.pidPage === activeSheet);
      const hasSheetBox = activeRegion && d.sheet_bbox_x != null && d.sheet_bbox_y != null && d.sheet_bbox_w != null && d.sheet_bbox_h != null && d.pid_page === activeSheet;
      const hasWorldBox = d.world_bbox_x != null && d.world_bbox_y != null && d.world_bbox_w != null && d.world_bbox_h != null;
      
      // Override koordinat jika sedang di-drag
      let bboxX = d.bbox_x ?? 0;
      let bboxY = d.bbox_y ?? 0;
      let bboxW = d.bbox_w ?? 0;
      let bboxH = d.bbox_h ?? 0;
      if (dragBbox && dragBbox.id === d.id) {
        bboxX = dragBbox.currentX;
        bboxY = dragBbox.currentY;
      }

      const wx1 = hasSheetBox ? activeRegion!.extents.minX + (d.sheet_bbox_x! / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! : bounds.minX + (bboxX / 1000) * spanX;
      const wy1 = hasSheetBox ? activeRegion!.extents.maxY - ((d.sheet_bbox_y! + d.sheet_bbox_h!) / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! + d.world_bbox_h! : bounds.maxY - (bboxY / 1000) * spanY;
      const wx2 = hasSheetBox ? activeRegion!.extents.minX + ((d.sheet_bbox_x! + d.sheet_bbox_w!) / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! + d.world_bbox_w! : bounds.minX + ((bboxX + bboxW) / 1000) * spanX;
      const wy2 = hasSheetBox ? activeRegion!.extents.maxY - (d.sheet_bbox_y! / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! : bounds.maxY - ((bboxY + bboxH) / 1000) * spanY;

      const tl = worldToCanvas(wx1, wy1, cw, ch);
      const br = worldToCanvas(wx2, wy2, cw, ch);

      let rx = Math.min(tl.x, br.x);
      let ry = Math.min(tl.y, br.y);
      let rw = Math.abs(br.x - tl.x);
      let rh = Math.abs(br.y - tl.y);
      
      // Expand very small bboxes for visibility (min 15px on screen)
      const MIN_RENDER_SIZE = 15;
      if (rw > 0 && rw < MIN_RENDER_SIZE) {
        const expand = (MIN_RENDER_SIZE - rw) / 2;
        rx -= expand;
        rw = MIN_RENDER_SIZE;
      }
      if (rh > 0 && rh < MIN_RENDER_SIZE) {
        const expand = (MIN_RENDER_SIZE - rh) / 2;
        ry -= expand;
        rh = MIN_RENDER_SIZE;
      }
      
      if (renderedCount < 3) {
        console.log(`[DxfViewer] bbox ${d.id.slice(0,8)}:`, {
          world: { wx1, wy1, wx2, wy2 },
          canvas: { rx: rx.toFixed(1), ry: ry.toFixed(1), rw: rw.toFixed(1), rh: rh.toFixed(1) },
          hasWorldBox, hasSheetBox
        });
      }
      
      // Only skip if completely degenerate (0 size)
      if (rw < 1 || rh < 1) {
        outsideViewportCount++;
        continue;
      }
      renderedCount++;

      if (isSelected) selRect = { x: rx, y: ry, w: rw, h: rh };

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

    console.log('[DxfViewer] drawOverlay complete:', {
      totalVisible: sorted.length,
      rendered: renderedCount,
      culled: outsideViewportCount
    });

    setSelectedRect((prev) => {
      if (!selRect) return prev === null ? prev : null;
      if (prev && Math.abs(prev.x - selRect.x) < 0.5 && Math.abs(prev.y - selRect.y) < 0.5 &&
          Math.abs(prev.w - selRect.w) < 0.5 && Math.abs(prev.h - selRect.h) < 0.5) return prev;
      return selRect;
    });

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
  }, [detections, selectedId, showAll, showReviewCandidates, textTokens, showText, loading, worldToCanvas, getVisible, dragBbox, regions, activeSheet]);

  // Selalu tunjuk ke implementasi terbaru (lawan closure basi).
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  // Redraw overlay saat drag bbox untuk visual feedback real-time
  useEffect(() => {
    if (dragBbox) drawOverlay();
  }, [dragBbox, drawOverlay]);

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

  // ── Auto-navigate to first page with detections ──────────────────────────
  useEffect(() => {
    if (detections.length === 0 || regions.length === 0) return;
    if (activeSheet !== null && activeSheet !== undefined) {
      // Already on a specific page — check if it has detections
      const hasDetOnPage = detections.some(d => d.pid_page === activeSheet);
      if (hasDetOnPage) return; // Page has detections, stay
    }
    // Find first page with detections
    const pagesWithDet = new Set(detections.map(d => d.pid_page).filter(p => p !== null && p !== undefined));
    if (pagesWithDet.size > 0) {
      const firstPageWithDet = Math.min(...Array.from(pagesWithDet));
      if (activeSheet !== firstPageWithDet) {
        // User hook would need to handle this — for now just log
        console.log(`[DxfViewer] Detections found on page ${firstPageWithDet}, activeSheet=${activeSheet}`);
      }
    }
  }, [detections, regions, activeSheet]);

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

  // ── Manual draw handlers ─────────────────────────────────────────────────────
  const handleDrawStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    drawStartRef.current = { x, y };
    setDrawRect({ x, y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleDrawMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = drawStartRef.current;
    if (!start) return;
    const box = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - box.left;
    const cy = e.clientY - box.top;
    setDrawRect({
      x: Math.min(start.x, cx),
      y: Math.min(start.y, cy),
      w: Math.abs(cx - start.x),
      h: Math.abs(cy - start.y),
    });
  }, []);

  const handleDrawEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = drawStartRef.current;
    drawStartRef.current = null;
    setDrawRect(null);
    if (!start) return;

    const box = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - box.left;
    const cy = e.clientY - box.top;
    const rx = Math.min(start.x, cx);
    const ry = Math.min(start.y, cy);
    const rw = Math.abs(cx - start.x);
    const rh = Math.abs(cy - start.y);
    if (rw < 8 || rh < 8) return;

    const viewer = viewerRef.current;
    const bounds = viewer?.GetBounds();
    if (!viewer || !bounds) return;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    if (spanX <= 0 || spanY <= 0) return;

    const tl = canvasToWorld(rx, ry, box.width, box.height);
    const br = canvasToWorld(rx + rw, ry + rh, box.width, box.height);
    if (!tl || !br) return;

    const worldX = Math.min(tl.x, br.x);
    const worldY = Math.min(tl.y, br.y);
    const worldW = Math.abs(br.x - tl.x);
    const worldH = Math.abs(br.y - tl.y);
    const clamp = (v: number) => Math.max(0, Math.min(1000, v));

    onDrawComplete?.({
      x: Math.round(clamp(((worldX - bounds.minX) / spanX) * 1000)),
      y: Math.round(clamp(((bounds.maxY - (worldY + worldH)) / spanY) * 1000)),
      width: Math.max(1, Math.round(clamp((worldW / spanX) * 1000))),
      height: Math.max(1, Math.round(clamp((worldH / spanY) * 1000))),
      world: { x: worldX, y: worldY, width: worldW, height: worldH },
    });
  }, [canvasToWorld, onDrawComplete]);

  const handleDrawCancel = useCallback(() => {
    drawStartRef.current = null;
    setDrawRect(null);
  }, []);

  // ── Drag existing bbox handlers ──────────────────────────────────────────────
  const handleBboxPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, detectionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const detection = detections.find(d => d.id === detectionId);
    if (!detection || detection.bbox_x == null || detection.bbox_y == null || detection.bbox_w == null || detection.bbox_h == null) return;
    
    const box = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - box.left;
    const startY = e.clientY - box.top;
    const pointerId = e.pointerId;
    const target = e.currentTarget; // Simpan ref sebelum async
    
    // Start long press timer (400ms)
    longPressTimerRef.current = setTimeout(() => {
      setIsDraggingActive(true);
      setDragBbox({
        id: detectionId,
        startX,
        startY,
        origX: detection.bbox_x!,
        origY: detection.bbox_y!,
        origW: detection.bbox_w!,
        origH: detection.bbox_h!,
        currentX: detection.bbox_x!,
        currentY: detection.bbox_y!,
      });
      try {
        target.setPointerCapture(pointerId);
      } catch (err) {
        // Target bisa null jika unmounted, ignore
      }
    }, 400);
  }, [detections]);

  const handleBboxDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingActive || !dragBbox) return;
    const box = e.currentTarget.getBoundingClientRect();
    const canvas = overlayRef.current;
    if (!canvas) return;
    const viewer = viewerRef.current;
    const bounds = viewer?.GetBounds();
    if (!bounds) return;

    const cw = canvas.clientWidth || canvas.width;
    const ch = canvas.clientHeight || canvas.height;
    if (!cw || !ch) return;

    const currentX = e.clientX - box.left;
    const currentY = e.clientY - box.top;
    const dx = ((currentX - dragBbox.startX) / cw) * 1000;
    const dy = ((currentY - dragBbox.startY) / ch) * 1000;

    const newX = Math.max(0, Math.min(1000 - dragBbox.origW, Math.round(dragBbox.origX + dx)));
    const newY = Math.max(0, Math.min(1000 - dragBbox.origH, Math.round(dragBbox.origY + dy)));

    setDragBbox(prev => prev ? { ...prev, currentX: newX, currentY: newY } : null);
  }, [dragBbox]);

  const handleBboxDragEnd = useCallback(() => {
    // Clear long press timer jika masih pending
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!dragBbox || !onBboxUpdate || !isDraggingActive) {
      setDragBbox(null);
      setIsDraggingActive(false);
      return;
    }

    const hasChanged = dragBbox.currentX !== dragBbox.origX || dragBbox.currentY !== dragBbox.origY;
    if (hasChanged) {
      // Konversi normalized → world coords
      const viewer = viewerRef.current;
      const bounds = viewer?.GetBounds();
      if (bounds) {
        const spanX = bounds.maxX - bounds.minX;
        const spanY = bounds.maxY - bounds.minY;
        const worldX = bounds.minX + (dragBbox.currentX / 1000) * spanX;
        const worldY = bounds.maxY - ((dragBbox.currentY + dragBbox.origH) / 1000) * spanY;
        const worldW = (dragBbox.origW / 1000) * spanX;
        const worldH = (dragBbox.origH / 1000) * spanY;

        onBboxUpdate(dragBbox.id, {
          x: dragBbox.currentX,
          y: dragBbox.currentY,
          width: dragBbox.origW,
          height: dragBbox.origH,
          world: { x: worldX, y: worldY, width: worldW, height: worldH },
        });
      }
    }
    setDragBbox(null);
    setIsDraggingActive(false);
  }, [dragBbox, onBboxUpdate, isDraggingActive]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const activeDetections = detections.filter(
    (d) => d.detection_status !== 'REJECTED' && d.review_status !== 'REJECTED',
  );
  const selectedDet = selectedId ? detections.find((d) => d.id === selectedId) ?? null : null;
  const confirmDelete = selectedId != null && confirmId === selectedId;
  const cardW = 230;
  const cardLeft = selectedRect
    ? Math.max(8, Math.min(selectedRect.x + selectedRect.w + 10, viewSize.w - cardW - 8))
    : 8;
  const cardTop = selectedRect ? Math.max(8, Math.min(selectedRect.y, viewSize.h - 160)) : 8;

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

      {/* Manual draw surface — only mounted in draw mode so pan/zoom stay free */}
      {drawingEnabled && !loading && !error && (
        <div
          onPointerDown={handleDrawStart}
          onPointerMove={handleDrawMove}
          onPointerUp={handleDrawEnd}
          onPointerCancel={handleDrawCancel}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        >
          {drawRect && (
            <div
              style={{
                position: 'absolute',
                left: drawRect.x,
                top: drawRect.y,
                width: drawRect.w,
                height: drawRect.h,
                border: '2px dashed #22c55e',
                background: 'rgba(34,197,94,0.15)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}

      {/* Drag bbox interaction layer — hotspots over each bbox */}
      {!drawingEnabled && editEnabled && !loading && !error && (() => {
        const viewer = viewerRef.current;
        const canvas = overlayRef.current;
        if (!viewer || !canvas) return null;
        const bounds = viewer.GetBounds();
        if (!bounds) return null;
        const cw = canvas.clientWidth || canvas.width;
        const ch = canvas.clientHeight || canvas.height;
        if (!cw || !ch) return null;

        const visible = getVisible().filter(d => 
          d.bbox_x != null && d.bbox_y != null && d.bbox_w != null && d.bbox_h != null
        );

        return (
          <div
            onPointerMove={isDraggingActive && dragBbox ? handleBboxDragMove : undefined}
            onPointerUp={handleBboxDragEnd}
            onPointerCancel={() => {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
              setDragBbox(null);
              setIsDraggingActive(false);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: dragBbox ? 5 : 3,
              pointerEvents: dragBbox ? 'auto' : 'none',
              cursor: dragBbox ? 'grabbing' : 'default',
              touchAction: 'none',
            }}
          >
            {visible.map(d => {
              const spanX = bounds.maxX - bounds.minX;
              const spanY = bounds.maxY - bounds.minY;
              const activeRegion = activeSheet == null ? null : regions.find(r => r.pidPage === activeSheet);
              const hasSheetBox = activeRegion && d.sheet_bbox_x != null && d.sheet_bbox_y != null && d.sheet_bbox_w != null && d.sheet_bbox_h != null && d.pid_page === activeSheet;
              const hasWorldBox = d.world_bbox_x != null && d.world_bbox_y != null && d.world_bbox_w != null && d.world_bbox_h != null;
              
              const wx1 = hasSheetBox ? activeRegion!.extents.minX + (d.sheet_bbox_x! / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! : bounds.minX + ((d.bbox_x ?? 0) / 1000) * spanX;
              const wy1 = hasSheetBox ? activeRegion!.extents.maxY - ((d.sheet_bbox_y! + d.sheet_bbox_h!) / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! + d.world_bbox_h! : bounds.maxY - ((d.bbox_y ?? 0) / 1000) * spanY;
              const wx2 = hasSheetBox ? activeRegion!.extents.minX + ((d.sheet_bbox_x! + d.sheet_bbox_w!) / 1000) * (activeRegion!.extents.maxX - activeRegion!.extents.minX) : hasWorldBox ? d.world_bbox_x! + d.world_bbox_w! : bounds.minX + (((d.bbox_x ?? 0) + (d.bbox_w ?? 0)) / 1000) * spanX;
              const wy2 = hasSheetBox ? activeRegion!.extents.maxY - (d.sheet_bbox_y! / 1000) * (activeRegion!.extents.maxY - activeRegion!.extents.minY) : hasWorldBox ? d.world_bbox_y! : bounds.maxY - (((d.bbox_y ?? 0) + (d.bbox_h ?? 0)) / 1000) * spanY;

              const tl = worldToCanvas(wx1, wy1, cw, ch);
              const br = worldToCanvas(wx2, wy2, cw, ch);
              let rx = Math.min(tl.x, br.x);
              let ry = Math.min(tl.y, br.y);
              let rw = Math.abs(br.x - tl.x);
              let rh = Math.abs(br.y - tl.y);

              const MIN_RENDER_SIZE = 15;
              if (rw > 0 && rw < MIN_RENDER_SIZE) {
                const expand = (MIN_RENDER_SIZE - rw) / 2;
                rx -= expand;
                rw = MIN_RENDER_SIZE;
              }
              if (rh > 0 && rh < MIN_RENDER_SIZE) {
                const expand = (MIN_RENDER_SIZE - rh) / 2;
                ry -= expand;
                rh = MIN_RENDER_SIZE;
              }

              if (rw < 1 || rh < 1) return null;

              // Override position jika sedang di-drag
              if (dragBbox && dragBbox.id === d.id) {
                const dx = ((dragBbox.currentX - dragBbox.origX) / 1000) * cw;
                const dy = ((dragBbox.currentY - dragBbox.origY) / 1000) * ch;
                rx += dx;
                ry += dy;
              }

              return (
                <div
                  key={d.id}
                  onPointerDown={(e) => handleBboxPointerDown(e, d.id)}
                  style={{
                    position: 'absolute',
                    left: rx,
                    top: ry,
                    width: rw,
                    height: rh,
                    pointerEvents: dragBbox ? 'none' : 'auto',
                    cursor: isDraggingActive ? 'grabbing' : 'grab',
                    // Debug: uncomment untuk lihat hitbox
                    // background: 'rgba(255,0,0,0.2)',
                  }}
                />
              );
            })}
          </div>
        );
      })()}

      {/* Selected detection card — delete requires explicit confirmation */}
      {!loading && !error && !drawingEnabled && selectedDet && selectedRect && (
        <div
          style={{
            position: 'absolute',
            left: cardLeft,
            top: cardTop,
            width: cardW,
            zIndex: 7,
            background: 'rgba(24,40,50,0.97)',
            backdropFilter: 'blur(10px)',
            border: '1px solid #46606D',
            borderRadius: 8,
            padding: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontSize: 11,
            color: '#e5e7eb',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedDet.asset_tag ?? selectedDet.asset_type}
          </div>
          <div style={{ color: '#9ca3af', marginBottom: 8 }}>
            {selectedDet.asset_type} · {Math.round((selectedDet.confidence ?? 0) * 100)}%
          </div>

          {confirmDelete ? (
            <>
              <div style={{ color: '#fca5a5', marginBottom: 8, lineHeight: 1.4 }}>
                Hapus aset ini permanen?
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedDet.id;
                    setConfirmId(null);
                    onDeleteAsset?.(id);
                  }}
                  style={{
                    flex: 1, padding: '5px 8px', border: 'none', borderRadius: 5,
                    background: '#ef4444', color: '#fff', fontWeight: 700,
                    fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Ya, hapus
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  style={{
                    flex: 1, padding: '5px 8px', borderRadius: 5,
                    background: 'transparent', color: '#e5e7eb',
                    border: '1px solid #46606D', fontWeight: 600,
                    fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Batal
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button
                  type="button"
                  onClick={() => onRecrop?.(selectedDet.id)}
                  disabled={!onRecrop}
                  style={{
                    flex: 1, padding: '5px 8px', borderRadius: 5,
                    background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                    border: '1px solid rgba(59,130,246,0.5)', fontWeight: 700,
                    fontSize: 11, cursor: onRecrop ? 'pointer' : 'not-allowed',
                  }}
                >
                  Recrop
                </button>
                <button
                  type="button"
                  onClick={() => onEdit?.(selectedDet)}
                  disabled={!onEdit}
                  style={{
                    flex: 1, padding: '5px 8px', borderRadius: 5,
                    background: 'rgba(34,197,94,0.15)', color: '#4ade80',
                    border: '1px solid rgba(34,197,94,0.5)', fontWeight: 700,
                    fontSize: 11, cursor: onEdit ? 'pointer' : 'not-allowed',
                  }}
                >
                  Edit
                </button>
              </div>
              <button
                type="button"
                onClick={() => setConfirmId(selectedDet.id)}
                disabled={!onDeleteAsset}
                style={{
                  width: '100%', padding: '5px 8px', borderRadius: 5,
                  background: 'rgba(239,68,68,0.16)', color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.5)', fontWeight: 700,
                  fontSize: 11, cursor: onDeleteAsset ? 'pointer' : 'not-allowed',
                }}
              >
                Hapus
              </button>
            </>
          )}
        </div>
      )}

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
