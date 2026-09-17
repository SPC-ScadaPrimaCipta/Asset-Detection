'use client';
import React from 'react';

export function Card({ children, style, padding = 16, hoverable, ...props }: { children: React.ReactNode; style?: React.CSSProperties; padding?: number | string; hoverable?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding,
        transition: hoverable ? 'box-shadow 150ms, border-color 150ms' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: subtitle ? 4 : 12 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card padding={16}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 600, color: 'var(--foreground)', marginTop: 8, marginBottom: 0 }}>{value}</p>
      {hint && <p style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginTop: 4, marginBottom: 0 }}>{hint}</p>}
    </Card>
  );
}
