'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}

interface DetectionJob {
  id: string;
  status: string;
  document_id: string;
  project_id: string | null;
  created_at: string;
  stats: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
    detected: number;
  };
}

interface Detection {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  description: string | null;
  equipment_class: string | null;
  pid_page: number | null;
  confidence: number | null;
  detection_status: string;
  review_status: string;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  evidence: string[] | string | null;
  service: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  job_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEvidence(ev: string[] | string | null): string[] {
  if (!ev) return [];
  if (Array.isArray(ev)) return ev;
  try {
    const p = JSON.parse(ev);
    return Array.isArray(p) ? p : [String(p)];
  } catch {
    return [String(ev)];
  }
}

function confBadge(c: number | null) {
  if (c === null) return <span className="text-xs text-zinc-400">—</span>;
  const pct = Math.round(c * 100);
  const cls =
    c >= 0.95
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : c >= 0.8
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {pct}%
    </span>
  );
}

function statusBadge(reviewStatus: string) {
  const label =
    reviewStatus === 'APPROVED'
      ? 'Confirmed'
      : reviewStatus === 'REJECTED'
      ? 'Rejected'
      : 'Pending';
  const cls =
    reviewStatus === 'APPROVED'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : reviewStatus === 'REJECTED'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface DetailPanelProps {
  detection: Detection;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onEdit: (
    id: string,
    fields: { asset_tag: string | null; asset_type: string; description: string | null }
  ) => Promise<void>;
}

function DetailPanel({
  detection,
  onClose,
  onConfirm,
  onReject,
  onEdit,
}: DetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editTag, setEditTag] = useState(detection.asset_tag ?? '');
  const [editType, setEditType] = useState(detection.asset_type);
  const [editDesc, setEditDesc] = useState(detection.description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Sync edit fields when detection changes
  useEffect(() => {
    setEditTag(detection.asset_tag ?? '');
    setEditType(detection.asset_type);
    setEditDesc(detection.description ?? '');
    setEditing(false);
  }, [detection.id, detection.asset_tag, detection.asset_type, detection.description]);

  const handleSave = async () => {
    setSaving(true);
    await onEdit(detection.id, {
      asset_tag: editTag.trim() || null,
      asset_type: editType.trim(),
      description: editDesc.trim() || null,
    });
    setSaving(false);
    setEditing(false);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    await onConfirm(detection.id);
    setConfirming(false);
  };

  const handleReject = async () => {
    setRejecting(true);
    await onReject(detection.id);
    setRejecting(false);
  };

  const ev = parseEvidence(detection.evidence);
  const pct =
    detection.confidence !== null ? Math.round(detection.confidence * 100) : null;

  const isReviewed =
    detection.review_status === 'APPROVED' ||
    detection.review_status === 'REJECTED';

  return (
    <div className="flex flex-col h-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
        <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm truncate pr-2">
          {detection.asset_tag ?? detection.asset_type}
        </span>
        <button
          onClick={onClose}
          className="flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {!editing ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {(
                [
                  ['Asset Tag', detection.asset_tag ?? '—'],
                  ['Asset Type', detection.asset_type],
                  ['Equipment Class', detection.equipment_class ?? '—'],
                  ['P&ID Page', detection.pid_page !== null ? String(detection.pid_page) : '—'],
                  ['Confidence', pct !== null ? `${pct}%` : '—'],
                  ['Service', detection.service ?? '—'],
                  ['Location', detection.location ?? '—'],
                  ['Unit', detection.unit ?? '—'],
                  ['Area', detection.area ?? '—'],
                  ['Detection Status', detection.detection_status],
                  ['Review Status', detection.review_status],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="col-span-1">
                  <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    {k}
                  </dt>
                  <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200 break-words">{v}</dd>
                </div>
              ))}

              {/* Description full width */}
              <div className="col-span-2">
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Description
                </dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                  {detection.description ?? '—'}
                </dd>
              </div>

              {/* BBox */}
              <div className="col-span-2">
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Bounding Box
                </dt>
                <dd className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  x={detection.bbox_x ?? '—'} y={detection.bbox_y ?? '—'} w=
                  {detection.bbox_w ?? '—'} h={detection.bbox_h ?? '—'}
                </dd>
              </div>
            </dl>

            {/* Evidence */}
            {ev.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1.5">
                  Evidence
                </p>
                <ul className="space-y-1.5">
                  {ev.map((e, i) => (
                    <li
                      key={i}
                      className="text-xs text-zinc-600 dark:text-zinc-400 flex gap-1.5 leading-relaxed"
                    >
                      <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Asset Tag
              </span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
                placeholder="e.g. V-101"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Asset Type
              </span>
              <input
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                placeholder="e.g. Valve"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Description
              </span>
              <textarea
                className="mt-1 w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Optional description…"
              />
            </label>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 flex gap-2 flex-wrap">
        {isReviewed ? (
          <span className="text-xs text-zinc-400 italic self-center">
            Reviewed — {detection.review_status.toLowerCase()}
          </span>
        ) : !editing ? (
          <>
            <button
              onClick={handleConfirm}
              disabled={confirming || rejecting}
              className="flex-1 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {confirming ? 'Confirming…' : 'Confirm'}
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={confirming || rejecting}
              className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleReject}
              disabled={confirming || rejecting}
              className="flex-1 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {rejecting ? 'Rejecting…' : 'Reject'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="py-1.5 px-4 rounded-md border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Empty Detail State ───────────────────────────────────────────────────────

function EmptyDetail() {
  return (
    <div className="h-full rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-700 flex items-center justify-center">
      <div className="text-center text-zinc-400 px-4">
        <svg
          className="w-10 h-10 mx-auto mb-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        <p className="text-sm font-medium">No detection selected</p>
        <p className="text-xs mt-1">Click a row to view details</p>
      </div>
    </div>
  );
}

// ─── Confidence filter options ────────────────────────────────────────────────

type ConfFilter = 'all' | 'high' | 'medium' | 'low';
type StatusFilter = 'ALL' | 'PENDING' | 'CONFIRMED' | 'REJECTED';

const CONF_OPTIONS: { label: string; value: ConfFilter }[] = [
  { label: 'All Confidence', value: 'all' },
  { label: '≥95% High', value: 'high' },
  { label: '≥80% Medium', value: 'medium' },
  { label: '<80% Low', value: 'low' },
];

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: 'All Status', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Rejected', value: 'REJECTED' },
];

const PAGE_SIZE = 15;

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  // ── Filter state ──
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<DetectionJob[]>([]);
  const [projectId, setProjectId] = useState('');
  const [jobId, setJobId] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [confFilter, setConfFilter] = useState<ConfFilter>('all');
  const [searchQ, setSearchQ] = useState('');

  // ── Data state ──
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // ── Table/selection state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  // ── Bulk action state ──
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Load projects on mount ──
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // ── Load jobs when project changes ──
  useEffect(() => {
    setJobs([]);
    setJobId('');
    setDetections([]);
    setSelectedId(null);
    setSelectedDetection(null);
    setCheckedIds(new Set());
    if (!projectId) return;
    fetch(`/api/detection/jobs?project_id=${projectId}&limit=100`)
      .then((r) => r.json())
      .then((d) => setJobs(Array.isArray(d.data) ? d.data : []))
      .catch(() => {});
  }, [projectId]);

  // ── Load detections when job changes ──
  const loadDetections = useCallback(async (jId: string) => {
    if (!jId) return;
    setLoading(true);
    setLoadError('');
    try {
      const r = await fetch(`/api/detections?job_id=${jId}&limit=200`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setDetections(Array.isArray(d.data) ? d.data : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load detections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDetections([]);
    setSelectedId(null);
    setSelectedDetection(null);
    setCheckedIds(new Set());
    setPage(1);
    if (jobId) loadDetections(jobId);
  }, [jobId, loadDetections]);

  // ── Filtered detections ──
  const filtered = detections.filter((d) => {
    const tag = (d.asset_tag ?? '').toLowerCase();
    const type = (d.asset_type ?? '').toLowerCase();
    const q = searchQ.toLowerCase();
    if (q && !tag.includes(q) && !type.includes(q)) return false;

    if (statusFilter === 'PENDING') {
      if (d.review_status !== 'PENDING') return false;
    } else if (statusFilter === 'CONFIRMED') {
      if (d.review_status !== 'APPROVED') return false;
    } else if (statusFilter === 'REJECTED') {
      if (d.review_status !== 'REJECTED') return false;
    }

    if (confFilter === 'high' && (d.confidence ?? 0) < 0.95) return false;
    if (
      confFilter === 'medium' &&
      ((d.confidence ?? 0) < 0.8 || (d.confidence ?? 0) >= 0.95)
    )
      return false;
    if (confFilter === 'low' && (d.confidence ?? 0) >= 0.8) return false;

    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Stats (live) ──
  const statsTotal = detections.length;
  const statsPending = detections.filter((d) => d.review_status === 'PENDING').length;
  const statsConfirmed = detections.filter((d) => d.review_status === 'APPROVED').length;
  const statsRejected = detections.filter((d) => d.review_status === 'REJECTED').length;

  // ── Selection helpers ──
  const allPageChecked =
    pageSlice.length > 0 && pageSlice.every((d) => checkedIds.has(d.id));
  const somePageChecked =
    !allPageChecked && pageSlice.some((d) => checkedIds.has(d.id));

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePageAll = () => {
    if (allPageChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pageSlice.forEach((d) => next.delete(d.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pageSlice.forEach((d) => next.add(d.id));
        return next;
      });
    }
  };

  // ── Local state update helper ──
  const updateDetectionLocally = useCallback(
    (id: string, patch: Partial<Detection>) => {
      setDetections((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      );
      setSelectedDetection((prev) =>
        prev?.id === id ? { ...prev, ...patch } : prev
      );
    },
    []
  );

  // ── Action handlers ──
  const handleConfirm = useCallback(
    async (id: string) => {
      await fetch(`/api/detections/${id}/confirm`, { method: 'POST' });
      updateDetectionLocally(id, {
        review_status: 'APPROVED',
        detection_status: 'CONFIRMED',
      });
    },
    [updateDetectionLocally]
  );

  const handleReject = useCallback(
    async (id: string) => {
      await fetch(`/api/detections/${id}/reject`, { method: 'POST' });
      updateDetectionLocally(id, { review_status: 'REJECTED' });
      // Close detail panel if the rejected item was selected
      setSelectedId((prev) => (prev === id ? null : prev));
      setSelectedDetection((prev) => (prev?.id === id ? null : prev));
    },
    [updateDetectionLocally]
  );

  const handleEdit = useCallback(
    async (
      id: string,
      fields: { asset_tag: string | null; asset_type: string; description: string | null }
    ) => {
      await fetch(`/api/detections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      updateDetectionLocally(id, fields);
    },
    [updateDetectionLocally]
  );

  // ── Bulk actions ──
  const handleBulkConfirm = async () => {
    if (checkedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(checkedIds);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/detections/${id}/confirm`, { method: 'POST' }).then(() =>
          updateDetectionLocally(id, {
            review_status: 'APPROVED',
            detection_status: 'CONFIRMED',
          })
        )
      )
    );
    setCheckedIds(new Set());
    setBulkLoading(false);
  };

  const handleBulkReject = async () => {
    if (checkedIds.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(checkedIds);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/detections/${id}/reject`, { method: 'POST' }).then(() =>
          updateDetectionLocally(id, { review_status: 'REJECTED' })
        )
      )
    );
    // If selected detection was among bulk-rejected, clear it
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null);
      setSelectedDetection(null);
    }
    setCheckedIds(new Set());
    setBulkLoading(false);
  };

  const handleRowClick = (d: Detection) => {
    setSelectedId(d.id);
    setSelectedDetection(d);
  };

  // Reset page when filters change
  const handleStatusFilter = (v: StatusFilter) => {
    setStatusFilter(v);
    setPage(1);
    setCheckedIds(new Set());
  };
  const handleConfFilter = (v: ConfFilter) => {
    setConfFilter(v);
    setPage(1);
    setCheckedIds(new Set());
  };
  const handleSearch = (v: string) => {
    setSearchQ(v);
    setPage(1);
    setCheckedIds(new Set());
  };

  const checkedCount = checkedIds.size;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* ── Page Header ── */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              Human Review
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">Review AI-detected assets</p>
          </div>
          <a
            href="/detection"
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline"
          >
            ← Detection
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-6 py-5 flex flex-col gap-4">
        {/* ── Filter bar ── */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Project */}
            <label className="flex flex-col gap-1 min-w-40">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Project
              </span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Job */}
            <label className="flex flex-col gap-1 min-w-56">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Detection Job
              </span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                disabled={!projectId || jobs.length === 0}
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">
                  {!projectId
                    ? 'Select project first…'
                    : jobs.length === 0
                    ? 'No jobs found'
                    : 'Select job…'}
                </option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.id.slice(0, 8)}… — {j.status} —{' '}
                    {new Date(j.created_at).toLocaleDateString()}
                    {j.stats ? ` (${j.stats.total} detections)` : ''}
                  </option>
                ))}
              </select>
            </label>

            {/* Status filter */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Status
              </span>
              <div className="flex rounded border border-zinc-300 dark:border-zinc-600 overflow-hidden">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusFilter(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-zinc-300 dark:border-zinc-600 last:border-r-0
                      ${
                        statusFilter === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </label>

            {/* Confidence filter */}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Confidence
              </span>
              <select
                value={confFilter}
                onChange={(e) => handleConfFilter(e.target.value as ConfFilter)}
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {CONF_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Search */}
            <label className="flex flex-col gap-1 min-w-44">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Search
              </span>
              <input
                type="search"
                placeholder="Tag or type…"
                value={searchQ}
                onChange={(e) => handleSearch(e.target.value)}
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            {/* Results count */}
            {detections.length > 0 && (
              <span className="ml-auto self-end text-xs text-zinc-400 pb-1.5">
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Stats bar ── */}
        {detections.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total', value: statsTotal, color: 'text-zinc-700 dark:text-zinc-300' },
              { label: 'Pending', value: statsPending, color: 'text-yellow-600 dark:text-yellow-400' },
              { label: 'Confirmed', value: statsConfirmed, color: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Rejected', value: statsRejected, color: 'text-red-600 dark:text-red-400' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-center"
              >
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Split view ── */}
        <div
          className="flex gap-4 flex-1"
          style={{ minHeight: 520 }}
        >
          {/* ── Left: Table ── */}
          <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
            {/* Bulk action bar */}
            {checkedCount > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {checkedCount} selected
                </span>
                <button
                  onClick={handleBulkConfirm}
                  disabled={bulkLoading}
                  className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  {bulkLoading ? 'Working…' : 'Confirm All'}
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={bulkLoading}
                  className="px-3 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  {bulkLoading ? 'Working…' : 'Reject All'}
                </button>
                <button
                  onClick={() => setCheckedIds(new Set())}
                  disabled={bulkLoading}
                  className="ml-auto text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Loading / error / empty states */}
            {loading && (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                <svg
                  className="animate-spin h-5 w-5 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Loading detections…
              </div>
            )}

            {!loading && loadError && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-4 py-2">
                  {loadError}
                </p>
              </div>
            )}

            {!loading && !loadError && !jobId && (
              <div className="flex-1 flex items-center justify-center text-center text-zinc-400 p-8">
                <div>
                  <svg
                    className="w-12 h-12 mx-auto mb-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                    />
                  </svg>
                  <p className="text-sm font-medium">Select a project and job to begin</p>
                  <p className="text-xs mt-1">Detections will appear here for review</p>
                </div>
              </div>
            )}

            {!loading && !loadError && jobId && detections.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                No detections found for this job.
              </div>
            )}

            {!loading && !loadError && filtered.length === 0 && detections.length > 0 && (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                No detections match the current filters.
              </div>
            )}

            {/* Table */}
            {!loading && !loadError && filtered.length > 0 && (
              <>
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2.5 w-8">
                          <input
                            type="checkbox"
                            checked={allPageChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = somePageChecked;
                            }}
                            onChange={togglePageAll}
                            aria-label="Select all on this page"
                            className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          No
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          Asset Tag
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          Asset Type
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          P&amp;ID Page
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          Confidence
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          Status
                        </th>
                        <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageSlice.map((d, i) => {
                        const rowNum = (page - 1) * PAGE_SIZE + i + 1;
                        const isSelected = d.id === selectedId;
                        const isChecked = checkedIds.has(d.id);
                        return (
                          <tr
                            key={d.id}
                            onClick={() => handleRowClick(d)}
                            className={`border-t border-zinc-100 dark:border-zinc-800 cursor-pointer transition-colors
                              ${
                                isSelected
                                  ? 'bg-blue-50 dark:bg-blue-900/20'
                                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                              }`}
                          >
                            <td
                              className="px-3 py-2 w-8"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCheck(d.id)}
                                aria-label={`Select detection ${d.asset_tag ?? d.asset_type}`}
                                className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2 text-zinc-400">{rowNum}</td>
                            <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200 font-mono">
                              {d.asset_tag ?? (
                                <span className="text-zinc-400 italic">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                              {d.asset_type}
                            </td>
                            <td className="px-3 py-2 text-zinc-500">
                              {d.pid_page ?? '—'}
                            </td>
                            <td className="px-3 py-2">{confBadge(d.confidence)}</td>
                            <td className="px-3 py-2">{statusBadge(d.review_status)}</td>
                            <td
                              className="px-3 py-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.review_status !== 'APPROVED' &&
                              d.review_status !== 'REJECTED' ? (
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handleConfirm(d.id)}
                                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                                    title="Confirm"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    onClick={() => handleReject(d.id)}
                                    className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
                                    title="Reject"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <span className="text-zinc-300 dark:text-zinc-600 text-xs">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      ←
                    </button>
                    <span>
                      Page {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      →
                    </button>
                    <span className="ml-auto text-zinc-400">
                      {filtered.length} total
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Right: Detail Panel ── */}
          <div className="w-96 flex-shrink-0">
            {selectedDetection ? (
              <DetailPanel
                key={selectedDetection.id}
                detection={selectedDetection}
                onClose={() => {
                  setSelectedId(null);
                  setSelectedDetection(null);
                }}
                onConfirm={handleConfirm}
                onReject={handleReject}
                onEdit={handleEdit}
              />
            ) : (
              <EmptyDetail />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
