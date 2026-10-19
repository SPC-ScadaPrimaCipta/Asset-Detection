'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { FileXls, MagnifyingGlass, Eye, CaretLeft, CaretRight, PencilSimple, Trash, FloppyDisk, X } from '@phosphor-icons/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}

interface Asset {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  size: string | null;
  equipment_class: string | null;
  description: string | null;
  pid_number: string | null;
  pid_page: number | null;
  service: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  legend_name: string | null;
  confidence: number | null;
  detection_status: string;
  review_status: string;
  evidence: string[] | string | null;
  created_at: string;
}

interface AssetsResponse {
  data: Asset[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25;

const REVIEW_STATUS_OPTS = [
  { label: 'All', value: '' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Rejected', value: 'REJECTED' },
];

const CONFIDENCE_OPTS = [
  { label: 'All', value: '' },
  { label: '≥95% High', value: 'high' },
  { label: '≥80% Medium', value: 'medium' },
  { label: '<80% Low', value: 'low' },
];

const SORT_OPTS = [
  { label: 'Created', value: 'created_at_desc' },
  { label: 'Tag A–Z', value: 'tag_asc' },
  { label: 'Type A–Z', value: 'type_asc' },
  { label: 'Confidence High–Low', value: 'confidence_desc' },
];

// ─── Style constants ──────────────────────────────────────────────────────────

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

const controlStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '13px',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: '11px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdBase: React.CSSProperties = { padding: '10px 12px' };

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: '500',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function confToParams(conf: string): { confidence_min?: string; confidence_max?: string } {
  if (conf === 'high') return { confidence_min: '0.95' };
  if (conf === 'medium') return { confidence_min: '0.80', confidence_max: '0.9499' };
  if (conf === 'low') return { confidence_max: '0.7999' };
  return {};
}

function Spinner({ size = 16 }: { size?: number } = {}) {
  return (
    <svg style={{ width: size, height: size, color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function ConfBadge({ value }: { value: number | null }) {
  if (value === null) return <span style={{ fontSize: '12px', color: 'var(--foreground-subtle)' }}>—</span>;
  const pct = Math.round(value * 100);
  const badge =
    value >= 0.95
      ? { ...badgeBase, background: 'var(--success-soft)', color: 'var(--success)' }
      : value >= 0.80
      ? { ...badgeBase, background: 'var(--warning-soft)', color: 'var(--warning)' }
      : { ...badgeBase, background: 'var(--danger-soft)', color: 'var(--danger)' };
  return <span style={badge}>{pct}%</span>;
}

function StatusBadge({ reviewStatus }: { reviewStatus: string }) {
  const label =
    reviewStatus === 'APPROVED' ? 'Approved'
    : reviewStatus === 'REJECTED' ? 'Rejected'
    : reviewStatus === 'PENDING' ? 'Pending'
    : reviewStatus;

  const badge =
    reviewStatus === 'APPROVED'
      ? { ...badgeBase, background: 'var(--success-soft)', color: 'var(--success)' }
      : reviewStatus === 'REJECTED'
      ? { ...badgeBase, background: 'var(--danger-soft)', color: 'var(--danger)' }
      : { ...badgeBase, background: 'var(--surface-muted)', color: 'var(--foreground-muted)' };

  return <span style={badge}>{label}</span>;
}

// ─── Detail Side Panel ────────────────────────────────────────────────────────

function DetailPanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const ev = parseEvidence(asset.evidence);
  const pct = asset.confidence !== null ? Math.round(asset.confidence * 100) : null;

  const fields: [string, string][] = [
    ['Asset Tag', asset.asset_tag ?? '—'],
    ['Asset Type', asset.asset_type],
    ['Size', asset.size ?? '—'],
    ['Equipment Class', asset.equipment_class ?? '—'],
    ['Description', asset.description ?? '—'],
    ['P&ID Number', asset.pid_number ?? '—'],
    ['P&ID Page', asset.pid_page !== null ? String(asset.pid_page) : '—'],
    ['Service', asset.service ?? '—'],
    ['Location', asset.location ?? '—'],
    ['Unit', asset.unit ?? '—'],
    ['Area', asset.area ?? '—'],
    ['Legend', asset.legend_name ?? '—'],
    ['Confidence', pct !== null ? `${pct}%` : '—'],
    ['Detection Status', asset.detection_status],
    ['Review Status', asset.review_status],
    ['Created', new Date(asset.created_at).toLocaleString()],
  ];

  return (
    // Overlay backdrop on narrow screens, side panel on wide
    <div style={{ position: 'fixed', inset: '0 0 0 0', zIndex: 50, display: 'flex' }}>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.2)', zIndex: 49 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside style={{ position: 'relative', width: 320, background: 'var(--surface)', borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)', boxShadow: '0 8px 16px rgba(0, 0, 0, 0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontWeight: '600', color: 'var(--foreground)', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
            {asset.asset_tag ?? asset.asset_type}
          </span>
          <button
            onClick={onClose}
            aria-label="Close detail panel"
            style={{ flexShrink: 0, color: 'var(--foreground-subtle)', borderRadius: 'var(--radius-sm)', padding: 4, cursor: 'pointer', border: 'none', background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground-muted)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--foreground-subtle)'; }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '14px' }}>
          {/* Badges row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <ConfBadge value={asset.confidence} />
            <StatusBadge reviewStatus={asset.review_status} />
          </div>

          {/* Fields */}
          <dl style={{ margin: 0 }}>
            {fields.map(([k, v]) => (
              <div key={k} style={{ marginBottom: '4px' }}>
                <dt style={{ fontSize: '11px', fontWeight: '500', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>{k}</dt>
                <dd style={{ margin: '2px 0 0', color: 'var(--foreground)', overflowWrap: 'break-word' }}>{v}</dd>
              </div>
            ))}
          </dl>

          {/* Evidence */}
          {ev.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', fontWeight: '500', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }}>Evidence</p>
              <ul style={{ padding: 0, margin: 0 }}>
                {ev.map((e, i) => (
                  <li key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}>•</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Asset Register Workspace ─────────────────────────────────────────────────

function AssetRegisterWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Filter state — initialised from URL params
  const [projectId, setProjectId] = useState(searchParams.get('project_id') ?? '');
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [assetType, setAssetType] = useState(searchParams.get('asset_type') ?? '');
  const [reviewStatus, setReviewStatus] = useState(searchParams.get('review_status') ?? '');
  const [confidence, setConfidence] = useState(searchParams.get('confidence') ?? '');
  const [sort, setSort] = useState(searchParams.get('sort') ?? 'created_at_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived asset types for the filter dropdown
  const [knownTypes, setKnownTypes] = useState<string[]>([]);

  // Detail panel
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Edit / Delete
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editForm, setEditForm] = useState<Partial<Asset>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Export
  const [includeReviewItems, setIncludeReviewItems] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Debounce search input
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState(q);

  // ── Load projects ──
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // ── Debounce search ──
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q]);

  // ── Build API URL ──
  const buildUrl = useCallback(() => {
    const sp = new URLSearchParams();
    if (projectId) sp.set('project_id', projectId);
    if (debouncedQ) sp.set('q', debouncedQ);
    if (assetType) sp.set('asset_type', assetType);
    if (reviewStatus) sp.set('review_status', reviewStatus);
    const confParams = confToParams(confidence);
    if (confParams.confidence_min) sp.set('confidence_min', confParams.confidence_min);
    if (confParams.confidence_max) sp.set('confidence_max', confParams.confidence_max);
    if (sort) sp.set('sort', sort);
    sp.set('page', String(page));
    sp.set('limit', String(pageSize));
    return `/api/assets?${sp.toString()}`;
  }, [projectId, debouncedQ, assetType, reviewStatus, confidence, sort, page, pageSize]);

  // ── Fetch assets ──
  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildUrl());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: AssetsResponse = await r.json();
      setAssets(d.data ?? []);
      setTotal(d.total ?? 0);
      // Collect known types from current page for filter dropdown
      setKnownTypes(prev => {
        const merged = new Set([...prev, ...(d.data ?? []).map((a: Asset) => a.asset_type)]);
        return [...merged].sort();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assets');
      setAssets([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Reset to page 1 when filters change (except page itself)
  const resetPage = () => setPage(1);

  // ── Edit / Delete handlers ──
  const handleEdit = (asset: Asset) => {
    setEditingAsset(asset);
    setEditForm({
      asset_tag: asset.asset_tag ?? '',
      asset_type: asset.asset_type,
      equipment_class: asset.equipment_class ?? '',
      description: asset.description ?? '',
      service: asset.service ?? '',
      location: asset.location ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingAsset) return;
    setSavingEdit(true);
    const r = await fetch(`/api/assets/${editingAsset.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    if (r.ok) { await fetchAssets(); setEditingAsset(null); }
    setSavingEdit(false);
  };

  const handleDelete = async (asset: Asset) => {
    if (!confirm(`Delete asset "${asset.asset_tag ?? asset.asset_type}"? This cannot be undone.`)) return;
    setDeletingId(asset.id);
    await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' });
    await fetchAssets();
    setDeletingId(null);
  };

  // ── Stats ──
  const confirmed = assets.filter(a => a.review_status === 'APPROVED').length;
  const pending = assets.filter(a => a.review_status === 'PENDING').length;
  const avgConfOnPage =
    assets.length > 0
      ? Math.round(
          (assets.reduce((s, a) => s + (a.confidence ?? 0), 0) / assets.length) * 100
        )
      : null;

  // ── Export ──
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const sp = new URLSearchParams();
      if (projectId) sp.set('project_id', projectId);
      sp.set('includeReviewItems', String(includeReviewItems));
      const r = await fetch(`/api/export/assets?${sp.toString()}`);
      if (!r.ok) throw new Error(`Export failed: HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Asset_Register.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Header ── */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', margin: '0 0 8px' }}>Asset Register</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)', margin: 0 }}>
          Confirmed and reviewed assets extracted from P&amp;ID documents.
        </p>
      </div>

      {/* ── Filter / Action Bar ── */}
      <div style={{ ...cardStyle, padding: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
          {/* Project */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Project</label>
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); resetPage(); }}
              style={{ ...controlStyle, minWidth: 160 }}
            >
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Search</label>
            <input
              type="text"
              placeholder="Tag, type, description…"
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ ...controlStyle, width: 210 }}
            />
          </div>

          {/* Asset Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Asset Type</label>
            {knownTypes.length > 0 ? (
              <select
                value={assetType}
                onChange={e => { setAssetType(e.target.value); resetPage(); }}
                style={{ ...controlStyle, minWidth: 140 }}
              >
                <option value="">All types</option>
                {knownTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="e.g. Valve"
                value={assetType}
                onChange={e => { setAssetType(e.target.value); resetPage(); }}
                style={{ ...controlStyle, width: 140 }}
              />
            )}
          </div>

          {/* Review Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Status</label>
            <select
              value={reviewStatus}
              onChange={e => { setReviewStatus(e.target.value); resetPage(); }}
              style={{ ...controlStyle, minWidth: 120 }}
            >
              {REVIEW_STATUS_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Confidence */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Confidence</label>
            <select
              value={confidence}
              onChange={e => { setConfidence(e.target.value); resetPage(); }}
              style={{ ...controlStyle, minWidth: 150 }}
            >
              {CONFIDENCE_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={fieldLabelStyle}>Sort</label>
            <select
              value={sort}
              onChange={e => { setSort(e.target.value); resetPage(); }}
              style={{ ...controlStyle, minWidth: 170 }}
            >
              {SORT_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Export button — pushed to right */}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success)', background: 'var(--success)', color: 'var(--surface)', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: exporting ? 0.6 : 1, transition: 'all 150ms ease-out' }}
            >
              {exporting ? (
                <>
                  <Spinner size={14} />
                  Exporting…
                </>
              ) : (
                <>
                  <FileXls size={16} weight="bold" />
                  Export Excel
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {[
          { label: 'Total', value: total, color: 'var(--foreground)' },
          { label: 'Confirmed', value: confirmed, color: 'var(--success)' },
          { label: 'Pending', value: pending, color: 'var(--warning)' },
          {
            label: 'Avg Confidence',
            value: avgConfOnPage !== null ? `${avgConfOnPage}%` : '—',
            color: 'var(--info)',
          },
        ].map(s => (
          <div key={s.label} style={{ ...cardStyle, padding: '16px', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: '600', color: s.color, margin: '0 0 4px' }}>{s.value}</p>
            <p style={{ fontSize: '11px', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Export Section ── */}
      <div style={{ ...cardStyle, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={includeReviewItems}
            onChange={e => setIncludeReviewItems(e.target.checked)}
            style={{ width: 16, height: 16, borderRadius: 'var(--radius-sm)', accentColor: 'var(--primary)' }}
          />
          <span style={{ color: 'var(--foreground)' }}>Include review items (pending detections)</span>
        </label>

        <button
          onClick={handleExport}
          disabled={exporting}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--surface)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', opacity: exporting ? 0.6 : 1, transition: 'all 150ms ease-out' }}
        >
          {exporting ? (
            <>
              <Spinner size={14} />
              Exporting…
            </>
          ) : (
            <>
              <FileXls size={16} weight="bold" />
              Export Asset Register (.xlsx)
            </>
          )}
        </button>

        {exportError && (
          <p style={{ fontSize: '12px', color: 'var(--danger)' }}>{exportError}</p>
        )}
      </div>

      {/* ── Asset Table ── */}
      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        {error && (
          <div style={{ padding: '12px 16px', background: 'var(--danger-soft)', borderBottom: '1px solid var(--danger-soft)' }}>
            <p style={{ fontSize: '14px', color: 'var(--danger)', margin: 0 }}>{error}</p>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-muted)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                <th style={{ ...thStyle, width: 40 }}>No</th>
                <th style={thStyle}>Asset Tag</th>
                <th style={thStyle}>Asset Type</th>
                <th style={thStyle}>Size</th>
                <th style={thStyle}>Equipment Class</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>P&amp;ID</th>
                <th style={thStyle}>Page</th>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>Legend</th>
                <th style={thStyle}>Confidence</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} style={{ padding: '64px 0', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--foreground-muted)' }}>
                      <Spinner size={24} />
                      <span>Loading assets…</span>
                    </div>
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ padding: '64px 0', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--foreground-muted)' }}>
                      <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4m8-4v8" />
                      </svg>
                      <p style={{ fontWeight: '500', margin: 0 }}>No assets found</p>
                      <p style={{ fontSize: '12px', margin: 0 }}>Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                assets.map((asset, idx) => (
                  <tr
                    key={asset.id}
                    style={{
                      borderTop: '1px solid var(--border)',
                      transition: 'background 150ms ease-out',
                      background: selectedAsset?.id === asset.id ? 'var(--accent-soft)' : undefined,
                    }}
                    onMouseEnter={e => { if (selectedAsset?.id !== asset.id) e.currentTarget.style.background = 'rgba(0, 43, 78, 0.04)'; }}
                    onMouseLeave={e => { if (selectedAsset?.id !== asset.id) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ ...tdBase, color: 'var(--foreground-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    <td style={{ ...tdBase, fontWeight: '500', color: 'var(--foreground)', whiteSpace: 'nowrap', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)' }}>
                      {asset.asset_tag ?? <span style={{ color: 'var(--foreground-subtle)', fontStyle: 'italic', fontFamily: 'sans-serif' }}>—</span>}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
                      {asset.asset_type}
                    </td>
                    <td style={{ ...tdBase, color: asset.size ? 'var(--foreground)' : 'var(--foreground-subtle)', whiteSpace: 'nowrap', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)' }}>
                      {asset.size ?? <span style={{ color: 'var(--foreground-subtle)' }}>—</span>}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                      {asset.equipment_class ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.description ?? undefined}>
                      {asset.description ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)' }}>
                      {asset.pid_number ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {asset.pid_page ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                      {asset.service ?? '—'}
                    </td>
                    <td style={{ ...tdBase, color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                      {asset.legend_name ?? '—'}
                    </td>
                    <td style={tdBase}>
                      <ConfBadge value={asset.confidence} />
                    </td>
                    <td style={tdBase}>
                      <StatusBadge reviewStatus={asset.review_status} />
                    </td>
                    <td style={{ ...tdBase, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {/* View */}
                        <button
                          onClick={() => setSelectedAsset(prev => prev?.id === asset.id ? null : asset)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '500', padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: '#F0F2E9', color: '#1F2A22', border: '1px solid #DDE2D8', cursor: 'pointer', transition: 'all 150ms ease-out' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#E4E6DC'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#F0F2E9'; }}
                        >
                          <Eye size={13} weight="bold" />
                          View
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => handleEdit(asset)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '500', padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: '#002B4E', color: '#FFFFFF', border: '1px solid #002B4E', cursor: 'pointer', transition: 'all 150ms ease-out' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#003d6b'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#002B4E'; }}
                        >
                          <PencilSimple size={13} weight="bold" />
                          Edit
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(asset)}
                          disabled={deletingId === asset.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '500', padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: '#A65A55', color: '#FFFFFF', border: '1px solid #A65A55', cursor: deletingId === asset.id ? 'not-allowed' : 'pointer', transition: 'all 150ms ease-out', opacity: deletingId === asset.id ? 0.4 : 1 }}
                          onMouseEnter={e => { if (deletingId !== asset.id) e.currentTarget.style.background = '#8f4d48'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#A65A55'; }}
                        >
                          <Trash size={13} weight="bold" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: 'var(--foreground-muted)' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '12px', opacity: (page === 1 || loading) ? 0.4 : 1 }}
          >
            <CaretLeft size={13} weight="bold" />
            Prev
          </button>
          <span style={{ fontSize: '12px' }}>
            Page <span style={{ fontWeight: '600', color: 'var(--foreground)' }}>{page}</span>
            {' '}of{' '}
            <span style={{ fontWeight: '600', color: 'var(--foreground)' }}>{totalPages}</span>
            <span style={{ marginLeft: '8px', color: 'var(--foreground-subtle)' }}>({total} total)</span>
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '12px', opacity: (page === totalPages || loading) ? 0.4 : 1 }}
          >
            Next
            <CaretRight size={13} weight="bold" />
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Show</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={{ padding: '2px 6px', fontSize: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Detail Side Panel ── */}
      {selectedAsset && (
        <DetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}

      {/* ── Edit Modal ── */}
      {editingAsset && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)', zIndex: 59 }}
            onClick={() => !savingEdit && setEditingAsset(null)}
            aria-hidden="true"
          />
          {/* Card */}
          <div style={{ position: 'relative', zIndex: 60, width: 420, maxHeight: '90vh', overflowY: 'auto', ...cardStyle, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 16px 40px rgba(0,0,0,0.18)' }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--foreground)' }}>
                Edit Asset
              </h2>
              <button
                onClick={() => !savingEdit && setEditingAsset(null)}
                aria-label="Close edit modal"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--foreground-subtle)', borderRadius: 'var(--radius-sm)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--foreground-subtle)'; }}
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {(
                [
                  { key: 'asset_tag', label: 'Asset Tag' },
                  { key: 'asset_type', label: 'Asset Type' },
                  { key: 'size', label: 'Size' },
                  { key: 'equipment_class', label: 'Equipment Class' },
                  { key: 'description', label: 'Description' },
                  { key: 'service', label: 'Service' },
                  { key: 'location', label: 'Location' },
                ] as { key: keyof Asset; label: string }[]
              ).map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={fieldLabelStyle}>{label}</label>
                  <input
                    type="text"
                    value={(editForm[key] as string) ?? ''}
                    onChange={e => setEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ ...controlStyle }}
                    disabled={savingEdit}
                  />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => !savingEdit && setEditingAsset(null)}
                disabled={savingEdit}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground-muted)', fontSize: '13px', fontWeight: '500', cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.5 : 1 }}
              >
                <X size={14} weight="bold" />
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid #0078B8', background: '#0078B8', color: '#FFFFFF', fontSize: '13px', fontWeight: '500', cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.6 : 1, transition: 'all 150ms ease-out' }}
                onMouseEnter={e => { if (!savingEdit) e.currentTarget.style.background = '#0069a3'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0078B8'; }}
              >
                {savingEdit ? (
                  <>
                    <Spinner size={14} />
                    Saving…
                  </>
                ) : (
                  <>
                    <FloppyDisk size={14} weight="bold" />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Need Suspense for useSearchParams
export default function AssetsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--foreground-muted)' }}>Loading...</div>}>
      <AssetRegisterWorkspace />
    </Suspense>
  );
}