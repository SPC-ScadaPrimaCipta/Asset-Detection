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
  assets: {
    total: number;
    confirmed: number;
    pending: number;
  };
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
};

const statCardStyle: React.CSSProperties = {
  ...cardStyle,
  padding: '16px',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '13px',
  fontWeight: '500',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground)',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--primary)',
  color: 'var(--surface)',
  border: '1px solid var(--primary)',
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/quota').then(r => r.json())
    ]).then(([statsData, quotaData]) => {
      setStats(statsData);
      setQuota(quotaData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p style={{ color: 'var(--foreground-muted)' }}>Loading…</p>
      </div>
    );
  }

  const totalDet = stats?.detections.total ?? 0;
  const avgPct = stats ? Math.round((stats.detections.avg_confidence ?? 0) * 100) : 0;
  const totalJobs = Object.values(stats?.jobs ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div style={{ maxWidth: '1440px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '8px' }}>
          Automatic Assets Detection
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)' }}>
          Monitor projects, detection progress, review status, and asset extraction.
        </p>
      </div>

      {/* KPI Cards (4 column) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <div style={statCardStyle}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projects</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--foreground)', marginTop: '12px' }}>{stats?.projects ?? 0}</p>
        </div>
        <div style={statCardStyle}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Documents</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--foreground)', marginTop: '12px' }}>{stats?.documents ?? 0}</p>
        </div>
        <div style={statCardStyle}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Detected Assets</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--foreground)', marginTop: '12px' }}>{totalDet.toLocaleString()}</p>
        </div>
        <div style={statCardStyle}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pending Review</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--foreground)', marginTop: '12px' }}>{stats?.detections.pending ?? 0}</p>
        </div>
      </div>

      {/* Detections & Confidence (2 col) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        <div style={cardStyle}>
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>Detection Activity</h3>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--foreground-muted)' }}>Confirmed</span>
                <span style={{ fontWeight: '600', color: 'var(--success)' }}>{stats?.detections.confirmed ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--foreground-muted)' }}>Pending</span>
                <span style={{ fontWeight: '600', color: 'var(--warning)' }}>{stats?.detections.pending ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--foreground-muted)' }}>Rejected</span>
                <span style={{ fontWeight: '600', color: 'var(--danger)' }}>{stats?.detections.rejected ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>Average Confidence</h3>
            <p style={{ fontSize: '36px', fontWeight: '600', color: 'var(--primary)', marginTop: '16px' }}>{avgPct}%</p>
            <div style={{ marginTop: '12px', width: '100%', height: '4px', background: 'var(--surface-muted)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${avgPct}%`, background: 'var(--primary)', borderRadius: '2px' }} />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '8px' }}>
              {avgPct >= 90 ? 'High reliability' : avgPct >= 75 ? 'Acceptable' : 'Needs review'}
            </p>
          </div>
        </div>
      </div>

      {/* Job Status */}
      <div style={cardStyle}>
        <div style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>Job Status</h3>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(['COMPLETED', 'PROCESSING', 'PENDING', 'FAILED'] as const).map(status => {
              const count = stats?.jobs[status] ?? 0;
              if (count === 0) return null;
              const statusColor = status === 'COMPLETED' ? 'var(--success)' : status === 'PROCESSING' ? 'var(--info)' : status === 'PENDING' ? 'var(--warning)' : 'var(--danger)';
              return (
                <div key={status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>{status}</span>
                  <span style={{ fontWeight: '600', color: statusColor }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* API Provider Quota */}
      {quota && (
        <div style={cardStyle}>
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>API Provider</h3>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--foreground-muted)' }}>Active Provider</span>
                <span style={{ fontWeight: '600', color: 'var(--foreground)', textTransform: 'capitalize' }}>{quota.provider}</span>
              </div>
              {quota.data?.balance && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>Balance</span>
                  <span style={{ fontWeight: '600', color: 'var(--foreground)' }}>{quota.data.balance} {quota.data.currency}</span>
                </div>
              )}
              {quota.message && (
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic', marginTop: '4px' }}>{quota.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div style={cardStyle}>
        <div style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '12px' }}>Quick Actions</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <Link href="/detection" style={{ textDecoration: 'none' }}>
              <button style={{ ...buttonStyle, width: '100%' }}>Run Detection</button>
            </Link>
            <Link href="/review" style={{ textDecoration: 'none' }}>
              <button style={{ ...buttonStyle, width: '100%' }}>Review Detections</button>
            </Link>
            <Link href="/legends/new" style={{ textDecoration: 'none' }}>
              <button style={{ ...buttonStyle, width: '100%' }}>Upload Legend</button>
            </Link>
            <Link href="/assets" style={{ textDecoration: 'none' }}>
              <button style={{ ...buttonStyle, width: '100%' }}>Export Assets</button>
            </Link>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {totalJobs === 0 && (stats?.documents ?? 0) === 0 && (
        <div style={{ ...cardStyle, borderStyle: 'dashed' }}>
          <div style={{ padding: '24px' }}>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px', fontWeight: '600' }}>Getting Started</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '13px', color: 'var(--foreground)' }}>1. Create a project</p>
              <p style={{ fontSize: '13px', color: 'var(--foreground)' }}>2. Upload a legend (P&ID symbols)</p>
              <p style={{ fontSize: '13px', color: 'var(--foreground)' }}>3. Upload P&ID documents</p>
              <p style={{ fontSize: '13px', color: 'var(--foreground)' }}>4. Run detection</p>
              <p style={{ fontSize: '13px', color: 'var(--foreground)' }}>5. Review and export</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
