'use client';
import React from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const tones: Record<Tone, React.CSSProperties> = {
  neutral: { background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  danger:  { background: 'var(--danger-soft)', color: 'var(--danger)' },
  info:    { background: 'var(--info-soft)', color: 'var(--info)' },
  primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
};

export function Badge({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: Tone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 'var(--radius-chip, 6px)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  if (confidence == null) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>;
  const pct = Math.round(confidence * 100);
  const tone: Tone = confidence >= 0.9 ? 'success' : confidence >= 0.7 ? 'warning' : 'danger';
  return (
    <Badge tone={tone}>
      <span className="tabular-nums">{pct}%</span>
    </Badge>
  );
}

export function StatusBadge({ status, reviewStatus }: { status?: string; reviewStatus?: string }) {
  const s = (status ?? '').toUpperCase();
  const r = (reviewStatus ?? '').toUpperCase();
  if (r === 'APPROVED') return <Badge tone="success">Confirmed</Badge>;
  if (r === 'REJECTED') return <Badge tone="danger">Rejected</Badge>;
  if (s === 'MANUAL') return <Badge tone="info">Manual</Badge>;
  if (s === 'DETECTED') return <Badge tone="primary">Detected</Badge>;
  if (s === 'UPLOADED') return <Badge tone="neutral">Uploaded</Badge>;
  if (s === 'PROCESSING') return <Badge tone="info">Processing</Badge>;
  if (s === 'DONE' || s === 'COMPLETED') return <Badge tone="success">Done</Badge>;
  if (s === 'FAILED') return <Badge tone="danger">Failed</Badge>;
  return <Badge tone="neutral">{status ?? '—'}</Badge>;
}
