'use client';
import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontWeight: 500,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
  whiteSpace: 'nowrap',
  lineHeight: 1,
};

const sizes: Record<Size, React.CSSProperties> = {
  sm: { height: 28, padding: '0 10px', fontSize: 12 },
  md: { height: 36, padding: '0 14px', fontSize: 13 },
  lg: { height: 42, padding: '0 18px', fontSize: 14 },
  icon: { height: 36, width: 36, padding: 0, fontSize: 14 },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' },
  secondary: { background: 'var(--surface)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  ghost: { background: 'transparent', color: 'var(--foreground-muted)', borderColor: 'transparent' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'transparent' },
  subtle: { background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'transparent' },
};

export function Button({ variant = 'secondary', size = 'md', loading, children, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        ...base,
        ...sizes[size],
        ...variants[variant],
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {loading && <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />}
      {children}
    </button>
  );
}
