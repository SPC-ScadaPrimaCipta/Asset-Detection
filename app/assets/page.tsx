'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
}

interface Asset {
  id: string;
  asset_tag: string | null;
  asset_type: string;
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

const PAGE_SIZE = 25;

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

function ConfBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-zinc-400">—</span>;
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.95
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : value >= 0.80
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {pct}%
    </span>
  );
}

function StatusBadge({ reviewStatus }: { reviewStatus: string }) {
  const label =
    reviewStatus === 'APPROVED' ? 'Approved'
    : reviewStatus === 'REJECTED' ? 'Rejected'
    : reviewStatus === 'PENDING' ? 'Pending'
    : reviewStatus;
  const cls =
    reviewStatus === 'APPROVED'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : reviewStatus === 'REJECTED'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

// ─── Detail Side Panel ────────────────────────────────────────────────────────

function DetailPanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const ev = parseEvidence(asset.evidence);
  const pct = asset.confidence !== null ? Math.round(asset.confidence * 100) : null;

  const fields: [string, string][] = [
    ['Asset Tag', asset.asset_tag ?? '—'],
    ['Asset Type', asset.asset_type],
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
    <div className="fixed inset-y-0 right-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside className="relative w-80 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm truncate pr-2">
            {asset.asset_tag ?? asset.asset_type}
          </span>
          <button
            onClick={onClose}
            className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close detail panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {/* Badges row */}
          <div className="flex flex-wrap gap-2">
            <ConfBadge value={asset.confidence} />
            <StatusBadge reviewStatus={asset.review_status} />
          </div>

          {/* Fields */}
          <dl className="space-y-3">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{k}</dt>
                <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200 break-words">{v}</dd>
              </div>
            ))}
          </dl>

          {/* Evidence */}
          {ev.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Evidence</p>
              <ul className="space-y-1.5">
                {ev.map((e, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-blue-500 mt-0.5 shrink-0">•</span>
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
    sp.set('limit', String(PAGE_SIZE));
    return `/api/assets?${sp.toString()}`;
  }, [projectId, debouncedQ, assetType, reviewStatus, confidence, sort, page]);

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Asset Register</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Confirmed and reviewed assets extracted from P&amp;ID documents.
        </p>
      </div>

      {/* ── Filter / Action Bar ── */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Project */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Project</span>
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); resetPage(); }}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40"
            >
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {/* Search */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Search</span>
            <input
              type="text"
              placeholder="Tag, type, description…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
            />
          </label>

          {/* Asset Type */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Asset Type</span>
            {knownTypes.length > 0 ? (
              <select
                value={assetType}
                onChange={e => { setAssetType(e.target.value); resetPage(); }}
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-36"
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
                className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
              />
            )}
          </label>

          {/* Review Status */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</span>
            <select
              value={reviewStatus}
              onChange={e => { setReviewStatus(e.target.value); resetPage(); }}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REVIEW_STATUS_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* Confidence */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Confidence</span>
            <select
              value={confidence}
              onChange={e => { setConfidence(e.target.value); resetPage(); }}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CONFIDENCE_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* Sort */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Sort</span>
            <select
              value={sort}
              onChange={e => { setSort(e.target.value); resetPage(); }}
              className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORT_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* Export button — pushed to right */}
          <div className="ml-auto flex items-end">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-medium transition-colors"
            >
              {exporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Exporting…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  Export Excel
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, color: 'text-zinc-700 dark:text-zinc-300' },
          { label: 'Confirmed', value: confirmed, color: 'text-emerald-600' },
          { label: 'Pending', value: pending, color: 'text-yellow-600' },
          {
            label: 'Avg Confidence',
            value: avgConfOnPage !== null ? `${avgConfOnPage}%` : '—',
            color: 'text-blue-600',
          },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 text-center"
          >
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Export Section ── */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeReviewItems}
            onChange={e => setIncludeReviewItems(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-300 accent-blue-600"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">Include review items (pending detections)</span>
        </label>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-semibold transition-colors"
        >
          {exporting ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Exporting…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Asset Register (.xlsx)
            </>
          )}
        </button>

        {exportError && (
          <p className="text-xs text-red-600 dark:text-red-400">{exportError}</p>
        )}
      </div>

      {/* ── Asset Table ── */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap w-10">No</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Asset Tag</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Asset Type</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Equipment Class</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap max-w-[200px]">Description</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">P&amp;ID</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Page</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Service</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Legend</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Confidence</th>
                <th className="text-left px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Status</th>
                <th className="text-right px-3 py-2.5 font-semibold text-zinc-500 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span className="text-sm">Loading assets…</span>
                    </div>
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4m8-4v8" />
                      </svg>
                      <p className="text-sm font-medium">No assets found</p>
                      <p className="text-xs">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                assets.map((asset, idx) => (
                  <tr
                    key={asset.id}
                    className={`border-t border-zinc-100 dark:border-zinc-800 transition-colors
                      ${selectedAsset?.id === asset.id
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                  >
                    <td className="px-3 py-2 text-zinc-400 tabular-nums">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      {asset.asset_tag ?? <span className="text-zinc-400 italic font-sans">—</span>}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      {asset.asset_type}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                      {asset.equipment_class ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 max-w-[200px] truncate" title={asset.description ?? undefined}>
                      {asset.description ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap font-mono text-xs">
                      {asset.pid_number ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap tabular-nums">
                      {asset.pid_page ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                      {asset.service ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                      {asset.legend_name ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ConfBadge value={asset.confidence} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge reviewStatus={asset.review_status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setSelectedAsset(prev => prev?.id === asset.id ? null : asset)}
                        className="text-xs px-2.5 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors font-medium"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-3 text-sm text-zinc-500">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="px-3 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-xs"
            >
              ← Prev
            </button>
            <span className="text-xs">
              Page <span className="font-semibold text-zinc-700 dark:text-zinc-300">{page}</span>
              {' '}of{' '}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{totalPages}</span>
              <span className="ml-2 text-zinc-400">({total} total)</span>
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              className="px-3 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-xs"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Detail Side Panel ── */}
      {selectedAsset && (
        <DetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}
    </div>
  );
}

// Need Suspense for useSearchParams
export default function AssetsPage() {
  return (
    <Suspense>
      <AssetRegisterWorkspace />
    </Suspense>
  );
}
