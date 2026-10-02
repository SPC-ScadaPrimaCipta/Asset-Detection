'use client';
import React from 'react';

type Variant =
  | 'primary'    // Create, Save       — Industrial Blue #0078B8
  | 'secondary'  // neutral surface
  | 'ghost'      // icon-only, subtle
  | 'danger'     // Delete             — Industrial Red #A65A55
  | 'subtle'     // soft primary tint
  | 'edit'       // Edit               — Navy #002B4E
  | 'view'       // View               — Neutral #F0F2E9
  | 'cancel'     // Cancel             — Neutral #F0F2E9
  | 'approve'    // Approve            — Green #8BBE3F
  | 'review'     // Review             — Amber #A68145
  | 'finalize';  // Finalize           — Navy #002B4E solid

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
  sm:   { height: 28, padding: '0 10px', fontSize: 12 },
  md:   { height: 36, padding: '0 14px', fontSize: 13 },
  lg:   { height: 42, padding: '0 18px', fontSize: 14 },
  icon: { height: 36, width: 36, padding: 0, fontSize: 14 },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary:  { background: '#0078B8', color: '#fff',    borderColor: '#0078B8' },
  edit:     { background: '#002B4E', color: '#fff',    borderColor: '#002B4E' },
  view:     { background: '#F0F2E9', color: '#1F2A22', borderColor: '#DDE2D8' },
  cancel:   { background: '#F0F2E9', color: '#1F2A22', borderColor: '#DDE2D8' },
  secondary:{ background: 'var(--surface)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  danger:   { background: '#A65A55', color: '#fff',    borderColor: '#A65A55' },
  approve:  { background: '#2D7A3A', color: '#fff',    borderColor: '#2D7A3A' },
  review:   { background: '#A68145', color: '#fff',    borderColor: '#A68145' },
  finalize: { background: '#002B4E', color: '#fff',    borderColor: '#002B4E' },
  ghost:    { background: 'transparent', color: 'var(--foreground-muted)', borderColor: 'transparent' },
  subtle:   { background: 'var(--primary-soft)', color: '#0078B8', borderColor: 'transparent' },
};

// Hover — darken by ~12%
const hoverVariants: Record<Variant, React.CSSProperties> = {
  primary:  { background: '#006BA3', borderColor: '#006BA3' },
  edit:     { background: '#003D6B', borderColor: '#003D6B' },
  view:     { background: '#E4E6DC', borderColor: '#CDD2C8' },
  cancel:   { background: '#E4E6DC', borderColor: '#CDD2C8' },
  secondary:{ background: 'var(--surface-hover)' },
  danger:   { background: '#924D48', borderColor: '#924D48' },
  approve:  { background: '#236130', borderColor: '#236130' },
  review:   { background: '#8F6D35', borderColor: '#8F6D35' },
  finalize: { background: '#003D6B', borderColor: '#003D6B' },
  ghost:    { background: 'var(--surface-hover)' },
  subtle:   { background: 'var(--primary-soft-hover)' },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  ...props
}: ButtonProps) {
  const [hovered, setHovered] = React.useState(false);
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      style={{
        ...base,
        ...sizes[size],
        ...variants[variant],
        ...(hovered && !isDisabled ? hoverVariants[variant] : {}),
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {loading && (
        <span
          aria-hidden
          style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid currentColor', borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      )}
      {children}
    </button>
  );
}
