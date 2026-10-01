'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as pdfjsLib from 'pdfjs-dist';
import { ArrowCounterClockwise, PencilLine, SquaresFour, CheckCircle, SealCheck, PencilSimple, XCircle, Trash, FloppyDisk, X, CaretLeft, CaretRight, Plus, Minus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { validateTagPattern } from '@/lib/legend-schemas';
import { referenceCropUrl } from '@/lib/legend-url';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface Legend { id: string; name: string; description: string; status: string; }
interface LegendSymbol {
  id: string; asset_type: string; symbol_name: string | null;
  tag_pattern: string | null; description: string | null;
  aliases: string[]; status: string;
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
  pid_page: number | null;
  reference_image_url: string | null;
  reference_crop_hash: string | null;
  computed_features: Record<string, unknown> | null;
  quality_status: 'validated' | 'review' | 'rejected' | null;
  quality_reasons: string[] | null;
  pipeline_version: string | null;
  review_reason: string | null;
  class_id: string | null;
  class_label?: string | null;
  class_key?: string | null;
  superseded_by?: string | null;
}

type QualityTab = 'all' | 'validated' | 'review' | 'rejected' | 'missing';
type ReasonFilter = '' | 'text' | 'border' | 'blank' | 'duplicate' | 'missing';

const REJECT_REASONS = ['Note / annotation', 'Invalid symbol', 'Wrong OCR', 'Wrong crop', 'Other'];

const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };
const SYMS_PER_PAGE = 12;

function StatusBadge({ s }: { s: string }) {
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, lineHeight: '14px' };
  if (s === 'ACTIVE') return <span style={{ ...base, background: 'var(--success-soft)', color: 'var(--success)' }}>ACTIVE</span>;
  if (s === 'REJECTED') return <span style={{ ...base, background: 'var(--danger-soft)', color: 'var(--danger)' }}>REJECTED</span>;
  return <span style={{ ...base, background: 'var(--warning-soft)', color: 'var(--warning)' }}>DRAFT</span>;
}

function QualityBadge({ s, missing }: { s: string | null; missing?: boolean }) {
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, lineHeight: '14px' };
  if (missing) return <span style={{ ...base, background: '#e5e7eb', color: '#6b7280' }}>MISSING</span>;
  if (s === 'validated') return <span style={{ ...base, background: 'var(--success-soft)', color: 'var(--success)' }}>VALIDATED</span>;
  if (s === 'rejected') return <span style={{ ...base, background: 'var(--danger-soft)', color: 'var(--danger)' }}>REJECTED</span>;
  if (s === 'review') return <span style={{ ...base, background: '#fef3c7', color: '#b45309' }}>REVIEW</span>;
  return <span style={{ ...base, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' }}>REVIEW</span>;
}

function qualityReasonKind(sym: LegendSymbol): string[] {
  // Derive filterable reason kinds from diagnostics evidence (no guessing).
  const kinds: string[] = [];
  const reasons = Array.isArray(sym.quality_reasons) ? sym.quality_reasons.join(' ').toLowerCase() : '';
  if (!sym.reference_image_url) kinds.push('missing');
  if (reasons.includes('text-dominant') || reasons.includes('text crop')) kinds.push('text');
  if (reasons.includes('border contamination')) kinds.push('border');
  if (reasons.includes('blank')) kinds.push('blank');
  const f = sym.computed_features as Record<string, unknown> | null;
  if (f && f.duplicateGroup) kinds.push('duplicate');
  return kinds;
}

export default function LegendReviewPage() {
  const params = useParams(); const router = useRouter();
  const legendId = params.id as string;

  const [legend, setLegend] = useState<Legend | null>(null);
  const [symbols, setSymbols] = useState<LegendSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [renderScale, setRenderScale] = useState(2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showCards, setShowCards] = useState(true);
  const [showAllBboxes, setShowAllBboxes] = useState(false);
  const [symPage, setSymPage] = useState(1);
  const [symSearch, setSymSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ΓöÇΓöÇ Manual draw-to-add symbol ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const [drawMode, setDrawMode] = useState(false);
  const [drawState, setDrawState] = useState<{ startX: number; startY: number; x: number; y: number; w: number; h: number } | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalBbox, setAddModalBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [addForm, setAddForm] = useState({ assetType: '', symbolName: '', tagPattern: '', description: '' });
  const [addSaving, setAddSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [dragBbox, setDragBbox] = useState<any>(null);
  // Set true once a real drag happens ΓÇö used to swallow the click event that
  // follows mouseup after moving/resizing (so the sidebar doesn't jump).
  const suppressClickRef = useRef(false);

  // ── Stage 3.5: quality review state ───────────────────────────────────────
  const [qualityTab, setQualityTab] = useState<QualityTab>('all');
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>('');
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const [recropTargetId, setRecropTargetId] = useState<string | null>(null);
  const [recropping, setRecropping] = useState(false);

  // ---- PDF preview zoom: pure-ref math, zero DOM reads in the hot path ----
  // viewRef   = what is displayed (eased toward target every frame)
  // targetRef = where the view is heading (accumulates wheel events)
  // All anchor math derives from these refs + stable layout sizes
  // (offsetWidth/offsetLeft ΓÇö unaffected by the scale transform), so rapid
  // event streams can never observe a half-rendered frame and jump.
  const ZMIN = 0.3, ZMAX = 4;
  const viewRef = useRef({ zoom, pan });
  const targetRef = useRef({ zoom, pan });
  const animRef = useRef<number | null>(null);

  const stopZoomAnim = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }, []);
  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // Frame-rate independent easing toward the target (same feel on 60/120Hz+).
  const kickZoomAnim = useCallback(() => {
    if (animRef.current) return;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      const V = viewRef.current, T = targetRef.current;
      const a = 1 - Math.exp(-dt * 0.016);
      const nz = V.zoom + (T.zoom - V.zoom) * a;
      const nxp = V.pan.x + (T.pan.x - V.pan.x) * a;
      const nyp = V.pan.y + (T.pan.y - V.pan.y) * a;
      if (Math.abs(T.zoom - nz) < 0.0008 && Math.abs(T.pan.x - nxp) < 0.05 && Math.abs(T.pan.y - nyp) < 0.05) {
        V.zoom = T.zoom; V.pan = { ...T.pan };
        setZoom(V.zoom); setPan(V.pan);
        animRef.current = null;
        return;
      }
      V.zoom = nz; V.pan = { x: nxp, y: nyp };
      setZoom(nz); setPan(V.pan);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);

  // Stable layout metrics (viewer/content are never transformed themselves).
  const zoomMetrics = useCallback(() => {
    const el = viewerRef.current; const content = contentRef.current;
    if (!el || !content) return null;
    const vRect = el.getBoundingClientRect();
    const layoutW = content.offsetWidth;
    const layoutH = content.offsetHeight;
    if (layoutW === 0 || layoutH === 0) return null;
    return { vLeft: vRect.left, vTop: vRect.top, offLeft: content.offsetLeft, offTop: content.offsetTop, layoutW, layoutH };
  }, []);

  // Move the TARGET so the content point under (clientX, clientY) stays fixed.
  // nx/ny are measured in the VIEW frame (what the user actually sees);
  // the correction is expressed at target zoom ΓÇö all ref-exact, no DOM reads.
  const retargetZoom = useCallback((clientX: number, clientY: number, next: number) => {
    const m = zoomMetrics(); if (!m) return;
    next = Math.max(ZMIN, Math.min(ZMAX, next));
    const V = viewRef.current, T = targetRef.current;
    if (Math.abs(next - T.zoom) < 0.0005) return;
    const px = clientX - m.vLeft, py = clientY - m.vTop;
    const cornerVx = m.offLeft + V.pan.x, cornerVy = m.offTop + V.pan.y;
    const nx = Math.max(0, Math.min(1, (px - cornerVx) / (m.layoutW * V.zoom)));
    const ny = Math.max(0, Math.min(1, (py - cornerVy) / (m.layoutH * V.zoom)));
    const cornerTx = m.offLeft + T.pan.x, cornerTy = m.offTop + T.pan.y;
    const ncx = px - nx * m.layoutW * next;
    const ncy = py - ny * m.layoutH * next;
    T.zoom = next;
    T.pan = { x: T.pan.x + (ncx - cornerTx), y: T.pan.y + (ncy - cornerTy) };
    kickZoomAnim();
  }, [zoomMetrics, kickZoomAnim]);

  const stepZoom = useCallback((dir: 1 | -1) => {
    const el = viewerRef.current; if (!el) return;
    const vRect = el.getBoundingClientRect();
    retargetZoom(
      vRect.left + vRect.width / 2, vRect.top + vRect.height / 2,
      targetRef.current.zoom + dir * 0.2,
    );
  }, [retargetZoom]);

  // Snap everything instantly (page change / fit-compute). No animation.
  const snapZoom = useCallback((z: number, p: { x: number; y: number }) => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    viewRef.current = { zoom: z, pan: { ...p } };
    targetRef.current = { zoom: z, pan: { ...p } };
    setZoom(z); setPan({ ...p });
  }, []);

  // non-passive wheel for pdf zoom ΓÇö scroll (biasa) = zoom, anchored at cursor.
  // The content div uses transformOrigin 'top left', so a plain scale() would
  // grow toward bottom-right; retargetZoom compensates via pan.
  // NOTE: deps include `loading` ΓÇö on first render the component early-returns
  // while loading, so viewerRef.current is null and there is nothing to bind to.
  // When loading finishes the viewer mounts and this effect must re-run to attach.
  useEffect(() => {
    const el = viewerRef.current; const content = contentRef.current;
    if (!el || !content) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      // Normalize trackpad line-scroll deltas, then exponential factor so zoom
      // speed follows scroll velocity. Per-event change clamped so aggressive
      // scroll drivers can't teleport (fast scroll still zooms fast via volume).
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const raw = Math.exp(-dy * 0.002);
      const factor = Math.max(0.85, Math.min(1.18, raw));
      retargetZoom(e.clientX, e.clientY, targetRef.current.zoom * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loading, retargetZoom]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bbox]')) return;
    if (drawMode) {
      // Draw mode ΓÇö capture start point relative to contentRef in CSS coords
      const content = contentRef.current; if (!content || !viewport) return;
      const rect = content.getBoundingClientRect();
      const cssW = viewport.w / (renderScale || 1); const cssH = viewport.h / (renderScale || 1);
      // BoundingClientRect already accounts for the CSS transform (scale+translate),
      // so dividing by the rendered size gives us true fractional position.
      const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const sx = fx * cssW; const sy = fy * cssH;
      setDrawState({ startX: sx, startY: sy, x: sx, y: sy, w: 0, h: 0 });
      return;
    }
    stopZoomAnim();
    const V = viewRef.current;
    targetRef.current = { zoom: V.zoom, pan: { ...V.pan } };
    setDragging(true); setDragStart({ x: e.clientX - V.pan.x, y: e.clientY - V.pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (drawMode && drawState) {
      const content = contentRef.current; if (!content || !viewport) return;
      const rect = content.getBoundingClientRect();
      const cssW = viewport.w / (renderScale || 1); const cssH = viewport.h / (renderScale || 1);
      const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const ex = fx * cssW; const ey = fy * cssH;
      setDrawState(prev => prev ? { ...prev, x: Math.min(prev.startX, ex), y: Math.min(prev.startY, ey), w: Math.abs(ex - prev.startX), h: Math.abs(ey - prev.startY) } : null);
      return;
    }
    if (!dragging) return; const np = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }; viewRef.current.pan = np; targetRef.current.pan = np; setPan(np);
  };
  const handleMouseUp = () => {
    if (drawMode && drawState) {
      const { x, y, w, h } = drawState;
      setDrawState(null);
      if (w > 5 && h > 5 && viewport) {
        const cssW = viewport.w / (renderScale || 1); const cssH = viewport.h / (renderScale || 1);
        const bx = Math.round((x / cssW) * 1000);
        const by = Math.round((y / cssH) * 1000);
        const bw = Math.round((w / cssW) * 1000);
        const bh = Math.round((h / cssH) * 1000);
        // Re-crop mode: drawn box becomes a versioned reference (raw preserved).
        if (recropTargetId) {
          setDrawMode(false);
          handleRecropSave({ x: bx, y: by, w: bw, h: bh });
          return;
        }
        setAddModalBbox({ x: bx, y: by, w: bw, h: bh });
        // Preserve any form data already entered — only reset if form is empty
        setAddForm(prev => prev.assetType ? prev : { assetType: '', symbolName: '', tagPattern: '', description: '' });
        setAddModalOpen(true);
        setDrawMode(false);
      }
      return;
    }
    setDragging(false);
  };

  // ESC key: cancel draw mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawMode) { setDrawMode(false); setDrawState(null); }
        if (confirmApproveAll) setConfirmApproveAll(false);
        if (confirmFinalize) setConfirmFinalize(false);
        if (confirmDeleteId) setConfirmDeleteId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, confirmApproveAll, confirmFinalize, confirmDeleteId]);

  // drag bbox move/resize
  useEffect(() => {
    if (!dragBbox || !viewport) return;
    const cssW = viewport.w / renderScale; const cssH = viewport.h / renderScale;
    const onMove = (e: MouseEvent) => {
      const ndx = (e.clientX - dragBbox.startX) / zoom;
      const ndy = (e.clientY - dragBbox.startY) / zoom;
      if (Math.abs(e.clientX - dragBbox.startX) > 3 || Math.abs(e.clientY - dragBbox.startY) > 3) suppressClickRef.current = true;
      if (dragBbox.mode === 'move') {
        const nx = Math.max(0, Math.min(cssW - dragBbox.w, dragBbox.origX + ndx));
        const ny = Math.max(0, Math.min(cssH - dragBbox.h, dragBbox.origY + ndy));
        setDragBbox((p: any) => p ? { ...p, x: nx, y: ny } : p);
      } else {
        // Resize ΓÇö mode is a combination of r/l/t/b (e.g. 'r', 'tl', 'br').
        // Right/bottom edges grow w/h; left/top edges move x/y with the
        // opposite edge anchored. All clamped to canvas, min 10px.
        const mode: string = dragBbox.mode;
        const right = dragBbox.origX + dragBbox.origW;
        const bottom = dragBbox.origY + dragBbox.origH;
        let nx = dragBbox.origX; let ny = dragBbox.origY;
        let nw = dragBbox.origW; let nh = dragBbox.origH;
        if (mode.includes('r')) nw = Math.max(10, Math.min(dragBbox.origW + ndx, cssW - dragBbox.origX));
        if (mode.includes('b')) nh = Math.max(10, Math.min(dragBbox.origH + ndy, cssH - dragBbox.origY));
        if (mode.includes('l')) { nx = Math.max(0, Math.min(dragBbox.origX + ndx, right - 10)); nw = right - nx; }
        if (mode.includes('t')) { ny = Math.max(0, Math.min(dragBbox.origY + ndy, bottom - 10)); nh = bottom - ny; }
        setDragBbox((p: any) => p ? { ...p, x: nx, y: ny, w: nw, h: nh } : p);
      }
    };
    const onUp = async () => {
      const { id, x, y, w, h } = dragBbox; const sym = symbols.find(s => s.id === id);
      setDragBbox(null);
      const cssW2 = viewport!.w / renderScale; const cssH2 = viewport!.h / renderScale;
      const nx = Math.round((x / cssW2) * 1000); const ny = Math.round((y / cssH2) * 1000);
      const nw = Math.round((w / cssW2) * 1000); const nh = Math.round((h / cssH2) * 1000);
      if (sym && (nx !== sym.bbox_x || ny !== sym.bbox_y || nw !== sym.bbox_w || nh !== sym.bbox_h)) {
        try { await persistSymbol(sym, { bbox_x: nx, bbox_y: ny, bbox_w: nw, bbox_h: nh }); } catch (e: any) { setError(e.message || 'Drag save failed'); }
      }
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragBbox, viewport, symbols, zoom, renderScale]);

  useEffect(() => {
    const load = async () => {
      try {
        const [legRes, symRes] = await Promise.all([
          fetch(`/api/legends/${legendId}`),
          fetch(`/api/legends/${legendId}/symbols?include_draft=true`),
        ]);
        if (!legRes.ok) throw new Error('Legend not found');
        setLegend(await legRes.json() as Legend);
        if (symRes.ok) { const d = await symRes.json(); setSymbols(Array.isArray(d) ? d : []); }
        const pdfRes = await fetch(`/api/legends/${legendId}/pdf`);
        if (!pdfRes.ok) throw new Error('PDF not found');
        const doc = await pdfjsLib.getDocument({ data: await pdfRes.arrayBuffer() }).promise;
        setPdfDoc(doc); setPdfPages(doc.numPages);
      } catch (e: any) { setError(e.message || 'Load failed'); } finally { setLoading(false); }
    };
    load();
  }, [legendId]);

  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    if (!canvasRef.current) return;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale });
    const c = canvasRef.current;
    c.width = vp.width; c.height = vp.height;
    setViewport({ w: vp.width, h: vp.height });
    const ctx = c.getContext('2d'); if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport: vp });
    renderTaskRef.current = task;
    try { await task.promise; } catch {}
  }, []);

  // fit zoom on page change / resize
  useEffect(() => {
    if (!pdfDoc || !viewerRef.current) return;
    let cancelled = false;
    const compute = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const vp = page.getViewport({ scale: 1 });
      if (cancelled || !viewerRef.current) return;
      const cw = viewerRef.current.clientWidth - 16;
      if (cw <= 0) return;
      const fit = Math.max(0.45, Math.min(1.2, cw / vp.width));
      setFitZoom(fit); setRenderScale(Math.min(2.8, fit * 1.8));
      snapZoom(fit, { x: 0, y: 0 });
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(viewerRef.current);
    return () => { cancelled = true; ro.disconnect(); };
  }, [pdfDoc, currentPage]);

  useEffect(() => { if (pdfDoc) renderPage(pdfDoc, currentPage, renderScale); }, [pdfDoc, currentPage, renderScale, renderPage]);

  // reset sym pagination when filter changes
  useEffect(() => { setSymPage(1); }, [symbols.length]);
  useEffect(() => {
    // clamp symPage when symbols shrink
    const tp = Math.max(1, Math.ceil(symbols.length / SYMS_PER_PAGE));
    if (symPage > tp) setSymPage(tp);
  }, [symbols.length, symPage]);

  const persistSymbol = async (sym: LegendSymbol, patch: Partial<LegendSymbol>) => {
    // normalize aliases ΓÇö DB may return string/JSON
    const rawAliases = (patch as any).aliases ?? sym.aliases;
    let aliases: string[] = [];
    if (Array.isArray(rawAliases)) aliases = rawAliases.map(String);
    else if (typeof rawAliases === 'string') { try { const p = JSON.parse(rawAliases); aliases = Array.isArray(p) ? p.map(String) : []; } catch { aliases = []; } }

    // normalize bbox to int
    const toInt = (v: unknown) => { const n = parseInt(String(v ?? ''), 10); return isNaN(n) ? null : n; };

    const payload = {
      asset_type: patch.asset_type ?? sym.asset_type,
      symbol_name: patch.symbol_name !== undefined ? patch.symbol_name : sym.symbol_name,
      tag_pattern: patch.tag_pattern !== undefined ? patch.tag_pattern : sym.tag_pattern,
      description: patch.description !== undefined ? patch.description : sym.description,
      aliases,
      status: patch.status ?? sym.status,
      bbox_x: toInt(patch.bbox_x !== undefined ? patch.bbox_x : sym.bbox_x),
      bbox_y: toInt(patch.bbox_y !== undefined ? patch.bbox_y : sym.bbox_y),
      bbox_w: toInt(patch.bbox_w !== undefined ? patch.bbox_w : sym.bbox_w),
      bbox_h: toInt(patch.bbox_h !== undefined ? patch.bbox_h : sym.bbox_h),
      pid_page: toInt(patch.pid_page !== undefined ? patch.pid_page : sym.pid_page),
      review_reason: (patch as Partial<LegendSymbol>).review_reason !== undefined
        ? (patch as Partial<LegendSymbol>).review_reason
        : (sym as Partial<LegendSymbol>).review_reason ?? null,
    };
    const res = await fetch(`/api/legends/${legendId}/symbols/${sym.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any).error || `Save failed (${res.status})`); }
    const updated = await res.json() as LegendSymbol;
    setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleApprove = async (id: string) => {
    const s = symbols.find(x => x.id === id); if (!s) return;
    // Restore from REJECTED clears the stale review reason; plain DRAFT→ACTIVE keeps it.
    const patch = s.status === 'REJECTED' ? { status: 'ACTIVE', review_reason: null } : { status: 'ACTIVE' };
    try { await persistSymbol(s, patch as Partial<LegendSymbol>); } catch (e: any) { setError(e.message); }
  };
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const handleValidate = async (id: string) => {
    setValidatingId(id); setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${id}/validate`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as any).error || `Validate failed (${res.status})`);
      setSymbols(prev => prev.map(x => x.id === id ? d as LegendSymbol : x));
    } catch (e: any) { setError(e.message || 'Validate failed'); }
    finally { setValidatingId(null); }
  };

  const handleRejectWithReason = async () => {
    if (!rejectModalId) return;
    const s = symbols.find(x => x.id === rejectModalId);
    if (!s) { setRejectModalId(null); return; }
    const reason = rejectNote.trim() ? `${rejectReason} — ${rejectNote.trim()}` : rejectReason;
    try {
      await persistSymbol(s, { status: 'REJECTED', review_reason: reason });
      setRejectModalId(null); setRejectNote(''); setRejectReason(REJECT_REASONS[0]);
    } catch (e: any) { setError(e.message); }
  };

  const handleRecropSave = async (bbox: { x: number; y: number; w: number; h: number }) => {
    if (!recropTargetId) return;
    setRecropping(true);
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${recropTargetId}/recrop`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox_x: bbox.x, bbox_y: bbox.y, bbox_w: bbox.w, bbox_h: bbox.h }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as any).error || `Re-crop failed (${res.status})`);
      const updated = (d as any).symbol as LegendSymbol;
      setSymbols(prev => prev.map(x => x.id === recropTargetId ? { ...x, ...updated } : x));
      setSelectedId(recropTargetId);
      setRecropTargetId(null);
    } catch (e: any) { setError(e.message || 'Re-crop failed'); }
    finally { setRecropping(false); }
  };

  const handleDeleteSymbol = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any).error || 'Delete failed'); }
      setSymbols(prev => prev.filter(s => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e: any) { setError(e.message); }
  };

  const handleReparse = async () => {
    setReparsing(true); setError('');
    try {
      const r = await fetch(`/api/legends/${legendId}/reparse`, { method: 'POST' });
      const d = await r.json() as any; if (!r.ok) throw new Error(d.error || 'Re-parse failed');
      const sr = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`); if (sr.ok) { const j = await sr.json(); setSymbols(Array.isArray(j) ? j : []); }
      setSelectedId(null); setEditingId(null); setRecropTargetId(null); setRejectModalId(null); setConfirmDeleteId(null);
      setDrawMode(false); setAddModalOpen(false); setAddModalBbox(null); setSymPage(1);
      setSuccessMsg('Legend re-parsed successfully. Symbol list refreshed.');
      setTimeout(() => setSuccessMsg(''), 2500);
    } catch (e: any) { setError(e.message); } finally { setReparsing(false); }
  };
  const handleSaveEdit = async () => {
    if (!editForm.asset_type?.trim()) { setError('Asset type required'); return; }
    const tpErr = validateTagPattern(editForm.tag_pattern ?? null);
    if (tpErr) { setError(tpErr); return; }
    try {
      // normalize aliases ΓÇö DB may return string/object
      let aliases: string[] = [];
      const rawAliases = (editForm as any).aliases;
      if (Array.isArray(rawAliases)) aliases = rawAliases.map(String);
      else if (typeof rawAliases === 'string') { try { const p = JSON.parse(rawAliases); aliases = Array.isArray(p) ? p.map(String) : []; } catch { aliases = []; } }

      // normalize bbox ΓÇö input values may be strings
      const toInt = (v: unknown) => { const n = parseInt(String(v ?? ''), 10); return isNaN(n) ? null : n; };

      const payload = {
        asset_type: editForm.asset_type.trim(),
        symbol_name: editForm.symbol_name?.trim() || null,
        tag_pattern: editForm.tag_pattern?.trim() || null,
        description: editForm.description?.trim() || null,
        aliases,
        status: (editForm as any).status || 'ACTIVE',
        bbox_x: toInt(editForm.bbox_x),
        bbox_y: toInt(editForm.bbox_y),
        bbox_w: toInt(editForm.bbox_w),
        bbox_h: toInt(editForm.bbox_h),
        pid_page: toInt(editForm.pid_page),
      };
      const r = await fetch(`/api/legends/${legendId}/symbols/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error((d as any).error || `Save failed (${r.status})`); }
      const u = await r.json() as LegendSymbol;
      setSymbols(prev => prev.map(s => s.id === u.id ? u : s)); setEditingId(null);
    } catch (e: any) { setError(e.message); }
  };
  const handleApproveAll = async () => {
    const drafts = symbols.filter(s => s.status === 'DRAFT');
    if (!drafts.length) return;
    setConfirmApproveAll(false);
    setApprovingAll(true); setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/bulk-approve`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Approve all failed');
      // Always refetch from server — response body may be empty if already approved
      const sr = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`);
      if (sr.ok) { const j = await sr.json(); if (Array.isArray(j)) setSymbols(j); }
      setSuccessMsg(`All symbols approved (${drafts.length})`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e: any) { setError(e.message || 'Approve all failed'); } finally { setApprovingAll(false); }
  };

  const handleFinalize = async () => {
    setConfirmFinalize(false);
    setFinalizing(true);
    try {
const r = await fetch(`/api/legends/${legendId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE', strictQuality: true }) });
      if (r.status === 409) {
        const d = await r.json().catch(() => ({}));
        const msg = `Quality gate: ${(d as any).unassessed ?? 0} unassessed, ${(d as any).in_review ?? 0} in review, ${(d as any).drafts ?? 0} drafts. Only VALIDATED references feed the matcher.\n\nFinalize anyway?`;
        if (!confirm(msg)) return;
        const r2 = await fetch(`/api/legends/${legendId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE', strictQuality: true, force: true }) });
        if (!r2.ok) throw new Error();
      } else if (!r.ok) throw new Error();
      setSuccessMsg('Legend activated! Redirecting…');
      setTimeout(() => router.push(`/legends/${legendId}`), 1200);
    } catch { setError('Finalize failed'); } finally { setFinalizing(false); }
  };

  // ΓöÇΓöÇ Add Symbol modal save handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const handleAddSymbolSave = async () => {
    if (addSaving) return; // guard against double-click / StrictMode double-invoke
    if (!addForm.assetType.trim()) { setError('Asset Type is required'); return; }
    const tpErr = validateTagPattern(addForm.tagPattern || null);
    if (tpErr) { setError(tpErr); return; }
    setAddSaving(true);
    try {
      const body = {
        asset_type: addForm.assetType.trim(),
        symbol_name: addForm.symbolName.trim() || null,
        tag_pattern: addForm.tagPattern.trim() || null,
        description: addForm.description.trim() || null,
        aliases: [],
        status: 'ACTIVE',
        bbox_x: addModalBbox?.x ?? null,
        bbox_y: addModalBbox?.y ?? null,
        bbox_w: addModalBbox?.w ?? null,
        bbox_h: addModalBbox?.h ?? null,
        pid_page: currentPage,
      };
      const res = await fetch(`/api/legends/${legendId}/symbols`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any).error || `Error ${res.status}`); }
      const created = await res.json() as LegendSymbol;
      setSymbols(prev => {
        const next = [...prev, created];
        // Jump sidebar to last page so new symbol is visible
        setSymPage(Math.ceil(next.length / SYMS_PER_PAGE));
        return next;
      });
      setSelectedId(created.id);
      setShowAllBboxes(true); // show all bboxes so the new one is visible on the viewer
      setAddModalOpen(false); setAddModalBbox(null);
      setAddForm({ assetType: '', symbolName: '', tagPattern: '', description: '' });
    } catch (e: any) { setError(e.message || 'Save failed'); }
    finally { setAddSaving(false); }
  };

  if (loading) return <div style={{ padding: 64, textAlign: 'center', color: 'var(--foreground-subtle)' }}>Loading&hellip;</div>;
  if (!legend) return <div style={{ padding: 64, textAlign: 'center', color: 'var(--foreground-muted)' }}>Legend not found</div>;

  const qualityCounts = {
    total: symbols.length,
    validated: symbols.filter(s => s.quality_status === 'validated').length,
    review: symbols.filter(s => s.quality_status === 'review').length,
    rejected: symbols.filter(s => s.quality_status === 'rejected').length,
    missing: symbols.filter(s => !s.reference_image_url).length,
  };
  const filteredSymbols = symbols.filter(s => {
    if (symSearch.trim()) {
      const q = symSearch.toLowerCase();
      const hit = (
        s.asset_type.toLowerCase().includes(q) ||
        (s.symbol_name ?? '').toLowerCase().includes(q) ||
        (s.tag_pattern ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)
      );
      if (!hit) return false;
    }
    if (qualityTab === 'validated' && s.quality_status !== 'validated') return false;
    if (qualityTab === 'review' && s.quality_status !== 'review') return false;
    if (qualityTab === 'rejected' && s.quality_status !== 'rejected') return false;
    if (qualityTab === 'missing' && s.reference_image_url) return false;
    if (reasonFilter && !qualityReasonKind(s).includes(reasonFilter)) return false;
    return true;
  });
  const totalSymPages = Math.max(1, Math.ceil(filteredSymbols.length / SYMS_PER_PAGE));
  const pagedSymbols = filteredSymbols.slice((symPage - 1) * SYMS_PER_PAGE, symPage * SYMS_PER_PAGE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100vh - var(--topbar-height) - 24px)', overflow: 'hidden' }}>
      {/* ΓöÇΓöÇ Add Symbol Modal ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setAddModalOpen(false); setAddModalBbox(null); } }}>
          <div style={{ ...cardStyle, padding: 24, width: 380, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Add Symbol Manually</h2>
              <button onClick={() => { setAddModalOpen(false); setAddModalBbox(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--foreground-muted)', lineHeight: 1 }}>&times;</button>
            </div>
            {addModalBbox ? (
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✓ BBox: x={addModalBbox.x} y={addModalBbox.y} w={addModalBbox.w} h={addModalBbox.h} · Page {currentPage}</span>
                <button onClick={() => setAddModalBbox(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--danger)' }}>✕ Clear</button>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => { setAddModalOpen(false); setDrawMode(true); }}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)', background: 'var(--surface-muted)', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <PencilLine size={12} /> Draw BBox on PDF (optional — can save without)
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>
                  Asset Type <span style={{ color: 'var(--danger)' }}>*</span>
                </span>
                <input autoFocus value={addForm.assetType} onChange={e => setAddForm(p => ({ ...p, assetType: e.target.value }))}
                  placeholder="e.g. PUMP, VALVE, VESSEL"
                  style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Symbol Name</span>
                <input value={addForm.symbolName} onChange={e => setAddForm(p => ({ ...p, symbolName: e.target.value }))}
                  placeholder="e.g. Centrifugal Pump"
                  style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Tag Pattern</span>
                <input value={addForm.tagPattern} onChange={e => setAddForm(p => ({ ...p, tagPattern: e.target.value }))}
                  placeholder="e.g. P-###"
                  style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Description</span>
                <textarea value={addForm.description} onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description…" rows={2}
                  style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 13, resize: 'none', fontFamily: 'inherit' }} />
              </label>
              <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                <button onClick={() => { setAddModalOpen(false); setAddModalBbox(null); }}
                  style={{ flex: 1, padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <X size={13} />Cancel
                </button>
                <button onClick={handleAddSymbolSave} disabled={addSaving || !addForm.assetType.trim()}
                  style={{ flex: 1, padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: addSaving || !addForm.assetType.trim() ? 'not-allowed' : 'pointer', opacity: addSaving || !addForm.assetType.trim() ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <FloppyDisk size={13} />{addSaving ? 'Saving\u2026' : 'Save Symbol'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Header ΓÇö compact */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', margin: 0, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{legend.name}</h1>
<p style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '2px 0 0' }}>Review and approve extracted symbols · {symbols.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handleReparse} disabled={reparsing}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: reparsing ? 'not-allowed' : 'pointer', opacity: reparsing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <ArrowCounterClockwise size={13} />{reparsing ? 'Re-parsing…' : 'Re-parse'}
          </button>

          <button
            onClick={() => { setDrawMode(v => !v); setRecropTargetId(null); }}
            title={drawMode ? 'Cancel draw mode' : 'Drag on the PDF to mark a new symbol area'}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${drawMode ? '#dc2626' : 'var(--border)'}`, background: drawMode ? '#dc2626' : 'var(--surface)', color: drawMode ? '#fff' : 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
          >{drawMode ? '✕ Cancel' : '✏ Add Symbol (draw)'}
          </button>

          <button
            onClick={() => {
              // Open modal directly — bbox will be null (user can draw optionally)
              setAddModalBbox(null);
              setAddForm({ assetType: '', symbolName: '', tagPattern: '', description: '' });
              setAddModalOpen(true);
            }}
            title="Add a symbol manually (optionally draw bbox on PDF first)"
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <PencilLine size={13} />Add Symbol
          </button>
          <button
            onClick={() => setShowAllBboxes(v => !v)}
            title={showAllBboxes ? 'Switch to single-select mode' : 'Show all symbol bounding boxes on PDF'}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showAllBboxes ? 'var(--primary)' : 'var(--border)'}`, background: showAllBboxes ? 'var(--primary)' : 'var(--surface)', color: showAllBboxes ? '#fff' : 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <SquaresFour size={13} />{showAllBboxes ? 'Show All (on)' : 'Show All'}
          </button>
          <button onClick={() => {
            const drafts = symbols.filter(s => s.status === 'DRAFT').length;
            if (drafts === 0) return;
            setConfirmApproveAll(true);
          }}
            disabled={approvingAll || symbols.filter(s => s.status === 'DRAFT').length === 0}
            style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: approvingAll || symbols.filter(s => s.status === 'DRAFT').length === 0 ? 0.45 : 1, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <CheckCircle size={13} />{approvingAll ? 'Approving…' : `Approve All (${symbols.filter(s => s.status === 'DRAFT').length})`}
          </button>
          <button onClick={() => setConfirmFinalize(true)} disabled={finalizing}
            style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)', background: 'var(--success)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: finalizing ? 'not-allowed' : 'pointer', opacity: finalizing ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <SealCheck size={13} />{finalizing ? 'Finalizing…' : 'Finalize & Activate'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 12, display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <span>{error}</span><button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background: 'var(--success-soft)', border: '1px solid var(--success)', color: 'var(--success)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 12, flexShrink: 0 }}>
          ✓ {successMsg}
        </div>
      )}
      {/* Approve All confirmation */}
      {confirmApproveAll && (
        <div style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <span style={{ color: 'var(--foreground)' }}>Approve all <strong>{symbols.filter(s => s.status === 'DRAFT').length}</strong> DRAFT symbols?</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleApproveAll} style={{ padding: '4px 12px', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Yes, Approve All</button>
            <button onClick={() => setConfirmApproveAll(false)} style={{ padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {/* Finalize confirmation */}
      {confirmFinalize && (
        <div style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
          <span style={{ color: 'var(--foreground)' }}>
            {symbols.filter(s => s.status === 'DRAFT').length > 0
              ? `${symbols.filter(s => s.status === 'DRAFT').length} symbols still DRAFT. Finalize & Activate legend anyway?`
              : 'Finalize and activate this legend?'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleFinalize} style={{ padding: '4px 12px', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Yes, Finalize</button>
            <button onClick={() => setConfirmFinalize(false)} style={{ padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {/* Delete symbol confirmation */}
      {confirmDeleteId && (() => {
        const sym = symbols.find(s => s.id === confirmDeleteId);
        return (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
            <span style={{ color: 'var(--foreground)' }}>Delete <strong>{sym?.asset_type}</strong> permanently?</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => handleDeleteSymbol(confirmDeleteId)} style={{ padding: '4px 12px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
              <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        );
      })()}
      {symbols.length === 0 && !reparsing && (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--foreground-muted)', flexShrink: 0 }}>No symbols yet. Click <strong>Re-parse</strong> to run AI analysis.</div>
      )}

      {/* Workspace ΓÇö fills remaining height, no page scroll */}
      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Viewer ΓÇö compact, no outer scroll */}
        <div style={{ ...cardStyle, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar compact */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)', flexShrink: 0, gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>PDF Preview</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {pdfPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', opacity: currentPage === 1 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center' }}><CaretLeft size={12} /></button>
                  <span style={{ fontSize: 11, width: 36, textAlign: 'center', color: 'var(--foreground-muted)' }}>{currentPage}/{pdfPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(pdfPages, p + 1))} disabled={currentPage === pdfPages} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', opacity: currentPage === pdfPages ? 0.4 : 1, display: 'inline-flex', alignItems: 'center' }}><CaretRight size={12} /></button>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <button onClick={() => stepZoom(-1)} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><Minus size={12} /></button>
                <span style={{ fontSize: 11, width: 30, textAlign: 'center', color: 'var(--foreground-muted)' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => stepZoom(1)} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><Plus size={12} /></button>
                <button onClick={() => { const el = viewerRef.current; if (!el) return; const v = el.getBoundingClientRect(); retargetZoom(v.left + v.width / 2, v.top + v.height / 2, fitZoom); }} title="Fit" style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Fit</button>
                <button onClick={() => { targetRef.current = { zoom: fitZoom, pan: { x: 0, y: 0 } }; kickZoomAnim(); }} title="Reset" style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Reset</button>
              </div>
              <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
              <button onClick={() => setShowCards(v => !v)} style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: showCards ? 'var(--primary)' : 'var(--surface)', color: showCards ? '#fff' : 'var(--foreground)', cursor: 'pointer', fontWeight: 600 }}>{showCards ? 'Hide' : 'Show'} Symbols</button>
            </div>
          </div>
          {/* Canvas viewport ΓÇö centered, clipped, no scroll */}
          <div
            ref={viewerRef}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: drawMode ? 'crosshair' : dragging ? 'grabbing' : 'grab', padding: 6 }}
          >
            <div ref={contentRef} style={{ position: 'relative', transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'top left', boxShadow: '0 1px 8px rgba(0,0,0,0.12)', flexShrink: 0, willChange: 'transform' }}>
              <canvas ref={canvasRef} style={{ background: '#fff', display: 'block', width: viewport ? viewport.w / (renderScale || 1) : 0, height: viewport ? viewport.h / (renderScale || 1) : 0 }} />
              {viewport && (() => {
                const cssW = viewport.w / (renderScale || 1); const cssH = viewport.h / (renderScale || 1);
                return (
                  <svg viewBox={`0 0 ${cssW} ${cssH}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {symbols.filter(s => (s.pid_page ?? 1) === currentPage && s.bbox_x !== null && s.bbox_w !== null && s.bbox_h !== null && (showAllBboxes || s.id === selectedId)).map(sym => {
                      const isSel = sym.id === selectedId;
                      const x = (sym.bbox_x! / 1000) * cssW; const y = (sym.bbox_y! / 1000) * cssH;
                      const w = (sym.bbox_w! / 1000) * cssW; const h = (sym.bbox_h! / 1000) * cssH;
const color = sym.status === 'REJECTED' ? '#ef4444' : sym.status === 'ACTIVE' ? '#22c55e' : '#f59e0b';
                      const rx = dragBbox?.id === sym.id ? dragBbox.x : x; const ry = dragBbox?.id === sym.id ? dragBbox.y : y;
                      const rw = dragBbox?.id === sym.id ? dragBbox.w : w; const rh = dragBbox?.id === sym.id ? dragBbox.h : h;
                      const label = (sym.symbol_name || sym.asset_type).slice(0, 16);
                      return (
                        <g key={sym.id} data-bbox="true" style={{ pointerEvents: 'all', cursor: isSel ? 'move' : 'pointer' }}
                          onClick={e => { e.stopPropagation(); if (suppressClickRef.current) { suppressClickRef.current = false; return; } setSelectedId(sym.id); cardRefs.current[sym.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                          onMouseDown={e => {
                            e.stopPropagation();
                            if (!viewport) { setSelectedId(sym.id); return; }
                            suppressClickRef.current = false;
                            // Resize handle? (data-handle="r|l|t|b|tr|tl|br|bl" on handle rects)
                            const handle = (e.target as Element).getAttribute?.('data-handle');
                            if (handle) {
                              setDragBbox({ id: sym.id, x, y, w, h, startX: e.clientX, startY: e.clientY, origX: x, origY: y, origW: w, origH: h, mode: handle });
                            } else if (isSel) {
                              setDragBbox({ id: sym.id, x, y, w, h, startX: e.clientX, startY: e.clientY, origX: x, origY: y, origW: w, origH: h, mode: 'move' });
                            } else {
                              setSelectedId(sym.id);
                            }
                          }}>
                          <rect x={rx - 2} y={ry - 2} width={w + 4} height={h + 4} fill="transparent" />
                          <rect x={rx} y={ry} width={rw} height={rh} fill="#fbbf24" fillOpacity={isSel ? 0.2 : 0.15} stroke={color} strokeWidth={isSel ? 2.2 : 1} strokeDasharray={isSel ? undefined : '5 3'} rx={1} />
                          <rect x={rx} y={ry > 14 ? ry - 12 : ry + rh + 1} width={Math.min(90, Math.max(w, 62))} height={11} rx={3} fill={color} opacity={0.95} />
                          <text x={rx + 3} y={(ry > 14 ? ry - 12 : ry + rh + 1) + 8} fill="#fff" fontSize={7} fontFamily="ui-monospace,monospace" fontWeight={isSel ? 700 : 500}>{label}</text>
                          {/* Resize handles ΓÇö 4 corners + 4 edges, only on selected bbox */}
                          {isSel && ([
                            { m: 'tl', hx: rx, hy: ry, c: 'nwse-resize', t: 'Resize top-left' },
                            { m: 'tr', hx: rx + rw, hy: ry, c: 'nesw-resize', t: 'Resize top-right' },
                            { m: 'bl', hx: rx, hy: ry + rh, c: 'nesw-resize', t: 'Resize bottom-left' },
                            { m: 'br', hx: rx + rw, hy: ry + rh, c: 'nwse-resize', t: 'Resize bottom-right' },
                            { m: 't', hx: rx + rw / 2, hy: ry, c: 'ns-resize', t: 'Resize top edge' },
                            { m: 'b', hx: rx + rw / 2, hy: ry + rh, c: 'ns-resize', t: 'Resize bottom edge' },
                            { m: 'l', hx: rx, hy: ry + rh / 2, c: 'ew-resize', t: 'Resize left edge' },
                            { m: 'r', hx: rx + rw, hy: ry + rh / 2, c: 'ew-resize', t: 'Resize right edge' },
                          ].map(h => (
                            <rect key={h.m} data-handle={h.m} x={h.hx - 3} y={h.hy - 3} width={6} height={6}
                              fill="#fff" stroke={color} strokeWidth={1.5} rx={1.5} style={{ cursor: h.c }}>
                              <title>{h.t}</title>
                            </rect>
                          )))}
                        </g>
                      );
                    })}
                    {/* Live draw rect ΓÇö shown while user drags in draw mode */}
                    {drawMode && drawState && drawState.w > 2 && drawState.h > 2 && (
                      <rect
                        x={drawState.x} y={drawState.y}
                        width={drawState.w} height={drawState.h}
                        fill="rgba(0,90,200,0.12)" stroke="#005ab4" strokeWidth={1.5}
                        strokeDasharray="6 3" rx={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                  </svg>
                );
            })()}
            {drawMode && (
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10 }}>
                Γ£Å Drag to mark symbol area
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Symbols — paginated, no page scroll */}
        {showCards && (
          <aside style={{ ...cardStyle, width: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>Symbols</span>
                <span style={{ fontSize: 11, color: 'var(--foreground-subtle)', background: 'var(--surface-muted)', padding: '1px 6px', borderRadius: 999 }}>
                  {symSearch.trim() ? `${filteredSymbols.length} / ${symbols.length}` : symbols.length}
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={symSearch}
                  onChange={e => { setSymSearch(e.target.value); setSymPage(1); }}
                  placeholder="Search symbols…"
                  style={{ width: '100%', padding: '5px 26px 5px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', fontSize: 12, boxSizing: 'border-box' }}
                />
                {symSearch && (
                  <button onClick={() => { setSymSearch(''); setSymPage(1); }}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--foreground-muted)', lineHeight: 1, padding: 0 }}>&times;</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['all', 'validated', 'review', 'rejected', 'missing'] as QualityTab[]).map(t => {
                  const n = t === 'all' ? qualityCounts.total : qualityCounts[t];
                  const active = qualityTab === t;
                  return (
                    <button key={t} onClick={() => { setQualityTab(t); setSymPage(1); }}
                      style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 999, border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`, background: active ? 'var(--primary)' : 'var(--surface)', color: active ? '#fff' : 'var(--foreground-muted)', cursor: 'pointer', textTransform: 'uppercase' }}>
                      {t} {n}
                    </button>
                  );
                })}
                <select value={reasonFilter} onChange={e => { setReasonFilter(e.target.value as ReasonFilter); setSymPage(1); }}
                  title="Filter by diagnostics reason"
                  style={{ padding: '3px 6px', fontSize: 10, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground-muted)', cursor: 'pointer' }}>
                  <option value="">all reasons</option>
                  <option value="text">text dominant</option>
                  <option value="border">border contamination</option>
                  <option value="blank">blank</option>
                  <option value="duplicate">possible duplicate</option>
                  <option value="missing">missing crop</option>
                </select>
              </div>
              {(() => {
                const sel = symbols.find(x => x.id === selectedId);
                if (!sel) return null;
                const f = (sel.computed_features ?? {}) as Record<string, unknown>;
                return (
                  <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: 8, background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.symbol_name || sel.asset_type}</span>
                      <QualityBadge s={sel.quality_status} missing={!sel.reference_image_url} />
                    </div>
                    {sel.reference_image_url ? (
                      <img src={referenceCropUrl(legendId, sel.id, sel.reference_crop_hash)} alt="reference crop"
                        style={{ width: '100%', maxHeight: 120, objectFit: 'contain', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', textAlign: 'center', padding: 8, border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>No crop file</div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--foreground-muted)', fontFamily: 'ui-monospace,monospace' }}>
                      bbox {sel.bbox_x ?? '–'},{sel.bbox_y ?? '–'},{sel.bbox_w ?? '–'},{sel.bbox_h ?? '–'} · p{sel.pid_page ?? '?'}
                      {typeof f.inkDensity === 'number' && <> · ink {Number(f.inkDensity).toFixed(3)}</>}
                      {typeof f.borderScore === 'number' && <> · brd {Number(f.borderScore).toFixed(2)}</>}
                      {typeof f.textScore === 'number' && <> · txt {Number(f.textScore).toFixed(2)}</>}
                    </div>
                    {sel.class_label && <div style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>Class: <strong>{sel.class_label as string}</strong></div>}
                    {Array.isArray(sel.quality_reasons) && sel.quality_reasons.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: '#b45309' }}>
                        {(sel.quality_reasons as string[]).slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                    {sel.review_reason && <div style={{ fontSize: 10, color: 'var(--danger)' }}>Review: {sel.review_reason}</div>}
                    {sel.superseded_by && <div style={{ fontSize: 10, color: 'var(--foreground-subtle)' }}>Superseded by newer version</div>}
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { setRecropTargetId(sel.id); setDrawMode(true); }} disabled={recropping}
                        title="Draw a new symbol area on the PDF — creates a versioned reference, raw preserved"
                        style={{ flex: 1, padding: '5px 0', borderRadius: 'var(--radius-sm)', border: '1px solid var(--primary)', background: 'var(--surface)', color: 'var(--primary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {recropping && recropTargetId === sel.id ? 'Saving…' : recropTargetId === sel.id ? '✏ Drawing… click PDF' : '✂ Re-crop'}
                      </button>
                      <button onClick={() => { setRejectModalId(sel.id); setRejectReason(REJECT_REASONS[0]); setRejectNote(sel.review_reason ?? ''); }}
                        style={{ flex: 1, padding: '5px 0', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                        ✕ Reject…
                      </button>
                    </div>
                    {sel.quality_status !== 'validated' && (
                      <button onClick={() => handleValidate(sel.id)} disabled={!sel.reference_image_url || validatingId === sel.id}
                        title={sel.reference_image_url ? 'Confirm this corrected reference as matcher-eligible' : 'Missing crop — cannot validate'}
                        style={{ width: '100%', padding: '5px 0', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--success)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: !sel.reference_image_url ? 'not-allowed' : 'pointer', opacity: !sel.reference_image_url ? 0.45 : 1 }}>
                        {validatingId === sel.id ? 'Validating…' : '✓ Mark Validated'}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pagedSymbols.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--foreground-subtle)', textAlign: 'center', padding: 24 }}>
                  {symSearch.trim() ? `No symbols match "${symSearch}"` : 'No symbols on this page.'}
                </p>
              ) : pagedSymbols.map(sym => (
                <div key={sym.id} ref={el => { cardRefs.current[sym.id] = el; }} onClick={() => {
                  const n = sym.id === selectedId ? null : sym.id;
                  setSelectedId(n);
                  if (n && sym.pid_page && sym.pid_page !== currentPage) setCurrentPage(sym.pid_page);
                }}
                  style={{ ...cardStyle, padding: '8px 9px', cursor: 'pointer', borderColor: sym.id === selectedId ? 'var(--accent)' : 'var(--border)', boxShadow: sym.id === selectedId ? '0 0 0 2px var(--accent-soft)' : undefined, background: sym.status === 'REJECTED' ? 'var(--danger-soft)' : sym.status === 'ACTIVE' ? 'var(--success-soft)' : 'var(--warning-soft)', opacity: sym.status === 'REJECTED' ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sym.asset_type}</span>
                    <StatusBadge s={sym.status} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                    <QualityBadge s={sym.quality_status} missing={!sym.reference_image_url} />
                    {sym.class_label && <span style={{ fontSize: 10, color: 'var(--foreground-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym.class_label as string}</span>}
                  </div>
                  {sym.symbol_name && <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym.symbol_name}</div>}
                  {sym.tag_pattern && <div style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: 'var(--foreground-subtle)', marginBottom: 6 }}>Tag: {sym.tag_pattern}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                    {sym.status === 'DRAFT' && (
                      <Button variant="approve" size="sm" style={{ width: '100%', padding: '0 6px', fontSize: 11 }} onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}>
                        <CheckCircle size={12} />Approve
                      </Button>
                    )}
                    <Button variant="edit" size="sm" style={{ width: '100%', padding: '0 6px', fontSize: 11 }} onClick={e => { e.stopPropagation(); setEditingId(sym.id); setEditForm(sym); }}>
                      <PencilSimple size={12} />Edit
                    </Button>
                    {sym.status !== 'REJECTED' ? (
                      <Button variant="danger" size="sm" style={{ flex: 1, width: '100%', padding: '0 6px', fontSize: 11 }} onClick={e => { e.stopPropagation(); setRejectModalId(sym.id); setRejectReason(REJECT_REASONS[0]); setRejectNote(sym.review_reason ?? ''); }} title="Reject">
                        <XCircle size={12} />Reject
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" style={{ width: '100%', padding: '0 6px', fontSize: 11 }} onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}>
                        <ArrowCounterClockwise size={12} />Restore
                      </Button>
                    )}
                    <Button variant="danger" size="sm" style={{ width: '100%', padding: '0 6px', fontSize: 11, background: '#8B3A38', borderColor: '#8B3A38' }} onClick={e => { e.stopPropagation(); setConfirmDeleteId(sym.id); }} title="Delete permanently">
                      <Trash size={12} />Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {/* Pagination ΓÇö compact */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface-muted)', flexShrink: 0, gap: 6 }}>
<button onClick={() => setSymPage(p => Math.max(1, p - 1))} disabled={symPage === 1} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: symPage === 1 ? 'not-allowed' : 'pointer', opacity: symPage === 1 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', gap: 3 }}><CaretLeft size={12} />Prev</button>
              <span style={{ fontSize: 11, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>{symPage} / {totalSymPages} &middot; {(symPage - 1) * SYMS_PER_PAGE + 1}-{Math.min(symPage * SYMS_PER_PAGE, filteredSymbols.length)} of {filteredSymbols.length}</span>
              <button onClick={() => setSymPage(p => Math.min(totalSymPages, p + 1))} disabled={symPage === totalSymPages} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: symPage === totalSymPages ? 'not-allowed' : 'pointer', opacity: symPage === totalSymPages ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', gap: 3 }}>Next<CaretRight size={12} /></button>
            </div>
          </aside>
        )}
      </div>

      {/* Reject modal — reason required for audit */}
      {rejectModalId && (() => {
        const sym = symbols.find(x => x.id === rejectModalId);
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
            onClick={e => { if (e.target === e.currentTarget) setRejectModalId(null); }}>
            <div style={{ ...cardStyle, padding: 16, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
                Reject “{(sym?.symbol_name || sym?.asset_type || '').slice(0, 40)}”
              </h3>
              <p style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: 0 }}>The reference stays in the database for audit — it will never feed the matcher.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {REJECT_REASONS.map(r => (
                  <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--foreground)' }}>
                    <input type="radio" name="reject-reason" checked={rejectReason === r} onChange={() => setRejectReason(r)} />
                    {r}
                  </label>
                ))}
              </div>
              <input value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="Optional note…"
                style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleRejectWithReason} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', background: 'var(--danger)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Reject</button>
                <button onClick={() => setRejectModalId(null)} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit modal */}
      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ ...cardStyle, padding: 16, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Edit Symbol</h3>
            {[
              { k: 'asset_type', label: 'Asset Type *', type: 'text' },
              { k: 'symbol_name', label: 'Symbol Name', type: 'text' },
              { k: 'tag_pattern', label: 'Tag Pattern', type: 'text', ph: 'e.g. P-###' },
            ].map(f => (
              <label key={f.k} style={{ display: 'block' }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--foreground-muted)' }}>{f.label}</span>
                <input value={(editForm as any)[f.k] || ''} placeholder={(f as any).ph || ''} onChange={e => setEditForm(v => ({ ...v, [f.k]: e.target.value }))}
                  style={{ marginTop: 4, width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13 }} />
              </label>
            ))}
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--foreground-muted)' }}>Description</span>
              <textarea value={editForm.description || ''} onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} rows={2}
                style={{ marginTop: 4, width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, resize: 'none' }} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--foreground-muted)' }}>Bounding Box</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 4 }}>
                {(['bbox_x', 'bbox_y', 'bbox_w', 'bbox_h'] as const).map((k, i) => (
                  <div key={k}><span style={{ fontSize: 10, color: 'var(--foreground-subtle)' }}>{['X', 'Y', 'W', 'H'][i]}</span>
                    <input type="number" value={(editForm as any)[k] ?? ''} onChange={e => setEditForm(v => ({ ...v, [k]: parseInt(e.target.value) || null }))}
                      style={{ marginTop: 2, width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 6px', fontSize: 12, fontFamily: 'ui-monospace,monospace' }} /></div>
                ))}
              </div>
            </label>
            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button onClick={handleSaveEdit} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><FloppyDisk size={13} />Save</button>
              <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><X size={13} />Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
