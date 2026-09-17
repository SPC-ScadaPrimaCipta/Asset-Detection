'use client';
import React from 'react';

const baseInput: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};

export function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
      {children} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...baseInput, ...(props.style as object) }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...baseInput, ...(props.style as object) }} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...baseInput, minHeight: 80, resize: 'vertical', ...(props.style as object) }} />;
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>{children}</p>;
}

export function HelperText({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 6, fontSize: 12, color: 'var(--foreground-muted)' }}>{children}</p>;
}
