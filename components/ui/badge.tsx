'use client';
import React from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const tones: Record<Tone, React.CSSProperties> = {
  neutral: { background: 'var(--surface-muted)', color: 'var(--foreground-muted)' },
  success: { background: 'var(--success-soft)', color: 'var(--success)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  info: { background: 'var(--info-soft)', color: 'var(--info)' },
  primary: { background: 'var(--primary-soft)', color: 'var(--primary)' },
};

export function Badge({ tone = 'neutral', children, style }: { tone?: Tone; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.5,
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
  if (confidence == null) return <span style={{ fontSize: 12, color: 'var(--foreground-subtle)' }}>—</span>;
  const pct = Math.round(confidence * 100);
  const tone: Tone = confidence >= 0.9 ? 'success' : confidence >= 0.7 ? 'warning' : 'danger';
  return <Badge tone={tone}>{pct}%</Badge>;
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
