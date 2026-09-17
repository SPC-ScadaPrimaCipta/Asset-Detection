'use client';
import React from 'react';

export function TableWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

export function Th({ children, style, align = 'left' }: { children: React.ReactNode; style?: React.CSSProperties; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{ textAlign: align, padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', ...style }}>
      {children}
    </th>
  );
}

export function Td({ children, style, align = 'left' }: { children: React.ReactNode; style?: React.CSSProperties; align?: 'left' | 'right' | 'center' }) {
  return <td style={{ padding: '10px 12px', fontSize: 13, textAlign: align as any, ...style }}>{children}</td>;
}
