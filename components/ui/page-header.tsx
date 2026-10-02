'use client';
import React from 'react';
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 8px' }}>{title}</h1>
        {description && <p style={{ fontSize: 14, color: 'var(--foreground-muted)', margin: 0 }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}
