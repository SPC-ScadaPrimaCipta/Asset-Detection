'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import * as pdfjsLib from 'pdfjs-dist';

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

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: '500',
};

function StatusBadge({ reviewStatus }: { reviewStatus: string }) {
  const badge =
    reviewStatus === 'ACTIVE'
      ? { ...badgeBase, background: 'var(--success-soft)', color: 'var(--success)' }
      : reviewStatus === 'REJECTED'
      ? { ...badgeBase, background: 'var(--danger-soft)', color: 'var(--danger)' }
      : { ...badgeBase, background: 'var(--warning-soft)', color: 'var(--warning)' };
  return <span style={badge}>{reviewStatus}</span>;
}

function Spinner({ size = 16 }: { size?: number } = {}) {
  return (
    <svg style={{ width: size, height: size, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
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
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1.0);
  const [renderScale, setRenderScale] = useState(2.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showCards, setShowCards] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LegendSymbol>>({});
  const [finalizing, setFinalizing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [dragBbox, setDragBbox] = useState<any>(null);

  // Interaction handlers (keep original logic)
  const handleWheel = (e: React.WheelEvent) => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.1 : 0.1; setZoom(prev => Math.max(0.3, Math.min(5, prev + delta))); };
  const handleMouseDown = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('[data-bbox]')) return; setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); };
  const handleMouseMove = (e: React.MouseEvent) => { if (!dragging) return; setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp = () => { setDragging(false); };

  // Sync / Fetch effects (same as original)
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

  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width;
    canvas.height = vp.height;
    setViewport({ w: vp.width, h: vp.height });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport: vp });
    renderTaskRef.current = task;
    try { await task.promise; } catch (e) {}
  }, []);

  useEffect(() => {
    if (!pdfDoc || renderScale === null) return;
    renderPage(pdfDoc, currentPage, renderScale);
  }, [pdfDoc, currentPage, renderScale, renderPage]);

  // Persist handlers (same as original)
  const persistSymbol = async (sym: LegendSymbol, patch: Partial<LegendSymbol>) => {
    const res = await fetch(`/api/legends/${legendId}/symbols/${sym.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sym, ...patch }),
    });
    if (!res.ok) throw new Error('Save failed');
    const updated = await res.json() as LegendSymbol;
    setSymbols(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleApprove = async (symId: string) => {
    const sym = symbols.find(s => s.id === symId);
    if (!sym) return;
    await persistSymbol(sym, { status: 'ACTIVE' });
  };

  const handleReject = async (symId: string) => {
    const sym = symbols.find(s => s.id === symId);
    if (!sym) return;
    await persistSymbol(sym, { status: 'REJECTED' });
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      await fetch(`/api/legends/${legendId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      router.push(`/legends/${legendId}`);
    } catch {
      setError('Finalize failed');
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) return <div style={{ padding: '96px 0', textAlign: 'center' }}>Loading…</div>;
  if (!legend) return <div style={{ padding: '64px 0', textAlign: 'center' }}>Legend not found.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--foreground)', margin: 0 }}>{legend.name}</h1>
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>Review and approve extracted symbols</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setReparsing(true)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>↺ Re-parse</button>
          <button onClick={handleFinalize} disabled={finalizing} style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)', background: 'var(--success)', color: 'var(--surface)', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: finalizing ? 0.6 : 1 }}>{finalizing ? 'Finalizing…' : 'Finalize & Activate'}</button>
        </div>
      </div>

      {/* Main workspace */}
      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 600 }}>
        {/* Viewer */}
        <div style={{ ...cardStyle, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
             <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)' }}>PDF Preview</span>
             <button onClick={() => setShowCards(!showCards)} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>{showCards ? 'Hide Symbols' : 'Show Symbols'}</button>
          </div>
          <div ref={viewerRef} style={{ flex: 1, overflow: 'hidden', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: dragging ? 'grabbing' : 'grab' }} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'top left' }}>
              <canvas ref={canvasRef} style={{ background: '#fff', display: 'block' }} />
            </div>
          </div>
        </div>

        {/* Sidebar panel */}
        {showCards && (
          <aside style={{ ...cardStyle, width: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--foreground)' }}>Symbols</span>
              <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{symbols.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {symbols.map(sym => (
                <div key={sym.id} style={{ ...cardStyle, padding: '12px', cursor: 'pointer', border: sym.id === selectedId ? '1px solid var(--accent)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--foreground)' }}>{sym.asset_type}</span>
                    <StatusBadge reviewStatus={sym.status} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleApprove(sym.id)} style={{ flex: 1, padding: '4px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--success-soft)', color: 'var(--success)', fontSize: '11px', fontWeight: '500', cursor: 'pointer' }}>Approve</button>
                    <button onClick={() => handleReject(sym.id)} style={{ flex: 1, padding: '4px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: '11px', fontWeight: '500', cursor: 'pointer' }}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
