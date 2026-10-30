'use client';
import React from 'react';

export function Card({
  children,
  style,
  padding = 24,
  hoverable,
  ...props
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  padding?: number | string;
  hoverable?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card, 20px)',
        boxShadow: 'var(--shadow-card)',
        padding,
        transition: hoverable ? 'all 150ms ease-out' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  iconBox = true,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  iconBox?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: subtitle ? 8 : 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {iconBox && (
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 'var(--radius-icon-box, 4px)',
              background: 'var(--primary)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        )}
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action || (
        <button
          type="button"
          aria-label="Options"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⋮
        </button>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  trendPositive,
  sparkline,
}: {
  label: string;
  value: string | number;
  hint?: string;
  trend?: string;
  trendPositive?: boolean;
  sparkline?: React.ReactNode;
}) {
  return (
    <Card padding={24}>
      <CardHeader title={label} />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
        <div>
          <p
            className="tabular-nums"
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            {value}
          </p>
          {trend && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: trendPositive ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {trend}
              </span>
              {hint && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{hint}</span>}
            </div>
          )}
          {!trend && hint && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, marginBottom: 0 }}>
              {hint}
            </p>
          )}
        </div>
        {sparkline && <div style={{ flexShrink: 0 }}>{sparkline}</div>}
      </div>
    </Card>
  );
}

