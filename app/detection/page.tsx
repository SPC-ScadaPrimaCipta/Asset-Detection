'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project { id: string; name: string }
interface Document { id: string; filename: string; page_count: number; status: string }
interface Legend { id: string; name: string }
interface DetectionJob {
  id: string; status: string; progress_pct: number;
  document_id: string; legend_id: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
  error_detail?: string | null;
}
interface Detection {
  id: string; asset_tag: string | null; asset_type: string;
  description: string | null; equipment_class: string | null;
  pid_page: number | null; confidence: number | null;
  detection_status: string; review_status: string;
  bbox_x: number | null; bbox_y: number | null;
  bbox_w: number | null; bbox_h: number | null;
  evidence: string[] | string | null;
  service: string | null; location: string | null;
  unit: string | null; area: string | null;
  legend_id: string | null; legend_symbol_id: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function confBadge(c: number | null) {
  if (c === null) return <span className="text-xs text-zinc-400">—</span>;
  const pct = Math.round(c * 100);
  const cls = c >= 0.95
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    : c >= 0.80
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{pct}%</span>;
}

function statusBadge(ds: string, rs: string) {
  const label = ds === 'MANUAL' ? 'Manual' : rs === 'APPROVED' ? 'Confirmed' : rs === 'REJECTED' ? 'Rejected' : ds === 'DETECTED' ? 'Detected' : ds;
  const cls =
    rs === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    : rs === 'REJECTED' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function parseEvidence(ev: string[] | string | null): string[] {
  if (!ev) return [];
  if (Array.isArray(ev)) return ev;
  try { const p = JSON.parse(ev); return Array.isArray(p) ? p : [String(p)]; } catch { return [String(ev)]; }
}

// ─── ManualAddModal ───────────────────────────────────────────────────────────

function ManualAddModal({
  open,
  onClose,
  onSave,
  documentId,
  legendId,
  jobId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  documentId: string;
  legendId: string;
  jobId: string | null;
}) {
  const [assetType, setAssetType] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [description, setDescription] = useState('');
  const [pidPage, setPidPage] = useState('');
  // BBox — 0-1000 normalized coordinate space (same as AI detections)
  const [bboxX, setBboxX] = useState('0');
  const [bboxY, setBboxY] = useState('0');
  const [bboxW, setBboxW] = useState('100');
  const [bboxH, setBboxH] = useState('100');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAssetType('');
      setAssetTag('');
      setDescription('');
      setPidPage('');
      setBboxX('0');
      setBboxY('0');
      setBboxW('100');
      setBboxH('100');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const numField = (val: string, set: (v: string) => void, label: string, hint: string) => (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="text-xs text-zinc-400 ml-1 normal-case">{hint}</span>
      <input
        type="number"
        min={0}
        max={1000}
        value={val}
        onChange={e => set(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetType.trim()) {
      setError('Asset Type is required.');
      return;
    }
    const bx = Math.max(0, Math.min(1000, parseInt(bboxX, 10) || 0));
    const by = Math.max(0, Math.min(1000, parseInt(bboxY, 10) || 0));
    const bw = Math.max(1, Math.min(1000 - bx, parseInt(bboxW, 10) || 100));
    const bh = Math.max(1, Math.min(1000 - by, parseInt(bboxH, 10) || 100));

    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/detections/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: assetType.trim(),
          asset_tag: assetTag.trim() || null,
          description: description.trim() || null,
          pid_page: pidPage ? parseInt(pidPage, 10) : null,
          document_id: documentId,
          legend_id: legendId || null,
          job_id: jobId,
          bbox_x: bx,
          bbox_y: by,
          bbox_w: bw,
          bbox_h: bh,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-md w-full mx-auto mt-20 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Add Asset Manually</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Asset Type (required) */}
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Asset Type <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              required
              value={assetType}
              onChange={e => setAssetType(e.target.value)}
              placeholder="e.g. PUMP, VALVE, COMPRESSOR"
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {/* Asset Tag */}
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset Tag</span>
            <input
              type="text"
              value={assetTag}
              onChange={e => setAssetTag(e.target.value)}
              placeholder="e.g. P-101A"
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </label>

          {/* P&ID Page */}
          <label className="block">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">P&amp;ID Page</span>
            <input
              type="number"
              min={1}
              value={pidPage}
              onChange={e => setPidPage(e.target.value)}
              placeholder="Page number"
              className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {/* Bounding Box */}
          <div>
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider block mb-1">
              Bounding Box
              <span className="text-zinc-400 normal-case font-normal ml-1">— 0–1000 normalized coordinate space</span>
            </span>
            <div className="grid grid-cols-2 gap-3">
              {numField(bboxX, setBboxX, 'X', '(left edge)')}
              {numField(bboxY, setBboxY, 'Y', '(top edge)')}
              {numField(bboxW, setBboxW, 'Width', '')}
              {numField(bboxH, setBboxH, 'Height', '')}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Saving…' : 'Save Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── JobProgress ─────────────────────────────────────────────────────────────

function JobProgress({ jobId, onComplete }: { jobId: string; onComplete: () => void }) {
  const [job, setJob] = useState<DetectionJob | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    doneRef.current = false;
    const poll = async () => {
      const r = await fetch(`/api/detection/jobs/${jobId}`);
      if (!r.ok) return;
      const j: DetectionJob = await r.json();
      setJob(j);
      if ((j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'CANCELLED') && !doneRef.current) {
        doneRef.current = true;
        onComplete();
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [jobId, onComplete]);

  if (!job) return null;

  const statusColor =
    job.status === 'COMPLETED' ? 'bg-emerald-500'
    : job.status === 'FAILED' ? 'bg-red-500'
    : job.status === 'CANCELLED' ? 'bg-zinc-400'
    : 'bg-blue-500';

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Detection Job
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${statusColor}`}>
          {job.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${statusColor}`}
          style={{ width: `${job.progress_pct ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500">{job.progress_pct ?? 0}% complete</p>

      {job.status === 'PROCESSING' && (
        <p className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">Analyzing P&ID with AI…</p>
      )}
      {job.status === 'FAILED' && job.error_detail && (
        <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded p-2 font-mono">
          {job.error_detail.slice(0, 300)}
        </p>
      )}

      {/* Cancel button */}
      {(job.status === 'PENDING' || job.status === 'PROCESSING') && (
        <button
          onClick={async () => {
            await fetch(`/api/detection/jobs/${jobId}/cancel`, { method: 'POST' });
          }}
          className="text-xs text-red-600 hover:text-red-700 underline"
        >
          Cancel job
        </button>
      )}
    </div>
  );
}

// ─── PidViewer ───────────────────────────────────────────────────────────────

function PidViewer({
  documentId,
  detections,
  selectedId,
  onSelect,
  page,
  totalPages,
  onPageChange,
}: {
  documentId: string;
  detections: Detection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [fullscreen, setFullscreen] = useState(false);
  // Natural image dimensions — used to map bbox coords to display space
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [imgLoading, setImgLoading] = useState(!!documentId);
  const [imgError, setImgError] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const imgSrc = documentId ? `/api/documents/${documentId}/pages/${page}/image` : null;

  // Reset image state on page or document change
  useEffect(() => {
    setImgNatural(null);
    setImgLoading(!!documentId);
    setImgError(false);
  }, [documentId, page]);

  // Reset pan/zoom/rotation when page changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [page]);

  // ESC exits fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const visible = detections.filter(
    d => d.detection_status !== 'REJECTED' && d.review_status !== 'REJECTED'
       && d.bbox_x !== null && d.bbox_y !== null && d.bbox_w !== null && d.bbox_h !== null
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(prev => Math.max(0.2, Math.min(6, prev + delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bbox]')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setDragging(false);

  const rotate = () => setRotation(r => (r + 90) % 360);
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); setRotation(0); };

  // Build CSS transform: rotation applied first, then zoom+pan
  const imgTransform = `rotate(${rotation}deg)`;
  const containerTransform = `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`;

  const viewerContent = (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-wrap">
        {/* Page nav */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}
              className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-700">◀</button>
            <span className="text-xs text-zinc-500 px-2 font-medium">Page {page} / {totalPages}</span>
            <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
              className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-700">▶</button>
          </div>
        )}

        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 hidden sm:block" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(0.2, +(z - 0.2).toFixed(1)))}
            className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 font-bold">−</button>
          <span className="text-xs text-zinc-500 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(6, +(z + 0.2).toFixed(1)))}
            className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 font-bold">+</button>
        </div>

        {/* Rotate button */}
        <button
          onClick={rotate}
          title="Rotate 90°"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Rotate{rotation > 0 ? ` (${rotation}°)` : ''}
        </button>

        {/* Reset */}
        <button onClick={resetView}
          title="Reset view"
          className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
          Reset
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-400">{visible.length} bbox</span>
          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
          >
            {fullscreen ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
            {fullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {/* Viewer area */}
      <div
        className="relative bg-zinc-100 dark:bg-zinc-800 overflow-hidden select-none flex-1"
        style={{ minHeight: fullscreen ? 'calc(100vh - 80px)' : 600 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        ref={viewerRef}
      >
        {/* Transformed container — zoom + pan, centered */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          {/* Inner wrapper takes zoom+pan transform */}
          <div style={{
            transform: containerTransform,
            transformOrigin: 'center center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {imgSrc && (
              <div
                className="relative shadow-lg"
                style={{
                  transform: imgTransform,
                  transformOrigin: 'center center',
                  lineHeight: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={imgSrc}
                  src={imgSrc}
                  alt={`P&ID page ${page}`}
                  onLoad={e => {
                    const img = e.currentTarget;
                    setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    setImgLoading(false);
                    setImgError(false);
                  }}
                  onError={() => { setImgLoading(false); setImgError(true); }}
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    opacity: imgLoading ? 0 : 1,
                    transition: 'opacity 0.2s ease',
                  }}
                  draggable={false}
                />

                {/* SVG bbox overlay */}
                {imgNatural && !imgError && (
                  <svg
                    viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      overflow: 'visible', pointerEvents: 'none',
                    }}
                  >
                    {visible.map(d => {
                      const x = (d.bbox_x ?? 0) / 1000 * imgNatural.w;
                      const y = (d.bbox_y ?? 0) / 1000 * imgNatural.h;
                      const w = (d.bbox_w ?? 50) / 1000 * imgNatural.w;
                      const h = (d.bbox_h ?? 50) / 1000 * imgNatural.h;
                      const selected = d.id === selectedId;
                      const color = d.review_status === 'APPROVED'
                        ? '#10b981'
                        : (d.confidence ?? 0) >= 0.95 ? '#3b82f6'
                        : (d.confidence ?? 0) >= 0.80 ? '#f59e0b'
                        : '#ef4444';
                      const labelW = Math.max(w, 80);
                      const labelY = y > 22 ? y - 22 : y + h + 4;
                      return (
                        <g key={d.id} data-bbox="true" onClick={() => onSelect(d.id)} style={{ pointerEvents: 'all', cursor: 'pointer' }}>
                          <rect x={x} y={y} width={w} height={h} fill="transparent" />
                          <rect x={x} y={y} width={w} height={h}
                            fill={selected ? `${color}18` : 'none'}
                            stroke={color} strokeWidth={selected ? 3 : 2}
                            strokeDasharray={selected ? undefined : '8 4'} rx={3}
                            opacity={selected ? 1 : 0.85} />
                          <rect x={x} y={labelY} width={labelW} height={20} fill={color} rx={3} opacity={selected ? 1 : 0.85} />
                          <text x={x + 5} y={labelY + 14} fill="white" fontSize={13}
                            fontFamily="ui-monospace, monospace" fontWeight={selected ? 700 : 400}>
                            {(d.asset_tag ?? d.asset_type).slice(0, 16)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
            )}

            {/* Loading */}
            {imgLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                  <svg style={{ width: 32, height: 32, margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
                    <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  <p style={{ fontSize: 12 }}>Rendering page {page}…</p>
                </div>
              </div>
            )}

            {/* Error / empty */}
            {(imgError || !imgSrc) && !imgLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: '#475569' }}>
                  <svg style={{ width: 56, height: 56, margin: '0 auto 8px' }} fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p style={{ fontSize: 13 }}>{imgError ? 'Failed to load page' : 'Select document to view'}</p>
                  <p style={{ fontSize: 11, marginTop: 4 }}>{imgError ? 'Check server logs' : 'Run detection to see bounding boxes'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend bar */}
      <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 flex gap-4 flex-wrap text-xs text-zinc-500 bg-white dark:bg-zinc-900">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-blue-500 rounded"/>&ge;95% High</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-yellow-500 rounded"/>&ge;80% Medium</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-red-500 rounded"/>Review</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-emerald-500 rounded"/>Confirmed</span>
        <span className="ml-auto text-zinc-400 text-xs">Scroll to zoom · Drag to pan · Click bbox to select</span>
      </div>
    </>
  );

  // Fullscreen overlay
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
        <div className="flex flex-col flex-1 min-h-0">
          {viewerContent}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col" style={{ minHeight: 480 }}>
      {viewerContent}
    </div>
  );
}

// ─── AssetDetail ─────────────────────────────────────────────────────────────

function AssetDetail({
  detection,
  onClose,
  onConfirm,
  onReject,
  onEdit,
}: {
  detection: Detection;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onEdit: (id: string, fields: Partial<Detection>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editTag, setEditTag] = useState(detection.asset_tag ?? '');
  const [editType, setEditType] = useState(detection.asset_type);
  const [editDesc, setEditDesc] = useState(detection.description ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onEdit(detection.id, {
      asset_tag: editTag || null,
      asset_type: editType,
      description: editDesc || null,
    } as Partial<Detection>);
    setSaving(false);
    setEditing(false);
  };

  const ev = parseEvidence(detection.evidence);
  const pct = detection.confidence !== null ? Math.round(detection.confidence * 100) : null;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">
          {detection.asset_tag ?? detection.asset_type}
        </span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none">&times;</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {!editing ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              ['Asset Tag', detection.asset_tag ?? '—'],
              ['Asset Type', detection.asset_type],
              ['Equipment Class', detection.equipment_class ?? '—'],
              ['Description', detection.description ?? '—'],
              ['P&ID Page', detection.pid_page !== null ? String(detection.pid_page) : '—'],
              ['Service', detection.service ?? '—'],
              ['Location', detection.location ?? '—'],
              ['Unit', detection.unit ?? '—'],
              ['Area', detection.area ?? '—'],
              ['Confidence', pct !== null ? `${pct}%` : '—'],
              ['Detection Status', detection.detection_status],
              ['Review Status', detection.review_status],
            ].map(([k, v]) => (
              <div key={k} className="col-span-1">
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{k}</dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{v}</dd>
              </div>
            ))}

            {/* BBox */}
            <div className="col-span-2">
              <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Bounding Box</dt>
              <dd className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                x={detection.bbox_x} y={detection.bbox_y} w={detection.bbox_w} h={detection.bbox_h}
              </dd>
            </div>

            {/* Evidence */}
            {ev.length > 0 && (
              <div className="col-span-2">
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Evidence</dt>
                <ul className="space-y-1">
                  {ev.map((e, i) => (
                    <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400 flex gap-1.5">
                      <span className="text-blue-500 mt-0.5">•</span>{e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset Tag</span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
                value={editTag}
                onChange={e => setEditTag(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset Type</span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm"
                value={editType}
                onChange={e => setEditType(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</span>
              <textarea
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm resize-none"
                rows={3}
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 flex gap-2">
        {detection.review_status !== 'APPROVED' && detection.review_status !== 'REJECTED' && (
          <>
            <button
              onClick={() => onConfirm(detection.id)}
              className="flex-1 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Confirm
            </button>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                Edit
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <button
              onClick={() => onReject(detection.id)}
              className="flex-1 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
            >
              Reject
            </button>
          </>
        )}
        {editing && (
          <button onClick={() => setEditing(false)} className="py-1.5 px-3 rounded-md border border-zinc-300 text-xs text-zinc-600">
            Cancel
          </button>
        )}
        {(detection.review_status === 'APPROVED' || detection.review_status === 'REJECTED') && (
          <span className="text-xs text-zinc-400 italic">Reviewed — {detection.review_status.toLowerCase()}</span>
        )}
      </div>
    </div>
  );
}

// ─── DetectionsTable ─────────────────────────────────────────────────────────

const STATUS_OPTS = ['', 'DETECTED', 'CONFIRMED', 'REJECTED', 'MANUAL'];
const CONF_OPTS = [
  { label: 'All', value: '' },
  { label: '≥95% High', value: 'high' },
  { label: '≥80% Medium', value: 'medium' },
  { label: '<80% Review', value: 'low' },
];

function DetectionsTable({
  detections,
  selectedId,
  onSelect,
}: {
  detections: Detection[];
  selectedId: string | null;
  onSelect: (d: Detection) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [conf, setConf] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'tag' | 'type' | 'page' | 'conf' | 'status'>('tag');
  const [sortAsc, setSortAsc] = useState(true);
  const PAGE_SIZE = 15;

  const filtered = detections.filter(d => {
    const tag = d.asset_tag ?? '';
    const type = d.asset_type ?? '';
    if (q && !tag.toLowerCase().includes(q.toLowerCase()) && !type.toLowerCase().includes(q.toLowerCase())) return false;
    if (status) {
      const matchStatus = status === 'CONFIRMED'
        ? d.review_status === 'APPROVED'
        : status === 'REJECTED'
        ? d.review_status === 'REJECTED'
        : d.detection_status === status;
      if (!matchStatus) return false;
    }
    if (conf === 'high' && (d.confidence ?? 0) < 0.95) return false;
    if (conf === 'medium' && ((d.confidence ?? 0) < 0.80 || (d.confidence ?? 0) >= 0.95)) return false;
    if (conf === 'low' && (d.confidence ?? 0) >= 0.80) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'tag') cmp = (a.asset_tag ?? '').localeCompare(b.asset_tag ?? '');
    else if (sortBy === 'type') cmp = (a.asset_type ?? '').localeCompare(b.asset_type ?? '');
    else if (sortBy === 'page') cmp = (a.pid_page ?? 0) - (b.pid_page ?? 0);
    else if (sortBy === 'conf') cmp = (a.confidence ?? 0) - (b.confidence ?? 0);
    else if (sortBy === 'status') cmp = (a.review_status ?? '').localeCompare(b.review_status ?? '');
    return sortAsc ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (col: 'tag' | 'type' | 'page' | 'conf' | 'status') => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(true); }
    setPage(1);
  };

  const SortHeader = ({ col, label }: { col: 'tag' | 'type' | 'page' | 'conf' | 'status'; label: string }) => (
    <th onClick={() => toggleSort(col)} className="text-left px-3 py-2 font-semibold text-zinc-500 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700">
      {label} {sortBy === col && (sortAsc ? '↑' : '↓')}
    </th>
  );

  return (
    <div className="flex flex-col h-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search tag / type…"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
          className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs"
        >
          {STATUS_OPTS.map(s => (
            <option key={s} value={s}>{s || 'All Status'}</option>
          ))}
        </select>
        <select
          value={conf}
          onChange={e => { setConf(e.target.value); setPage(1); }}
          className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs"
        >
          {CONF_OPTS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-zinc-400 self-center">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-zinc-500">No</th>
              <SortHeader col="tag" label="Asset Tag" />
              <SortHeader col="type" label="Asset Type" />
              <SortHeader col="page" label="Page" />
              <SortHeader col="conf" label="Conf." />
              <SortHeader col="status" label="Status" />
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-zinc-400">No detections found.</td></tr>
            ) : (
              slice.map((d, i) => (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d)}
                  className={`border-t border-zinc-100 dark:border-zinc-800 cursor-pointer transition-colors
                    ${d.id === selectedId
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
                >
                  <td className="px-3 py-2 text-zinc-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200 font-mono">
                    {d.asset_tag ?? <span className="text-zinc-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{d.asset_type}</td>
                  <td className="px-3 py-2 text-zinc-500">{d.pid_page ?? '—'}</td>
                  <td className="px-3 py-2">{confBadge(d.confidence)}</td>
                  <td className="px-3 py-2">{statusBadge(d.detection_status, d.review_status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 text-xs text-zinc-500">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-zinc-200 disabled:opacity-40">←</button>
          <span>Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border border-zinc-200 disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function DetectionWorkspace() {
  const searchParams = useSearchParams();
  const initProjectId = searchParams.get('project_id') ?? '';

  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [legends, setLegends] = useState<Legend[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);

  const [projectId, setProjectId] = useState(initProjectId);
  const [documentId, setDocumentId] = useState('');
  const [legendId, setLegendId] = useState('');

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);

  const maxPage = detections.length ? Math.max(1, ...detections.map(d => d.pid_page ?? 1)) : 1;

  // Detections filtered to current page (null means all pages)
  const pageDetections = currentPage
    ? detections.filter(d => d.pid_page === currentPage)
    : detections;

  // Stats (over all detections, not just current page)
  const total = detections.length;
  const confirmed = detections.filter(d => d.review_status === 'APPROVED').length;
  const pending = detections.filter(d => d.review_status === 'PENDING').length;
  const rejected = detections.filter(d => d.review_status === 'REJECTED').length;
  const avgConf = detections.length
    ? Math.round(detections.reduce((s, d) => s + (d.confidence ?? 0), 0) / detections.length * 100)
    : null;

  // Load reference data
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(Array.isArray(d) ? d : []));
    fetch('/api/legends').then(r => r.json()).then(d => setLegends(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (!projectId) { setDocuments([]); setDocumentId(''); return; }
    fetch(`/api/documents?project_id=${projectId}`).then(r => r.json()).then(d => {
      const arr = Array.isArray(d) ? d : [];
      setDocuments(arr);
      // Only auto-select first doc when no doc selected yet
      setDocumentId(prev => prev || (arr.length ? arr[0].id : ''));
    });
  }, [projectId]);

  const loadDetections = useCallback(async () => {
    if (!currentJobId) return;
    const r = await fetch(`/api/detections?job_id=${currentJobId}&limit=200`);
    const d = await r.json();
    setDetections(Array.isArray(d.data) ? d.data : []);
  }, [currentJobId]);

  const handleRunDetection = async () => {
    if (!documentId) return;
    setRunning(true);
    setDetections([]);
    setSelectedDetection(null);
    const r = await fetch('/api/detection/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: documentId, legend_id: legendId || null, project_id: projectId || null }),
    });
    const j = await r.json();
    setCurrentJobId(j.id);
    setRunning(false);
  };

  const handleJobComplete = useCallback(async () => {
    await loadDetections();
  }, [loadDetections]);

  // Periodic refresh of detections while job running
  useEffect(() => {
    if (!currentJobId) return;
    const t = setInterval(loadDetections, 3000);
    return () => clearInterval(t);
  }, [currentJobId, loadDetections]);

  const handleConfirm = async (id: string) => {
    await fetch(`/api/detections/${id}/confirm`, { method: 'POST' });
    await loadDetections();
    setSelectedDetection(prev => prev?.id === id ? { ...prev, detection_status: 'CONFIRMED', review_status: 'APPROVED' } : prev);
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/detections/${id}/reject`, { method: 'POST' });
    await loadDetections();
    setSelectedDetection(null);
  };

  const handleEdit = async (id: string, fields: Partial<Detection>) => {
    const body: Record<string, unknown> = {};
    if (fields.asset_tag !== undefined) body.asset_tag = fields.asset_tag;
    if (fields.asset_type !== undefined) body.asset_type = fields.asset_type;
    if (fields.description !== undefined) body.description = fields.description;
    await fetch(`/api/detections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadDetections();
    setSelectedDetection(prev => prev?.id === id ? { ...prev, ...fields } : prev);
  };

  const selectedId = selectedDetection?.id ?? null;

  return (
    <div className="flex flex-col min-h-full gap-4 pb-6">
      {/* Manual Add Modal */}
      <ManualAddModal
        open={showManualAdd}
        onClose={() => setShowManualAdd(false)}
        onSave={loadDetections}
        documentId={documentId}
        legendId={legendId}
        jobId={currentJobId}
      />

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Automatic Asset Detection</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Select document and legend, then run detection.</p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1 min-w-40">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Project</span>
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); setDocumentId(''); setCurrentJobId(null); setDetections([]); }}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            >
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 min-w-56">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Document</span>
            <select
              value={documentId}
              onChange={e => { setDocumentId(e.target.value); setCurrentJobId(null); setDetections([]); }}
              disabled={!projectId}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">Select document…</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.filename} ({d.page_count}p)</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 min-w-48">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Legend</span>
            <select
              value={legendId}
              onChange={e => setLegendId(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm"
            >
              <option value="">No legend (auto-detect)</option>
              {legends.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <button
            onClick={handleRunDetection}
            disabled={running || !documentId}
            className="px-5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-semibold transition-colors"
          >
            {running ? 'Starting…' : 'Run Detection'}
          </button>

          {/* Manual Add button */}
          <button
            onClick={() => setShowManualAdd(true)}
            disabled={!documentId}
            className="px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-700 dark:text-zinc-300 text-sm font-medium transition-colors"
          >
            + Add Asset Manually
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {detections.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Detected', value: total, color: 'text-zinc-700 dark:text-zinc-300' },
            { label: 'Confirmed', value: confirmed, color: 'text-emerald-600' },
            { label: 'Pending Review', value: pending, color: 'text-yellow-600' },
            { label: 'Rejected', value: rejected, color: 'text-red-600' },
            { label: 'Avg Confidence', value: avgConf !== null ? `${avgConf}%` : '—', color: 'text-blue-600' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main workspace: Viewer (left, wide) + Table+Detail (right, narrower) */}
      {detections.length > 0 || currentJobId ? (
        <div className="flex gap-3 flex-1 min-h-0" style={{ minHeight: 700 }}>
          {/* Left: Viewer — takes most of the width (~75%) */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {/* Job progress inline above viewer — compact, doesn't push viewer down */}
            {currentJobId && (
              <div className="flex-shrink-0">
                <JobProgress jobId={currentJobId} onComplete={handleJobComplete} />
              </div>
            )}
            <div className="flex-1 min-h-0" style={{ minHeight: 640 }}>
              <PidViewer
                documentId={documentId}
                detections={pageDetections}
                selectedId={selectedId}
                onSelect={id => {
                  const d = detections.find(x => x.id === id);
                  if (d) setSelectedDetection(d);
                }}
                page={currentPage || 1}
                totalPages={maxPage}
                onPageChange={setCurrentPage}
              />
            </div>
          </div>

          {/* Right panel: Detail on top (when selected) + Table below */}
          <div className="w-72 xl:w-80 flex-shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
            {selectedDetection && (
              <div className="flex-shrink-0">
                <AssetDetail
                  detection={selectedDetection}
                  onClose={() => setSelectedDetection(null)}
                  onConfirm={handleConfirm}
                  onReject={handleReject}
                  onEdit={handleEdit}
                />
              </div>
            )}
            <div className="flex-1 min-h-0" style={{ minHeight: 300 }}>
              <DetectionsTable
                detections={detections}
                selectedId={selectedId}
                onSelect={setSelectedDetection}
              />
            </div>
          </div>
        </div>
      ) : (
        !currentJobId && (
          <div className="flex-1 flex items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm font-medium">Select a document and run detection</p>
              <p className="text-xs mt-1">AI will analyze your P&ID and detect assets</p>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// Need Suspense for useSearchParams
export default function DetectionPage() {
  return (
    <Suspense>
      <DetectionWorkspace />
    </Suspense>
  );
}
