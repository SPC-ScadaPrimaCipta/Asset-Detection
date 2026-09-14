'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Stats {
  projects: number;
  documents: number;
  jobs: Record<string, number>;
  detections: {
    total: number;
    confirmed: number;
    pending: number;
    rejected: number;
    avg_confidence: number;
  };
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      <p className={`text-2xl font-bold ${color ?? 'text-zinc-800 dark:text-zinc-100'}`}>{value}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const activeJobs = stats ? ((stats.jobs['PENDING'] ?? 0) + (stats.jobs['PROCESSING'] ?? 0)) : 0;
  const avgPct = stats ? Math.round((stats.detections.avg_confidence ?? 0) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Automatic Asset Detection overview</p>
      </div>

      {loading ? (
        <div className="text-zinc-400 text-sm">Loading stats…</div>
      ) : (
        <>
          {/* Main stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Projects" value={stats?.projects ?? 0} />
            <StatCard label="Documents" value={stats?.documents ?? 0} />
            <StatCard label="Active Jobs" value={activeJobs} color={activeJobs > 0 ? 'text-blue-600' : undefined} />
            <StatCard label="Completed Jobs" value={stats?.jobs['COMPLETED'] ?? 0} color="text-emerald-600" />
          </div>

          {/* Detection stats */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Detections</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard label="Total Detected" value={stats?.detections.total ?? 0} />
              <StatCard label="Confirmed" value={stats?.detections.confirmed ?? 0} color="text-emerald-600" />
              <StatCard label="Pending Review" value={stats?.detections.pending ?? 0} color="text-yellow-600" />
              <StatCard label="Rejected" value={stats?.detections.rejected ?? 0} color="text-red-600" />
              <StatCard
                label="Avg Confidence"
                value={stats?.detections.total ? `${avgPct}%` : '—'}
                color="text-blue-600"
                sub={avgPct >= 95 ? 'High' : avgPct >= 80 ? 'Medium' : avgPct > 0 ? 'Review' : undefined}
              />
            </div>
          </div>

          {/* Job status breakdown */}
          {stats && Object.keys(stats.jobs).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Job Status</h2>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
                {(['COMPLETED', 'PROCESSING', 'PENDING', 'FAILED', 'CANCELLED'] as const).map(s => {
                  const count = stats.jobs[s] ?? 0;
                  if (count === 0) return null;
                  const color =
                    s === 'COMPLETED' ? 'text-emerald-600' :
                    s === 'PROCESSING' ? 'text-blue-600' :
                    s === 'PENDING' ? 'text-yellow-600' :
                    s === 'FAILED' ? 'text-red-600' : 'text-zinc-400';
                  return (
                    <div key={s} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-zinc-600 dark:text-zinc-400">{s}</span>
                      <span className={`font-semibold ${color}`}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <Link href="/projects" className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
                Manage Projects
              </Link>
              <Link href="/detection" className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium">
                Run Detection
              </Link>
              <Link href="/legends" className="px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium">
                Legend Library
              </Link>
              <Link href="/documents" className="px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium">
                Upload Document
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
