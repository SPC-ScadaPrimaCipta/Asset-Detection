'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import * as pdfjsLib from 'pdfjs-dist';

// Set PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
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
}

interface SymbolWithBbox extends LegendSymbol {
  bbox_x?: number;
  bbox_y?: number;
  bbox_w?: number;
  bbox_h?: number;
  page?: number;
}

export default function LegendReviewPage() {
  const params = useParams();
  const router = useRouter();
  const legendId = params.id as string;

  const [legend, setLegend] = useState<Legend | null>(null);
  const [symbols, setSymbols] = useState<SymbolWithBbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfCanvas, setPdfCanvas] = useState<HTMLCanvasElement | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.5);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState('');

  // Load legend and symbols
  useEffect(() => {
    const load = async () => {
      try {
        const [legRes, symRes] = await Promise.all([
          fetch(`/api/legends/${legendId}`),
          fetch(`/api/legends/${legendId}/symbols?include_draft=true`),
        ]);
        if (!legRes.ok || !symRes.ok) throw new Error('Load failed');
        setLegend(await legRes.json());
        setSymbols(await symRes.json());
        setPdfUrl(`/api/legends/${legendId}/pdf`);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [legendId]);

  // Render PDF page with symbol overlay
  useEffect(() => {
    if (!pdfUrl || !pdfCanvas) return;
    const render = async () => {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      setPdfPages(pdf.numPages);
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: zoom });
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      const ctx = pdfCanvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Draw symbol bboxes
      const pageSyms = symbols.filter(s => (s.page === currentPage || !s.page) && s.bbox_x != null);
      pageSyms.forEach(sym => {
        if (!sym.bbox_x || !sym.bbox_y || !sym.bbox_w || !sym.bbox_h) return;
        const x = (sym.bbox_x / 1000) * viewport.width;
        const y = (sym.bbox_y / 1000) * viewport.height;
        const w = (sym.bbox_w / 1000) * viewport.width;
        const h = (sym.bbox_h / 1000) * viewport.height;

        const selected = sym.id === selectedSymbolId;
        const color = sym.status === 'ACTIVE' ? '#10b981' : sym.status === 'REJECTED' ? '#ef4444' : '#f59e0b';

        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 3 : 2;
        ctx.setLineDash(selected ? [] : [6, 3]);
        ctx.strokeRect(x, y, w, h);

        // Label
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x, y - 20, Math.max(w, 80), 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = '11px monospace';
        ctx.fillText(sym.asset_type.slice(0, 12), x + 4, y - 6);
      });
    };
    render().catch(() => {});
  }, [pdfUrl, currentPage, pdfCanvas, symbols, selectedSymbolId, zoom]);

  const pageSymbols = symbols.filter(s => s.page === currentPage || !s.page);
  const draftCount = symbols.filter(s => s.status === 'DRAFT').length;
  const rejectedCount = symbols.filter(s => s.status === 'REJECTED').length;

  const handleEdit = (sym: SymbolWithBbox) => {
    setEditingId(sym.id);
    setEditForm(sym);
  };

  const handleSaveEdit = async () => {
    if (!editForm.asset_type?.trim()) {
      setError('Asset type required');
      return;
    }
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: editForm.asset_type.trim(),
          symbol_name: editForm.symbol_name?.trim() || null,
          tag_pattern: editForm.tag_pattern?.trim() || null,
          description: editForm.description?.trim() || null,
          aliases: editForm.aliases || [],
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApprove = async (symId: string) => {
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${symId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error('Approve failed');
      const updated = await res.json();
      setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async (symId: string) => {
    try {
      const res = await fetch(`/api/legends/${legendId}/symbols/${symId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED' }),
      });
      if (!res.ok) throw new Error('Reject failed');
      const updated = await res.json();
      setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFinalize = async () => {
    if (draftCount > 0 && !confirm(`${draftCount} symbols still in draft. Continue?`)) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/legends/${legendId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error('Finalize failed');
      router.push(`/legends/${legendId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-zinc-400">Loading…</div>;
  }

  if (!legend) {
    return <div className="text-center py-12">Legend not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{legend.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">Review and approve extracted symbols</p>
        </div>
        <button
          onClick={handleFinalize}
          disabled={finalizing}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {finalizing ? 'Finalizing…' : 'Finalize & Activate'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs text-zinc-500">Total</p>
          <p className="text-lg font-bold">{symbols.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs text-zinc-500">Active</p>
          <p className="text-lg font-bold text-emerald-600">{symbols.filter(s => s.status === 'ACTIVE').length}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs text-zinc-500">Draft</p>
          <p className="text-lg font-bold text-yellow-600">{draftCount}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <p className="text-xs text-zinc-500">Rejected</p>
          <p className="text-lg font-bold text-red-600">{rejectedCount}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Main layout: PDF + Symbols */}
      <div className="grid grid-cols-3 gap-6">
        {/* PDF Viewer */}
        <div className="col-span-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-4 space-y-3">
          <h2 className="text-sm font-semibold">PDF Preview</h2>
          <div className="bg-white dark:bg-zinc-900 rounded flex items-center justify-center" style={{ minHeight: 500 }}>
            <canvas
              ref={setPdfCanvas}
              className="max-w-full max-h-96"
              style={{ border: '1px solid #e5e7eb' }}
            />
          </div>
          <div className="flex items-center justify-center gap-2">
            {pdfPages > 1 && (
              <>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-1 rounded border border-zinc-300 text-sm disabled:opacity-40"
                >
                  ◀
                </button>
                <span className="text-sm text-zinc-500">
                  Page {currentPage} / {pdfPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(pdfPages, p + 1))}
                  disabled={currentPage === pdfPages}
                  className="px-2 py-1 rounded border border-zinc-300 text-sm disabled:opacity-40"
                >
                  ▶
                </button>
              </>
            )}
            {/* Zoom controls */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.2))}
                className="px-2 py-1 rounded border border-zinc-300 text-sm"
              >
                −
              </button>
              <span className="text-xs text-zinc-500 w-8 text-center">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(z => Math.min(3, z + 0.2))}
                className="px-2 py-1 rounded border border-zinc-300 text-sm"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Symbols Panel */}
        <div className="col-span-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">Symbols</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 p-3">
            {pageSymbols.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-4">No symbols on this page</p>
            ) : (
              pageSymbols.map(sym => (
                <div
                  key={sym.id}
                  onClick={() => setSelectedSymbolId(sym.id)}
                  className={`cursor-pointer rounded-lg p-3 border text-xs space-y-2 ${
                    sym.id === selectedSymbolId ? 'ring-2 ring-blue-400' : ''
                  } ${
                    sym.status === 'ACTIVE'
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                      : sym.status === 'REJECTED'
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
                      : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10'
                  }`}
                >
                  <div>
                    <p className="font-medium">{sym.asset_type}</p>
                    {sym.symbol_name && <p className="text-zinc-500">{sym.symbol_name}</p>}
                  </div>
                  <div className="flex gap-1">
                    {sym.status === 'DRAFT' && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); handleApprove(sym.id); }}
                          className="flex-1 px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleEdit(sym); }}
                          className="flex-1 px-2 py-1 rounded bg-zinc-300 dark:bg-zinc-600 text-xs hover:bg-zinc-400"
                        >
                          Edit
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleReject(sym.id); }}
                          className="flex-1 px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="font-semibold">Edit Symbol</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Asset Type *</label>
                <input
                  value={editForm.asset_type || ''}
                  onChange={e => setEditForm({ ...editForm, asset_type: e.target.value })}
                  className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Symbol Name</label>
                <input
                  value={editForm.symbol_name || ''}
                  onChange={e => setEditForm({ ...editForm, symbol_name: e.target.value })}
                  className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Tag Pattern</label>
                <input
                  value={editForm.tag_pattern || ''}
                  onChange={e => setEditForm({ ...editForm, tag_pattern: e.target.value })}
                  className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-sm"
                  placeholder="e.g. P-###"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                className="flex-1 px-3 py-2 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black font-medium text-sm hover:opacity-90"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="flex-1 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
