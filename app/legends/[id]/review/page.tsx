'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as pdfjsLib from 'pdfjs-dist';

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
}

const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };
const SYMS_PER_PAGE = 12;

function StatusBadge({ s }: { s: string }) {
  const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, lineHeight: '14px' };
  if (s === 'ACTIVE') return <span style={{ ...base, background: 'var(--success-soft)', color: 'var(--success)' }}>ACTIVE</span>;
  if (s === 'REJECTED') return <span style={{ ...base, background: 'var(--danger-soft)', color: 'var(--danger)' }}>REJECTED</span>;
  return <span style={{ ...base, background: 'var(--warning-soft)', color: 'var(--warning)' }}>DRAFT</span>;
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
  const [symPage, setSymPage] = useState(1);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [dragBbox, setDragBbox] = useState<any>(null);
  // Set true once a real drag happens — used to swallow the click event that
  // follows mouseup after moving/resizing (so the sidebar doesn't jump).
  const suppressClickRef = useRef(false);

  // non-passive wheel for pdf zoom — anchored at cursor position.
  // The content div uses transformOrigin 'top left', so a plain scale() would
  // grow toward bottom-right. We compensate by shifting pan so the point under
  // the cursor stays fixed on screen.
  // NOTE: deps include `loading` — on first render the component early-returns
  // while loading, so viewerRef.current is null and there is nothing to bind to.
  // When loading finishes the viewer mounts and this effect must re-run to attach.
  // `zoom` is a dep so the handler always sees the current zoom (no stale closure).
  useEffect(() => {
    const el = viewerRef.current; const content = contentRef.current;
    if (!el || !content) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = Math.max(0.3, Math.min(4, zoom + (e.deltaY > 0 ? -0.08 : 0.08)));
      if (next === zoom) return;
      const vRect = el.getBoundingClientRect();
      const cRect = content.getBoundingClientRect();
      if (cRect.width === 0 || cRect.height === 0) { setZoom(next); return; }
      // Unscaled content size + cursor position as a fraction across content.
      // getBoundingClientRect already includes the current scale transform,
      // so dividing by `zoom` recovers layout size — origin-independent.
      const layoutW = cRect.width / zoom; const layoutH = cRect.height / zoom;
      const nx = (e.clientX - cRect.left) / cRect.width;
      const ny = (e.clientY - cRect.top) / cRect.height;
      // Where the content's top-left corner must be (viewer-relative) after
      // zoom so the same content point stays under the cursor. pan is a
      // screen-pixel offset, so shift it by the corner delta.
      const dx = ((e.clientX - vRect.left) - nx * layoutW * next) - (cRect.left - vRect.left);
      const dy = ((e.clientY - vRect.top) - ny * layoutH * next) - (cRect.top - vRect.top);
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loading, zoom]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bbox]')) return;
    setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => { if (!dragging) return; setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp = () => setDragging(false);

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
        // Resize — mode is a combination of r/l/t/b (e.g. 'r', 'tl', 'br').
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
      setFitZoom(fit); setZoom(fit); setRenderScale(Math.min(2.8, fit * 1.8));
      setPan({ x: 0, y: 0 });
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
    const payload = { asset_type: patch.asset_type ?? sym.asset_type, symbol_name: patch.symbol_name !== undefined ? patch.symbol_name : sym.symbol_name, tag_pattern: patch.tag_pattern !== undefined ? patch.tag_pattern : sym.tag_pattern, description: patch.description !== undefined ? patch.description : sym.description, aliases: (patch as any).aliases ?? sym.aliases, status: patch.status ?? sym.status, bbox_x: patch.bbox_x !== undefined ? patch.bbox_x : sym.bbox_x, bbox_y: patch.bbox_y !== undefined ? patch.bbox_y : sym.bbox_y, bbox_w: patch.bbox_w !== undefined ? patch.bbox_w : sym.bbox_w, bbox_h: patch.bbox_h !== undefined ? patch.bbox_h : sym.bbox_h, pid_page: patch.pid_page !== undefined ? patch.pid_page : sym.pid_page };
    const res = await fetch(`/api/legends/${legendId}/symbols/${sym.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Save failed');
    const updated = await res.json() as LegendSymbol;
    setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleApprove = async (id: string) => { const s = symbols.find(x => x.id === id); if (s) try { await persistSymbol(s, { status: 'ACTIVE' }); } catch (e: any) { setError(e.message); } };
  const handleReject = async (id: string) => { const s = symbols.find(x => x.id === id); if (s) try { await persistSymbol(s, { status: 'REJECTED' }); } catch (e: any) { setError(e.message); } };

  const handleReparse = async () => {
    setReparsing(true); setError('');
    try {
      const r = await fetch(`/api/legends/${legendId}/reparse`, { method: 'POST' });
      const d = await r.json() as any; if (!r.ok) throw new Error(d.error || 'Re-parse failed');
      const sr = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`); if (sr.ok) { const j = await sr.json(); setSymbols(Array.isArray(j) ? j : []); }
    } catch (e: any) { setError(e.message); } finally { setReparsing(false); }
  };
  const handleSaveEdit = async () => {
    if (!editForm.asset_type?.trim()) { setError('Asset type required'); return; }
    try {
      const payload = { asset_type: editForm.asset_type.trim(), symbol_name: editForm.symbol_name?.trim() || null, tag_pattern: editForm.tag_pattern?.trim() || null, description: editForm.description?.trim() || null, aliases: (editForm as any).aliases || [], bbox_x: editForm.bbox_x ?? null, bbox_y: editForm.bbox_y ?? null, bbox_w: editForm.bbox_w ?? null, bbox_h: editForm.bbox_h ?? null, pid_page: editForm.pid_page ?? null, status: (editForm as any).status || 'ACTIVE' };
      const r = await fetch(`/api/legends/${legendId}/symbols/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('Save failed'); const u = await r.json() as LegendSymbol;
      setSymbols(prev => prev.map(s => s.id === u.id ? u : s)); setEditingId(null);
    } catch (e: any) { setError(e.message); }
  };
  const handleApproveAll = async () => {
    const drafts = symbols.filter(s => s.status === 'DRAFT');
    if (!drafts.length) return;
    if (!confirm(`Approve all ${drafts.length} DRAFT symbols?`)) return;
    setApprovingAll(true); setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/bulk-approve`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Approve all failed');
      const updated: LegendSymbol[] = body.symbols ?? [];
      if (updated.length) setSymbols(prev => prev.map(s => { const u = updated.find((x: LegendSymbol) => x.id === s.id); return u ? u as LegendSymbol : s; }));
      else {
        const sr = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`);
        if (sr.ok) { const j = await sr.json(); if (Array.isArray(j)) setSymbols(j); }
      }
    } catch (e: any) { setError(e.message || 'Approve all failed'); } finally { setApprovingAll(false); }
  };

  const handleFinalize = async () => {
    const drafts = symbols.filter(s => s.status === 'DRAFT').length;
    if (drafts > 0 && !confirm(`${drafts} symbols still in draft. Finalize anyway?`)) return;
    setFinalizing(true);
    try { const r = await fetch(`/api/legends/${legendId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) }); if (!r.ok) throw new Error(); router.push(`/legends/${legendId}`); } catch { setError('Finalize failed'); } finally { setFinalizing(false); }
  };

  if (loading) return <div style={{ padding: 64, textAlign: 'center', color: 'var(--foreground-subtle)' }}>Loading…</div>;
  if (!legend) return <div style={{ padding: 64, textAlign: 'center', color: 'var(--foreground-muted)' }}>Legend not found</div>;

  const totalSymPages = Math.max(1, Math.ceil(symbols.length / SYMS_PER_PAGE));
  const pagedSymbols = symbols.slice((symPage - 1) * SYMS_PER_PAGE, symPage * SYMS_PER_PAGE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100vh - var(--topbar-height) - 24px)', overflow: 'hidden' }}>
      {/* Header — compact */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', margin: 0, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{legend.name}</h1>
          <p style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '2px 0 0' }}>Review and approve extracted symbols · {symbols.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={handleReparse} disabled={reparsing} style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: reparsing ? 0.6 : 1 }}>{reparsing ? 'Re-parsing…' : '↺ Re-parse'}</button>
          <button onClick={handleApproveAll} disabled={approvingAll || symbols.filter(s => s.status === 'DRAFT').length === 0} style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: approvingAll || symbols.filter(s => s.status === 'DRAFT').length === 0 ? 0.45 : 1 }}>{approvingAll ? 'Approving…' : `Approve All (${symbols.filter(s => s.status === 'DRAFT').length})`}</button>
          <button onClick={handleFinalize} disabled={finalizing} style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)', background: 'var(--success)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: finalizing ? 0.6 : 1 }}>{finalizing ? 'Finalizing…' : 'Finalize & Activate'}</button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 12, display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <span>{error}</span><button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}
      {symbols.length === 0 && !reparsing && (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--foreground-muted)', flexShrink: 0 }}>No symbols yet. Click <strong>↺ Re-parse</strong> to run AI analysis.</div>
      )}

      {/* Workspace — fills remaining height, no page scroll */}
      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Viewer — compact, no outer scroll */}
        <div style={{ ...cardStyle, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar compact */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)', flexShrink: 0, gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>PDF Preview</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {pdfPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}>◀</button>
                  <span style={{ fontSize: 11, width: 36, textAlign: 'center', color: 'var(--foreground-muted)' }}>{currentPage}/{pdfPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(pdfPages, p + 1))} disabled={currentPage === pdfPages} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', opacity: currentPage === pdfPages ? 0.4 : 1 }}>▶</button>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.08).toFixed(2)))} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>−</button>
                <span style={{ fontSize: 11, width: 30, textAlign: 'center', color: 'var(--foreground-muted)' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(4, +(z + 0.08).toFixed(2)))} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>+</button>
                <button onClick={() => setZoom(fitZoom)} title="Fit" style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>⊡</button>
                <button onClick={() => { setZoom(fitZoom); setPan({ x: 0, y: 0 }); }} title="Reset" style={{ padding: '2px 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>⊙</button>
              </div>
              <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
              <button onClick={() => setShowCards(v => !v)} style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: showCards ? 'var(--primary)' : 'var(--surface)', color: showCards ? '#fff' : 'var(--foreground)', cursor: 'pointer', fontWeight: 600 }}>{showCards ? 'Hide' : 'Show'} Symbols</button>
            </div>
          </div>
          {/* Canvas viewport — centered, clipped, no scroll */}
          <div
            ref={viewerRef}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dragging ? 'grabbing' : 'grab', padding: 6 }}
          >
            <div ref={contentRef} style={{ position: 'relative', transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'top left', boxShadow: '0 1px 8px rgba(0,0,0,0.12)', flexShrink: 0 }}>
              <canvas ref={canvasRef} style={{ background: '#fff', display: 'block', width: viewport ? viewport.w / (renderScale || 1) : 0, height: viewport ? viewport.h / (renderScale || 1) : 0 }} />
              {viewport && (() => {
                const cssW = viewport.w / (renderScale || 1); const cssH = viewport.h / (renderScale || 1);
                return (
                  <svg viewBox={`0 0 ${cssW} ${cssH}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {symbols.filter(s => (s.pid_page ?? 1) === currentPage && s.bbox_x !== null && s.bbox_w !== null && s.id === selectedId).map(sym => {
                      const isSel = sym.id === selectedId;
                      const x = (sym.bbox_x! / 1000) * cssW; const y = (sym.bbox_y! / 1000) * cssH;
                      const w = (sym.bbox_w! / 1000) * cssW; const h = (sym.bbox_h! / 1000) * cssH;
                      const color = sym.status === 'REJECTED' ? 'var(--danger)' : isSel ? '#f59e0b' : 'var(--success)';
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
                          <rect x={rx} y={ry} width={rw} height={rh} fill="#fbbf24" fillOpacity={isSel ? 0.55 : 0.32} stroke={color} strokeWidth={isSel ? 1.8 : 1} strokeDasharray={isSel ? undefined : '5 3'} rx={1} />
                          <rect x={rx} y={ry > 14 ? ry - 12 : ry + rh + 1} width={Math.min(90, Math.max(w, 62))} height={11} rx={3} fill={color} opacity={0.95} />
                          <text x={rx + 3} y={(ry > 14 ? ry - 12 : ry + rh + 1) + 8} fill="#fff" fontSize={7} fontFamily="ui-monospace,monospace" fontWeight={isSel ? 700 : 500}>{label}</text>
                          {/* Resize handles — 4 corners + 4 edges, only on selected bbox */}
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
                            <rect key={h.m} data-handle={h.m} x={h.hx - 5} y={h.hy - 5} width={10} height={10}
                              fill="#fff" stroke={color} strokeWidth={1.5} rx={1.5} style={{ cursor: h.c }}>
                              <title>{h.t}</title>
                            </rect>
                          )))}
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Symbols — paginated, no page scroll */}
        {showCards && (
          <aside style={{ ...cardStyle, width: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>Symbols</span>
              <span style={{ fontSize: 11, color: 'var(--foreground-subtle)', background: 'var(--surface-muted)', padding: '1px 6px', borderRadius: 999 }}>{symbols.length}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pagedSymbols.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--foreground-subtle)', textAlign: 'center', padding: 24 }}>No symbols on this page.</p>
              ) : pagedSymbols.map(sym => (
                <div key={sym.id} ref={el => { cardRefs.current[sym.id] = el; }} onClick={() => { const n = sym.id === selectedId ? null : sym.id; setSelectedId(n); if (n && sym.pid_page && sym.pid_page !== currentPage) setCurrentPage(sym.pid_page); }}
                  style={{ ...cardStyle, padding: '8px 9px', cursor: 'pointer', borderColor: sym.id === selectedId ? 'var(--accent)' : 'var(--border)', boxShadow: sym.id === selectedId ? '0 0 0 2px var(--accent-soft)' : undefined, background: sym.status === 'REJECTED' ? 'var(--danger-soft)' : sym.status === 'ACTIVE' ? 'var(--success-soft)' : 'var(--warning-soft)', opacity: sym.status === 'REJECTED' ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sym.asset_type}</span>
                    <StatusBadge s={sym.status} />
                  </div>
                  {sym.symbol_name && <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym.symbol_name}</div>}
                  {sym.tag_pattern && <div style={{ fontSize: 10, fontFamily: 'ui-monospace,monospace', color: 'var(--foreground-subtle)', marginBottom: 6 }}>Tag: {sym.tag_pattern}</div>}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {sym.status === 'DRAFT' && <button onClick={e => { e.stopPropagation(); handleApprove(sym.id); }} style={{ flex: 1, padding: '4px 0', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--success)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Approve</button>}
                    <button onClick={e => { e.stopPropagation(); setEditingId(sym.id); setEditForm(sym); }} style={{ flex: sym.status === 'DRAFT' ? 1 : undefined, flexGrow: sym.status !== 'DRAFT' ? 1 : undefined, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>Edit</button>
                    {sym.status !== 'REJECTED' ? <button onClick={e => { e.stopPropagation(); handleReject(sym.id); }} style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                      : <button onClick={e => { e.stopPropagation(); handleApprove(sym.id); }} style={{ flex: 1, padding: '4px 0', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11, cursor: 'pointer' }}>Restore</button>}
                  </div>
                </div>
              ))}
            </div>
            {/* Pagination — compact */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface-muted)', flexShrink: 0, gap: 6 }}>
              <button onClick={() => setSymPage(p => Math.max(1, p - 1))} disabled={symPage === 1} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: symPage === 1 ? 'not-allowed' : 'pointer', opacity: symPage === 1 ? 0.4 : 1 }}>‹ Prev</button>
              <span style={{ fontSize: 11, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>{symPage} / {totalSymPages} · {(symPage - 1) * SYMS_PER_PAGE + 1}-{Math.min(symPage * SYMS_PER_PAGE, symbols.length)} of {symbols.length}</span>
              <button onClick={() => setSymPage(p => Math.min(totalSymPages, p + 1))} disabled={symPage === totalSymPages} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: symPage === totalSymPages ? 'not-allowed' : 'pointer', opacity: symPage === totalSymPages ? 0.4 : 1 }}>Next ›</button>
            </div>
          </aside>
        )}
      </div>

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
              <button onClick={handleSaveEdit} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
