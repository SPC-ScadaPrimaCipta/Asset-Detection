'use client';
import React from 'react';

type Variant =
  | 'primary'    // Main CTA — Royal Blue var(--primary)
  | 'secondary'  // Neutral surface with border
  | 'ghost'      // Icon-only, subtle
  | 'danger'     // Delete / Reject — var(--danger)
  | 'subtle'     // Soft primary tint
  | 'accent'     // Accent cyan / contact us — var(--accent)
  | 'edit'       // Edit — Navy var(--primary-hover)
  | 'view'       // View — var(--surface-2)
  | 'cancel'     // Cancel — Neutral var(--surface-2)
  | 'approve'    // Approve / Confirm — var(--success)
  | 'review'     // Review — var(--warning)
  | 'finalize';  // Finalize — var(--primary)

type Size = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

const base: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontWeight: 600,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-button, 10px)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  outline: 'none',
  boxSizing: 'border-box',
};

const sizes: Record<Size, React.CSSProperties> = {
  sm:   { height: 32, padding: '0 12px', fontSize: 12 },
  md:   { height: 40, padding: '0 16px', fontSize: 13 },
  lg:   { height: 44, padding: '0 20px', fontSize: 14 },
  icon: { height: 44, width: 44, padding: 0, fontSize: 14, borderRadius: 'var(--radius-button, 10px)' },
};

const variants: Record<Variant, React.CSSProperties> = {
  primary:  { background: 'var(--primary)', color: '#ffffff', borderColor: 'var(--primary)' },
  secondary:{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' },
  accent:   { background: 'var(--accent)', color: '#ffffff', borderColor: 'var(--accent)' },
  edit:     { background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'transparent' },
  view:     { background: 'var(--surface-2)', color: 'var(--text-primary)', borderColor: 'var(--border)' },
  cancel:   { background: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' },
  danger:   { background: 'var(--danger)', color: '#ffffff', borderColor: 'var(--danger)' },
  approve:  { background: 'var(--success)', color: '#ffffff', borderColor: 'var(--success)' },
  review:   { background: 'var(--warning)', color: '#ffffff', borderColor: 'var(--warning)' },
  finalize: { background: 'var(--primary)', color: '#ffffff', borderColor: 'var(--primary)' },
  ghost:    { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'transparent' },
  subtle:   { background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'transparent' },
};

const hoverVariants: Record<Variant, React.CSSProperties> = {
  primary:  { background: 'var(--primary-hover)', borderColor: 'var(--primary-hover)', transform: 'translateY(-1px)' },
  secondary:{ background: 'var(--surface-2)', borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' },
  accent:   { background: 'var(--accent-hover)', borderColor: 'var(--accent-hover)', transform: 'translateY(-1px)' },
  edit:     { background: 'var(--primary)', color: '#ffffff', transform: 'translateY(-1px)' },
  view:     { background: 'var(--surface)', borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' },
  cancel:   { background: 'var(--surface)', borderColor: 'var(--border-strong)', transform: 'translateY(-1px)' },
  danger:   { background: '#D64E63', borderColor: '#D64E63', transform: 'translateY(-1px)' },
  approve:  { background: '#259C6F', borderColor: '#259C6F', transform: 'translateY(-1px)' },
  review:   { background: '#E0A32F', borderColor: '#E0A32F', transform: 'translateY(-1px)' },
  finalize: { background: 'var(--primary-hover)', borderColor: 'var(--primary-hover)', transform: 'translateY(-1px)' },
  ghost:    { background: 'var(--surface-2)', color: 'var(--text-primary)' },
  subtle:   { background: 'var(--primary)', color: '#ffffff', transform: 'translateY(-1px)' },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  fullWidth,
  children,
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ButtonProps) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      onMouseEnter={(e) => { setHovered(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeave?.(e); }}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={{
        ...base,
        ...sizes[size],
        ...variants[variant],
        ...(hovered && !isDisabled ? hoverVariants[variant] : {}),
        ...(focused ? { outline: '2px solid var(--primary)', outlineOffset: '2px' } : {}),
        ...(fullWidth ? { width: '100%' } : {}),
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {loading && (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      )}
      {children}
    </button>
  );
}
