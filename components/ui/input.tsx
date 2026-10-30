'use client';
import React, { useState } from 'react';

const baseInputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 14px',
  borderRadius: 'var(--radius-input, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out, background-color 150ms ease-out',
  boxSizing: 'border-box',
};

export function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: 8,
      }}
    >
      {children} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        ...baseInputStyle,
        borderColor: focused ? 'var(--primary)' : 'var(--border)',
        boxShadow: focused ? '0 0 0 3px var(--primary-soft)' : 'none',
        background: focused ? 'var(--surface)' : 'var(--surface-2)',
        ...(props.style as object),
      }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        ...baseInputStyle,
        borderColor: focused ? 'var(--primary)' : 'var(--border)',
        boxShadow: focused ? '0 0 0 3px var(--primary-soft)' : 'none',
        background: focused ? 'var(--surface)' : 'var(--surface-2)',
        cursor: 'pointer',
        ...(props.style as object),
      }}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        ...baseInputStyle,
        height: 'auto',
        minHeight: 90,
        padding: '12px 14px',
        resize: 'vertical',
        borderColor: focused ? 'var(--primary)' : 'var(--border)',
        boxShadow: focused ? '0 0 0 3px var(--primary-soft)' : 'none',
        background: focused ? 'var(--surface)' : 'var(--surface-2)',
        ...(props.style as object),
      }}
    />
  );
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}>{children}</p>;
}

export function HelperText({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>{children}</p>;
}
