'use client';
import React, { useState } from 'react';

export function TableWrap({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card, 20px)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({
  children,
  style,
  align = 'left',
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '14px 16px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        ...style,
      }}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  style,
  hoverable = true,
  onClick,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  hoverable?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered && hoverable ? 'var(--surface-2)' : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 120ms ease-out',
        ...style,
      }}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  style,
  align = 'left',
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      style={{
        padding: '14px 16px',
        fontSize: 13,
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border)',
        textAlign: align as any,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
