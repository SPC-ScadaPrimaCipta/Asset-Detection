'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Cpu, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, Button, Badge } from '@/components/ui';

interface VerificationStatusCardProps {
  confirmedCount: number;
  pendingCount: number;
  rejectedCount?: number;
  quota?: {
    provider?: string;
    data?: { balance?: string | number; currency?: string };
    message?: string;
  } | null;
}

export default function VerificationStatusCard({
  confirmedCount,
  pendingCount,
  rejectedCount = 0,
  quota,
}: VerificationStatusCardProps) {
  const total = confirmedCount + pendingCount + rejectedCount;
  const confirmedPct = total > 0 ? Math.round((confirmedCount / total) * 100) : 0;

  return (
    <Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader title="Verification Status" />

      {/* 2-Column Comparison: Confirmed vs Pending */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 4 }}>
        {/* Confirmed / Available */}
        <div
          style={{
            padding: '16px',
            borderRadius: 14,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground-muted)' }}>Confirmed</span>
            <Badge variant="available">Verified</Badge>
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--success, #2FB584)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {confirmedCount.toLocaleString()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--foreground-muted)' }}>
            <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
            <span>Ready for export</span>
          </div>
        </div>

        {/* Pending / Needs Review */}
        <div
          style={{
            padding: '16px',
            borderRadius: 14,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground-muted)' }}>Pending</span>
            <Badge variant="pending">Needs Review</Badge>
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--warning, #E08A26)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pendingCount.toLocaleString()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--foreground-muted)' }}>
            <Clock size={13} style={{ color: 'var(--warning)' }} />
            <span>Awaiting sign-off</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: 'var(--foreground-muted)', fontWeight: 500 }}>Review Progress</span>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{confirmedPct}% Done</span>
        </div>
        <div
          style={{
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
              width: `${confirmedPct}%`,
              background: 'var(--primary)',
              borderRadius: 999,
              transition: 'width 300ms ease',
            }}
          />
        </div>
      </div>

      {/* Full-Width Action Button */}
      <div style={{ marginTop: 'auto', marginBottom: 16 }}>
        <Link href="/detection" style={{ textDecoration: 'none', display: 'block' }}>
          <Button fullWidth style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span>Review In Detection</span>
            <ArrowUpRight size={16} />
          </Button>
        </Link>
      </div>

      {/* AI Provider Quota Footer */}
      {quota && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--foreground-muted)' }}>
            <Cpu size={14} style={{ color: 'var(--primary)' }} />
            <span>AI Provider:</span>
            <strong style={{ color: 'var(--foreground)', textTransform: 'capitalize' }}>
              {quota.provider || 'Active'}
            </strong>
          </div>
          {quota.data?.balance !== undefined && (
            <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
              {quota.data.balance} {quota.data.currency ?? 'Tokens'}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
