'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface Asset {
  id: string;
  asset_tag: string | null;
  asset_type: string;
  equipment_class: string | null;
  description: string | null;
  service: string | null;
  location: string | null;
  unit: string | null;
  area: string | null;
  pid_page: number | null;
  confidence: number | null;
  review_status: string;
  created_at: string;
}

export default function AssetRegisterPage() {
  const searchParams = useSearchParams();
  const initProjectId = searchParams.get('project_id') ?? '';

  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState(initProjectId);
  const [reviewStatus, setReviewStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    loadAssets();
  }, [projectId, reviewStatus, q, page]);

  const loadAssets = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (reviewStatus) params.set('review_status', reviewStatus);
    if (q) params.set('q', q);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const r = await fetch(`/api/assets?${params}`);
    const d = await r.json();
    setAssets(d.data || []);
    setTotal(d.total || 0);
    setLoading(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Asset Register</h1>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Search tag / type / description…"
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
          className="rounded border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm w-80"
        />
        <select
          value={reviewStatus}
          onChange={e => { setReviewStatus(e.target.value); setPage(1); }}
          className="rounded border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="APPROVED">Approved</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span className="ml-auto self-center text-sm text-zinc-500">{total} asset{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading…</div>
      ) : assets.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">No assets found.</div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Asset Tag</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Equipment Class</th>
                <th className="text-left px-4 py-3 font-semibold">Description</th>
                <th className="text-left px-4 py-3 font-semibold">Service</th>
                <th className="text-left px-4 py-3 font-semibold">Location</th>
                <th className="text-left px-4 py-3 font-semibold">P&ID Page</th>
                <th className="text-left px-4 py-3 font-semibold">Confidence</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => {
                const pct = a.confidence !== null ? Math.round(a.confidence * 100) : null;
                const statusCls = a.review_status === 'APPROVED'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                  : a.review_status === 'REJECTED'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
                return (
                  <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-3 font-mono font-medium">{a.asset_tag ?? '—'}</td>
                    <td className="px-4 py-3">{a.asset_type}</td>
                    <td className="px-4 py-3">{a.equipment_class ?? '—'}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{a.description ?? '—'}</td>
                    <td className="px-4 py-3">{a.service ?? '—'}</td>
                    <td className="px-4 py-3">{a.location ?? '—'}</td>
                    <td className="px-4 py-3">{a.pid_page ?? '—'}</td>
                    <td className="px-4 py-3">{pct !== null ? `${pct}%` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>
                        {a.review_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded border border-zinc-300 disabled:opacity-40">←</button>
          <span className="text-zinc-600">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded border border-zinc-300 disabled:opacity-40">→</button>
        </div>
      )}
    </div>
  );
}
