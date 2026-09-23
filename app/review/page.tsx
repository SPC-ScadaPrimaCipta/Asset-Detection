'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, PencilSimple, FloppyDisk, CaretLeft, CaretRight, Trash, ArrowCounterClockwise } from '@phosphor-icons/react';

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

// ─── Style Constants ─────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '13px',
  fontFamily: 'inherit',
  outline: 'none',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--primary)',
  background: 'var(--primary)',
  color: 'var(--surface)',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
};

const tdBase: React.CSSProperties = { padding: '8px 12px' };

const toolButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground-muted)',
  fontSize: '12px',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const tableActionBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  color: 'white',
  fontSize: '12px',
  fontWeight: '600',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const badgeBase: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: '500',
  padding: '2px 8px',
  borderRadius: '999px',
  display: 'inline-flex',
  alignItems: 'center',
};

const successBadge: React.CSSProperties = { ...badgeBase, background: 'var(--success-soft)', color: 'var(--success)' };
const warningBadge: React.CSSProperties = { ...badgeBase, background: 'var(--warning-soft)', color: 'var(--warning)' };
const dangerBadge: React.CSSProperties = { ...badgeBase, background: 'var(--danger-soft)', color: 'var(--danger)' };
const neutralBadge: React.CSSProperties = { ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' };

function confBadge(c: number | null) {
  if (c === null) return <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>—</span>;
  const pct = Math.round(c * 100);
  const style =
    c >= 0.95
      ? successBadge
      : c >= 0.8
      ? warningBadge
      : dangerBadge;
  return (
    <span style={style}>
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
  const style =
    reviewStatus === 'APPROVED'
      ? successBadge
      : reviewStatus === 'REJECTED'
      ? dangerBadge
      : neutralBadge;
  return (
    <span style={style}>
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
  onUnreview: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function DetailPanel({
  detection,
  onClose,
  onConfirm,
  onReject,
  onEdit,
  onUnreview,
  onDelete,
}: DetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editTag, setEditTag] = useState(detection.asset_tag ?? '');
  const [editType, setEditType] = useState(detection.asset_type);
  const [editDesc, setEditDesc] = useState(detection.description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [unreviewing, setUnreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const handleUnreview = async () => {
    setUnreviewing(true);
    await onUnreview(detection.id);
    setUnreviewing(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(detection.id);
    setDeleting(false);
  };

  const ev = parseEvidence(detection.evidence);
  const pct =
    detection.confidence !== null ? Math.round(detection.confidence * 100) : null;

  const isReviewed =
    detection.review_status === 'APPROVED' ||
    detection.review_status === 'REJECTED';

  const actionBtn: React.CSSProperties = {
    flex: 1, padding: '6px 8px', borderRadius: 'var(--radius-sm)',
    color: 'white', fontSize: '12px', fontWeight: '600',
    border: 'none', cursor: 'pointer', transition: 'all 150ms ease-out',
  };

  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
        <span style={{ fontWeight: '600', color: 'var(--foreground)', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
          {detection.asset_tag ?? detection.asset_type}
        </span>
        <button
          onClick={onClose}
          style={{ flexShrink: 0, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', border: 'none', background: 'none', color: 'var(--foreground-muted)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '14px' }}>
        {!editing ? (
          <>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 16px', margin: 0 }}>
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
                <div key={k}>
                  <dt style={fieldLabelStyle}>
                    {k}
                  </dt>
                  <dd style={{ margin: '2px 0 0', color: 'var(--foreground)', overflowWrap: 'break-word' }}>{v}</dd>
                </div>
              ))}

              {/* Description full width */}
              <div style={{ gridColumn: '1 / -1' }}>
                <dt style={fieldLabelStyle}>
                  Description
                </dt>
                <dd style={{ margin: '2px 0 0', color: 'var(--foreground)' }}>
                  {detection.description ?? '—'}
                </dd>
              </div>

              {/* BBox */}
              <div style={{ gridColumn: '1 / -1' }}>
                <dt style={fieldLabelStyle}>
                  Bounding Box
                </dt>
                <dd style={{ margin: '2px 0 0', fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                  x={detection.bbox_x ?? '—'} y={detection.bbox_y ?? '—'} w=
                  {detection.bbox_w ?? '—'} h={detection.bbox_h ?? '—'}
                </dd>
              </div>
            </dl>

            {/* Evidence */}
            {ev.length > 0 && (
              <div>
                <p style={{ ...fieldLabelStyle, margin: '0 0 6px' }}>
                  Evidence
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: 0, padding: 0, listStyle: 'none' }}>
                  {ev.map((e, i) => (
                    <li
                      key={i}
                      style={{ fontSize: '12px', color: 'var(--foreground-muted)', display: 'flex', gap: '6px', lineHeight: 1.6 }}
                    >
                      <span style={{ color: 'var(--info)', marginTop: '2px', flexShrink: 0 }}>•</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ display: 'block' }}>
              <span style={fieldLabelStyle}>
                Asset Tag
              </span>
              <input
                style={{ ...selectStyle, marginTop: '4px', width: '100%' }}
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
                placeholder="e.g. V-101"
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={fieldLabelStyle}>
                Asset Type
              </span>
              <input
                style={{ ...selectStyle, marginTop: '4px', width: '100%' }}
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                placeholder="e.g. Valve"
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={fieldLabelStyle}>
                Description
              </span>
              <textarea
                style={{ ...selectStyle, marginTop: '4px', width: '100%', resize: 'none' }}
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
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {isReviewed && !editing ? (
          <>
            <button
              onClick={() => setEditing(true)}
              disabled={unreviewing || deleting}
              style={{ ...actionBtn, background: '#002B4E', opacity: unreviewing || deleting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <PencilSimple size={13} weight="bold" />
              Edit
            </button>
            <button
              onClick={handleUnreview}
              disabled={unreviewing || deleting}
              style={{ ...actionBtn, background: '#A68145', opacity: unreviewing || deleting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <ArrowCounterClockwise size={13} weight="bold" />
              {unreviewing ? 'Resetting…' : 'Reset to Pending'}
            </button>
            <button
              onClick={handleDelete}
              disabled={unreviewing || deleting}
              style={{ ...actionBtn, background: '#A65A55', opacity: unreviewing || deleting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <Trash size={13} weight="bold" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        ) : !editing ? (
          <>
            <button
              onClick={handleConfirm}
              disabled={confirming || rejecting}
              style={{ ...actionBtn, background: 'var(--success)', opacity: confirming || rejecting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <CheckCircle size={13} weight="bold" />
              {confirming ? 'Confirming…' : 'Confirm'}
            </button>
            <button
              onClick={() => setEditing(true)}
              disabled={confirming || rejecting}
              style={{ ...actionBtn, background: '#002B4E', opacity: confirming || rejecting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <PencilSimple size={13} weight="bold" />
              Edit
            </button>
            <button
              onClick={handleReject}
              disabled={confirming || rejecting}
              style={{ ...actionBtn, background: 'var(--danger)', opacity: confirming || rejecting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <XCircle size={13} weight="bold" />
              {rejecting ? 'Rejecting…' : 'Reject'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...actionBtn, background: '#0078B8', opacity: saving ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}
            >
              <FloppyDisk size={13} weight="bold" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ padding: '6px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '12px', color: 'var(--foreground-muted)', background: 'var(--surface)', cursor: 'pointer' }}
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
    <div style={{ height: '100%', borderRadius: 'var(--radius-md)', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: 'var(--foreground-subtle)', padding: '0 16px' }}>
        <svg
          style={{ width: 40, height: 40, margin: '0 auto 12px' }}
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
        <p style={{ fontSize: '14px', fontWeight: '500' }}>No detection selected</p>
        <p style={{ fontSize: '12px', marginTop: '4px' }}>Click a row to view details</p>
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

const DEFAULT_PAGE_SIZE = 15;

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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // ── Bulk action state ──
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Confirm All state ──
  const [confirmingAll, setConfirmingAll] = useState(false);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSlice = filtered.slice((page - 1) * pageSize, page * pageSize);

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

  const handleUnreview = useCallback(
    async (id: string) => {
      await fetch(`/api/detections/${id}/unreview`, { method: 'POST' });
      updateDetectionLocally(id, { review_status: 'PENDING', detection_status: 'DETECTED' });
    },
    [updateDetectionLocally]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/detections/${id}`, { method: 'DELETE' });
      setDetections((prev) => prev.filter((d) => d.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
      setSelectedDetection((prev) => (prev?.id === id ? null : prev));
      setCheckedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
    []
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

  // ── Confirm All (all PENDING in filtered list) ──
  const handleConfirmAll = async () => {
    const pendingIds = filtered
      .filter((d) => d.review_status === 'PENDING')
      .map((d) => d.id);
    if (pendingIds.length === 0) return;
    setConfirmingAll(true);
    try {
      await fetch('/api/detections/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: pendingIds, action: 'confirm' }),
      });
      pendingIds.forEach((id) =>
        updateDetectionLocally(id, {
          review_status: 'APPROVED',
          detection_status: 'CONFIRMED',
        })
      );
    } finally {
      setConfirmingAll(false);
    }
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
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Page Header ── */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '16px 24px' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--foreground)', margin: '0 0 4px' }}>
              Human Review
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0 }}>Review AI-detected assets</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleConfirmAll}
              disabled={confirmingAll || filtered.filter(d => d.review_status === 'PENDING').length === 0}
              style={{
                background: '#2D7A3A',
                color: 'white',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                cursor: confirmingAll || filtered.filter(d => d.review_status === 'PENDING').length === 0 ? 'not-allowed' : 'pointer',
                opacity: confirmingAll || filtered.filter(d => d.review_status === 'PENDING').length === 0 ? 0.5 : 1,
              }}
            >
              <CheckCircle size={15} weight="bold" />
              {confirmingAll
                ? 'Confirming…'
                : `Confirm All (${filtered.filter(d => d.review_status === 'PENDING').length})`}
            </button>
            <a
              href="/detection"
              style={{ fontSize: '12px', color: 'var(--foreground-muted)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              ← Detection
            </a>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: '1440px', margin: '0 auto', width: '100%', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ── Filter bar ── */}
        <div style={{ ...cardStyle, padding: '12px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
            {/* Project */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 160 }}>
              <span style={fieldLabelStyle}>
                Project
              </span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={selectStyle}
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
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 224 }}>
              <span style={fieldLabelStyle}>
                Detection Job
              </span>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                disabled={!projectId || jobs.length === 0}
                style={{ ...selectStyle, opacity: !projectId || jobs.length === 0 ? 0.5 : 1 }}
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
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={fieldLabelStyle}>
                Status
              </span>
              <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusFilter(opt.value)}
                    style={{
                      flex: 1, padding: '6px 12px', fontSize: '12px', fontWeight: '500', transition: 'all 150ms ease-out',
                      borderRight: '1px solid var(--border)',
                      background: statusFilter === opt.value ? 'var(--primary)' : 'var(--surface)',
                      color: statusFilter === opt.value ? 'var(--surface)' : 'var(--foreground-muted)',
                      border: statusFilter === opt.value ? 'none' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </label>

            {/* Confidence filter */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={fieldLabelStyle}>
                Confidence
              </span>
              <select
                value={confFilter}
                onChange={(e) => handleConfFilter(e.target.value as ConfFilter)}
                style={selectStyle}
              >
                {CONF_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Search */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 176 }}>
              <span style={fieldLabelStyle}>
                Search
              </span>
              <input
                type="search"
                placeholder="Tag or type…"
                value={searchQ}
                onChange={(e) => handleSearch(e.target.value)}
                style={selectStyle}
              />
            </label>

            {/* Results count */}
            {detections.length > 0 && (
              <span style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: '12px', color: 'var(--foreground-subtle)', paddingBottom: '6px' }}>
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Stats bar ── */}
        {detections.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              { label: 'Total', value: statsTotal, color: 'var(--foreground)' },
              { label: 'Pending', value: statsPending, color: 'var(--warning)' },
              { label: 'Confirmed', value: statsConfirmed, color: 'var(--success)' },
              { label: 'Rejected', value: statsRejected, color: 'var(--danger)' },
            ].map((s) => (
              <div
                key={s.label}
                style={{ ...cardStyle, padding: '12px', textAlign: 'center' }}
              >
                <p style={{ fontSize: 20, fontWeight: '700', color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '4px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Split view ── */}
        <div
          style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 520 }}
        >
          {/* ── Left: Table ── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', ...cardStyle, overflow: 'hidden' }}>
            {/* Bulk action bar */}
            {checkedCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 16px', background: 'var(--info-soft)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--info)' }}>
                  {checkedCount} selected
                </span>
                <button
                  onClick={handleBulkConfirm}
                  disabled={bulkLoading}
                  style={{ ...tableActionBtn, background: 'var(--success)', opacity: bulkLoading ? 0.5 : 1 }}
                >
                  {bulkLoading ? 'Working…' : 'Confirm All'}
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={bulkLoading}
                  style={{ ...tableActionBtn, background: 'var(--danger)', opacity: bulkLoading ? 0.5 : 1 }}
                >
                  {bulkLoading ? 'Working…' : 'Reject All'}
                </button>
                <button
                  onClick={() => setCheckedIds(new Set())}
                  disabled={bulkLoading}
                  style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', opacity: bulkLoading ? 0.5 : 1 }}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Loading / error / empty states */}
            {loading && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-muted)', fontSize: '14px' }}>
                <svg
                  style={{ width: 20, height: 20, marginRight: 8, animation: 'spin 1s linear infinite' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading detections…
              </div>
            )}

            {!loading && loadError && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: '14px', color: 'var(--danger)', background: 'var(--danger-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 16px' }}>
                  {loadError}
                </p>
              </div>
            )}

            {!loading && !loadError && !jobId && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--foreground-subtle)', padding: 32 }}>
                <div>
                  <svg
                    style={{ width: 48, height: 48, margin: '0 auto 12px' }}
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
                  <p style={{ fontSize: '14px', fontWeight: '500' }}>Select a project and job to begin</p>
                  <p style={{ fontSize: '12px', marginTop: '4px' }}>Detections will appear here for review</p>
                </div>
              </div>
            )}

            {!loading && !loadError && jobId && detections.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-subtle)', fontSize: '14px' }}>
                No detections found for this job.
              </div>
            )}

            {!loading && !loadError && filtered.length === 0 && detections.length > 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-subtle)', fontSize: '14px' }}>
                No detections match the current filters.
              </div>
            )}

            {/* Table */}
            {!loading && !loadError && filtered.length > 0 && (
              <>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--surface-muted)', position: 'sticky', top: 0, zIndex: 10 }}>
                      <tr>
                        <th style={{ ...thStyle, width: 32 }}>
                          <input
                            type="checkbox"
                            checked={allPageChecked}
                            ref={(el) => { if (el) el.indeterminate = somePageChecked; }}
                            onChange={togglePageAll}
                            aria-label="Select all on this page"
                            style={{ cursor: 'pointer' }}
                          />
                        </th>
                        <th style={thStyle}>No</th>
                        <th style={thStyle}>Asset Tag</th>
                        <th style={thStyle}>Asset Type</th>
                        <th style={thStyle}>P&amp;ID Page</th>
                        <th style={thStyle}>Confidence</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageSlice.map((d, i) => {
                        const rowNum = (page - 1) * pageSize + i + 1;
                        const isSelected = d.id === selectedId;
                        const isChecked = checkedIds.has(d.id);
                        return (
                          <tr
                            key={d.id}
                            onClick={() => handleRowClick(d)}
                            style={{
                              borderTop: '1px solid var(--border)',
                              cursor: 'pointer',
                              background: isSelected ? 'var(--primary-soft)' : 'transparent',
                              transition: 'background 150ms ease-out',
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <td style={{ ...tdBase, width: 32 }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCheck(d.id)}
                                aria-label={`Select detection ${d.asset_tag ?? d.asset_type}`}
                                style={{ cursor: 'pointer' }}
                              />
                            </td>
                            <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>{rowNum}</td>
                            <td style={{ ...tdBase, fontWeight: '500', color: 'var(--foreground)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
                              {d.asset_tag ?? <span style={{ color: 'var(--foreground-muted)', fontStyle: 'italic' }}>—</span>}
                            </td>
                            <td style={{ ...tdBase, color: 'var(--foreground)' }}>{d.asset_type}</td>
                            <td style={{ ...tdBase, color: 'var(--foreground-muted)' }}>{d.pid_page ?? '—'}</td>
                            <td style={tdBase}>{confBadge(d.confidence)}</td>
                            <td style={tdBase}>{statusBadge(d.review_status)}</td>
                            <td style={tdBase} onClick={e => e.stopPropagation()}>
                              {d.review_status !== 'APPROVED' && d.review_status !== 'REJECTED' ? (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    onClick={() => handleConfirm(d.id)}
                                    style={{ ...tableActionBtn, background: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    title="Confirm"
                                  >
                                    <CheckCircle size={13} weight="bold" /> Confirm
                                  </button>
                                  <button
                                    onClick={() => handleReject(d.id)}
                                    style={{ ...tableActionBtn, background: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    title="Reject"
                                  >
                                    <XCircle size={13} weight="bold" /> Reject
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    onClick={() => { handleRowClick(d); }}
                                    style={{ ...tableActionBtn, background: '#002B4E', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    title="Edit"
                                  >
                                    <PencilSimple size={13} weight="bold" /> Edit
                                  </button>
                                  <button
                                    onClick={() => handleDelete(d.id)}
                                    style={{ ...tableActionBtn, background: '#A65A55', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    title="Delete"
                                  >
                                    <Trash size={13} weight="bold" /> Delete
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{ ...toolButtonStyle, display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: page === 1 ? 0.4 : 1 }}
                  >
                    <CaretLeft size={13} weight="bold" />
                    Prev
                  </button>
                  <span>Page {page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    style={{ ...toolButtonStyle, display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: page === totalPages ? 0.4 : 1 }}
                  >
                    Next
                    <CaretRight size={13} weight="bold" />
                  </button>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
                    <select
                      value={pageSize}
                      onChange={e => { setPageSize(Number(e.target.value)); setPage(1); setCheckedIds(new Set()); }}
                      style={{ padding: '2px 6px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}
                    >
                      {[15, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span style={{ color: 'var(--foreground-subtle)', fontSize: '12px' }}>{filtered.length} total</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Right: Detail Panel ── */}
          <div style={{ width: 384, flexShrink: 0 }}>
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
                onUnreview={handleUnreview}
                onDelete={handleDelete}
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
