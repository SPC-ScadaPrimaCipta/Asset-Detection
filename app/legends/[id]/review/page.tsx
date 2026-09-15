'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as pdfjsLib from 'pdfjs-dist';

// Use local worker — avoids CDN dependency and pdfjs v4 version mismatch
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface Legend {
  id: string;
  name: string;
  description: string;
  status: string;
}

interface LegendSymbol {
  id: string;
  asset_type: string;
  symbol_name: string | null;
  tag_pattern: string | null;
  description: string | null;
  aliases: string[];
  status: string;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  pid_page: number | null;
}

export default function LegendReviewPage() {
  const params = useParams();
  const router = useRouter();
  const legendId = params.id as string;

  const [legend, setLegend] = useState<Legend | null>(null);
  const [symbols, setSymbols] = useState<LegendSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [fitZoom, setFitZoom] = useState(1.0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // bbox overlay state — mirror detection viewer pattern
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [dragBbox, setDragBbox] = useState<{
    id: string; x: number; y: number; w: number; h: number;
    startX: number; startY: number; origX: number; origY: number;
  } | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Global drag handlers — tracks mouse even when cursor leaves bbox
  useEffect(() => {
    if (!dragBbox || !viewport) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragBbox.startX;
      const dy = e.clientY - dragBbox.startY;
      const nx = dragBbox.origX + dx / (viewport.w / 1000);
      const ny = dragBbox.origY + dy / (viewport.h / 1000);
      const clampedX = Math.max(0, Math.min(1000 - dragBbox.w, nx));
      const clampedY = Math.max(0, Math.min(1000 - dragBbox.h, ny));
      setDragBbox(prev => prev ? { ...prev, x: clampedX, y: clampedY } : prev);
    };
    const onUp = async (e: MouseEvent) => {
      const dx = e.clientX - dragBbox.startX;
      const dy = e.clientY - dragBbox.startY;
      const nx = dragBbox.origX + dx / (viewport.w / 1000);
      const ny = dragBbox.origY + dy / (viewport.h / 1000);
      const clampedX = Math.max(0, Math.min(1000 - dragBbox.w, nx));
      const clampedY = Math.max(0, Math.min(1000 - dragBbox.h, ny));
      const id = dragBbox.id;
      const sym = symbols.find(s => s.id === id);
      setDragBbox(null);
      if (sym && (Math.round(clampedX) !== sym.bbox_x || Math.round(clampedY) !== sym.bbox_y)) {
        try { await persistSymbol(sym, { bbox_x: Math.round(clampedX), bbox_y: Math.round(clampedY) }); }
        catch (err: unknown) { setError(err instanceof Error ? err.message : 'Drag save failed'); }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragBbox, viewport, symbols]);

  // Load legend + symbols
  useEffect(() => {
    const load = async () => {
      try {
        const [legRes, symRes] = await Promise.all([
          fetch(`/api/legends/${legendId}`),
          fetch(`/api/legends/${legendId}/symbols?include_draft=true`),
        ]);
        if (!legRes.ok) throw new Error('Legend not found');
        const legData = await legRes.json() as Legend;
        setLegend(legData);
        if (symRes.ok) {
          const syms = await symRes.json();
          setSymbols(Array.isArray(syms) ? syms : []);
        }

        // Load PDF
        const pdfRes = await fetch(`/api/legends/${legendId}/pdf`);
        if (!pdfRes.ok) throw new Error('PDF not found');
        const arrayBuf = await pdfRes.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        setPdfDoc(doc);
        setPdfPages(doc.numPages);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [legendId]);

  // Render PDF page
  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    // Cancel previous render task if any
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
    }

    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    setViewport({ w: vp.width, h: vp.height });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const task = page.render({ canvasContext: ctx, viewport: vp });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e: unknown) {
      // RenderingCancelledException is expected when we cancel — ignore
      if (e instanceof Error && e.name !== 'RenderingCancelledException') {
        console.warn('PDF render error:', e.message);
      }
    }
  }, []);

  // Compute fit-to-width zoom — use ResizeObserver so it fires after DOM paint
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;
    let cancelled = false;

    const compute = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const vp = page.getViewport({ scale: 1 });
      if (cancelled || !containerRef.current) return;
      const containerW = containerRef.current.clientWidth - 32;
      if (containerW <= 0) return;
      const fit = Math.max(0.3, containerW / vp.width);
      setFitZoom(fit);
      setZoom(fit);
    };

    // Initial compute
    compute();

    // Re-compute if container resizes (e.g. sidebar toggle, window resize)
    const ro = new ResizeObserver(() => compute());
    ro.observe(containerRef.current);

    return () => { cancelled = true; ro.disconnect(); };
  }, [pdfDoc, currentPage]);

  // Render on page/zoom change
  useEffect(() => {
    if (!pdfDoc) return;
    renderPage(pdfDoc, currentPage, zoom);
  }, [pdfDoc, currentPage, zoom, renderPage]);

  const handleReparse = async () => {
    setReparsing(true);
    setError('');
    try {
      const res = await fetch(`/api/legends/${legendId}/reparse`, { method: 'POST' });
      const data = await res.json() as { inserted?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Re-parse failed');
      const symRes = await fetch(`/api/legends/${legendId}/symbols?include_draft=true`);
      if (symRes.ok) setSymbols(await symRes.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Re-parse failed');
    } finally {
      setReparsing(false);
    }
  };

  const persistSymbol = async (sym: LegendSymbol, patch: Partial<LegendSymbol>) => {
    const payload = {
      asset_type: patch.asset_type ?? sym.asset_type,
      symbol_name: patch.symbol_name !== undefined ? patch.symbol_name : sym.symbol_name,
      tag_pattern: patch.tag_pattern !== undefined ? patch.tag_pattern : sym.tag_pattern,
      description: patch.description !== undefined ? patch.description : sym.description,
      aliases: patch.aliases ?? sym.aliases,
      status: patch.status ?? sym.status,
      bbox_x: patch.bbox_x !== undefined ? patch.bbox_x : sym.bbox_x,
      bbox_y: patch.bbox_y !== undefined ? patch.bbox_y : sym.bbox_y,
      bbox_w: patch.bbox_w !== undefined ? patch.bbox_w : sym.bbox_w,
      bbox_h: patch.bbox_h !== undefined ? patch.bbox_h : sym.bbox_h,
      pid_page: patch.pid_page !== undefined ? patch.pid_page : sym.pid_page,
    };
    const res = await fetch(`/api/legends/${legendId}/symbols/${sym.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Save failed');
    const updated = await res.json() as LegendSymbol;
    setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleApprove = async (symId: string) => {
    try {
      const sym = symbols.find(s => s.id === symId);
      if (!sym) return;
      await persistSymbol(sym, { status: 'ACTIVE' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    }
  };

  const handleReject = async (symId: string) => {
    try {
      const sym = symbols.find(s => s.id === symId);
      if (!sym) return;
      await persistSymbol(sym, { status: 'REJECTED' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    }
  };

  const handleSaveEdit = async () => {
    if (!editForm.asset_type?.trim()) { setError('Asset type required'); return; }
    try {
      const payload = {
        asset_type: editForm.asset_type.trim(),
        symbol_name: editForm.symbol_name?.trim() || null,
        tag_pattern: editForm.tag_pattern?.trim() || null,
        description: editForm.description?.trim() || null,
        aliases: editForm.aliases || [],
        bbox_x: editForm.bbox_x ?? null,
        bbox_y: editForm.bbox_y ?? null,
        bbox_w: editForm.bbox_w ?? null,
        bbox_h: editForm.bbox_h ?? null,
        pid_page: editForm.pid_page ?? null,
        status: editForm.status ?? 'ACTIVE',
      };
      const res = await fetch(`/api/legends/${legendId}/symbols/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json() as LegendSymbol;
      setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
      setEditingId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleFinalize = async () => {
    const draftCount = symbols.filter(s => s.status === 'DRAFT').length;
    if (draftCount > 0 && !confirm(`${draftCount} symbols still in draft. Finalize anyway?`)) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/legends/${legendId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error('Finalize failed');
      router.push(`/legends/${legendId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  };

  const activeCount = symbols.filter(s => s.status === 'ACTIVE').length;
  const draftCount = symbols.filter(s => s.status === 'DRAFT').length;
  const rejectedCount = symbols.filter(s => s.status === 'REJECTED').length;

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>
  );
  if (!legend) return (
    <div className="text-center py-12 text-zinc-500">Legend not found</div>
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{legend.name}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Review and approve extracted symbols</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReparse}
            disabled={reparsing}
            className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {reparsing ? (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Re-parsing…
              </span>
            ) : '↺ Re-parse PDF'}
          </button>
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {finalizing ? 'Finalizing…' : 'Finalize & Activate'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: symbols.length, color: 'text-zinc-800 dark:text-zinc-100' },
          { label: 'Active', value: activeCount, color: 'text-emerald-600' },
          { label: 'Draft', value: draftCount, color: 'text-yellow-600' },
          { label: 'Rejected', value: rejectedCount, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">{s.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <div className="flex gap-2">
            {error.includes('sibuk') && (
              <button onClick={handleReparse} className="px-2 py-1 text-xs font-semibold bg-red-100 rounded">Coba Lagi</button>
            )}
            <button onClick={() => setError('')} className="ml-3 text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      {/* Hint when symbols empty */}
      {symbols.length === 0 && !reparsing && (
        <div className="rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-600 p-6 text-center text-sm text-zinc-500">
          No symbols extracted yet. Click <strong>↺ Re-parse PDF</strong> to run AI analysis on the legend PDF.
        </div>
      )}

      {/* Main layout: PDF viewer + Symbols panel */}
      <div className="flex gap-4 flex-1 min-h-0" style={{ minHeight: 520 }}>
        {/* PDF Viewer */}
        <div className="flex-1 min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-shrink-0">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">PDF Preview</span>
            <div className="flex items-center gap-2">
              {/* Page nav */}
              {pdfPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40">◀</button>
                  <span className="text-xs text-zinc-500 w-14 text-center">{currentPage}/{pdfPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(pdfPages, p + 1))} disabled={currentPage === pdfPages}
                    className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40">▶</button>
                </div>
              )}
              {/* Zoom */}
              <div className="flex items-center gap-1">
                <button onClick={() => setZoom(z => Math.max(0.3, +(z - 0.2).toFixed(1)))}
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700">−</button>
                <span className="text-xs text-zinc-500 w-9 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(4, +(z + 0.2).toFixed(1)))}
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700">+</button>
                <button onClick={() => setZoom(fitZoom)} title="Fit to width"
                  className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700">⊡</button>
              </div>
            </div>
          </div>
          {/* Canvas + Overlay — wrapper is inline-block sized to canvas so SVG aligns exactly */}
          <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-900 p-2 flex items-start justify-center">
            <div className="relative inline-block shadow-md">
              <canvas
                ref={canvasRef}
                className="block"
                style={{ background: '#fff', display: 'block' }}
              />
              {/* ponytail: SVG overlay uses same 0-1000 normalized bbox space as detection viewer; page sync via pid_page */}
              {viewport && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full"
                  style={{ pointerEvents: 'none' }}
                >
                  {symbols
                    .filter(s => (s.pid_page ?? 1) === currentPage && s.bbox_x !== null && s.bbox_w !== null)
                    .map(sym => {
                      const isSelected = sym.id === selectedId;
                      // bbox already 0-1000 normalized — same as detection; svg viewBox is 0 0 1000 1000 so coords map 1:1
                      const x = sym.bbox_x!;
                      const y = sym.bbox_y!;
                      const w = sym.bbox_w!;
                      const h = sym.bbox_h!;
                      // marker/highlighter style: selected = solid fill + pulse, unselected = dashed outline
                      const color = sym.status === 'REJECTED' ? '#ef4444' : isSelected ? '#f59e0b' : '#10b981';
                      const label = (sym.symbol_name ?? sym.asset_type).slice(0, 18);
                      const labelW = Math.min(120, Math.max(w, 80));
                      const labelY = y > 22 ? y - 18 : y + h + 2;
                      const curBbox = dragBbox?.id === sym.id ? dragBbox : null;
                      const rx = curBbox ? curBbox.x : x;
                      const ry = curBbox ? curBbox.y : y;
                      return (
                        <g
                          key={sym.id}
                          data-bbox="true"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedId(sym.id);
                            // scroll card into view
                            cardRefs.current[sym.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }}
                          onMouseDown={e => {
                            e.stopPropagation();
                            if (isSelected && viewport) {
                              setDragBbox({ id: sym.id, x: rx, y: ry, w, h, startX: e.clientX, startY: e.clientY, origX: rx, origY: ry });
                            } else {
                              setSelectedId(sym.id);
                            }
                          }}
                          style={{ pointerEvents: 'all', cursor: isSelected ? 'move' : 'pointer' }}
                        >
                          {/* hit area — larger than symbol for easier clicking */}
                          <rect x={rx - 5} y={ry - 5} width={w + 10} height={h + 10} fill="transparent" />
                          {/* highlight — like a marker/stabilo */}
                          <rect
                            x={rx} y={ry} width={w} height={h}
                            fill={isSelected ? '#fbbf24' : '#fbbf24'}
                            fillOpacity={isSelected ? 0.6 : 0.4}
                            stroke={color}
                            strokeWidth={isSelected ? 3 : 1.5}
                            strokeDasharray={isSelected ? undefined : '6 3'}
                            rx={2}
                            className={isSelected ? 'animate-pulse' : ''}
                            style={{ filter: isSelected ? 'drop-shadow(0 0 4px rgba(251, 191, 36, 0.8))' : undefined }}
                          />
                          {/* label pill */}
                          <rect x={rx} y={labelY} width={labelW} height={14} rx={3} fill={color} opacity={isSelected ? 1 : 0.9} />
                          <text x={rx + 3} y={labelY + 10} fill="white" fontSize={8} fontFamily="ui-monospace, monospace" fontWeight={isSelected ? 700 : 500}>
                            {label}
                          </text>
                        </g>
                      );
                    })}
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Symbols Panel */}
        <div className="w-80 flex-shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Symbols</span>
            <span className="text-xs text-zinc-400">{symbols.length} total</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {symbols.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">
                No symbols yet.<br/>Click ↺ Re-parse PDF
              </p>
            ) : (
              symbols.map(sym => (
                <div
                  key={sym.id}
                  ref={el => { cardRefs.current[sym.id] = el; }}
                  onClick={() => {
                    const next = sym.id === selectedId ? null : sym.id;
                    setSelectedId(next);
                    if (next && sym.pid_page && sym.pid_page !== currentPage) {
                      setCurrentPage(sym.pid_page);
                    }
                  }}
                  className={`cursor-pointer rounded-lg px-3 py-2.5 border text-xs transition-colors ${
                    sym.id === selectedId
                      ? 'ring-2 ring-blue-400 dark:ring-blue-500'
                      : ''
                  } ${
                    sym.status === 'ACTIVE'
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                      : sym.status === 'REJECTED'
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 opacity-60'
                      : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10'
                  }`}
                >
                  {/* Symbol info */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{sym.asset_type}</p>
                      {sym.symbol_name && (
                        <p className="text-zinc-500 truncate">{sym.symbol_name}</p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full ${
                      sym.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : sym.status === 'REJECTED'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                        : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                    }`}>
                      {sym.status}
                    </span>
                  </div>

                  {sym.tag_pattern && (
                    <p className="text-zinc-400 font-mono text-xs mb-1.5">Tag: {sym.tag_pattern}</p>
                  )}
                  {sym.description && (
                    <p className="text-zinc-500 text-xs mb-1.5 line-clamp-2">{sym.description}</p>
                  )}

                  {/* Actions */}
                  {sym.status !== 'REJECTED' && (
                    <div className="flex gap-1 mt-1">
                      {sym.status === 'DRAFT' && (
                        <button
                          onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}
                          className="flex-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setEditingId(sym.id); setEditForm(sym); }}
                        className="flex-1 px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs font-medium"
                      >
                        Edit
                      </button>
                      {sym.status !== 'REJECTED' && (
                        <button
                          onClick={e => { e.stopPropagation(); handleReject(sym.id); }}
                          className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-xs font-medium"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                  {sym.status === 'REJECTED' && (
                    <button
                      onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}
                      className="w-full px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700 text-xs mt-1"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Bulk approve all draft */}
          {draftCount > 0 && (
            <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => symbols.filter(s => s.status === 'DRAFT').forEach(s => handleApprove(s.id))}
                className="w-full px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
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
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset Type *</span>
                <input
                  value={editForm.asset_type || ''}
                  onChange={e => setEditForm(f => ({ ...f, asset_type: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Symbol Name</span>
                <input
                  value={editForm.symbol_name || ''}
                  onChange={e => setEditForm(f => ({ ...f, symbol_name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Tag Pattern</span>
                <input
                  value={editForm.tag_pattern || ''}
                  onChange={e => setEditForm(f => ({ ...f, tag_pattern: e.target.value }))}
                  placeholder="e.g. P-###"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</span>
                <textarea
                  value={editForm.description || ''}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Bounding Box</span>
                <div className="grid grid-cols-4 gap-1">
                  <div>
                    <span className="text-xs text-zinc-500">X</span>
                    <input
                      value={editForm.bbox_x ?? ''}
                      onChange={e => setEditForm(f => ({ ...f, bbox_x: parseInt(e.target.value) || null }))}
                      type="number"
                      className="mt-0.5 w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500">Y</span>
                    <input
                      value={editForm.bbox_y ?? ''}
                      onChange={e => setEditForm(f => ({ ...f, bbox_y: parseInt(e.target.value) || null }))}
                      type="number"
                      className="mt-0.5 w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500">W</span>
                    <input
                      value={editForm.bbox_w ?? ''}
                      onChange={e => setEditForm(f => ({ ...f, bbox_w: parseInt(e.target.value) || null }))}
                      type="number"
                      className="mt-0.5 w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500">H</span>
                    <input
                      value={editForm.bbox_h ?? ''}
                      onChange={e => setEditForm(f => ({ ...f, bbox_h: parseInt(e.target.value) || null }))}
                      type="number"
                      className="mt-0.5 w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">P&ID Page</span>
                <input
                  value={editForm.pid_page ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, pid_page: parseInt(e.target.value) || null }))}
                  type="number"
                  min={1}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black text-sm font-semibold hover:opacity-90"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="flex-1 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
