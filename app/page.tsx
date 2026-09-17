'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, StatCard, Button } from '@/components/ui';

interface Stats {
  projects: number;
  documents: number;
  jobs: Record<string, number>;
  detections: { total: number; confirmed: number; pending: number; rejected: number; avg_confidence: number };
  assets: { total: number; confirmed: number; pending: number };
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetch('/api/stats').then(r => r.json()), fetch('/api/quota').then(r => r.json())])
      .then(([s, q]) => { setStats(s); setQuota(q); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 256, color: 'var(--foreground-muted)' }}><p>Loading…</p></div>;

  const totalDet = stats?.detections.total ?? 0;
  const avgPct = stats ? Math.round((stats.detections.avg_confidence ?? 0) * 100) : 0;
  const totalJobs = Object.values(stats?.jobs ?? {}).reduce((a, b) => a + b, 0);
  const activity: [string, number, string][] = [
    ['Confirmed', stats?.detections.confirmed ?? 0, 'var(--success)'],
    ['Pending', stats?.detections.pending ?? 0, 'var(--warning)'],
    ['Rejected', stats?.detections.rejected ?? 0, 'var(--danger)'],
  ];

  return (
    <div style={{ maxWidth: 1440, display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Automatic Assets Detection</h1>
        <p style={{ fontSize: 14, color: 'var(--foreground-muted)', margin: 0 }}>Monitor projects, detection progress, review status, and asset extraction.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 16 }}>
        <StatCard label="Projects" value={stats?.projects ?? 0} />
        <StatCard label="Documents" value={stats?.documents ?? 0} />
        <StatCard label="Detected Assets" value={totalDet.toLocaleString()} />
        <StatCard label="Pending Review" value={stats?.detections.pending ?? 0} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Detection Activity</h3>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activity.map(([label, val, color]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--foreground-muted)' }}>{label}</span>
                <span style={{ fontWeight: 600, color }}>{val}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Average Confidence</h3>
          <p style={{ fontSize: 36, fontWeight: 600, color: 'var(--primary)', marginTop: 16, marginBottom: 0 }}>{avgPct}%</p>
          <div style={{ marginTop: 12, width: '100%', height: 4, background: 'var(--surface-muted)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${avgPct}%`, background: 'var(--primary)', borderRadius: 2 }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 8, marginBottom: 0 }}>{avgPct >= 90 ? 'High reliability' : avgPct >= 75 ? 'Acceptable' : 'Needs review'}</p>
        </Card>
      </div>

      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 16px' }}>Job Status</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(['COMPLETED', 'PROCESSING', 'PENDING', 'FAILED'] as const).map(s => {
            const count = stats?.jobs[s] ?? 0;
            if (!count) return null;
            const c = s === 'COMPLETED' ? 'var(--success)' : s === 'PROCESSING' ? 'var(--info)' : s === 'PENDING' ? 'var(--warning)' : 'var(--danger)';
            return <div key={s} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--foreground-muted)' }}>{s}</span><span style={{ fontWeight: 600, color: c }}>{count}</span></div>;
          })}
          {totalJobs === 0 && <p style={{ fontSize: 13, color: 'var(--foreground-subtle)', margin: 0 }}>No jobs yet.</p>}
        </div>
      </Card>

      {quota && (
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 16px' }}>API Provider</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--foreground-muted)' }}>Active Provider</span><span style={{ fontWeight: 600, color: 'var(--foreground)', textTransform: 'capitalize' }}>{quota.provider}</span></div>
            {quota.data?.balance && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--foreground-muted)' }}>Balance</span><span style={{ fontWeight: 600 }}>{quota.data.balance} {quota.data.currency}</span></div>}
            {quota.message && <p style={{ fontSize: 12, color: 'var(--foreground-muted)', fontStyle: 'italic', margin: 0 }}>{quota.message}</p>}
          </div>
        </Card>
      )}

      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 12px' }}>Quick Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          <Link href="/detection" style={{ textDecoration: 'none' }}><Button style={{ width: '100%' }}>Run Detection</Button></Link>
          <Link href="/review" style={{ textDecoration: 'none' }}><Button style={{ width: '100%' }}>Review Detections</Button></Link>
          <Link href="/legends/new" style={{ textDecoration: 'none' }}><Button style={{ width: '100%' }}>Upload Legend</Button></Link>
          <Link href="/assets" style={{ textDecoration: 'none' }}><Button style={{ width: '100%' }}>Export Assets</Button></Link>
        </div>
      </Card>

      {totalJobs === 0 && (stats?.documents ?? 0) === 0 && (
        <Card style={{ borderStyle: 'dashed' }}>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '0 0 12px', fontWeight: 600 }}>Getting Started</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {['1. Create a project', '2. Upload a legend (P&ID symbols)', '3. Upload P&ID documents', '4. Run detection', '5. Review and export'].map(s => <p key={s} style={{ fontSize: 13, color: 'var(--foreground)', margin: 0 }}>{s}</p>)}
          </div>
        </Card>
      )}
    </div>
  );
}
