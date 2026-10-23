import React from 'react';

export function EmptyState({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            marginBottom: 16,
          }}
        >
          {icon}
        </div>
      )}
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
        {title}
      </p>
      {subtitle && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 0, maxWidth: 360 }}>
          {subtitle}
        </p>
      )}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}
