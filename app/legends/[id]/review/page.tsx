'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface Legend { id: string; name: string; description: string; status: string }

interface LegendSymbol {
  id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[];
  status: string;
  bbox_x: number | null; // normalized xmin 0-1000
  bbox_y: number | null; // normalized ymin 0-1000
  bbox_w: number | null; // normalized width 0-1000
  bbox_h: number | null; // normalized height 0-1000
  pid_page: number | null;
}

interface HighlightRect { x: number; y: number; w: number; h: number; source: 'bbox' | 'text' }

/** Convert normalized 0-1000 → canvas pixel */
function n2c(v: number, dim: number) { return (v / 1000) * dim; }

export default function LegendReviewPage() {
  const params   = useParams();
  const router   = useRouter();
  const legendId = params.id as string;

  const [legend,      setLegend]      = useState<Legend | null>(null);
  const [symbols,     setSymbols]     = useState<LegendSymbol[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [pdfDoc,      setPdfDoc]      = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPages,    setPdfPages]    = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [zoom,        setZoom]        = useState(1.0);
  const [fitZoom,     setFitZoom]     = useState(1.0);
  const [highlights,  setHighlights]  = useState<HighlightRect[]>([]);
  const [matchInfo,   setMatchInfo]   = useState('');

  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editForm,   setEditForm]   = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [reparsing,  setReparsing]  = useState(false);
  const [error,      setError]      = useState('');

  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef    = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [legRes, symRes, pdfRes] = await Promise.all([
          fetch(`/api/legends/${legendId}`),
          fetch(`/api/legends/${legendId}/symbols?include_draft=true`),
          fetch(`/api/legends/${legendId}/pdf`),
        ]);
        if (!legRes.ok) throw new Error('Legend not found');
        setLegend(await legRes.json() as Legend);
        if (symRes.ok) setSymbols((await symRes.json()) as LegendSymbol[] ?? []);
        if (!pdfRes.ok) throw new Error('PDF not found');
        const doc = await pdfjsLib.getDocument({ data: await pdfRes.arrayBuffer() }).promise;
        setPdfDoc(doc);
        setPdfPages(doc.numPages);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Load failed');
      } finally { setLoading(false); }
    };
    load();
  }, [legendId]);

  // ── Render PDF ────────────────────────────────────────────────────────────
  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    const canvas  = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch { /* ok */ } }
    const page     = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    canvas.width = overlay.width = viewport.width;
    canvas.height = overlay.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try { await task.promise; }
    catch (e: unknown) { if (e instanceof Error && e.name !== 'RenderingCancelledException') console.warn(e.message); }
  }, []);

  // ── Draw overlay ──────────────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const W = overlay.width;
    const H = overlay.height;

    // All symbol bboxes (dimmed) for current page
    for (const sym of symbols) {
      if (sym.id === selectedId) continue;
      if (sym.bbox_x == null || sym.bbox_y == null || sym.bbox_w == null || sym.bbox_h == null) continue;
      if (sym.pid_page != null && sym.pid_page !== currentPage) continue;
      const cx = n2c(sym.bbox_x, W), cy = n2c(sym.bbox_y, H);
      const cw = n2c(sym.bbox_w, W), ch = n2c(sym.bbox_h, H);
      const color = sym.status === 'ACTIVE' ? '#10b981' : sym.status === 'REJECTED' ? '#ef4444' : '#f59e0b';
      ctx.strokeStyle = color + '55';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.setLineDash([]);
    }

    // Selected highlights
    for (const h of highlights) {
      const pad = 5;
      ctx.fillStyle   = h.source === 'bbox' ? '#f59e0b20' : '#3b82f615';
      ctx.fillRect(h.x - pad, h.y - pad, h.w + pad * 2, h.h + pad * 2);
      ctx.strokeStyle = h.source === 'bbox' ? '#f59e0b' : '#3b82f6';
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(h.x - pad, h.y - pad, h.w + pad * 2, h.h + pad * 2);

      if (h.source === 'bbox') {
        // Corner brackets
        const aw = 12;
        const [x, y, w, hh] = [h.x - pad, h.y - pad, h.w + pad * 2, h.h + pad * 2];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y + aw); ctx.lineTo(x, y); ctx.lineTo(x + aw, y);
        ctx.moveTo(x + w - aw, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + aw);
        ctx.moveTo(x, y + hh - aw); ctx.lineTo(x, y + hh); ctx.lineTo(x + aw, y + hh);
        ctx.moveTo(x + w - aw, y + hh); ctx.lineTo(x + w, y + hh); ctx.lineTo(x + w, y + hh - aw);
        ctx.stroke();
      }
    }
  }, [symbols, selectedId, currentPage, highlights]);

  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ── Fit-to-width ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;
    let cancelled = false;
    const compute = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const vp   = page.getViewport({ scale: 1 });
      if (cancelled || !containerRef.current) return;
      const w = containerRef.current.clientWidth - 32;
      if (w <= 0) return;
      const fit = Math.max(0.3, w / vp.width);
      setFitZoom(fit);
      setZoom(fit);
    };
    compute();
    const ro = new ResizeObserver(() => { if (!cancelled) compute(); });
    ro.observe(containerRef.current);
    return () => { cancelled = true; ro.disconnect(); };
  }, [pdfDoc, currentPage]);

  useEffect(() => { if (pdfDoc) renderPage(pdfDoc, currentPage, zoom); }, [pdfDoc, currentPage, zoom, renderPage]);

  // ── Highlight on symbol select ────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId || !pdfDoc) { setHighlights([]); setMatchInfo(''); return; }
    const sym = symbols.find(s => s.id === selectedId);
    if (!sym) { setHighlights([]); return; }

    const targetPage = sym.pid_page ?? 1;
    if (targetPage !== currentPage) { setCurrentPage(targetPage); return; }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) return;

    // Primary: normalized bbox from Gemini
    if (sym.bbox_x != null && sym.bbox_y != null && sym.bbox_w != null && sym.bbox_h != null) {
      const cx = n2c(sym.bbox_x, canvas.width);
      const cy = n2c(sym.bbox_y, canvas.height);
      const cw = n2c(sym.bbox_w, canvas.width);
      const ch = n2c(sym.bbox_h, canvas.height);
      setHighlights([{ x: cx, y: cy, w: cw, h: ch, source: 'bbox' }]);
      setMatchInfo('📍 AI-detected location');
      if (container) container.scrollTo({ left: cx + cw / 2 - container.clientWidth / 2, top: cy + ch / 2 - container.clientHeight / 2, behavior: 'smooth' });
      return;
    }

    // Fallback: text search
    const query = sym.symbol_name ?? sym.asset_type;
    pdfDoc.getPage(targetPage).then(async page => {
      const viewport = page.getViewport({ scale: zoom });
      const content  = await page.getTextContent();
      const q = query.toLowerCase();
      const matches: HighlightRect[] = [];
      for (const item of content.items) {
        const text = 'str' in item ? (item as { str: string }).str : '';
        if (!text.toLowerCase().includes(q)) continue;
        const t   = (item as { transform: number[] }).transform;
        const pW  = 'width'  in item ? (item as { width: number }).width   : 80;
        const pH  = 'height' in item ? (item as { height: number }).height  : 12;
        const [cx, cy]   = viewport.convertToViewportPoint(t[4], t[5] + pH);
        const [cx2, cy2] = viewport.convertToViewportPoint(t[4] + pW, t[5]);
        matches.push({ x: cx, y: cy, w: cx2 - cx, h: cy2 - cy, source: 'text' });
      }
      setHighlights(matches);
      if (matches.length > 0) {
        setMatchInfo(`🔍 ${matches.length} text match${matches.length > 1 ? 'es' : ''} — run Re-parse for visual detection`);
        if (container) container.scrollTo({ left: matches[0].x - container.clientWidth / 2, top: matches[0].y - container.clientHeight / 2, behavior: 'smooth' });
      } else {
        setMatchInfo(`No match for "${query}" on page ${currentPage}`);
      }
    }).catch(() => { setHighlights([]); setMatchInfo(''); });
  }, [selectedId, symbols, currentPage, pdfDoc, zoom]);

  useEffect(() => { if (!selectedId) { setHighlights([]); setMatchInfo(''); } }, [selectedId]);

  // ── API ───────────────────────────────────────────────────────────────────
  const handleReparse = async () => {
    setReparsing(true); setError(''); setSelectedId(null);
    try {
      const res = await fetch(`/api/legends/${legendId}/reparse`, { method: 'POST' });
      const j = await res.json() as { inserted?: number; error?: string };
      if (!res.ok) throw new Error(j.error ?? 'Re-parse failed');
      const r = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`);
      if (r.ok) setSymbols(await r.json());
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Re-parse failed'); }
    finally { setReparsing(false); }
  };

  const updateSymbol = async (symId: string, body: object) => {
    const res = await fetch(`/api/legends/${legendId}/symbols/${symId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Update failed');
    const updated = await res.json() as LegendSymbol;
    setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleApprove = (id: string) => updateSymbol(id, { status: 'ACTIVE'   }).catch(e => setError(String(e)));
  const handleReject  = (id: string) => updateSymbol(id, { status: 'REJECTED' }).catch(e => setError(String(e)));

  const handleSaveEdit = async () => {
    if (!editForm.asset_type?.trim()) { setError('Asset type required'); return; }
    try {
      await updateSymbol(editingId!, {
        asset_type:  editForm.asset_type.trim(),
        symbol_name: editForm.symbol_name?.trim() || null,
        tag_pattern: editForm.tag_pattern?.trim() || null,
        description: editForm.description?.trim() || null,
        aliases:     editForm.aliases || [],
      });
      setEditingId(null);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };

  const handleFinalize = async () => {
    const dc = symbols.filter(s => s.status === 'DRAFT').length;
    if (dc > 0 && !confirm(`${dc} symbols still Draft. Finalize anyway?`)) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/legends/${legendId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error('Finalize failed');
      router.push(`/legends/${legendId}`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Finalize failed'); }
    finally { setFinalizing(false); }
  };

  const activeCount   = symbols.filter(s => s.status === 'ACTIVE').length;
  const draftCount    = symbols.filter(s => s.status === 'DRAFT').length;
  const rejectedCount = symbols.filter(s => s.status === 'REJECTED').length;
  const selectedSym   = symbols.find(s => s.id === selectedId) ?? null;

  if (loading) return <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>;
  if (!legend) return <div className="text-center py-12 text-zinc-500">Legend not found</div>;

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 80px)', minHeight: 600 }}>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{legend.name}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Click symbol → highlights location on PDF</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReparse} disabled={reparsing}
            className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
            {reparsing
              ? <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>Re-parsing…
                </span>
              : '↺ Re-parse PDF'}
          </button>
          <button onClick={handleFinalize} disabled={finalizing}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
            {finalizing ? 'Finalizing…' : 'Finalize & Activate'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'Total',    value: symbols.length, color: 'text-zinc-800 dark:text-zinc-100' },
          { label: 'Active',   value: activeCount,    color: 'text-emerald-600' },
          { label: 'Draft',    value: draftCount,     color: 'text-yellow-600' },
          { label: 'Rejected', value: rejectedCount,  color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between flex-shrink-0">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-3">✕</button>
        </div>
      )}

      {symbols.length === 0 && !reparsing && (
        <div className="rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-600 p-6 text-center text-sm text-zinc-500 flex-shrink-0">
          No symbols yet — click <strong>↺ Re-parse PDF</strong> to run AI detection.
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* PDF Viewer */}
        <div className="flex-1 min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-shrink-0 gap-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">PDF Preview</span>
            <div className="flex items-center gap-2">
              {pdfPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40">◀</button>
                  <span className="text-xs text-zinc-500 w-14 text-center">{currentPage}/{pdfPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(pdfPages, p + 1))} disabled={currentPage === pdfPages}
                    className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40">▶</button>
                </div>
              )}
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.2).toFixed(1)))}
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600">−</button>
                <span className="text-xs text-zinc-500 w-9 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(4, +(z + 0.2).toFixed(1)))}
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600">+</button>
                <button onClick={() => setZoom(fitZoom)} title="Fit width"
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600">⊡</button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-900 p-3">
            <div className="relative inline-block shadow-md">
              <canvas ref={canvasRef} className="block" style={{ background: '#fff' }} />
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            </div>
          </div>

          {/* Match info bar */}
          {selectedSym && (
            <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs flex-shrink-0">
              {matchInfo
                ? <span className={highlights.length > 0 && highlights[0].source === 'bbox' ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}>
                    {matchInfo}
                  </span>
                : <span className="text-zinc-400 animate-pulse">Locating {selectedSym.symbol_name ?? selectedSym.asset_type}…</span>
              }
            </div>
          )}
        </div>

        {/* Symbols Panel */}
        <div className="w-80 flex-shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between flex-shrink-0">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Symbols</span>
            <span className="text-xs text-zinc-400">{symbols.length} total · {symbols.filter(s => s.bbox_x != null).length} located</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {symbols.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">No symbols.<br/>Click ↺ Re-parse PDF</p>
            ) : symbols.map(sym => {
              const hasBbox    = sym.bbox_x != null;
              const isSelected = sym.id === selectedId;
              return (
                <div
                  key={sym.id}
                  onClick={() => setSelectedId(sym.id === selectedId ? null : sym.id)}
                  className={`cursor-pointer rounded-lg px-3 py-2.5 border text-xs transition-colors ${
                    isSelected ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''
                  } ${
                    sym.status === 'ACTIVE'
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                      : sym.status === 'REJECTED'
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 opacity-60'
                      : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{sym.asset_type}</p>
                      {sym.symbol_name && <p className="text-zinc-500 truncate">{sym.symbol_name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        sym.status === 'ACTIVE'   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : sym.status === 'REJECTED' ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>{sym.status}</span>
                      <span className={`text-xs ${hasBbox ? 'text-amber-500' : 'text-zinc-400'}`}>
                        {hasBbox ? '📍' : '—'}
                      </span>
                    </div>
                  </div>

                  {sym.tag_pattern && (
                    <p className="text-zinc-400 font-mono text-xs mb-1.5">Tag: {sym.tag_pattern}</p>
                  )}

                  {isSelected && (
                    <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex gap-1">
                      {sym.status === 'DRAFT' && (
                        <button onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}
                          className="flex-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium">
                          Approve
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); setEditingId(sym.id); setEditForm(sym); }}
                        className="flex-1 px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs">
                        Edit
                      </button>
                      {sym.status !== 'REJECTED' ? (
                        <button onClick={e => { e.stopPropagation(); handleReject(sym.id); }}
                          className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 hover:bg-red-200 text-red-600 text-xs">✕</button>
                      ) : (
                        <button onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}
                          className="flex-1 px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700 text-xs">Restore</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {draftCount > 0 && (
            <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 flex-shrink-0">
              <button
                onClick={() => symbols.filter(s => s.status === 'DRAFT').forEach(s => handleApprove(s.id))}
                className="w-full px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
                Approve All Draft ({draftCount})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">Edit Symbol</h3>
            <div className="space-y-3">
              {([
                ['asset_type',  'Asset Type *',  'e.g. Pump'],
                ['symbol_name', 'Symbol Name',   'e.g. Centrifugal Pump'],
                ['tag_pattern', 'Tag Pattern',   'e.g. P-###'],
                ['description', 'Description',   ''],
              ] as [keyof LegendSymbol, string, string][]).map(([key, label, ph]) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
                  <input
                    value={(editForm[key] as string) || ''}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={ph}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveEdit}
                className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-sm font-semibold">Save</button>
              <button onClick={() => setEditingId(null)}
                className="flex-1 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
