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

// ── Design tokens (HMI palette) ───────────────────────────────────────────────
const C = {
  surface:    '#1e293b',
  surface2:   '#263348',
  border:     '#334155',
  borderSoft: '#1e2d40',
  text:       '#f1f5f9',
  textSub:    '#94a3b8',
  textMuted:  '#475569',
  green:      '#22c55e',
  greenDim:   'rgba(34,197,94,0.12)',
  greenBorder:'rgba(34,197,94,0.25)',
  yellow:     '#eab308',
  yellowDim:  'rgba(234,179,8,0.12)',
  yellowBorder:'rgba(234,179,8,0.25)',
  red:        '#ef4444',
  redDim:     'rgba(239,68,68,0.12)',
  redBorder:  'rgba(239,68,68,0.25)',
  blue:       '#3b82f6',
  blueDim:    'rgba(59,130,246,0.12)',
  blueBorder: 'rgba(59,130,246,0.25)',
  cyan:       '#22d3ee',
  cyanDim:    'rgba(34,211,238,0.10)',
  cyanBorder: 'rgba(34,211,238,0.22)',
  accent:     '#38bdf8',
};

// ── Icon helper ───────────────────────────────────────────────────────────────
const Icon = ({ d, size = 5, color }: { d: string; size?: number; color?: string }) => (
  <svg
    className={`w-${size} h-${size} shrink-0`}
    style={color ? { color } : undefined}
    fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

// ── Mini bar ──────────────────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.8s ease' }} />
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, color, iconPath, bar,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  iconPath: string;
  bar?: { value: number; max: number; barColor: string };
}) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </p>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {label}
          </p>
        </div>
        <div style={{
          background: `${color}1a`,
          border: `1px solid ${color}33`,
          borderRadius: 8,
          padding: 8,
          color,
        }}>
          <Icon d={iconPath} size={5} color={color} />
        </div>
      </div>
      {bar && <MiniBar value={bar.value} max={bar.max} color={bar.barColor} />}
      {sub && <p style={{ fontSize: 11, color: C.textMuted }}>{sub}</p>}
    </div>
  );
}

// ── Confidence ring ───────────────────────────────────────────────────────────
function ConfidenceRing({ pct }: { pct: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 95 ? C.green : pct >= 80 ? C.yellow : pct > 0 ? C.red : C.textMuted;
  const label = pct >= 95 ? 'HIGH' : pct >= 80 ? 'MEDIUM' : pct > 0 ? 'REVIEW' : 'N/A';
  const labelColor = pct >= 95 ? C.green : pct >= 80 ? C.yellow : pct > 0 ? C.red : C.textMuted;
  const dimColor   = pct >= 95 ? C.greenDim : pct >= 80 ? C.yellowDim : pct > 0 ? C.redDim : 'transparent';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={96} height={96} viewBox="0 0 96 96">
        {/* Track */}
        <circle cx={48} cy={48} r={r} fill="none" stroke="#0f172a" strokeWidth={9} />
        {/* Value arc */}
        <circle
          cx={48} cy={48} r={r}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)`, transition: 'stroke-dashoffset 0.9s ease' }}
        />
        {/* Center glow */}
        <circle cx={48} cy={48} r={30} fill={dimColor} />
        {/* Percentage text */}
        <text x={48} y={44} textAnchor="middle" fontSize={15} fontWeight={700} fill={color} dominantBaseline="middle">
          {pct > 0 ? `${pct}%` : '—'}
        </text>
        <text x={48} y={60} textAnchor="middle" fontSize={9} fontWeight={700} fill={labelColor}
          style={{ letterSpacing: '0.08em' }}>
          {label}
        </text>
      </svg>
      <p style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 1.4 }}>
        {pct >= 95 ? 'Detections reliable'
        : pct >= 80 ? 'Needs verification'
        : pct > 0 ? 'Manual review required'
        : 'No detections yet'}
      </p>
    </div>
  );
}

// ── Detection segment row ─────────────────────────────────────────────────────
function SegmentRow({
  label, value, total, color, dim, border, iconPath,
}: {
  label: string; value: number; total: number;
  color: string; dim: string; border: string; iconPath: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: dim, border: `1px solid ${border}`, borderRadius: 6, padding: '4px 5px', color }}>
            <Icon d={iconPath} size={3} color={color} />
          </div>
          <span style={{ fontSize: 12, color: C.textSub }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
          <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>{value}</span>
        </div>
      </div>
      <div style={{ height: 5, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max(pct > 0 ? 3 : 0, pct)}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 3,
          transition: 'width 0.8s ease',
          boxShadow: `0 0 6px ${color}55`,
        }} />
      </div>
    </div>
  );
}

// ── Job status item ───────────────────────────────────────────────────────────
function JobStatusRow({ status, count }: { status: string; count: number }) {
  const cfg: Record<string, { color: string; dim: string; border: string; dot: string }> = {
    COMPLETED:  { color: C.green,  dim: C.greenDim,  border: C.greenBorder,  dot: C.green },
    PROCESSING: { color: C.blue,   dim: C.blueDim,   border: C.blueBorder,   dot: C.blue },
    PENDING:    { color: C.yellow, dim: C.yellowDim, border: C.yellowBorder, dot: C.yellow },
    FAILED:     { color: C.red,    dim: C.redDim,    border: C.redBorder,    dot: C.red },
    CANCELLED:  { color: C.textMuted, dim: 'rgba(71,85,105,0.15)', border: 'rgba(71,85,105,0.3)', dot: C.textMuted },
  };
  const c = cfg[status] ?? cfg.CANCELLED;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 14px',
      background: c.dim,
      border: `1px solid ${c.border}`,
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.dot, display: 'inline-block',
          boxShadow: status === 'PROCESSING' ? `0 0 8px ${c.dot}` : 'none' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: c.color, letterSpacing: '0.06em' }}>{status}</span>
      </div>
      <span style={{ fontSize: 16, fontWeight: 800, color: c.color, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  );
}

// ── Quick action card ─────────────────────────────────────────────────────────
function ActionCard({ href, label, desc, iconPath, primary }: {
  href: string; label: string; desc: string; iconPath: string; primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 10,
        border: primary
          ? `1px solid ${C.blueBorder}`
          : `1px solid ${hover ? C.border : C.borderSoft}`,
        background: primary
          ? hover ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)'
          : hover ? C.surface2 : C.surface,
        textDecoration: 'none',
        transition: 'all 0.15s ease',
        transform: hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 4px 16px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{
        background: primary ? 'rgba(59,130,246,0.2)' : '#0f172a',
        border: `1px solid ${primary ? C.blueBorder : C.border}`,
        borderRadius: 8, padding: '7px',
        color: primary ? C.blue : C.textSub,
        flexShrink: 0,
      }}>
        <Icon d={iconPath} size={4} color={primary ? C.blue : C.textSub} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: primary ? C.blue : C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </p>
        <p style={{ fontSize: 11, color: C.textMuted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {desc}
        </p>
      </div>
      <svg style={{ width: 14, height: 14, color: primary ? C.blue : C.textMuted, flexShrink: 0 }}
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<any>(null);

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

  const activeJobs    = stats ? ((stats.jobs['PENDING'] ?? 0) + (stats.jobs['PROCESSING'] ?? 0)) : 0;
  const completedJobs = stats?.jobs['COMPLETED'] ?? 0;
  const totalJobs     = stats ? Object.values(stats.jobs).reduce((a, b) => a + b, 0) : 0;
  const avgPct        = stats ? Math.round((stats.detections.avg_confidence ?? 0) * 100) : 0;
  const totalDet      = stats?.detections.total ?? 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: C.textMuted }}>
          <svg style={{ width: 32, height: 32, animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24">
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <p style={{ fontSize: 13 }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em', margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
            Automatic Asset Detection — system overview
          </p>
        </div>
        {activeJobs > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 14px',
            background: C.blueDim,
            border: `1px solid ${C.blueBorder}`,
            borderRadius: 999,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: C.blue,
              boxShadow: `0 0 8px ${C.blue}`,
              animation: 'pulse 1.5s infinite',
              display: 'inline-block',
            }} />
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.blue }}>
              {activeJobs} job{activeJobs > 1 ? 's' : ''} running
            </span>
          </div>
        )}
      </div>

      {/* ── Row 1: Overview stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <StatCard
          label="Projects"
          value={stats?.projects ?? 0}
          color={C.accent}
          iconPath="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
        <StatCard
          label="Documents"
          value={stats?.documents ?? 0}
          color={C.cyan}
          iconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
        <StatCard
          label="Detection Jobs"
          value={totalJobs}
          color={C.blue}
          sub={completedJobs > 0 ? `${completedJobs} completed` : undefined}
          iconPath="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          bar={{ value: completedJobs, max: totalJobs || 1, barColor: C.blue }}
        />
        <StatCard
          label="Asset Register"
          value={stats?.assets.total ?? 0}
          color={C.green}
          sub={stats?.assets.confirmed ? `${stats.assets.confirmed} confirmed` : undefined}
          iconPath="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          bar={{ value: stats?.assets.confirmed ?? 0, max: stats?.assets.total || 1, barColor: C.green }}
        />
      </div>

      {/* ── Row 2: Detection breakdown + Confidence ring ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        {/* Detection breakdown */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <div style={{
            padding: '14px 20px',
            borderBottom: `1px solid ${C.borderSoft}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#1a2740',
          }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Detection Breakdown</p>
              <p style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                {totalDet.toLocaleString()} total detections
              </p>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, color: C.textMuted,
              background: '#0f172a', border: `1px solid ${C.border}`,
              padding: '3px 10px', borderRadius: 6,
              letterSpacing: '0.05em',
            }}>ALL JOBS</span>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SegmentRow label="Confirmed" value={stats?.detections.confirmed ?? 0} total={totalDet}
              color={C.green} dim={C.greenDim} border={C.greenBorder}
              iconPath="M5 13l4 4L19 7" />
            <SegmentRow label="Pending Review" value={stats?.detections.pending ?? 0} total={totalDet}
              color={C.yellow} dim={C.yellowDim} border={C.yellowBorder}
              iconPath="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            <SegmentRow label="Rejected" value={stats?.detections.rejected ?? 0} total={totalDet}
              color={C.red} dim={C.redDim} border={C.redBorder}
              iconPath="M6 18L18 6M6 6l12 12" />
            {/* Total bar */}
            <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: C.textMuted }}>Total Detected</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{totalDet}</span>
            </div>
          </div>
        </div>

        {/* Confidence ring */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: '24px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Avg. Confidence</p>
          <ConfidenceRing pct={avgPct} />
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6, width: '100%',
          }}>
            {[
              { label: '≥ 95% High',    color: C.green },
              { label: '80–94% Medium', color: C.yellow },
              { label: '< 80% Review',  color: C.red },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: C.textMuted }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 3: Quota Tracker ── */}
      {quota && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>API Quota & Balance</p>
              <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                Active Provider: <span style={{ color: C.accent, fontWeight: 600, textTransform: 'capitalize' }}>{quota.provider}</span>
              </p>
            </div>
            {quota.data?.balance && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1 }}>{quota.data.balance} {quota.data.currency}</p>
                <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Total Balance</p>
              </div>
            )}
          </div>

          {quota.data ? (
            quota.data.granted && quota.data.toppedUp ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                {/* Free Quota */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>Free Quota</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{quota.data.granted}</span>
                  </div>
                  <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, (parseFloat(quota.data.granted) / (parseFloat(quota.data.granted) + parseFloat(quota.data.toppedUp)) || 0) * 100)}%`,
                      height: '100%', background: C.green, borderRadius: 3, transition: 'width 0.8s ease'
                    }} />
                  </div>
                </div>

                {/* Top-up Balance */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>Top-up Balance</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{quota.data.toppedUp}</span>
                  </div>
                  <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, (parseFloat(quota.data.toppedUp) / (parseFloat(quota.data.granted) + parseFloat(quota.data.toppedUp)) || 0) * 100)}%`,
                      height: '100%', background: C.blue, borderRadius: 3, transition: 'width 0.8s ease'
                    }} />
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
                {quota.message || 'No quota usage data available.'}
              </p>
            )
          ) : (
            <p style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
              {quota.message || 'Check settings to configure API keys and view quota.'}
            </p>
          )}
        </div>
      )}

      {/* ── Row 4: Job status + Quick actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
        {/* Job status */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.borderSoft}`, background: '#1a2740' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Job Status</p>
          </div>
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {totalJobs === 0 ? (
              <p style={{ fontSize: 12, color: C.textMuted, padding: '16px 8px', textAlign: 'center' }}>
                No jobs yet
              </p>
            ) : (
              (['COMPLETED', 'PROCESSING', 'PENDING', 'FAILED', 'CANCELLED'] as const).map(s => {
                const count = stats?.jobs[s] ?? 0;
                if (count === 0) return null;
                return <JobStatusRow key={s} status={s} count={count} />;
              })
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Quick Actions
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ActionCard href="/detection" label="Run Detection" desc="Analyze P&ID with AI"
              iconPath="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" primary />
            <ActionCard href="/review" label="Review Detections"
              desc={stats?.detections.pending ? `${stats.detections.pending} pending` : 'Confirm / reject'}
              iconPath="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            <ActionCard href="/legends/new" label="Upload Legend" desc="Add P&ID symbol legend"
              iconPath="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            <ActionCard href="/assets" label="Export Excel" desc="Download Asset_Register.xlsx"
              iconPath="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </div>
        </div>
      </div>

      {/* ── Getting started guide (empty state) ── */}
      {totalJobs === 0 && (stats?.documents ?? 0) === 0 && (
        <div style={{
          border: `1px dashed ${C.border}`,
          borderRadius: 12, padding: '24px',
          background: 'rgba(15,23,42,0.5)',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 16 }}>Getting Started</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { step: '01', label: 'Create a Project', href: '/projects', desc: 'Group your P&ID documents' },
              { step: '02', label: 'Upload Legend',     href: '/legends/new', desc: 'Define P&ID symbols for AI recognition' },
              { step: '03', label: 'Upload P&ID PDF',   href: '/documents', desc: 'PDF format, max 50MB per file' },
              { step: '04', label: 'Run Detection',     href: '/detection', desc: 'AI analyzes each page automatically' },
              { step: '05', label: 'Review & Export',   href: '/review', desc: 'Confirm detections, export Asset Register' },
            ].map(s => (
              <Link key={s.step} href={s.href} style={{
                display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none',
                padding: '8px 0',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: C.textMuted,
                  width: 28, letterSpacing: '0.05em',
                }}>{s.step}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: C.textSub }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>{s.desc}</span>
                </div>
                <svg style={{ width: 14, height: 14, color: C.textMuted }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
