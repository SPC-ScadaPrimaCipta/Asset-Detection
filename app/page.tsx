'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers, ShieldAlert, Cpu, ArrowRight, Activity, Sparkles, CheckCircle } from 'lucide-react';
import { Card, CardHeader, StatCard, Button, Badge } from '@/components/ui';
import {
  DetectionBanner,
  Sparkline,
  ActivityChart,
  RecentDocumentsList,
  VerificationStatusCard,
  DetectionQueueStatus,
} from '@/components/dashboard';
import { DocumentItem } from '@/components/dashboard/RecentDocumentsList';

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
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/quota').then((r) => r.json()).catch(() => null),
      fetch('/api/documents').then((r) => r.json()).catch(() => []),
    ])
      .then(([s, q, docs]) => {
        if (s) setStats(s);
        if (q) setQuota(q);
        if (Array.isArray(docs)) setDocuments(docs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          color: 'var(--foreground-muted)',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '3px solid var(--border)',
            borderTopColor: 'var(--primary)',
            animation: 'spin 1s linear infinite',
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Loading dashboard metrics...</span>
      </div>
    );
  }

  const totalDet = stats?.detections.total ?? 0;
  const confirmedCount = stats?.detections.confirmed ?? 0;
  const pendingCount = stats?.detections.pending ?? 0;
  const rejectedCount = stats?.detections.rejected ?? 0;
  const avgPct = stats ? Math.round((stats.detections.avg_confidence ?? 0) * 100) : 0;
  const totalJobs = Object.values(stats?.jobs ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* 12-Column Responsive Grid Architecture */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 24,
        }}
        className="dashboard-main-grid"
      >
        {/* Left 8-Column Zone */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            minWidth: 0,
          }}
          className="dashboard-col-left"
        >
          {/* Top Banner */}
          <DetectionBanner />

          {/* Real-time AI Queue Status */}
          <DetectionQueueStatus />

          {/* 2 Key Stat Cards with Sparklines */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 20,
            }}
          >
            <StatCard
              label="Detected Assets"
              value={totalDet.toLocaleString()}
              trend="+12% this week"
              trendPositive={true}
              sparkline={<Sparkline positive={true} data={[12, 19, 15, 25, 22, 30, 28, 42]} />}
            />
            <StatCard
              label="Pending Review"
              value={pendingCount.toLocaleString()}
              trend={`${pendingCount} need validation`}
              trendPositive={pendingCount === 0}
              sparkline={<Sparkline positive={pendingCount === 0} data={[35, 30, 28, 22, 18, 14, 12, 8]} />}
            />
          </div>

          {/* Main Spline Activity Chart */}
          <ActivityChart title="P&ID Asset Detection Volume" />

          {/* Confidence and Job Status Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 20,
            }}
          >
            {/* Average Confidence Card */}
            <Card>
              <CardHeader title="Average Confidence" />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 700,
                      color: 'var(--primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {avgPct}%
                  </span>
                  <Badge variant={avgPct >= 90 ? 'available' : avgPct >= 75 ? 'primary' : 'pending'}>
                    {avgPct >= 90 ? 'High Reliability' : avgPct >= 75 ? 'Acceptable' : 'Needs Tuning'}
                  </Badge>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    width: '100%',
                    height: 6,
                    background: 'var(--surface-muted, #E6EAF2)',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${avgPct}%`,
                      background: 'var(--primary)',
                      borderRadius: 999,
                      transition: 'width 300ms ease',
                    }}
                  />
                </div>

                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--foreground-muted)',
                    marginTop: 12,
                    marginBottom: 0,
                    lineHeight: 1.5,
                  }}
                >
                  AI multimodal detection score calibrated against current symbol legend library.
                </p>
              </div>
            </Card>

            {/* Job Processing Status */}
            <Card>
              <CardHeader title="Pipeline Execution Status" />
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['COMPLETED', 'PROCESSING', 'PENDING', 'FAILED'] as const).map((s) => {
                  const count = stats?.jobs[s] ?? 0;
                  const c =
                    s === 'COMPLETED'
                      ? 'var(--success, #2FB584)'
                      : s === 'PROCESSING'
                      ? 'var(--info, #3451D1)'
                      : s === 'PENDING'
                      ? 'var(--warning, #E08A26)'
                      : 'var(--danger, #E5677B)';
                  return (
                    <div
                      key={s}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: 'var(--surface-2)',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: 'var(--foreground-muted)', fontWeight: 500 }}>{s}</span>
                      <span style={{ fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
                        {count.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
                {totalJobs === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '8px 0 0' }}>
                    No detection jobs have been executed yet.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Right 4-Column Zone */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            minWidth: 0,
          }}
          className="dashboard-col-right"
        >
          {/* Recent P&ID Documents */}
          <RecentDocumentsList documents={documents} />

          {/* Verification Status & AI Quota */}
          <VerificationStatusCard
            confirmedCount={confirmedCount}
            pendingCount={pendingCount}
            rejectedCount={rejectedCount}
            quota={quota}
          />
        </div>
      </div>

      <style jsx>{`
        @media (min-width: 1080px) {
          .dashboard-main-grid {
            display: grid !important;
            grid-template-columns: 2fr 1fr !important;
            gap: 24px !important;
          }
        }
      `}</style>
    </div>
  );
}
